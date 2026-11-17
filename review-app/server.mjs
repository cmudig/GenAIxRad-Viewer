import http from 'node:http';
import { readFile, mkdir, open, realpath } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { publicPrompt } from './prompts.mjs';
import { createFirestoreStore } from './firestore-store.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const rubricVersion = 3;
export const clinicalDefinition = 'Anatomically and pathologically plausible, without artifacts that materially mislead clinical interpretation';
export const descriptionDefinition = 'Reflects the displayed series description’s findings: presence or absence, location, and severity. This is description matching, not a diagnostic assertion.';
export const rubric = [
  { id: 'description_match', text: 'Does this generated scan reflect the description?', definition: descriptionDefinition },
  { id: 'clinically_accurate', text: 'Is this generated scan clinically accurate?', definition: clinicalDefinition },
];
export const choices = ['yes', 'no'];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = (status, message) => Object.assign(new Error(message), { status });

export async function startServer({ privateDir = process.env.REVIEW_PRIVATE_DIR || path.join(here, '.private'), port = Number(process.env.REVIEW_PORT || 4318), remoteConfig = process.env.REVIEW_REMOTE_CONFIG, storage = process.env.REVIEW_STORAGE || 'local', assessmentStore } = {}) {
  if (!['local', 'firestore'].includes(storage)) throw new Error('Invalid assessment storage mode');
  privateDir = path.resolve(privateDir);
  const remote = remoteConfig ? JSON.parse(await readFile(remoteConfig, 'utf8')) : null;
  if (remote && (remote.origin !== 'https://genai-radiology-verify.web.app' || !/^[a-f0-9]{64}$/.test(remote.proxyToken))) throw new Error('Invalid remote review proxy configuration');
  const bytes = await readFile(path.join(privateDir, 'manifest.json'));
  const manifestHash = hash(bytes);
  if ((await readFile(path.join(privateDir, 'manifest.sha256'), 'utf8')).trim() !== manifestHash) throw new Error('Manifest seal mismatch. Refusing to start.');
  const manifest = JSON.parse(bytes);
  const cases = new Map(manifest.cases.map(c => [c.id, c]));
  let promptMetadataHash = null;
  const promptMetadata = new Map();
  try {
    const bytes = await readFile(path.join(privateDir, 'prompts.json'));
    promptMetadataHash = hash(bytes);
    if ((await readFile(path.join(privateDir, 'prompts.sha256'), 'utf8')).trim() !== promptMetadataHash) throw new Error('Prompt metadata seal mismatch');
    const data = JSON.parse(bytes);
    if (data.version !== 1 || data.manifestHash !== manifestHash || data.cases.length !== cases.size || new Set(data.cases.map(p => p.caseId)).size !== cases.size || data.cases.some(p => !cases.has(p.caseId))) throw new Error('Prompt metadata belongs to a different cohort');
    for (const p of data.cases) promptMetadata.set(p.caseId, p);
  } catch (error) { if (error.code !== 'ENOENT' || promptMetadataHash) throw error; }
  const allowed = ['678543127898756', '620043239794181'];
  if (cases.size !== 28 || manifest.provenance.targets.length !== 29 || manifest.provenance.unmatched.length !== 1 || new Set(manifest.cases.map(c => c.seriesUID)).size !== 28) throw new Error('Invalid frozen cohort');
  const roots = await Promise.all(allowed.map(uid => realpath(path.join(os.homedir(), 'Downloads', `${uid} Generated Patient ${uid}`))));
  const sources = new Set();
  for (const c of cases.values()) {
    if (!allowed.includes(c.studyUID) || !/^case-\d{3}$/.test(c.id) || !c.frames.length) throw new Error('Invalid manifest case');
    for (const f of c.frames) {
      const source = await realpath(f.path);
      if (!roots.some(root => source.startsWith(root + path.sep)) || path.extname(source).toLowerCase() !== '.dcm' || !Number.isInteger(f.frame) || f.frame < 0 || sources.has(`${source}:${f.frame}`)) throw new Error('Duplicate or unallowlisted source frame');
      sources.add(`${source}:${f.frame}`);
    }
  }
  const store = storage === 'firestore' ? assessmentStore || createFirestoreStore({ manifestHash, caseIds: [...cases.keys()] }) : null;
  const ratingDir = path.join(privateDir, 'ratings');
  const journal = path.join(ratingDir, 'revisions.ndjson');
  let reviews = store ? await store.load() : new Map();
  if (!store) {
  await mkdir(ratingDir, { recursive: true, mode: 0o700 });
  try {
    const text = await readFile(journal, 'utf8');
    for (const line of text.split('\n').filter(Boolean)) {
      const r = JSON.parse(line);
      if (r.manifestHash !== manifestHash || !cases.has(r.caseId)) throw new Error('Review journal belongs to a different cohort');
      reviews.set(r.caseId, r);
    }
  } catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  let writeQueue = Promise.resolve();
  const evidence = new Map([...cases].map(([id]) => [id, { loaded: new Set(reviews.get(id)?.evidence?.loaded || []), errors: new Set(reviews.get(id)?.evidence?.errors || []), failures: new Set(reviews.get(id)?.evidence?.failures || []) }]));
  // Legacy revisions remain untouched in the journal. Never reinterpret old
  // answers (including v2's description-dependent clinical accuracy) as v3 answers.
  const publicReview = r => !r ? null : r.rubricVersion === rubricVersion ? r : { revision: r.revision, rubricVersion: r.rubricVersion, status: 'legacy', answers: {}, comments: '', references: [], evidence: r.evidence };
  const csrf = randomBytes(32).toString('hex');
  const python = process.env.REVIEW_PYTHON || path.join(os.homedir(), 'Downloads/.trajectory-dicom-venv/bin/python');
  const worker = spawn(python, [path.join(here, 'pixels.py'), '--worker', privateDir], { stdio: ['pipe', 'pipe', 'pipe'] });
  let pending = null;
  let dead = false;
  let pixelQueue = Promise.resolve();
  const stopWorker = () => { dead = true; pending?.reject(fail(503, 'Local pixel worker unavailable')); pending = null; };
  worker.on('error', stopWorker);
  worker.on('exit', stopWorker);
  worker.stderr.on('data', () => {}); // Do not leak local file paths into browser/log output.
  createInterface({ input: worker.stdout }).on('line', line => {
    const current = pending;
    pending = null;
    try { current?.resolve(JSON.parse(line)); } catch { current?.reject(fail(503, 'Invalid pixel worker response')); }
  });
  function pixels(caseId, index) {
    const run = pixelQueue.then(() => new Promise((resolve, reject) => {
      if (dead) return reject(fail(503, 'Local pixel worker unavailable'));
      const timeout = setTimeout(() => { reject(fail(503, 'Image decoding timed out')); worker.kill(); }, 30000);
      pending = { resolve: value => { clearTimeout(timeout); resolve(value); }, reject: error => { clearTimeout(timeout); reject(error); } };
      worker.stdin.write(JSON.stringify({ case: caseId, index }) + '\n');
    }));
    pixelQueue = run.catch(() => {});
    return run;
  }
  const assets = new Map(await Promise.all([['/', 'index.html', 'text/html'], ['/app.js', 'app.js', 'text/javascript'], ['/style.css', 'style.css', 'text/css']].map(async ([url, file, type]) => [url, { body: await readFile(path.join(here, file)), type }])));
  let origin;
  function validateReview(body, c, previous) {
    if (!body || body.expectedRevision !== (previous?.revision || 0)) throw fail(409, 'Review changed in another tab. Reload before editing.');
    if (body.rubricVersion !== rubricVersion) throw fail(400, `This review requires rubric v${rubricVersion}; reload before answering`);
    if (!['draft', 'final'].includes(body.status)) throw fail(400, 'Invalid status');
    if (!body.answers || typeof body.answers !== 'object' || Array.isArray(body.answers) || Object.keys(body.answers).some(k => !rubric.some(r => r.id === k)) || Object.values(body.answers).some(v => !choices.includes(v))) throw fail(400, 'Invalid rubric response');
    if (typeof body.comments !== 'string' || body.comments.length > 10000) throw fail(400, 'Comments must be at most 10,000 characters');
    if (!Array.isArray(body.references) || body.references.length > 100 || body.references.some(n => !Number.isInteger(n) || n < 1 || n > c.frames.length)) throw fail(400, 'Unknown slice reference');
    const e = evidence.get(c.id);
    if (body.references.some(n => !e.loaded.has(n - 1))) throw fail(400, 'Slice references must have loaded successfully');
    if (body.status === 'final') {
      if (rubric.some(r => !choices.includes(body.answers[r.id]))) throw fail(400, 'Answer every rubric item; no answers are automatically filled');
      if (body.confirmed !== true) throw fail(400, 'Explicitly finalize this assessment');
      if ((body.answers.description_match !== 'yes' || body.answers.clinically_accurate !== 'yes') && !body.comments.replace(/\bSlice\s+\d+\s*:/gi, '').trim()) throw fail(400, 'Comment required unless question 1 is Yes and question 2 is Plausible (Yes). Please say what is missing, extra, or unrealistic.');
      if (!e.loaded.size || e.failures.size) throw fail(400, 'Images unavailable or unresolved image load failure. Save a draft and skip this case, or retry successfully.');
    }
    return { caseId: c.id, manifestHash, promptMetadataHash, rubricVersion, clinicalDefinition, descriptionDefinition, commentPolicyVersion: 1, displayedPrompt: publicPrompt(promptMetadata.get(c.id)), revision: (previous?.revision || 0) + 1, status: body.status, answers: body.answers, comments: body.comments, references: [...new Set(body.references)], confirmed: body.confirmed === true, evidence: { loaded: [...e.loaded].sort((a, b) => a - b), errors: [...e.errors].sort((a, b) => a - b), failures: [...e.failures].sort((a, b) => a - b), total: c.frames.length }, savedAt: new Date().toISOString() };
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    const json = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
    try {
      const remoteRequest = !!remote && req.headers['x-review-proxy'] === remote.proxyToken && req.headers.origin === remote.origin && req.url.startsWith('/api/');
      if (req.headers.host !== new URL(origin).host || (!remoteRequest && ((req.headers.origin && req.headers.origin !== origin) || req.headers['sec-fetch-site'] === 'cross-site'))) throw fail(403, 'Only same-origin loopback or authenticated review proxy access is allowed');
      if (remoteRequest) {
        res.setHeader('Access-Control-Allow-Origin', remote.origin);
        res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Expose-Headers', 'X-Frame-Metadata');
        res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      }
      const url = new URL(req.url, origin);
      if (req.method === 'GET' && assets.has(url.pathname)) { const a = assets.get(url.pathname); res.writeHead(200, { 'Content-Type': a.type }); return res.end(a.body); }
      if (req.method === 'GET' && url.pathname === '/api/session') {
        if (store) reviews = await store.load();
        return json(200, { csrf, manifestHash, storage, assessmentCollection: store ? 'afrooz-review' : null, rubricVersion, clinicalDefinition, descriptionDefinition, rubric, choices, counts: { targets: 29, matched: 28, unmatched: 1 }, cases: [...cases.values()].map(c => ({ id: c.id, title: c.title, frames: c.frames.length, ordering: c.ordering, prompt: publicPrompt(promptMetadata.get(c.id)), review: publicReview(reviews.get(c.id)) })) });
      }
      const frame = url.pathname.match(/^\/api\/frame\/(case-\d{3})\/(\d+)$/);
      if (req.method === 'GET' && frame) {
        const c = cases.get(frame[1]), index = Number(frame[2]);
        if (!c || !Number.isSafeInteger(index) || index < 0 || index >= c.frames.length) throw fail(404, 'Unknown allowlisted frame');
        let result;
        try { result = await pixels(c.id, index); } catch (error) { evidence.get(c.id).errors.add(index); evidence.get(c.id).failures.add(index); throw error; }
        if (!result.ok) { evidence.get(c.id).errors.add(index); evidence.get(c.id).failures.add(index); throw fail(422, result.error); }
        evidence.get(c.id).loaded.add(index);
        evidence.get(c.id).failures.delete(index);
        const data = Buffer.from(result.pixels, 'base64');
        res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'X-Frame-Metadata': JSON.stringify(result.metadata) });
        return res.end(data);
      }
      const review = url.pathname.match(/^\/api\/review\/(case-\d{3})$/);
      if (req.method === 'PUT' && review && cases.has(review[1])) {
        if (req.headers['x-review-token'] !== csrf || (!remoteRequest && req.headers.origin !== origin) || !req.headers['content-type']?.startsWith('application/json')) throw fail(403, 'Missing same-origin review token');
        let raw = '';
        for await (const chunk of req) { raw += chunk; if (Buffer.byteLength(raw) > 32768) throw fail(413, 'Review too large'); }
        let body;
        try { body = JSON.parse(raw); } catch { throw fail(400, 'Invalid JSON'); }
        const save = writeQueue.then(async () => {
          const previous = store ? await store.get(review[1]) : reviews.get(review[1]);
          const record = validateReview(body, cases.get(review[1]), previous);
          if (store) await store.save(record, body.expectedRevision);
          else {
          const file = await open(journal, 'a', 0o600);
          try { await file.writeFile(JSON.stringify(record) + '\n'); await file.sync(); } finally { await file.close(); }
          }
          reviews.set(record.caseId, record);
          return record;
        });
        writeQueue = save.catch(() => {});
        return json(200, await save);
      }
      throw fail(404, 'Not found');
    } catch (error) { if (!res.headersSent) json(error.status || 500, { error: error.status ? error.message : 'Local request failed; no data was saved.' }); else res.end(); }
  });
  server.on('close', () => worker.kill());
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  origin = `http://127.0.0.1:${server.address().port}`;
  return { server, origin, manifestHash, close: async () => { worker.kill(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = await startServer({ storage: process.env.REVIEW_STORAGE || 'firestore' });
  console.log(`Local review: ${app.origin} · PID ${process.pid} · 28 cases · ${process.env.REVIEW_REMOTE_CONFIG ? 'authenticated HTTPS proxy enabled' : 'no authentication (single local reviewer only)'}`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await app.close(); process.exit(0); });
}

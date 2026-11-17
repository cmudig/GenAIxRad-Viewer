import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile, writeFile, mkdir, copyFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { startServer, clinicalDefinition, descriptionDefinition, rubric } from './server.mjs';
import { buildPromptMetadata, publicPrompt } from './prompts.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
test('Firestore mode is authoritative and never appends local assessments or acknowledges failed cloud saves', async () => {
  const privateDir = path.join(here, '.test-private', `cloud-api-${process.pid}`);
  await mkdir(privateDir, { recursive: true, mode: 0o700 });
  for (const name of ['manifest.json', 'manifest.sha256', 'prompts.json', 'prompts.sha256']) await copyFile(path.join(here, '.private', name), path.join(privateDir, name));
  const saved = new Map();
  let outage = false;
  const assessmentStore = {
    load: async () => new Map(saved),
    get: async id => saved.get(id) || null,
    save: async (record, expected) => {
      if (outage) throw Object.assign(new Error('Assessment storage unavailable'), { status: 503 });
      assert.equal(saved.get(record.caseId)?.revision || 0, expected);
      saved.set(record.caseId, record);
      return record;
    },
  };
  let app = await startServer({ privateDir, port: 0, storage: 'firestore', assessmentStore });
  try {
    const session = await (await fetch(app.origin + '/api/session')).json();
    assert.equal(session.storage, 'firestore');
    assert.equal(session.assessmentCollection, 'afrooz-review');
    const body = { expectedRevision: 0, rubricVersion: 3, status: 'draft', answers: {}, comments: 'Isolated cloud test', references: [], confirmed: false };
    const put = () => fetch(app.origin + '/api/review/case-001', { method: 'PUT', headers: { Origin: app.origin, 'Content-Type': 'application/json', 'X-Review-Token': session.csrf }, body: JSON.stringify(body) });
    outage = true;
    assert.equal((await put()).status, 503);
    assert.equal(saved.size, 0);
    outage = false;
    assert.equal((await put()).status, 200);
    assert.equal(saved.get('case-001').revision, 1);
    assert.equal((await put()).status, 409);
    await assert.rejects(readFile(path.join(privateDir, 'ratings/revisions.ndjson')), { code: 'ENOENT' });
    await app.close();
    app = await startServer({ privateDir, port: 0, storage: 'firestore', assessmentStore });
    const restarted = await (await fetch(app.origin + '/api/session')).json();
    assert.equal(restarted.cases[0].review.revision, 1);
  } finally { await app.close(); await rm(privateDir, { recursive: true, force: true }); }
});

test('remote review requires exact origin, private proxy proof, CSRF, and revision validation', async () => {
  const privateDir = path.join(here, '.test-private', `remote-api-${process.pid}`);
  await mkdir(privateDir, { recursive: true, mode: 0o700 });
  for (const name of ['manifest.json', 'manifest.sha256', 'prompts.json', 'prompts.sha256']) await copyFile(path.join(here, '.private', name), path.join(privateDir, name));
  const origin = 'https://genai-radiology-verify.web.app';
  const proxyToken = 'a'.repeat(64);
  const remoteConfig = path.join(privateDir, 'proxy.json');
  await writeFile(remoteConfig, JSON.stringify({ origin, proxyToken }));
  const app = await startServer({ privateDir, port: 0, remoteConfig });
  try {
    const headers = { Origin: origin, 'Sec-Fetch-Site': 'cross-site', 'X-Review-Proxy': proxyToken };
    assert.equal((await fetch(app.origin + '/api/session', { headers: { ...headers, 'X-Review-Proxy': 'wrong' } })).status, 403);
    assert.equal((await fetch(app.origin + '/api/session', { headers: { ...headers, Origin: 'https://attacker.invalid' } })).status, 403);
    const response = await fetch(app.origin + '/api/session', { headers });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('access-control-allow-origin'), origin);
    assert.equal(response.headers.get('access-control-expose-headers'), 'X-Frame-Metadata');
    const session = await response.json();
    const body = { expectedRevision: 0, rubricVersion: 3, status: 'draft', answers: {}, comments: 'Isolated remote test', references: [], confirmed: false };
    const put = extra => fetch(app.origin + '/api/review/case-001', { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json', 'X-Review-Token': session.csrf, ...extra }, body: JSON.stringify(body) });
    assert.equal((await put({ 'X-Review-Token': 'wrong' })).status, 403);
    assert.equal((await put({ Origin: 'https://attacker.invalid' })).status, 403);
    assert.equal((await put({})).status, 200);
    assert.equal((await put({})).status, 409);
    assert.equal((await fetch(app.origin + '/', { headers })).status, 403, 'Proxy trust is restricted to API paths');
  } finally { await app.close(); await rm(privateDir, { recursive: true, force: true }); }
});

test('frozen cohort, every case image endpoints, request safety, validation, revisions, and restart', { timeout: 180000 }, async () => {
  const privateDir = path.join(here, '.test-private', `api-${process.pid}`);
  await mkdir(privateDir, { recursive: true, mode: 0o700 });
  for (const name of ['manifest.json', 'manifest.sha256', 'prompts.json', 'prompts.sha256']) await copyFile(path.join(here, '.private', name), path.join(privateDir, name));
  const manifestHash = (await readFile(path.join(privateDir, 'manifest.sha256'), 'utf8')).trim();
  await mkdir(path.join(privateDir, 'ratings'));
  const legacy = ['case-026', 'case-027', 'case-028'].map((caseId, i) => ({ caseId, manifestHash, rubricVersion: 1, revision: 1, status: 'final', answers: i ? { imperfect_present: i === 1 ? 'yes' : 'no' } : { interpretable: 'yes', plausible: 'no', abnormality: 'yes', artifact: 'no' }, comments: 'Legacy audit only', references: [], evidence: { loaded: [], errors: [] } }));
  legacy.unshift({ caseId: 'case-025', manifestHash, rubricVersion: 2, clinicalDefinition: 'Earlier description-dependent definition', revision: 4, status: 'final', answers: { clinically_accurate: 'yes' }, comments: 'Retain v2 comment', references: [1], evidence: { loaded: [0], errors: [] } });
  await writeFile(path.join(privateDir, 'ratings/revisions.ndjson'), legacy.map(JSON.stringify).join('\n') + '\n');
  let app = await startServer({ privateDir, port: 0 });
  try {
    assert.equal(app.server.address().address, '127.0.0.1');
    const snapshotHTML = await readFile(path.join(process.env.HOME, 'Downloads/explanation-trajectory-report.html'), 'utf8');
    const snapshot = JSON.parse(snapshotHTML.match(/<script id="snapshot" type="application\/json">([\s\S]*?)<\/script>/)[1]);
    const source = JSON.parse(await readFile(path.join(privateDir, 'manifest.json'), 'utf8'));
    const targets = new Set(snapshot.variations.filter(v => ['678543127898756', '620043239794181'].includes(v.studyUID) && snapshot.sessions.some(s => v.t >= s.start && v.t < s.end)).map(v => JSON.stringify([v.studyUID, v.seriesUID])));
    assert.equal(targets.size, 29);
    assert.deepEqual(new Set(source.provenance.targets.map(v => JSON.stringify([v.studyUID, v.seriesUID]))), targets);
    assert.equal(source.cases.length, 28);
    assert.equal(source.provenance.unmatched.length, 1);
    assert.equal(new Set(source.cases.map(c => c.seriesUID)).size, 28);
    const getSession = async () => (await fetch(app.origin + '/api/session')).json();
    let session = await getSession();
    assert.equal(session.cases.length, 28);
    assert.deepEqual(session.counts, { targets: 29, matched: 28, unmatched: 1 });
    const publicText = JSON.stringify(session);
    for (const hidden of ['studyUID', 'seriesUID', 'documentId', 'promptKey', 'participant', 'Generated Patient', '/Users/']) assert.ok(!publicText.includes(hidden), `Unexpected public metadata: ${hidden}`);
    assert.ok(session.cases.every(c => /^Case \d{3}$/.test(c.title)));
    assert.ok(session.cases.slice(0, 24).every(c => c.review === null));
    for (const c of session.cases.slice(24)) {
      assert.equal(c.review.status, 'legacy'); assert.deepEqual(c.review.answers, {});
      assert.equal(c.review.comments, ''); assert.deepEqual(c.review.references, []);
    }
    assert.equal(session.cases[24].review.revision, 4);
    assert.equal(session.cases[24].review.rubricVersion, 2);
    assert.equal(session.rubricVersion, 3);
    assert.deepEqual(session.choices, ['yes', 'no']);
    assert.deepEqual(session.rubric, rubric);
    assert.deepEqual(session.rubric.map(r => r.id), ['description_match', 'clinically_accurate']);
    assert.equal(session.clinicalDefinition, clinicalDefinition);
    assert.equal(session.descriptionDefinition, descriptionDefinition);
    assert.ok(session.cases.every(c => c.prompt.description && c.prompt.prompts.length && c.prompt.originalGenerationPromptVerified === false));
    assert.equal(session.cases.filter(c => c.prompt.prompts.length > 1).length, 3);
    const put = async (id, body, headers = {}) => fetch(app.origin + '/api/review/' + id, { method: 'PUT', headers: { Origin: app.origin, 'Content-Type': 'application/json', 'X-Review-Token': session.csrf, ...headers }, body: JSON.stringify(body) });
    const valid = { expectedRevision: 0, rubricVersion: 3, status: 'final', answers: { clinically_accurate: 'yes', description_match: 'yes' }, comments: '', references: [], confirmed: true };
    assert.equal((await put('case-001', valid)).status, 400, 'Cannot finalize without loaded images');
    const bytesByCase = [];
    for (const c of session.cases) {
      for (const index of new Set([0, c.frames - 1])) {
        const response = await fetch(`${app.origin}/api/frame/${c.id}/${index}`);
        assert.equal(response.status, 200, `${c.id} frame ${index}`);
        const metadata = JSON.parse(response.headers.get('x-frame-metadata'));
        const bytes = await response.arrayBuffer();
        assert.equal(bytes.byteLength, metadata.rows * metadata.columns * 4);
        assert.ok(metadata.maximum > metadata.minimum, 'Image should not be uniformly blank');
        assert.ok(Number.isFinite(new Float32Array(bytes)[0]));
        bytesByCase.push(bytes.byteLength);
      }
    }
    console.log(`Decoded first/last API frames across all 28 cases: ${bytesByCase.length} requests`);
    for (const route of ['/api/frame/case-999/0', '/api/frame/case-001/999999', '/api/frame/case-001/-1', '/api/frame/case-001/0/extra', '/manifest.json', '/.private/manifest.json', '/pixels.py', '/api/frame?path=/etc/passwd']) assert.equal((await fetch(app.origin + route)).status, 404, route);
    // Undici rewrites Host; use a raw HTTP request to exercise DNS-rebinding protection.
    const hostileHostStatus = await new Promise((resolve, reject) => {
      http.get(app.origin + '/api/session', { headers: { Host: 'attacker.invalid' } }, response => { response.resume(); resolve(response.statusCode); }).on('error', reject);
    });
    assert.equal(hostileHostStatus, 403);
    assert.equal((await fetch(app.origin + '/api/session', { headers: { Origin: 'https://attacker.invalid' } })).status, 403);
    assert.equal((await put('case-001', valid, { 'X-Review-Token': 'wrong' })).status, 403);
    assert.equal((await put('case-001', { ...valid, answers: {} })).status, 400);
    assert.equal((await put('case-001', { ...valid, rubricVersion: 1 })).status, 400);
    assert.equal((await put('case-001', { ...valid, rubricVersion: 2 })).status, 400);
    assert.equal((await put('case-001', { ...valid, answers: { clinically_accurate: 'yes' } })).status, 400, 'Description match is required for final');
    assert.equal((await put('case-001', { ...valid, answers: { description_match: 'no' } })).status, 400, 'Clinical accuracy is required for final');
    assert.equal((await put('case-001', { ...valid, answers: { ...valid.answers, description_match: 'uncertain' } })).status, 400);
    assert.equal((await put('case-001', { ...valid, answers: { clinically_accurate: 'uncertain' } })).status, 400);
    assert.equal((await put('case-001', { ...valid, confirmed: false })).status, 400);
    assert.equal((await put('case-001', { ...valid, references: [99999] })).status, 400);
    assert.equal((await put('case-001', { ...valid, references: [2] })).status, 400, 'Cannot reference a never-loaded slice');
    assert.equal((await put('case-001', { ...valid, answers: { ...valid.answers, artifact: 'unable' } })).status, 400);
    let response = await put('case-001', { ...valid, status: 'draft', answers: {}, comments: 'Draft persists locally', references: [1] });
    assert.equal(response.status, 200);
    let saved = await response.json();
    assert.equal(saved.revision, 1); assert.equal(saved.status, 'draft');
    assert.equal((await put('case-001', valid)).status, 409);
    response = await put('case-001', { ...valid, expectedRevision: 1, references: [1], comments: 'Confirmed partial load' });
    assert.equal(response.status, 200); saved = await response.json();
    assert.equal(saved.status, 'final'); assert.equal(saved.revision, 2);
    assert.equal(saved.rubricVersion, 3); assert.ok(saved.promptMetadataHash); assert.ok(saved.displayedPrompt.description);
    assert.equal(saved.clinicalDefinition, clinicalDefinition); assert.equal(saved.descriptionDefinition, descriptionDefinition);
    assert.equal(saved.evidence.loaded.length, 2); assert.ok(saved.evidence.total > 2);
    await app.close(); app = await startServer({ privateDir, port: 0 }); session = await getSession();
    assert.equal(session.cases[0].review.revision, 2); assert.equal(session.cases[0].review.status, 'final');
    response = await put('case-001', { ...valid, expectedRevision: 2, status: 'draft', comments: 'Revision after final' });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).revision, 3);
    const revisions = (await readFile(path.join(privateDir, 'ratings/revisions.ndjson'), 'utf8')).trim().split('\n').map(JSON.parse);
    assert.deepEqual(revisions.filter(r => r.caseId === 'case-001').map(r => r.status), ['draft', 'final', 'draft']);
    assert.deepEqual(revisions.slice(0, legacy.length), legacy, 'Legacy v1 and v2 records must remain unchanged');
    for (const [i, [clinical, match]] of [['yes', 'yes'], ['yes', 'no'], ['no', 'yes'], ['no', 'no']].entries()) {
      const id = `case-00${i + 3}`;
      assert.equal((await fetch(`${app.origin}/api/frame/${id}/0`)).status, 200);
      if (clinical !== 'yes' || match !== 'yes') {
        for (const comments of ['', '   ', 'Slice 1: ']) {
          assert.equal((await put(id, { ...valid, comments, answers: { clinically_accurate: clinical, description_match: match } })).status, 400, 'Non-positive final requires substantive comment');
        }
      }
      response = await put(id, { ...valid, comments: clinical === 'yes' && match === 'yes' ? '' : 'Unrealistic anatomy in this synthetic test.', answers: { clinically_accurate: clinical, description_match: match } });
      assert.equal(response.status, 200, `Independent final answers ${clinical}/${match} accepted`);
      assert.deepEqual((await response.json()).answers, { clinically_accurate: clinical, description_match: match });
    }
    response = await put('case-025', { ...valid, expectedRevision: 4, status: 'draft', answers: { description_match: 'no' } });
    assert.equal(response.status, 200);
    saved = await response.json(); assert.equal(saved.revision, 5); assert.deepEqual(saved.answers, { description_match: 'no' });
    const audit = (await readFile(path.join(privateDir, 'ratings/revisions.ndjson'), 'utf8')).trim().split('\n').map(JSON.parse);
    assert.deepEqual(audit.slice(0, legacy.length), legacy, 'Reassessment appends without changing earlier answers, comments, references, or definition');
    await app.close(); app = await startServer({ privateDir, port: 0 }); session = await getSession();
    assert.equal(session.cases[24].review.rubricVersion, 3); assert.equal(session.cases[24].review.status, 'draft');
    assert.deepEqual(session.cases[24].review.answers, { description_match: 'no' }, 'Restart does not infer a clinical answer');
    response = await put('case-028', { ...valid, expectedRevision: 1, status: 'draft', answers: {} });
    assert.equal(response.status, 200);
    saved = await response.json(); assert.equal(saved.revision, 2); assert.equal(saved.rubricVersion, 3); assert.deepEqual(saved.answers, {});
    await app.close();
    const originalPython = process.env.REVIEW_PYTHON;
    process.env.REVIEW_PYTHON = '/nonexistent/local-review-test-python';
    try { app = await startServer({ privateDir, port: 0 }); } finally { if (originalPython) process.env.REVIEW_PYTHON = originalPython; else delete process.env.REVIEW_PYTHON; }
    session = await getSession();
    assert.equal((await fetch(app.origin + '/api/frame/case-002/0')).status, 503);
    response = await put('case-002', valid);
    assert.equal(response.status, 400, 'Image failure blocks final even with previously loaded images');
    response = await put('case-002', { ...valid, status: 'draft', answers: {}, comments: '' });
    assert.equal(response.status, 200);
    saved = await response.json(); assert.deepEqual(saved.answers, {}); assert.deepEqual(saved.evidence.errors, [0]); assert.deepEqual(saved.evidence.failures, [0]);
    await app.close(); app = await startServer({ privateDir, port: 0 }); session = await getSession();
    assert.equal((await fetch(app.origin + '/api/frame/case-002/0')).status, 200);
    response = await put('case-002', { ...valid, expectedRevision: 1, comments: 'Unrealistic anatomy.', answers: { clinically_accurate: 'no', description_match: 'yes' } });
    assert.equal(response.status, 200); saved = await response.json();
    assert.deepEqual(saved.evidence.failures, []); assert.deepEqual(saved.evidence.errors, [0]);
  } finally { await app.close(); await rm(privateDir, { recursive: true, force: true }); }
});

test('prompt provenance uses exact pair and strict windows, retaining all distinct prompts without inventing captions', () => {
  const manifest = { cases: [{ id: 'case-001', studyUID: 'study', seriesUID: 'series' }] };
  const index = { series: [{ studyUID: 'study', seriesUID: 'series', descriptions: ['DICOM caption'] }] };
  const log = (t, promptText, extra = {}) => ({ studyInstanceUID: 'study', seriesInstanceUID: 'series', createdAt: new Date(t).toISOString(), promptText, promptKey: 'key', documentId: 'private-id', ...extra });
  const rows = [log(1000, 'First'), log(1500, 'Second'), log(1600, 'First'), log(999, 'Outside'), log(2000, 'At excluded end'), log(1500, 'Wrong study', { studyInstanceUID: 'other' }), log(1500, 'Wrong series', { seriesInstanceUID: 'other' })];
  const [metadata] = buildPromptMetadata(manifest, index, rows, [{ start: 1000, end: 2000 }]);
  const p = publicPrompt(metadata);
  assert.equal(p.description, 'DICOM caption'); assert.equal(p.eventCount, 3);
  assert.deepEqual(p.prompts, [{ text: 'First', eventCount: 2 }, { text: 'Second', eventCount: 1 }]);
  assert.equal(p.originalGenerationPromptVerified, false);
  assert.ok(!JSON.stringify(p).includes('private-id'));
  assert.deepEqual(publicPrompt(null).prompts, []);
});

test('missing provenance stays explicitly unverified; corrupt provenance is rejected', async () => {
  const privateDir = path.join(here, '.test-private', `provenance-${process.pid}`);
  await mkdir(privateDir, { recursive: true, mode: 0o700 });
  let app;
  try {
    for (const name of ['manifest.json', 'manifest.sha256']) await copyFile(path.join(here, '.private', name), path.join(privateDir, name));
    app = await startServer({ privateDir, port: 0 });
    const session = await (await fetch(app.origin + '/api/session')).json();
    assert.ok(session.cases.every(c => c.prompt.description === null && c.prompt.prompts.length === 0 && !c.prompt.originalGenerationPromptVerified));
    await app.close(); app = null;
    await writeFile(path.join(privateDir, 'prompts.json'), '{}');
    await writeFile(path.join(privateDir, 'prompts.sha256'), 'incorrect seal');
    await assert.rejects(startServer({ privateDir, port: 0 }), /Prompt metadata seal mismatch/);
  } finally { await app?.close(); await rm(privateDir, { recursive: true, force: true }); }
});

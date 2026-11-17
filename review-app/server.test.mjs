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
    const body = { expectedRevision: 0, rubricVersion: 4, status: 'draft', answers: {}, comments: 'Isolated cloud test', references: [], confirmed: false };
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
  const app = await startServer({ privateDir, port: 0, remoteConfig, storage: 'local' });
  try {
    const headers = { Origin: origin, 'Sec-Fetch-Site': 'cross-site', 'X-Review-Proxy': proxyToken };
    assert.equal((await fetch(app.origin + '/api/session', { headers: { ...headers, 'X-Review-Proxy': 'wrong' } })).status, 403);
    assert.equal((await fetch(app.origin + '/api/session', { headers: { ...headers, Origin: 'https://attacker.invalid' } })).status, 403);
    const response = await fetch(app.origin + '/api/session', { headers });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('access-control-allow-origin'), origin);
    assert.equal(response.headers.get('access-control-expose-headers'), 'X-Frame-Metadata');
    const session = await response.json();
    const body = { expectedRevision: 0, rubricVersion: 4, status: 'draft', answers: {}, comments: 'Isolated remote test', references: [], confirmed: false };
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
  const priorV3 = { rubricVersion: 3, revision: 7, status: 'final', answers: { description_match: 'no', clinically_accurate: 'yes' }, comments: 'Retain original v3 assessment', references: [1], savedAt: '2026-11-15T12:00:00.000Z', clinicalDefinition: 'Original v3 clinical definition', descriptionDefinition: 'Original v3 description definition', commentPolicyVersion: 1, confirmed: true };
  legacy.unshift({ caseId: 'case-024', manifestHash, ...priorV3, evidence: { loaded: [0], errors: [] } });
  await writeFile(path.join(privateDir, 'ratings/revisions.ndjson'), legacy.map(JSON.stringify).join('\n') + '\n');
  let app = await startServer({ privateDir, port: 0, storage: 'local' });
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
    assert.ok(session.cases.slice(0, 23).every(c => c.review === null));
    for (const c of session.cases.slice(23)) {
      assert.equal(c.review.status, 'legacy'); assert.deepEqual(c.review.answers, {});
      assert.equal(c.review.comments, ''); assert.deepEqual(c.review.references, []);
    }
    assert.equal(session.cases[24].review.revision, 4);
    assert.equal(session.cases[24].review.rubricVersion, 2);
    assert.equal(session.cases[23].review.rubricVersion, 3);
    assert.deepEqual(session.cases[23].review.previousAssessment, priorV3);
    assert.equal(session.rubricVersion, 4);
    assert.equal(Object.hasOwn(session, 'choices'), false, 'Choices belong to each rubric item, not the session');
    assert.deepEqual(session.rubric, rubric);
    assert.deepEqual(session.rubric.map(r => r.id), ['description_match', 'clinical_plausibility']);
    assert.deepEqual(session.rubric.map(r => r.choices.map(choice => choice.value)), [
      ['matches', 'partially_matches', 'does_not_match'],
      ['plausible', 'plausible_overall', 'not_plausible_overall'],
    ]);
    assert.deepEqual(session.rubric.map(r => r.issueField), ['descriptionIssues', 'realismIssues']);
    assert.equal(session.clinicalDefinition, clinicalDefinition);
    assert.equal(session.descriptionDefinition, descriptionDefinition);
    assert.ok(session.cases.every(c => c.prompt.description && c.prompt.prompts.length && c.prompt.originalGenerationPromptVerified === false));
    assert.equal(session.cases.filter(c => c.prompt.prompts.length > 1).length, 3);
    const put = async (id, body, headers = {}) => fetch(app.origin + '/api/review/' + id, { method: 'PUT', headers: { Origin: app.origin, 'Content-Type': 'application/json', 'X-Review-Token': session.csrf, ...headers }, body: JSON.stringify(body) });
    const valid = { expectedRevision: 0, rubricVersion: 4, status: 'final', answers: { clinical_plausibility: 'plausible', description_match: 'matches' }, comments: '', references: [], confirmed: true };
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
    assert.equal((await put('case-001', { ...valid, rubricVersion: 3 })).status, 400);
    assert.equal((await put('case-001', { ...valid, answers: { clinical_plausibility: 'plausible' } })).status, 400, 'Description match is required for final');
    assert.equal((await put('case-001', { ...valid, answers: { description_match: 'matches' } })).status, 400, 'Clinical plausibility is required for final');
    assert.equal((await put('case-001', { ...valid, answers: { ...valid.answers, description_match: 'uncertain' } })).status, 400);
    assert.equal((await put('case-001', { ...valid, answers: { ...valid.answers, clinical_plausibility: 'uncertain' } })).status, 400);
    for (const answers of [{ description_match: 'yes', clinical_plausibility: 'plausible' }, { ...valid.answers, clinically_accurate: 'yes' }]) {
      assert.equal((await put('case-001', { ...valid, answers })).status, 400, 'Legacy answers cannot be submitted as v4');
    }
    assert.equal((await put('case-001', { ...valid, confirmed: false })).status, 400);
    assert.equal((await put('case-001', { ...valid, references: [99999] })).status, 400);
    assert.equal((await put('case-001', { ...valid, references: [2] })).status, 400, 'Cannot reference a never-loaded slice');
    assert.equal((await put('case-001', { ...valid, answers: { ...valid.answers, artifact: 'unable' } })).status, 400);
    for (const item of rubric) {
      for (const status of ['draft', 'final']) {
        for (const issues of [null, 'other', ['unknown_tag'], ['other', 'other'], [1], [{}]]) {
          const invalid = { ...valid, status, comments: 'Tag validation', answers: { ...valid.answers, [item.id]: item.issueWhen[0] }, [item.issueField]: issues };
          assert.equal((await put('case-001', invalid)).status, 400, `${item.issueField} rejects malformed, unknown, or duplicate tags in ${status}`);
        }
        assert.equal((await put('case-001', { ...valid, status, [item.issueField]: ['other'] })).status, 400, 'Tags cannot accompany a positive parent answer');
        assert.equal((await put('case-001', { ...valid, status, answers: {}, [item.issueField]: ['other'] })).status, 400, 'Tags cannot accompany an unanswered parent');
      }
    }
    const spoofedPrevious = { rubricVersion: 3, revision: 999, answers: { description_match: 'yes' }, comments: 'Forged prior assessment' };
    let response = await put('case-001', { ...valid, status: 'draft', answers: {}, comments: 'Draft persists locally', references: [1], previousAssessment: spoofedPrevious });
    assert.equal(response.status, 200);
    let saved = await response.json();
    assert.equal(saved.revision, 1); assert.equal(saved.status, 'draft');
    assert.equal(Object.hasOwn(saved, 'previousAssessment'), false, 'A request cannot invent a previous assessment');
    assert.equal((await put('case-001', valid)).status, 409);
    response = await put('case-001', { ...valid, expectedRevision: 1, references: [1], comments: 'Confirmed partial load' });
    assert.equal(response.status, 200); saved = await response.json();
    assert.equal(saved.status, 'final'); assert.equal(saved.revision, 2);
    assert.equal(saved.rubricVersion, 4); assert.ok(saved.promptMetadataHash); assert.ok(saved.displayedPrompt.description);
    assert.equal(saved.commentPolicyVersion, 2);
    assert.deepEqual(saved.rubricSnapshot, rubric);
    assert.deepEqual(saved.descriptionIssues, []); assert.deepEqual(saved.realismIssues, []);
    assert.equal(saved.clinicalDefinition, clinicalDefinition); assert.equal(saved.descriptionDefinition, descriptionDefinition);
    assert.equal(saved.evidence.loaded.length, 2); assert.ok(saved.evidence.total > 2);
    await app.close(); app = await startServer({ privateDir, port: 0, storage: 'local' }); session = await getSession();
    assert.equal(session.cases[0].review.revision, 2); assert.equal(session.cases[0].review.status, 'final');
    assert.deepEqual(session.cases[0].review, saved, 'Reload preserves the entire v4 assessment and rubric snapshot');
    response = await put('case-001', { ...valid, expectedRevision: 2, status: 'draft', comments: 'Revision after final' });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).revision, 3);
    const revisions = (await readFile(path.join(privateDir, 'ratings/revisions.ndjson'), 'utf8')).trim().split('\n').map(JSON.parse);
    assert.deepEqual(revisions.filter(r => r.caseId === 'case-001').map(r => r.status), ['draft', 'final', 'draft']);
    assert.deepEqual(revisions.slice(0, legacy.length), legacy, 'Legacy v1, v2, and v3 records must remain unchanged');
    const combinations = ['plausible', 'plausible_overall', 'not_plausible_overall'].flatMap(clinical => ['matches', 'partially_matches', 'does_not_match'].map(match => [clinical, match]));
    for (const [i, [clinical, match]] of combinations.entries()) {
      const id = `case-${String(i + 3).padStart(3, '0')}`;
      assert.equal((await fetch(`${app.origin}/api/frame/${id}/0`)).status, 200);
      if (clinical !== 'plausible' || match !== 'matches') {
        for (const comments of ['', '   ', 'Slice 1: ']) {
          assert.equal((await put(id, { ...valid, comments, answers: { clinical_plausibility: clinical, description_match: match } })).status, 400, 'Non-positive final requires substantive comment');
        }
      }
      response = await put(id, { ...valid, comments: clinical === 'plausible' && match === 'matches' ? '' : 'Unrealistic anatomy in this synthetic test.', answers: { clinical_plausibility: clinical, description_match: match } });
      assert.equal(response.status, 200, `Independent final answers ${clinical}/${match} accepted`);
      saved = await response.json();
      assert.deepEqual(saved.answers, { clinical_plausibility: clinical, description_match: match });
      assert.deepEqual(saved.descriptionIssues, []); assert.deepEqual(saved.realismIssues, []);
    }
    response = await put('case-025', { ...valid, expectedRevision: 4, status: 'draft', answers: { description_match: 'does_not_match' } });
    assert.equal(response.status, 200);
    saved = await response.json(); assert.equal(saved.revision, 5); assert.deepEqual(saved.answers, { description_match: 'does_not_match' });
    const tagged = { ...valid, expectedRevision: 7, status: 'draft', answers: { description_match: 'partially_matches', clinical_plausibility: 'plausible_overall' }, descriptionIssues: rubric[0].issueOptions.map(option => option.value), realismIssues: rubric[1].issueOptions.map(option => option.value), comments: 'Retain selected concerns and the original v3 review.', previousAssessment: spoofedPrevious };
    response = await put('case-024', tagged);
    assert.equal(response.status, 200);
    saved = await response.json();
    assert.equal(saved.revision, 8);
    assert.deepEqual(saved.previousAssessment, priorV3, 'Server-loaded v3 fields are preserved verbatim, not replaced by request fields');
    assert.deepEqual(saved.descriptionIssues, tagged.descriptionIssues);
    assert.deepEqual(saved.realismIssues, tagged.realismIssues);
    assert.equal((await put('case-024', tagged)).status, 409, 'Stale CAS cannot overwrite the assessment or its prior snapshot');
    const competing = await Promise.all([
      put('case-024', { ...tagged, expectedRevision: 8, status: 'final', previousAssessment: null }),
      put('case-024', { ...tagged, expectedRevision: 8, status: 'final', previousAssessment: spoofedPrevious }),
    ]);
    assert.deepEqual(competing.map(result => result.status).sort(), [200, 409], 'Only one concurrent CAS request may commit');
    const taggedFinal = await competing.find(result => result.status === 200).json();
    assert.equal(taggedFinal.revision, 9);
    assert.deepEqual(taggedFinal.previousAssessment, priorV3, 'Further v4 saves cannot clear or spoof the preserved v3 snapshot');
    assert.deepEqual(taggedFinal.descriptionIssues, tagged.descriptionIssues);
    assert.deepEqual(taggedFinal.realismIssues, tagged.realismIssues);
    const audit = (await readFile(path.join(privateDir, 'ratings/revisions.ndjson'), 'utf8')).trim().split('\n').map(JSON.parse);
    assert.deepEqual(audit.slice(0, legacy.length), legacy, 'Reassessment appends without changing earlier answers, comments, references, or definition');
    const v3ReassessmentHistory = audit.filter(record => record.caseId === 'case-024');
    assert.deepEqual(v3ReassessmentHistory.map(record => record.revision), [7, 8, 9], 'Rejected CAS requests append no history');
    assert.deepEqual(v3ReassessmentHistory[0], legacy[0]);
    assert.ok(v3ReassessmentHistory.slice(1).every(record => JSON.stringify(record.previousAssessment) === JSON.stringify(priorV3)));
    await app.close(); app = await startServer({ privateDir, port: 0, storage: 'local' }); session = await getSession();
    assert.deepEqual(session.cases[23].review, taggedFinal, 'Reload preserves tags, v4 metadata, and the original v3 assessment');
    assert.equal(session.cases[24].review.rubricVersion, 4); assert.equal(session.cases[24].review.status, 'draft');
    assert.deepEqual(session.cases[24].review.answers, { description_match: 'does_not_match' }, 'Restart does not infer a clinical answer');
    response = await put('case-028', { ...valid, expectedRevision: 1, status: 'draft', answers: {} });
    assert.equal(response.status, 200);
    saved = await response.json(); assert.equal(saved.revision, 2); assert.equal(saved.rubricVersion, 4); assert.deepEqual(saved.answers, {});
    await app.close();
    const originalPython = process.env.REVIEW_PYTHON;
    process.env.REVIEW_PYTHON = '/nonexistent/local-review-test-python';
    try { app = await startServer({ privateDir, port: 0, storage: 'local' }); } finally { if (originalPython) process.env.REVIEW_PYTHON = originalPython; else delete process.env.REVIEW_PYTHON; }
    session = await getSession();
    assert.equal((await fetch(app.origin + '/api/frame/case-002/0')).status, 503);
    response = await put('case-002', valid);
    assert.equal(response.status, 400, 'Image failure blocks final even with previously loaded images');
    response = await put('case-002', { ...valid, status: 'draft', answers: {}, comments: '' });
    assert.equal(response.status, 200);
    saved = await response.json(); assert.deepEqual(saved.answers, {}); assert.deepEqual(saved.evidence.errors, [0]); assert.deepEqual(saved.evidence.failures, [0]);
    await app.close(); app = await startServer({ privateDir, port: 0, storage: 'local' }); session = await getSession();
    assert.equal((await fetch(app.origin + '/api/frame/case-002/0')).status, 200);
    response = await put('case-002', { ...valid, expectedRevision: 1, comments: 'Unrealistic anatomy.', answers: { clinical_plausibility: 'not_plausible_overall', description_match: 'matches' } });
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
    app = await startServer({ privateDir, port: 0, storage: 'local' });
    const session = await (await fetch(app.origin + '/api/session')).json();
    assert.ok(session.cases.every(c => c.prompt.description === null && c.prompt.prompts.length === 0 && !c.prompt.originalGenerationPromptVerified));
    await app.close(); app = null;
    await writeFile(path.join(privateDir, 'prompts.json'), '{}');
    await writeFile(path.join(privateDir, 'prompts.sha256'), 'incorrect seal');
    await assert.rejects(startServer({ privateDir, port: 0, storage: 'local' }), /Prompt metadata seal mismatch/);
  } finally { await app?.close(); await rm(privateDir, { recursive: true, force: true }); }
});

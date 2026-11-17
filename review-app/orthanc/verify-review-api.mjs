import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const base = 'https://orthanc.katelyncmorrison.com';
const origin = 'https://genai-radiology-verify.web.app';
const { username, password } = JSON.parse(await readFile(new URL('../.private/orthanc/https/credentials.json', import.meta.url), 'utf8'));
const authorization = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
const preflight = await fetch(base + '/api/session', { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'authorization' } });
assert.equal(preflight.status, 204);
assert.equal(preflight.headers.get('access-control-allow-origin'), origin);
const badOrigin = await fetch(base + '/api/session', { headers: { Origin: 'https://attacker.invalid', Authorization: authorization } });
assert.equal(badOrigin.status, 403);
for (const auth of ['', 'Basic ' + Buffer.from('reviewer:wrong-password').toString('base64')]) {
  const response = await fetch(base + '/api/session', { headers: { Origin: origin, ...(auth ? { Authorization: auth } : {}) } });
  assert.equal(response.status, 401);
  assert.equal(response.headers.get('access-control-allow-origin'), origin);
}
const headers = { Origin: origin, Authorization: authorization };
const response = await fetch(base + '/api/session', { headers });
assert.equal(response.status, 200);
assert.equal(response.headers.get('access-control-allow-origin'), origin);
const session = await response.json();
assert.equal(session.cases.length, 28);
assert.equal(session.storage, 'firestore');
assert.equal(session.assessmentCollection, 'afrooz-review');
assert.equal(session.rubricVersion, 4);
assert.deepEqual(session.rubric.map(item => item.id), ['description_match', 'clinical_plausibility']);
assert.deepEqual(session.rubric.map(item => item.choices.length), [3, 3]);
assert.deepEqual(session.rubric.map(item => item.issueField), ['descriptionIssues', 'realismIssues']);
const frame = await fetch(base + '/api/frame/case-001/0', { headers });
assert.equal(frame.status, 200);
const metadata = JSON.parse(frame.headers.get('x-frame-metadata'));
assert.equal((await frame.arrayBuffer()).byteLength, metadata.rows * metadata.columns * 4);
assert.ok(frame.headers.get('access-control-expose-headers').includes('X-Frame-Metadata'));
const rejectedWrite = await fetch(base + '/api/review/case-001', { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json', 'X-Review-Token': 'invalid-security-test-token' }, body: '{}' });
assert.equal(rejectedWrite.status, 403);
console.log('PASS: live review CORS/authentication, exact origin, Firestore afrooz-review storage, 28-case session, pixels and CSRF rejection. No assessment written.');

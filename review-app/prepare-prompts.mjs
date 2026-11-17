// Explicit opt-in, read-only Firestore enrichment. Never runs in the web server.
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { buildPromptMetadata, sha256 } from './prompts.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const privateDir = path.resolve(process.env.REVIEW_PRIVATE_DIR || path.join(here, '.private'));
const manifestBytes = await readFile(path.join(privateDir, 'manifest.json'));
const manifest = JSON.parse(manifestBytes);
if ((await readFile(path.join(privateDir, 'manifest.sha256'), 'utf8')).trim() !== sha256(manifestBytes)) throw new Error('Manifest seal mismatch');
const snapshotBytes = await readFile(path.join(os.homedir(), 'Downloads/explanation-trajectory-report.html'));
const indexBytes = await readFile(path.join(os.homedir(), 'Downloads/trajectory-dicom-series.json'));
if (sha256(indexBytes) !== manifest.provenance.indexSHA256) throw new Error('Frozen index mismatch');
const snapshot = JSON.parse(snapshotBytes.toString().match(/<script id="snapshot" type="application\/json">([\s\S]*?)<\/script>/)[1]);
const studies = ['678543127898756', '620043239794181'];
if (manifest.cases.length !== 28 || manifest.cases.some(c => !studies.includes(c.studyUID))) throw new Error('Unexpected cohort');
const pair = row => JSON.stringify([row.studyUID, row.seriesUID]);
const currentTargets = [...new Set(snapshot.variations.filter(v => studies.includes(v.studyUID) && snapshot.sessions.some(s => v.t >= s.start && v.t < s.end)).map(pair))].sort();
if (JSON.stringify(currentTargets) !== JSON.stringify(manifest.provenance.targets.map(pair).sort())) throw new Error('Report no longer agrees with frozen targets');
const token = execFileSync('gcloud', ['auth', 'print-access-token', '--quiet'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const documents = new Map();
async function request(method, body) {
  const response = await fetch('https://firestore.googleapis.com/v1/projects/genai-radiology/databases/(default)/documents:' + method, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(`Read-only prompt query failed (${response.status}); no metadata written`);
  return data;
}
const decode = doc => Object.fromEntries(Object.entries(doc.fields || {}).map(([k, v]) => [k, v.stringValue ?? v.timestampValue ?? null]));
// No composite index exists. First read ONLY identifiers/timestamps for the two
// studies, then retrieve prompt fields ONLY for frozen pairs in strict windows.
// This needs no cloud index creation or other cloud writes.
const identifiers = (await request('runQuery', { structuredQuery: {
  from: [{ collectionId: 'variations_log' }],
  select: { fields: ['createdAt', 'studyInstanceUID', 'seriesInstanceUID'].map(fieldPath => ({ fieldPath })) },
  where: { fieldFilter: { field: { fieldPath: 'studyInstanceUID' }, op: 'IN', value: { arrayValue: { values: studies.map(stringValue => ({ stringValue })) } } } }, limit: 10001,
} })).filter(r => r.document).map(r => r.document);
if (identifiers.length >= 10001) throw new Error('Query exceeds safety bound');
const scopedNames = identifiers.filter(doc => {
  const d = decode(doc);
  return manifest.cases.some(c => c.studyUID === d.studyInstanceUID && c.seriesUID === d.seriesInstanceUID) && snapshot.sessions.some(s => Date.parse(d.createdAt) >= s.start && Date.parse(d.createdAt) < s.end);
}).map(d => d.name);
for (let offset = 0; offset < scopedNames.length; offset += 100) {
  const rows = await request('batchGet', { documents: scopedNames.slice(offset, offset + 100), mask: { fieldPaths: ['createdAt', 'studyInstanceUID', 'seriesInstanceUID', 'promptText', 'promptKey', 'seriesDescription'] } });
  for (const row of rows) {
    if (!row.found) throw new Error('Scoped document disappeared');
    const doc = row.found, data = decode(doc);
    if (!studies.includes(data.studyInstanceUID) || !snapshot.sessions.some(s => Date.parse(data.createdAt) >= s.start && Date.parse(data.createdAt) < s.end)) throw new Error('Query escaped strict scope');
    documents.set(doc.name, { ...data, documentId: doc.name.split('/').at(-1) });
  }
}
const cases = buildPromptMetadata(manifest, JSON.parse(indexBytes), [...documents.values()], snapshot.sessions);
// Ensure frozen event counts still agree; never silently refresh a changed cohort.
for (const c of manifest.cases) {
  const expected = snapshot.variations.filter(v => v.studyUID === c.studyUID && v.seriesUID === c.seriesUID && snapshot.sessions.some(s => v.t >= s.start && v.t < s.end)).length;
  if (cases.find(p => p.caseId === c.id).eventCount !== expected) throw new Error('Prompt event count differs from frozen snapshot');
}
const bytes = JSON.stringify({ version: 1, manifestHash: sha256(manifestBytes), reportSnapshotHash: sha256(snapshotBytes), frozenSnapshotHash: manifest.provenance.snapshotSHA256, sessions: snapshot.sessions.map(({ start, end }) => ({ start, end })), retrievedAt: new Date().toISOString(), boundary: 'schedule-start-inclusive-end-exclusive', source: 'variations_log; logged inputs matched to existing series, not verified original generation captions', cases }, null, 2);
await writeFile(path.join(privateDir, 'prompts.json'), bytes, { flag: 'wx', mode: 0o400 });
await writeFile(path.join(privateDir, 'prompts.sha256'), sha256(bytes) + '\n', { flag: 'wx', mode: 0o400 });
console.log(JSON.stringify({ cases: cases.length, withLoggedPrompts: cases.filter(c => c.prompts.length).length, multipleLoggedPrompts: cases.filter(c => c.prompts.length > 1).length, multipleDescriptions: cases.filter(c => c.descriptions.length > 1).length, missingPromptEvents: cases.reduce((n, c) => n + c.missingPromptEvents, 0), loggedDescriptionDifferences: cases.filter(c => c.prompts.some(p => p.events.some(e => e.seriesDescription && !c.descriptions.includes(e.seriesDescription)))).length, exactTextDifferences: cases.filter(c => c.prompts.some(p => !c.descriptions.includes(p.text))).length }));

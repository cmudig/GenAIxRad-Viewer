import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createFirestoreStore, validateMigrationRecords } from './firestore-store.mjs';

const directory = new URL('./.private/', import.meta.url);
const bytes = await readFile(new URL('manifest.json', directory));
const manifestHash = createHash('sha256').update(bytes).digest('hex');
assert.equal((await readFile(new URL('manifest.sha256', directory), 'utf8')).trim(), manifestHash);
const manifest = JSON.parse(bytes);
const caseIds = manifest.cases.map(item => item.id);
const journal = await readFile(new URL('ratings/revisions.ndjson', directory), 'utf8');
const records = validateMigrationRecords(journal.split('\n').filter(Boolean).map(line => JSON.parse(line)), { manifestHash, caseIds });
const store = createFirestoreStore({ manifestHash, caseIds });
const expected = new Map();
for (const record of records) expected.set(record.caseId, record);
const latest = await store.load();
for (const [id, record] of expected) {
  assert.ok(latest.get(id).revision >= record.revision);
  if (latest.get(id).revision === record.revision) assert.deepEqual(latest.get(id), record);
}
console.log(`Verified ${records.length} migrated revisions across ${expected.size} case(s); latest cloud assessments match the local backup or are newer.`);
if (records.length) {
  const url = `https://firestore.googleapis.com/v1/projects/genai-radiology/databases/(default)/documents/afrooz-review/${manifestHash}--${records[0].caseId}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  await response.body?.cancel();
  console.log(`Unauthenticated direct Firestore document access: HTTP ${response.status}`);
  if (response.status !== 401 && response.status !== 403) {
    console.error('Collection access rules require review; unexpected anonymous access result. No assessment content was printed.');
    process.exitCode = 1;
  }
}

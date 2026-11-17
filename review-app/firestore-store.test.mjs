import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createFirestoreStore, validateMigrationRecords } from './firestore-store.mjs';

const manifestHash = 'a'.repeat(64);
const caseIds = ['case-001', 'case-002'];
const root = 'projects/genai-radiology/databases/(default)/documents';
const name = (id = caseIds[0]) => `${root}/afrooz-review/${manifestHash}--${id}`;
const history = (revision, id) => `${name(id)}/revisions/${String(revision).padStart(8, '0')}`;
const clone = value => structuredClone(value);
const record = (revision = 1, extra = {}) => ({
  caseId: caseIds[0], manifestHash, revision, rubricVersion: 3,
  status: 'draft', answers: { description_match: 'yes', clinically_accurate: 'no' },
  comments: 'Synthetic assessment only — 測試', references: [1, 2], confirmed: false,
  clinicalDefinition: 'Synthetic definition', descriptionDefinition: 'Synthetic matching definition',
  displayedPrompt: { text: 'Synthetic description', optional: null },
  evidence: { loaded: [0, 1], errors: [], failures: [], total: 2 },
  savedAt: '2026-11-11T00:00:00.000Z',
  provenance: { origin: 'synthetic', enabled: true, extra: [null, false, {}, []], score: 0.5 },
  ...extra,
});

// Models Firestore's all-or-nothing commit and updateTime/exists preconditions.
// Every test supplies both fetch and credentials; no network or gcloud is used.
function fixture() {
  const docs = new Map();
  const calls = [];
  let clock = 0;
  let tokens = 0;
  const hooks = {};
  const response = (status, data) => ({ status, ok: status >= 200 && status < 300, json: async () => clone(data) });
  const fetchImpl = async (url, options) => {
    assert.ok(url.startsWith(`https://firestore.googleapis.com/v1/${root}`));
    assert.match(options.headers.Authorization, /^Bearer synthetic-token-\d+$/);
    const body = options.body ? JSON.parse(options.body) : undefined;
    calls.push({ url, options, body });
    if (hooks.request) {
      const overridden = await hooks.request(url, options, body);
      if (overridden) return overridden;
    }
    if (url.endsWith(':batchGet')) return response(200, body.documents.map(key => docs.has(key) ? { found: docs.get(key) } : { missing: key }).reverse());
    if (!url.endsWith(':commit')) {
      const key = url.slice('https://firestore.googleapis.com/v1/'.length);
      return docs.has(key) ? response(200, docs.get(key)) : response(404, {});
    }
    if (hooks.beforeCommit) await hooks.beforeCommit(body);
    for (const write of body.writes) {
      const old = docs.get(write.update.name);
      if (write.currentDocument.exists === false && old || write.currentDocument.updateTime && write.currentDocument.updateTime !== old?.updateTime) return response(409, { error: 'PRIVATE RAW ERROR' });
      assert.deepEqual(write.updateTransforms, [{ fieldPath: 'receivedAt', setToServerValue: 'REQUEST_TIME' }]);
    }
    const timestamp = `2026-11-11T00:00:00.${String(++clock).padStart(6, '0')}Z`;
    const next = new Map(docs);
    for (const write of body.writes) next.set(write.update.name, {
      ...clone(write.update), updateTime: timestamp,
      fields: { ...clone(write.update.fields), receivedAt: { timestampValue: timestamp } },
    });
    docs.clear();
    for (const [key, document] of next) docs.set(key, document);
    if (hooks.afterCommit) await hooks.afterCommit(body);
    return response(200, { commitTime: timestamp, writeResults: body.writes.map(() => ({ updateTime: timestamp })) });
  };
  const options = { manifestHash, caseIds, fetchImpl, tokenProvider: async () => `synthetic-token-${++tokens}` };
  return { docs, calls, hooks, response, options, store: createFirestoreStore(options), tokenCount: () => tokens };
}

const status = expected => error => {
  assert.equal(error.status, expected);
  assert.doesNotMatch(error.message, /PRIVATE|synthetic-token|Users|case-001|aaaa/);
  return true;
};

test('typed roundtrip preserves all assessment data and strips storage metadata', async () => {
  const f = fixture();
  const original = record();
  assert.equal(await f.store.get(caseIds[0]), null);
  const saved = await f.store.save(original, 0);
  assert.deepEqual(saved, original);
  assert.deepEqual(await f.store.get(caseIds[0]), original);
  assert.deepEqual(await f.store.load(), new Map([[caseIds[0], original]]));
  assert.equal(f.docs.size, 2);
  const document = f.docs.get(name());
  assert.deepEqual(document.fields.revision, { integerValue: '1' });
  assert.deepEqual(document.fields.confirmed, { booleanValue: false });
  assert.deepEqual(document.fields.displayedPrompt.mapValue.fields.optional, { nullValue: null });
  assert.deepEqual(document.fields.provenance.mapValue.fields.score, { doubleValue: 0.5 });
  assert.match(document.fields._recordHash.stringValue, /^[a-f0-9]{64}$/);
  assert.deepEqual(document.fields._storageVersion, { integerValue: '1' });
  assert.deepEqual(f.docs.get(history(1)).fields, document.fields);
  assert.equal(f.tokenCount(), 1);
  saved.answers.description_match = 'no';
  original.comments = 'Changed locally';
  assert.notDeepEqual(await f.store.get(caseIds[0]), original);
});

test('canonical hashing is SHA256 with recursively sorted keys and retains array order', async () => {
  const f = fixture();
  const first = record();
  await f.store.save(first, 0);
  const reversed = value => Array.isArray(value) ? value.map(reversed) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reversed(item)])) : value;
  assert.deepEqual(await f.store.save(reversed(first), 0), first);
  assert.equal(f.calls.filter(call => call.url.endsWith(':commit')).length, 1);
  const stable = value => Array.isArray(value) ? `[${value.map(stable).join(',')}]` : value && typeof value === 'object' ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}` : JSON.stringify(value);
  assert.equal(f.docs.get(name()).fields._recordHash.stringValue, createHash('sha256').update(stable(first)).digest('hex'));
  await assert.rejects(f.store.save({ ...first, references: [2, 1] }, 0), status(409));
});

test('save creates immutable history and CAS updates latest', async () => {
  const f = fixture();
  await f.store.save(record(), 0);
  const originalHistory = clone(f.docs.get(history(1)));
  const previous = f.docs.get(name()).updateTime;
  const next = record(2, { comments: 'Reassessment', status: 'final', confirmed: true });
  assert.deepEqual(await f.store.save(next, 1), next);
  const writes = f.calls.filter(call => call.url.endsWith(':commit')).at(-1).body.writes;
  assert.deepEqual(writes[0].currentDocument, { updateTime: previous });
  assert.deepEqual(writes[1].currentDocument, { exists: false });
  assert.equal(writes[1].update.name, history(2));
  assert.deepEqual(f.docs.get(history(1)), originalHistory);
  assert.equal(f.docs.size, 3);
});

test('stale expected revision refuses overwrite and performs no commit', async () => {
  const f = fixture();
  await f.store.save(record(), 0);
  const count = f.calls.length;
  await assert.rejects(f.store.save(record(1, { comments: 'Different' }), 0), status(409));
  assert.equal(f.calls.slice(count).filter(call => call.url.endsWith(':commit')).length, 0);
  assert.deepEqual(await f.store.get(caseIds[0]), record());
});

test('concurrent CAS race is atomic, returns 409 and preserves winner', async () => {
  const f = fixture();
  await f.store.save(record(), 0);
  const winner = record(2, { comments: 'Winner' });
  f.hooks.beforeCommit = async () => {
    delete f.hooks.beforeCommit;
    await f.store.save(winner, 1);
  };
  await assert.rejects(f.store.save(record(2, { comments: 'Loser' }), 1), status(409));
  assert.deepEqual(await f.store.get(caseIds[0]), winner);
  assert.equal(f.docs.size, 3);
});

test('history exists:false failure leaves latest completely untouched', async () => {
  const f = fixture();
  await f.store.save(record(), 0);
  const previous = clone(f.docs.get(name()));
  // An immutable history document exists while latest is behind it.
  const other = fixture();
  await other.store.save(record(), 0);
  await other.store.save(record(2, { comments: 'Different history' }), 1);
  f.docs.set(history(2), clone(other.docs.get(history(2))));
  await assert.rejects(f.store.save(record(2), 1), status(409));
  assert.deepEqual(f.docs.get(name()), previous);
});

test('lost commit response is verified remotely and safe retry is idempotent', async () => {
  const f = fixture();
  f.hooks.afterCommit = () => { throw new Error('PRIVATE network timeout'); };
  assert.deepEqual(await f.store.save(record(), 0), record());
  assert.deepEqual(await f.store.save(record(), 0), record());
  assert.equal(f.docs.size, 2);
  assert.equal(f.calls.filter(call => call.url.endsWith(':commit')).length, 1);
});

test('commit that applies but hangs past the deadline is verified without duplicate writes', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture();
  let applied;
  const ready = new Promise(resolve => { applied = resolve; });
  f.hooks.afterCommit = () => { applied(); return new Promise(() => {}); };
  const pending = f.store.save(record(), 0);
  await ready;
  t.mock.timers.tick(15000);
  assert.deepEqual(await pending, record());
  assert.deepEqual(await f.store.save(record(), 0), record());
  assert.equal(f.docs.size, 2);
  assert.equal(f.calls.filter(call => call.url.endsWith(':commit')).length, 1);
});

test('412 precondition conflict is sanitized and cannot overwrite state', async () => {
  const f = fixture();
  await f.store.save(record(), 0);
  const before = clone([...f.docs]);
  f.hooks.request = url => url.endsWith(':commit') ? f.response(412, { error: 'PRIVATE' }) : undefined;
  await assert.rejects(f.store.save(record(2), 1), status(409));
  assert.deepEqual([...f.docs], before);
});

test('save snapshots its input before awaiting and never exposes a speculative latest record', async () => {
  const f = fixture();
  const input = record();
  const pending = f.store.save(input, 0);
  input.comments = 'Mutated after save started';
  assert.deepEqual(await pending, record());
  await f.store.get(caseIds[0]);
  f.hooks.request = () => f.response(503, {});
  await assert.rejects(f.store.get(caseIds[0]), status(503));
  await assert.rejects(f.store.load(), status(503));
  assert.deepEqual(f.docs.get(name()).fields.comments, { stringValue: record().comments });
});

test('a timed-out/failed uncommitted write never succeeds or changes state', async () => {
  const f = fixture();
  await f.store.save(record(), 0);
  const previous = clone([...f.docs]);
  f.hooks.request = url => { if (url.endsWith(':commit')) throw new DOMException('PRIVATE timeout', 'TimeoutError'); };
  await assert.rejects(f.store.save(record(2), 1), status(503));
  assert.deepEqual([...f.docs], previous);
  assert.deepEqual(await f.store.get(caseIds[0]), record());
});

test('request timeout aborts a hung fetch at 15 seconds and fails closed', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture();
  let started;
  const ready = new Promise(resolve => { started = resolve; });
  let signal;
  f.hooks.request = (_url, options) => { signal = options.signal; started(); return new Promise(() => {}); };
  const pending = f.store.get(caseIds[0]);
  const rejected = assert.rejects(pending, status(503));
  await ready;
  t.mock.timers.tick(15000);
  await rejected;
  assert.equal(signal.aborted, true);
  assert.equal(f.docs.size, 0);
});

test('401 refreshes credentials exactly once; 403 and repeated 401 are sanitized 503', async () => {
  const f = fixture();
  let attempts = 0;
  f.hooks.request = () => ++attempts === 1 ? f.response(401, { error: 'PRIVATE' }) : undefined;
  assert.equal(await f.store.get(caseIds[0]), null);
  assert.equal(f.tokenCount(), 2);
  f.hooks.request = () => f.response(401, { error: 'PRIVATE' });
  await assert.rejects(f.store.get(caseIds[0]), status(503));
  assert.equal(f.tokenCount(), 3);
  f.hooks.request = () => f.response(403, { error: 'PRIVATE token data' });
  await assert.rejects(f.store.get(caseIds[0]), error => status(503)(error) && /credentials or permissions/.test(error.message));
});

test('tokens are cached for 45 minutes then renewed', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 1000 });
  const f = fixture();
  await f.store.get(caseIds[0]);
  t.mock.timers.tick(44 * 60 * 1000);
  await f.store.get(caseIds[0]);
  assert.equal(f.tokenCount(), 1);
  t.mock.timers.tick(60 * 1000);
  await f.store.get(caseIds[0]);
  assert.equal(f.tokenCount(), 2);
});

test('credential errors and arbitrary HTTP/network/JSON errors never leak', async () => {
  const f = fixture();
  const failedAuth = createFirestoreStore({ ...f.options, tokenProvider: async () => { throw new Error('PRIVATE secret /Users/example'); } });
  await assert.rejects(failedAuth.get(caseIds[0]), status(503));
  assert.equal(f.calls.length, 0);
  for (const code of [400, 429, 500, 503]) {
    f.hooks.request = () => f.response(code, { error: 'PRIVATE' });
    await assert.rejects(f.store.load(), status(503));
  }
  f.hooks.request = () => { throw new Error('PRIVATE raw fetch error'); };
  await assert.rejects(f.store.get(caseIds[0]), status(503));
  f.hooks.request = () => ({ status: 200, ok: true, json: async () => { throw new Error('PRIVATE JSON'); } });
  await assert.rejects(f.store.get(caseIds[0]), status(503));
});

test('load is bounded to configured cases and rejects partial/duplicate/foreign results', async () => {
  const f = fixture();
  const full = createFirestoreStore({ ...f.options, caseIds: Array.from({ length: 28 }, (_, i) => `case-${String(i + 1).padStart(3, '0')}`) });
  assert.equal((await full.load()).size, 0);
  assert.equal(f.calls.at(-1).body.documents.length, 28);
  for (const result of [[], [{ missing: name() }, { missing: name() }], [{ missing: name() }, { missing: 'foreign' }]]) {
    f.hooks.request = () => f.response(200, result);
    await assert.rejects(f.store.load(), status(503));
  }
  assert.throws(() => createFirestoreStore({ ...f.options, caseIds: Array.from({ length: 29 }, (_, i) => `case-${String(i + 1).padStart(3, '0')}`) }), status(400));
});

test('invalid cohort, revision, non-JSON, metadata, unsafe/private and oversized data are rejected before I/O', async () => {
  const f = fixture();
  const cyclic = record(); cyclic.loop = cyclic;
  const invalidRecords = [
    record(0), record(-1), record(1.5), record(100000000), record(1, { caseId: 'case-999' }),
    record(1, { manifestHash: 'b'.repeat(64) }), record(1, { _recordHash: 'fake' }),
    record(1, { receivedAt: 'fake' }), record(1, { _storageVersion: 1 }),
    record(1, { pixels: [1, 2] }), record(1, { provenance: { path: '/Users/private' } }),
    record(1, { provenance: { accessToken: 'secret' } }), record(1, { comments: '/Users/private/file' }),
    record(1, { comments: 'Bearer super-secret' }), record(1, { unknown: undefined }),
    record(1, { unknown: Infinity }), record(1, { unknown: Number.MAX_SAFE_INTEGER + 1 }),
    record(1, { unknown: new Date() }), record(1, { unknown: BigInt(1) }), cyclic,
    record(1, { unknown: Array(2) }), record(1, { unknown: JSON.parse('{"__proto__":1}') }),
  ];
  for (const invalidRecord of invalidRecords) await assert.rejects(f.store.save(invalidRecord, 0), status(400));
  await assert.rejects(f.store.save(record(1, { comments: 'x'.repeat(1024 * 1024) }), 0), status(413));
  // Typed-map overhead is checked as well as the raw JSON size.
  await assert.rejects(f.store.save(record(1, { unknown: Array(100000).fill(1) }), 0), status(413));
  await assert.rejects(f.store.save(record(2), 0), status(400));
  await assert.rejects(f.store.save(record(), -1), status(400));
  await assert.rejects(f.store.get('case-999'), status(400));
  assert.equal(f.calls.length, 0);
  assert.throws(() => createFirestoreStore({ ...f.options, manifestHash: 'bad' }), status(400));
  assert.throws(() => createFirestoreStore({ ...f.options, caseIds: ['case-001', 'case-001'] }), status(400));
});

test('remote corruption, invalid typed fields or hash mismatch cannot become cached data', async () => {
  const f = fixture();
  await f.store.save(record(), 0);
  const original = clone(f.docs.get(name()));
  for (const change of [
    doc => { doc.fields.comments.stringValue = 'Tampered'; },
    doc => { doc.fields._recordHash.stringValue = 'bad'; },
    doc => { doc.fields._storageVersion.integerValue = '2'; },
    doc => { delete doc.fields.receivedAt; },
    doc => { doc.fields.revision = { integerValue: '9007199254740993' }; },
    doc => { doc.fields.comments = { bytesValue: 'PRIVATE' }; },
    doc => { doc.name = name('case-002'); },
  ]) {
    const broken = clone(original); change(broken); f.docs.set(name(), broken);
    await assert.rejects(f.store.get(caseIds[0]), status(503));
  }
  f.docs.set(name(), original);
  assert.deepEqual(await f.store.get(caseIds[0]), record());
});

test('migration preserves legacy and current revisions, orders writes and is idempotent', async () => {
  const f = fixture();
  const legacy1 = record(1, { rubricVersion: 1, answers: { plausibility: 'uncertain' }, comments: 'Original legacy text' });
  const legacy2 = record(2, { rubricVersion: 2, answers: { description_match: 'no', clinically_accurate: null } });
  const current = record(3);
  const other = record(1, { caseId: caseIds[1] });
  const input = [current, other, legacy2, legacy1];
  const unchanged = clone(input);
  assert.deepEqual(await f.store.migrate(input), { records: 4, historyCreated: 4, latestUpdated: 4, skipped: 0 });
  assert.deepEqual(input, unchanged);
  assert.equal(f.docs.size, 6);
  assert.deepEqual(await f.store.load(), new Map([[caseIds[1], other], [caseIds[0], current]]));
  assert.equal(f.docs.get(history(1)).fields.comments.stringValue, legacy1.comments);
  const commitNames = f.calls.filter(call => call.url.endsWith(':commit')).map(call => call.body.writes.at(-1).update.name);
  assert.deepEqual(commitNames, [history(1), history(2), history(3), history(1, caseIds[1])]);
  const before = clone([...f.docs]);
  assert.deepEqual(await f.store.migrate(input), { records: 4, historyCreated: 0, latestUpdated: 0, skipped: 4 });
  assert.deepEqual([...f.docs], before);
});

test('older migration creates missing history without overwriting newer latest', async () => {
  const f = fixture();
  await f.store.migrate([record(5)]);
  const latest = clone(f.docs.get(name()));
  assert.deepEqual(await f.store.migrate([record(1), record(2)]), { records: 2, historyCreated: 2, latestUpdated: 0, skipped: 0 });
  assert.deepEqual(f.docs.get(name()), latest);
  assert.equal(f.docs.size, 4);
  const writes = f.calls.filter(call => call.url.endsWith(':commit')).at(-1).body.writes;
  assert.equal(writes.length, 1);
  assert.equal(writes[0].update.name, history(2));
});

test('migration refuses different same-revision history/latest without changing anything', async () => {
  for (const remove of [null, name(), history(1)]) {
    const f = fixture();
    await f.store.save(record(), 0);
    if (remove) f.docs.delete(remove);
    const before = clone([...f.docs]);
    await assert.rejects(f.store.migrate([record(1, { comments: 'Different' })]), status(409));
    assert.deepEqual([...f.docs], before);
  }
});

test('migration validates all source records and duplicate identities before any I/O', async () => {
  const f = fixture();
  for (const input of [[record(), record()], [record(), record(2, { manifestHash: 'b'.repeat(64) })], [record(), record(0)], [record(), record(2, { caseId: 'case-999' })]]) {
    await assert.rejects(f.store.migrate(input), status(400));
  }
  assert.equal(f.calls.length, 0);
  assert.deepEqual(validateMigrationRecords([], { manifestHash, caseIds }), []);
});

test('migration can resume after partial outage without modifying imported records', async () => {
  const f = fixture();
  f.hooks.request = (url, _options, body) => url.endsWith(':commit') && body.writes[0].update.fields.revision.integerValue === '2' ? f.response(503, {}) : undefined;
  await assert.rejects(f.store.migrate([record(), record(2), record(3)]), status(503));
  const firstHistory = clone(f.docs.get(history(1)));
  assert.equal(f.docs.size, 2);
  delete f.hooks.request;
  assert.deepEqual(await f.store.migrate([record(), record(2), record(3)]), { records: 3, historyCreated: 2, latestUpdated: 2, skipped: 1 });
  assert.deepEqual(f.docs.get(history(1)), firstHistory);
  assert.deepEqual(await f.store.get(caseIds[0]), record(3));
});

test('migration handles a lost commit response and same/newer concurrent parent', async () => {
  const f = fixture();
  f.hooks.afterCommit = () => { throw new Error('PRIVATE lost response'); };
  await f.store.migrate([record()]);
  assert.equal(f.docs.size, 2);
  delete f.hooks.afterCommit;
  f.hooks.beforeCommit = async () => {
    delete f.hooks.beforeCommit;
    await f.store.migrate([record(4)]);
  };
  await f.store.migrate([record(2)]);
  assert.deepEqual(await f.store.get(caseIds[0]), record(4));
  assert.ok(f.docs.has(history(2)));
  assert.equal(f.docs.size, 4);
});

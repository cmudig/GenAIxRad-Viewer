import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';

const ROOT = 'projects/genai-radiology/databases/(default)/documents';
const API = `https://firestore.googleapis.com/v1/${ROOT}`;
const LIMIT = 1024 * 1024 - 16384; // Reserve space for document names and storage metadata.
const TIMEOUT = 15000;
const metadata = new Set(['_recordHash', '_storageVersion', 'receivedAt']);
const failure = (status, message) => Object.assign(new Error(message), { status });
const invalid = () => failure(400, 'Invalid assessment data');
const conflict = () => failure(409, 'Assessment revision conflict');
const unavailable = () => failure(503, 'Assessment storage unavailable');
const credentials = () => failure(503, 'Assessment storage credentials or permissions unavailable');
const plain = value => value !== null && typeof value === 'object' &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

// Only JSON data is accepted. Do not silently drop undefined, accessors, or secrets.
function canonical(value, depth = 0, seen = new Set()) {
  if (depth > 64) throw invalid();
  if (value === null || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'string') {
    if (/(?:^|[\s"'])(?:\/(?:Users|home|private|tmp|Volumes)\/|file:\/\/|[A-Za-z]:\\)|-----BEGIN .*PRIVATE KEY-----|\bBearer\s+\S+/i.test(value)) throw invalid();
    return JSON.stringify(value);
  }
  if (typeof value === 'number' && Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value))) return JSON.stringify(value);
  if ((!Array.isArray(value) && !plain(value)) || seen.has(value)) throw invalid();
  seen.add(value);
  let result;
  if (Array.isArray(value)) {
    if (Object.keys(value).length !== value.length) throw invalid();
    result = `[${value.map(item => canonical(item, depth + 1, seen)).join(',')}]`;
  } else {
    if (Object.getOwnPropertySymbols(value).length) throw invalid();
    result = `{${Object.keys(value).sort().map(key => {
      if (!key || /^(?:__proto__|prototype|constructor|.*paths?|pixels?|pixelData|pixel_array|secrets?|.*tokens?|password|authorization|credentials?|privateKey|apiKey)$/i.test(key) || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value')) throw invalid();
      return `${JSON.stringify(key)}:${canonical(value[key], depth + 1, seen)}`;
    }).join(',')}}`;
  }
  seen.delete(value);
  return result;
}

const digest = value => createHash('sha256').update(canonical(value)).digest('hex');

function scope(manifestHash, caseIds) {
  if (typeof manifestHash !== 'string' || !/^[a-f0-9]{64}$/.test(manifestHash) ||
      !Array.isArray(caseIds) && !(caseIds instanceof Set)) throw invalid();
  const ids = [...caseIds];
  if (!ids.length || ids.length > 28 || new Set(ids).size !== ids.length || ids.some(id => typeof id !== 'string' || !/^case-\d{3}$/.test(id))) throw invalid();
  return new Set(ids);
}

function validate(record, manifestHash, ids) {
  if (!plain(record) || record.manifestHash !== manifestHash || !ids.has(record.caseId) ||
      !Number.isSafeInteger(record.revision) || record.revision < 1 || record.revision > 99999999 ||
      Object.keys(record).some(key => metadata.has(key))) throw invalid();
  const text = canonical(record);
  if (Buffer.byteLength(text) > LIMIT) throw failure(413, 'Assessment exceeds storage limit');
  const copy = JSON.parse(text);
  if (Buffer.byteLength(JSON.stringify(fields(copy))) > LIMIT) throw failure(413, 'Assessment exceeds storage limit');
  return copy;
}

function encode(value) {
  if (value === null) return { nullValue: null };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'number') return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encode) } };
  return { mapValue: { fields: fields(value) } };
}

function fields(record) {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, encode(value)]));
}

function decode(value, depth = 0) {
  if (!plain(value) || Object.keys(value).length !== 1 || depth > 64) throw unavailable();
  if (Object.hasOwn(value, 'nullValue') && value.nullValue === null) return null;
  if (typeof value.booleanValue === 'boolean') return value.booleanValue;
  if (typeof value.stringValue === 'string') return value.stringValue;
  if (typeof value.integerValue === 'string' && /^-?\d+$/.test(value.integerValue) && Number.isSafeInteger(Number(value.integerValue))) return Number(value.integerValue);
  if (typeof value.doubleValue === 'number' && Number.isFinite(value.doubleValue)) return value.doubleValue;
  if (plain(value.arrayValue)) {
    const values = value.arrayValue.values ?? [];
    if (!Array.isArray(values)) throw unavailable();
    return values.map(item => decode(item, depth + 1));
  }
  if (plain(value.mapValue) && plain(value.mapValue.fields ?? {})) return Object.fromEntries(Object.entries(value.mapValue.fields ?? {}).map(([key, item]) => [key, decode(item, depth + 1)]));
  throw unavailable();
}

/** Validate the entire source before any migration writes; returns detached, sorted records. */
export function validateMigrationRecords(records, { manifestHash, caseIds }) {
  const ids = scope(manifestHash, caseIds);
  if (!Array.isArray(records)) throw invalid();
  const seen = new Set();
  return records.map(record => {
    const copy = validate(record, manifestHash, ids);
    const key = `${copy.caseId}:${copy.revision}`;
    if (seen.has(key)) throw invalid();
    seen.add(key);
    return copy;
  }).sort((a, b) => a.caseId.localeCompare(b.caseId) || a.revision - b.revision);
}

async function gcloudToken() {
  return new Promise((resolve, reject) => {
    execFile('gcloud', ['auth', 'print-access-token', '--quiet'], {
      encoding: 'utf8', timeout: TIMEOUT, maxBuffer: 64 * 1024,
      windowsHide: true,
    }, (error, stdout) => {
      // execFile captures stdout/stderr; neither raw errors nor credentials escape.
      if (error || !stdout.trim()) reject(credentials());
      else resolve(stdout.trim());
    });
  });
}

/** All operations are async and remote-authoritative; there is no local fallback/cache. */
export function createFirestoreStore({ manifestHash, caseIds, fetchImpl = fetch, tokenProvider = gcloudToken }) {
  const ids = scope(manifestHash, caseIds);
  if (typeof fetchImpl !== 'function' || typeof tokenProvider !== 'function') throw invalid();
  const parentName = id => {
    if (!ids.has(id)) throw invalid();
    return `${ROOT}/afrooz-review/${manifestHash}--${id}`;
  };
  const historyName = record => `${parentName(record.caseId)}/revisions/${String(record.revision).padStart(8, '0')}`;
  let tokenPromise;
  let expires = 0;
  async function token() {
    if (!tokenPromise || Date.now() >= expires) {
      expires = Date.now() + 45 * 60 * 1000;
      tokenPromise = Promise.resolve().then(tokenProvider).then(value => {
        if (typeof value !== 'string' || !value.trim() || /[\r\n]/.test(value)) throw credentials();
        return value.trim();
      }).catch(() => { tokenPromise = null; throw credentials(); });
    }
    return tokenPromise;
  }
  async function request(suffix, body, allowMissing = false) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const accessToken = await token();
      const controller = new AbortController();
      let timer;
      try {
        const result = await Promise.race([
          (async () => {
            const response = await fetchImpl(`${API}${suffix}`, {
              method: body === undefined ? 'GET' : 'POST',
              headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
              ...(body === undefined ? {} : { body: JSON.stringify(body) }),
              signal: controller.signal,
            });
            if (response.status === 401) return { unauthorized: true };
            if (response.status === 403) throw credentials();
            if (response.status === 404 && allowMissing) return { data: null };
            if ([409, 412].includes(response.status)) throw conflict();
            if (!response.ok) throw unavailable();
            return { data: await response.json() };
          })(),
          new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(unavailable()); }, TIMEOUT); }),
        ]);
        if (!result.unauthorized) return result.data;
        tokenPromise = null;
        expires = 0;
        if (attempt) throw credentials();
      } catch (error) {
        // Only our fixed messages may escape, never fetch/gcloud response text.
        if (error?.status === 409) throw conflict();
        if (error?.message === credentials().message) throw credentials();
        throw unavailable();
      } finally { clearTimeout(timer); }
    }
    throw credentials();
  }
  function unpack(document, name) {
    try {
      if (!document || document.name !== name || typeof document.updateTime !== 'string' || !document.updateTime || !plain(document.fields)) throw unavailable();
      const { _recordHash, _storageVersion, receivedAt, ...data } = document.fields;
      if (decode(_storageVersion) !== 1 || typeof receivedAt?.timestampValue !== 'string') throw unavailable();
      const record = validate(Object.fromEntries(Object.entries(data).map(([key, value]) => [key, decode(value)])), manifestHash, ids);
      const recordHash = digest(record);
      if (decode(_recordHash) !== recordHash || (name !== parentName(record.caseId) && name !== historyName(record))) throw unavailable();
      return { record, recordHash, updateTime: document.updateTime };
    } catch { throw unavailable(); }
  }
  async function read(name) {
    const document = await request(`/${name.slice(ROOT.length + 1)}`, undefined, true);
    return document === null ? null : unpack(document, name);
  }
  const matches = (entry, record) => entry?.record.revision === record.revision && entry.recordHash === digest(record);
  function write(name, record, current) {
    return {
      update: { name, fields: { ...fields(record), _recordHash: encode(digest(record)), _storageVersion: encode(1) } },
      currentDocument: current ? { updateTime: current.updateTime } : { exists: false },
      updateTransforms: [{ fieldPath: 'receivedAt', setToServerValue: 'REQUEST_TIME' }],
    };
  }
  async function committed(record) {
    const current = await read(parentName(record.caseId));
    return matches(current, record) && matches(await read(historyName(record)), record);
  }
  async function get(caseId) { return (await read(parentName(caseId)))?.record ?? null; }
  async function load() {
    const names = [...ids].map(parentName);
    const response = await request(':batchGet', { documents: names });
    if (!Array.isArray(response) || response.length !== names.length) throw unavailable();
    const pending = new Set(names);
    const latest = new Map();
    for (const item of response) {
      const name = item?.found?.name ?? item?.missing;
      if (!pending.delete(name) || (!!item.found === !!item.missing)) throw unavailable();
      if (item.found) {
        const { record } = unpack(item.found, name);
        latest.set(record.caseId, record);
      }
    }
    return latest;
  }
  async function save(record, expectedRevision) {
    const copy = validate(record, manifestHash, ids);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || copy.revision !== expectedRevision + 1) throw invalid();
    const current = await read(parentName(copy.caseId));
    if ((current?.record.revision ?? 0) !== expectedRevision) {
      if (matches(current, copy) && matches(await read(historyName(copy)), copy)) return copy;
      throw conflict();
    }
    try {
      await request(':commit', { writes: [write(parentName(copy.caseId), copy, current), write(historyName(copy), copy, null)] });
    } catch (error) {
      // A lost response can mean a successful atomic commit. Never claim success
      // unless both the exact latest record and immutable revision are visible.
      try { if (await committed(copy)) return copy; } catch { /* Fail closed. */ }
      throw error;
    }
    return copy;
  }
  async function migrate(records) {
    const sorted = validateMigrationRecords(records, { manifestHash, caseIds: ids });
    const summary = { records: sorted.length, historyCreated: 0, latestUpdated: 0, skipped: 0 };
    for (const record of sorted) {
      let complete = false;
      for (let attempt = 0; attempt < 4 && !complete; attempt++) {
        const current = await read(parentName(record.caseId));
        const history = await read(historyName(record));
        if (history && !matches(history, record)) throw conflict();
        if (current?.record.revision === record.revision && !matches(current, record)) throw conflict();
        const advance = !current || current.record.revision < record.revision;
        const writes = [];
        if (advance) writes.push(write(parentName(record.caseId), record, current));
        if (!history) writes.push(write(historyName(record), record, null));
        if (!writes.length) { summary.skipped++; complete = true; break; }
        try {
          await request(':commit', { writes });
          summary.historyCreated += Number(!history);
          summary.latestUpdated += Number(advance);
          complete = true;
        } catch (error) {
          // Re-read on CAS races or uncertain network outcomes. A later parent
          // is acceptable for migration, but conflicting history never is.
          if (error.status !== 409 && error.status !== 503) throw error;
          if (attempt === 3) throw error;
        }
      }
    }
    return summary;
  }
  return { load, get, save, migrate };
}

import { readFile, realpath, stat, mkdir, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { setTimeout as backoff } from 'node:timers/promises';

const here = path.dirname(fileURLToPath(import.meta.url));
const allowedStudies = ['678543127898756', '620043239794181'];
export const serverName = 'Frozen 28 review series (local only)';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const pair = c => JSON.stringify([c.studyUID, c.seriesUID]);
const requireThat = (ok, message) => { if (!ok) throw new Error(message); };

export function localBase(value = 'http://127.0.0.1:8043') {
  const u = new URL(value);
  requireThat(u.protocol === 'http:' && u.hostname === '127.0.0.1' && !u.username && !u.password && u.pathname === '/' && !u.search && !u.hash, 'Only an HTTP 127.0.0.1 origin is permitted');
  return u.origin;
}

// Small, fail-closed Part 10 identity reader, not a pixel decoder. Supports
// implicit/explicit LE, explicit BE and encapsulated explicit LE. Undefined
// length sequences before the required identities and deflated data fail closed.
export function dicomIdentity(bytes) {
  requireThat(bytes.length > 144 && bytes.toString('ascii', 128, 132) === 'DICM', 'Source is not a DICOM Part 10 file');
  let offset = 132;
  const longVR = new Set(['OB', 'OD', 'OF', 'OL', 'OV', 'OW', 'SQ', 'UC', 'UR', 'UT', 'UN']);
  function element(explicit, little) {
    const u16 = n => little ? bytes.readUInt16LE(n) : bytes.readUInt16BE(n);
    const u32 = n => little ? bytes.readUInt32LE(n) : bytes.readUInt32BE(n);
    requireThat(offset + 8 <= bytes.length, 'Truncated DICOM header');
    const tag = [u16(offset), u16(offset + 2)];
    const vr = explicit ? bytes.toString('ascii', offset + 4, offset + 6) : '';
    requireThat(!explicit || /^[A-Z]{2}$/.test(vr), 'Invalid DICOM VR');
    const header = explicit && longVR.has(vr) ? 12 : 8;
    requireThat(offset + header <= bytes.length, 'Truncated DICOM element');
    const length = explicit && header === 8 ? u16(offset + 6) : u32(offset + header - 4);
    requireThat(length !== 0xffffffff && offset + header + length <= bytes.length, 'Unsupported or truncated DICOM element before identity');
    const value = bytes.toString('ascii', offset + header, offset + header + length).replace(/[\0 ]+$/g, '');
    offset += header + length;
    return { tag: tag.map(n => n.toString(16).padStart(4, '0')).join(''), value };
  }
  let syntax, mediaSop;
  while (offset + 8 <= bytes.length && bytes.readUInt16LE(offset) === 2) {
    const e = element(true, true);
    if (e.tag === '00020010') syntax = e.value;
    if (e.tag === '00020003') mediaSop = e.value;
  }
  requireThat(syntax && syntax !== '1.2.840.10008.1.2.1.99', 'Missing or unsupported transfer syntax');
  const explicit = syntax !== '1.2.840.10008.1.2';
  const little = syntax !== '1.2.840.10008.1.2.2';
  const identity = {};
  const tags = { '00080018': 'sop', '0020000d': 'studyUID', '0020000e': 'seriesUID' };
  while (offset + 8 <= bytes.length && Object.keys(identity).length < 3) {
    const e = element(explicit, little);
    if (tags[e.tag]) {
      requireThat(!identity[tags[e.tag]] && e.value, 'Missing or duplicate DICOM identity');
      identity[tags[e.tag]] = e.value;
    }
  }
  requireThat(identity.sop && identity.studyUID && identity.seriesUID, 'DICOM dataset identities missing');
  // Generated originals can have stale file-meta SOPs. The frozen manifest and
  // Orthanc identify instances by DATASET SOP; disclose, but never repair originals.
  return { ...identity, mediaSopMismatch: mediaSop !== identity.sop };
}

export async function boundedMap(items, fn, concurrency = 4) {
  let next = 0, failure;
  const results = new Array(items.length);
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (!failure && next < items.length) {
      const i = next++;
      try { results[i] = await fn(items[i], i); } catch (error) { failure ||= error; }
    }
  }));
  if (failure) throw failure;
  return results;
}

export async function loadCohort(privateDir) {
  const bytes = await readFile(path.join(privateDir, 'manifest.json'));
  const manifestHash = hash(bytes);
  requireThat((await readFile(path.join(privateDir, 'manifest.sha256'), 'utf8')).trim() === manifestHash, 'Manifest seal mismatch');
  const m = JSON.parse(bytes);
  requireThat(m.version === 1 && m.cases?.length === 28 && m.provenance?.targets?.length === 29 && m.provenance?.unmatched?.length === 1, 'Invalid frozen cohort');
  requireThat(new Set(m.cases.map(c => c.id)).size === 28 && new Set(m.cases.map(c => c.seriesUID)).size === 28, 'Duplicate frozen case or series');
  const targets = new Set(m.provenance.targets.map(pair));
  const roots = await Promise.all(allowedStudies.map(uid => realpath(path.join(os.homedir(), 'Downloads', `${uid} Generated Patient ${uid}`))));
  const files = [], paths = new Set(), sops = new Set(), frames = new Set();
  for (const c of m.cases) {
    requireThat(allowedStudies.includes(c.studyUID) && targets.has(pair(c)) && /^case-\d{3}$/.test(c.id) && c.frames?.length > 0 && Number.isSafeInteger(c.expectedFiles) && c.expectedFiles > 0, 'Invalid manifest case');
    const caseFiles = new Map();
    for (const f of c.frames) {
      requireThat(typeof f.path === 'string' && typeof f.sop === 'string' && f.sop && Number.isSafeInteger(f.frame) && f.frame >= 0, 'Invalid manifest frame');
      const source = await realpath(f.path);
      requireThat(roots.some(root => source.startsWith(root + path.sep)) && path.extname(source).toLowerCase() === '.dcm' && (await stat(source)).isFile(), 'Source outside approved canonical allowlist');
      const frameKey = JSON.stringify([source, f.frame]);
      requireThat(!frames.has(frameKey), 'Duplicate source frame');
      frames.add(frameKey);
      if (caseFiles.has(source)) {
        requireThat(caseFiles.get(source).sop === f.sop, 'Conflicting source SOP');
        continue;
      }
      requireThat(!paths.has(source) && !sops.has(f.sop), 'Duplicate source file or SOP');
      paths.add(source); sops.add(f.sop);
      const file = { source, sop: f.sop, studyUID: c.studyUID, seriesUID: c.seriesUID, caseId: c.id };
      caseFiles.set(source, file); files.push(file);
    }
    requireThat(caseFiles.size === c.expectedFiles, 'Source count differs from frozen index');
  }
  // Validate ALL headers before the first network request/upload. Record hashes
  // to reject source changes between preflight and each upload; never rewrite DICOM.
  await boundedMap(files, async f => {
    const bytes = await readFile(f.source);
    const id = dicomIdentity(bytes);
    requireThat(id.sop === f.sop && pair(id) === pair(f), 'Source identity differs from frozen manifest');
    f.sha256 = hash(bytes);
    f.mediaSopMismatch = id.mediaSopMismatch;
  });
  return { manifestHash, cases: m.cases, files, frames: frames.size };
}

export function apiClient(base, fetcher = fetch) {
  base = localBase(base);
  return async (route, body, contentType = 'application/json') => {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt) await backoff(attempt * 500);
      let response;
      try {
        response = await fetcher(base + route, {
          method: body === undefined ? 'GET' : 'POST', redirect: 'error',
          signal: AbortSignal.timeout(60000),
          headers: body === undefined ? {} : { 'Content-Type': contentType },
          body: body === undefined ? undefined : contentType === 'application/json' ? JSON.stringify(body) : body,
        });
      } catch {
        if (attempt < 2) continue;
        throw new Error('Local Orthanc connection failed after 3 attempts');
      }
      if ((response.status === 429 || response.status >= 500) && attempt < 2) {
        await response.body?.cancel();
        continue;
      }
      requireThat(response.ok, `Local Orthanc HTTP ${response.status}`);
      try { return await response.json(); } catch { throw new Error('Invalid local Orthanc JSON response'); }
    }
  };
}

export async function verifyInventory(api, cohort, complete = false) {
  const system = await api('/system');
  requireThat(system.Name === serverName, 'Refusing a server not named for this isolated review cohort');
  const series = await api('/tools/find', { Level: 'Series', Query: {}, Expand: true });
  requireThat(Array.isArray(series) && series.length <= 28, 'Unexpected series inventory');
  // Expanded read-only find verifies EVERY SOP without thousands of tiny HTTP
  // connections through Docker Desktop's loopback forwarder.
  const instanceRows = await api('/tools/find', { Level: 'Instance', Query: {}, Expand: true });
  requireThat(Array.isArray(instanceRows) && instanceRows.length <= cohort.files.length, 'Unexpected instance inventory');
  const instancesById = new Map(instanceRows.map(i => [i.ID, i]));
  requireThat(instancesById.size === instanceRows.length, 'Duplicate instance inventory');
  const wanted = new Map(cohort.cases.map(c => [pair(c), c]));
  const expectedSops = new Map(cohort.files.map(f => [f.sop, f]));
  const seenPairs = new Set(), seenSops = new Set(), seenStudies = new Set();
  const studyIds = await api('/studies');
  requireThat(Array.isArray(studyIds) && studyIds.length <= 2, 'Unexpected study inventory');
  const studies = new Map(await boundedMap(studyIds, async id => {
    const study = await api(`/studies/${id}`);
    requireThat(allowedStudies.includes(study.MainDicomTags?.StudyInstanceUID), 'Unrelated study already in local Orthanc; nothing deleted');
    return [id, study.MainDicomTags.StudyInstanceUID];
  }));
  const counts = [];
  for (const s of series) {
    const key = pair({ studyUID: studies.get(s.ParentStudy), seriesUID: s.MainDicomTags?.SeriesInstanceUID });
    const c = wanted.get(key);
    requireThat(c && !seenPairs.has(key) && Array.isArray(s.Instances), 'Unrelated or duplicate series in local Orthanc; nothing deleted');
    seenPairs.add(key); seenStudies.add(s.ParentStudy);
    for (const id of s.Instances) {
      const instance = instancesById.get(id);
      requireThat(instance, 'Series references a missing instance');
      const sop = instance.MainDicomTags?.SOPInstanceUID;
      const expected = expectedSops.get(sop);
      requireThat(expected && pair(expected) === key && instance.ParentSeries === s.ID && !seenSops.has(sop), 'Unrelated or duplicate SOP in local Orthanc; nothing deleted');
      seenSops.add(sop);
    }
    requireThat(s.Instances.length <= c.expectedFiles && (!complete || s.Instances.length === c.expectedFiles), 'Orthanc per-series instance count mismatch');
    counts.push({ caseId: c.id, seriesId: s.ID, instances: s.Instances.length });
  }
  const allInstances = await api('/instances');
  requireThat(Array.isArray(allInstances) && allInstances.length === seenSops.size && instancesById.size === seenSops.size && allInstances.every(id => instancesById.has(id)), 'Unexpected instance inventory');
  if (complete) requireThat(seenPairs.size === 28 && seenSops.size === cohort.files.length && seenStudies.size === studies.size, 'Final Orthanc inventory is incomplete');
  return { version: system.Version, series: series.length, instances: seenSops.size, counts };
}

export async function importCohort(cohort, api, onProgress = () => {}) {
  await verifyInventory(api, cohort);
  let stored = 0, alreadyStored = 0, done = 0;
  await boundedMap(cohort.files, async f => {
    const bytes = await readFile(f.source);
    requireThat(hash(bytes) === f.sha256, 'Source changed after preflight; upload stopped');
    const result = await api('/instances', bytes, 'application/dicom');
    requireThat(['Success', 'AlreadyStored'].includes(result.Status) && typeof result.ID === 'string', 'Orthanc did not confirm storage');
    if (result.Status === 'Success') stored++; else alreadyStored++;
    done++;
    if (done % 256 === 0 || done === cohort.files.length) onProgress({ processed: done, total: cohort.files.length });
  });
  const inventory = await verifyInventory(api, cohort, true);
  await verifyDicomWeb(api, cohort);
  return { stored, alreadyStored, ...inventory };
}

export async function verifyDicomWeb(api, cohort) {
  // Require the configured DICOMweb endpoint too, not just core REST storage.
  const webSeries = await api('/dicom-web/series');
  requireThat(Array.isArray(webSeries) && webSeries.length === 28, 'DICOMweb series count mismatch');
  const webPairs = new Set(webSeries.map(s => pair({ studyUID: s['0020000D']?.Value?.[0], seriesUID: s['0020000E']?.Value?.[0] })));
  requireThat(webPairs.size === 28 && cohort.cases.every(c => webPairs.has(pair(c))), 'DICOMweb cohort membership mismatch');
}

async function main() {
  const args = process.argv.slice(2);
  requireThat(args.every(a => ['--check', '--verify'].includes(a)) && args.length <= 1, 'Use --check (no network), --verify (read only), or no arguments (import)');
  const base = localBase(process.env.REVIEW_ORTHANC_URL);
  const privateDir = path.resolve(process.env.REVIEW_PRIVATE_DIR || path.join(here, '../.private'));
  const auditDir = path.join(privateDir, 'orthanc');
  await mkdir(auditDir, { recursive: true, mode: 0o700 });
  const report = { startedAt: new Date().toISOString(), mode: args[0] || 'import', base, status: 'failed' };
  let failed;
  try {
    const cohort = await loadCohort(privateDir);
    Object.assign(report, { manifestHash: cohort.manifestHash, cases: cohort.cases.length, files: cohort.files.length, frames: cohort.frames, fileMetaSopMismatches: cohort.files.filter(f => f.mediaSopMismatch).length });
    console.log(`Sealed cohort validated: ${report.cases} series / ${report.files} unique DICOM files / ${report.frames} frames.`);
    if (report.fileMetaSopMismatches) console.log(`Source warning: ${report.fileMetaSopMismatches} file-meta SOPs differ from dataset SOPs; originals are not modified.`);
    if (!args.includes('--check')) {
      const api = apiClient(base);
      report.inventory = args.includes('--verify') ? await verifyInventory(api, cohort, true) : await importCohort(cohort, api, p => console.log(`Confirmed uploads: ${p.processed}/${p.total}`));
      if (args.includes('--verify')) await verifyDicomWeb(api, cohort);
      console.log(`Verified Orthanc ${report.inventory.version}: ${report.inventory.series} series / ${report.inventory.instances} instances.`);
    }
    report.status = 'success';
  } catch (error) {
    // Filesystem errors can contain private paths. Only expose controlled messages.
    report.error = error.code ? 'Local source/private file access failed' : error.message;
    failed = report.error;
  } finally {
    report.finishedAt = new Date().toISOString();
    await writeFile(path.join(auditDir, `${Date.now()}-${randomUUID()}.json`), JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  }
  if (failed) throw new Error(failed);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.code ? 'Local private audit write failed' : error.message); process.exitCode = 1; });
}

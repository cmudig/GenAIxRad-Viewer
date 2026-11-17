import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { localBase, dicomIdentity, boundedMap, apiClient, verifyInventory, verifyDicomWeb, importCohort, loadCohort, serverName } from './import.mjs';

function dicom({ implicit = false, big = false, syntax, metaSop = '1.2.3', truncate = false } = {}) {
  function element(group, tag, value, explicit = true, little = true) {
    const data = Buffer.from(value.length % 2 ? value + '\0' : value);
    const h = Buffer.alloc(8);
    const u16 = (n, p) => little ? h.writeUInt16LE(n, p) : h.writeUInt16BE(n, p);
    u16(group, 0); u16(tag, 2);
    if (explicit) { h.write('UI', 4); u16(data.length, 6); }
    else if (little) h.writeUInt32LE(data.length, 4);
    else h.writeUInt32BE(data.length, 4);
    return Buffer.concat([h, data]);
  }
  const preamble = Buffer.alloc(132);
  preamble.write('DICM', 128);
  const bytes = Buffer.concat([preamble,
    element(2, 3, metaSop),
    element(2, 0x10, syntax || (implicit ? '1.2.840.10008.1.2' : big ? '1.2.840.10008.1.2.2' : '1.2.840.10008.1.2.1')),
    element(8, 0x18, '1.2.3', !implicit, !big),
    element(0x20, 0x0d, '1.2.4', !implicit, !big),
    element(0x20, 0x0e, '1.2.5', !implicit, !big),
  ]);
  return truncate ? bytes.subarray(0, bytes.length - 4) : bytes;
}

test('only literal HTTP loopback origins; no remote, credentials, paths or query', () => {
  assert.equal(localBase(), 'http://127.0.0.1:8043');
  for (const url of ['https://127.0.0.1:8043', 'http://localhost:8043', 'http://example.org', 'http://127.0.0.1.evil', 'http://user:secret@127.0.0.1', 'http://127.0.0.1/x', 'http://127.0.0.1/?x', 'http://127.0.0.1/#x']) assert.throws(() => localBase(url));
});

test('read dataset identity for explicit/implicit LE, explicit BE and encapsulated LE', () => {
  for (const options of [{}, { implicit: true }, { big: true }, { syntax: '1.2.840.10008.1.2.4.90' }]) {
    assert.deepEqual(dicomIdentity(dicom(options)), { sop: '1.2.3', studyUID: '1.2.4', seriesUID: '1.2.5', mediaSopMismatch: false });
  }
  assert.equal(dicomIdentity(dicom({ metaSop: '1.9.9' })).mediaSopMismatch, true);
});

test('reject truncated, non-Part-10 and deflated headers', () => {
  assert.throws(() => dicomIdentity(Buffer.alloc(300)));
  assert.throws(() => dicomIdentity(dicom({ truncate: true })));
  assert.throws(() => dicomIdentity(dicom({ syntax: '1.2.840.10008.1.2.1.99' })));
});

test('bounded work stops scheduling on failure and drains in-flight work', async () => {
  let active = 0, maximum = 0;
  const results = await boundedMap([0, 1, 2, 3, 4], async n => {
    active++; maximum = Math.max(maximum, active);
    await new Promise(resolve => setImmediate(resolve)); active--;
    return n * 2;
  }, 2);
  assert.equal(maximum, 2);
  assert.deepEqual(results, [0, 2, 4, 6, 8]);
  let calls = 0;
  await assert.rejects(boundedMap([0, 1, 2, 3], async () => { calls++; throw Error('stop'); }, 1));
  assert.equal(calls, 1);
});

test('HTTP retry is bounded, redirects blocked, upload bytes unchanged; permanent errors not retried', async () => {
  let attempts = 0;
  const payload = Buffer.from('original bytes');
  const api = apiClient(undefined, async (url, options) => {
    assert.equal(url, 'http://127.0.0.1:8043/instances');
    assert.equal(options.body, payload);
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers['Content-Type'], 'application/dicom');
    attempts++;
    return new Response(JSON.stringify({ Status: 'AlreadyStored' }), { status: attempts < 3 ? 503 : 200 });
  });
  assert.equal((await api('/instances', payload, 'application/dicom')).Status, 'AlreadyStored');
  assert.equal(attempts, 3);
  attempts = 0;
  await assert.rejects(apiClient(undefined, async () => { attempts++; return new Response('{}', { status: 400 }); })('/system'), /400/);
  assert.equal(attempts, 1);
  attempts = 0;
  await assert.rejects(apiClient(undefined, async () => { attempts++; throw Error('network'); })('/system'), /3 attempts/);
  assert.equal(attempts, 3);
});

function mockInventory() {
  const studyUID = '678543127898756';
  const cases = Array.from({ length: 28 }, (_, i) => ({ id: `case-${i}`, studyUID, seriesUID: `1.2.${i}`, expectedFiles: 1 }));
  const files = cases.map((c, i) => ({ ...c, sop: `1.3.${i}` }));
  const series = cases.map((c, i) => ({ ID: `series-${i}`, ParentStudy: 'study', MainDicomTags: { SeriesInstanceUID: c.seriesUID }, Instances: [`instance-${i}`] }));
  const routes = new Map([
    ['/system', { Name: serverName, Version: 'test' }],
    ['/tools/find', series], ['/studies', ['study']],
    ['/studies/study', { MainDicomTags: { StudyInstanceUID: studyUID } }],
    ['/instances', files.map((_, i) => `instance-${i}`)],
    ['/dicom-web/series', cases.map(c => ({ '0020000D': { Value: [c.studyUID] }, '0020000E': { Value: [c.seriesUID] } }))],
    ...files.map((f, i) => [`/instances/instance-${i}`, { ParentSeries: `series-${i}`, MainDicomTags: { SOPInstanceUID: f.sop } }]),
  ]);
  routes.set('/tools/find:Instance', files.map((_, i) => ({ ID: `instance-${i}`, ...routes.get(`/instances/instance-${i}`) })));
  return { cohort: { cases, files }, routes, api: async (route, body) => {
    if (route === '/tools/find' && body?.Level === 'Instance') route += ':Instance';
    assert.ok(routes.has(route), 'Only expected local API routes');
    return routes.get(route);
  } };
}

test('verify all 28 exact study+series pairs and all SOPs, not just totals', async () => {
  const m = mockInventory();
  const result = await verifyInventory(m.api, m.cohort, true);
  assert.equal(result.series, 28); assert.equal(result.instances, 28);
  m.routes.get('/instances/instance-0').MainDicomTags.SOPInstanceUID = 'unrelated';
  await assert.rejects(verifyInventory(m.api, m.cohort, true), /Unrelated/);
});

test('refuse wrong local server before uploading anything', async () => {
  let calls = 0;
  await assert.rejects(importCohort({ files: [] }, async route => {
    calls++; assert.equal(route, '/system'); return { Name: 'another server' };
  }), /Refusing/);
  assert.equal(calls, 1);
});

test('reject unrelated series, wrong study, incomplete series and stray instances', async () => {
  for (const kind of ['series', 'study', 'missing', 'stray']) {
    const m = mockInventory();
    if (kind === 'series') m.routes.get('/tools/find')[0].MainDicomTags.SeriesInstanceUID = 'other';
    if (kind === 'study') m.routes.get('/studies/study').MainDicomTags.StudyInstanceUID = 'other';
    if (kind === 'missing') { m.routes.get('/tools/find')[0].Instances = []; m.routes.get('/instances').shift(); }
    if (kind === 'stray') m.routes.get('/instances').push('stray');
    await assert.rejects(verifyInventory(m.api, m.cohort, true));
  }
});

test('DICOMweb must expose the exact 28 pairs; same count of different pairs fails', async () => {
  const m = mockInventory();
  await verifyDicomWeb(m.api, m.cohort);
  m.routes.get('/dicom-web/series')[0]['0020000E'].Value[0] = 'unrelated';
  await assert.rejects(verifyDicomWeb(m.api, m.cohort), /membership/);
});

test('idempotent import counts confirmations; refuses changed files and failed storage', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'orthanc-import-test-'));
  try {
    const source = path.join(dir, 'synthetic.bin'), bytes = Buffer.from('synthetic unchanged bytes');
    await writeFile(source, bytes);
    const m = mockInventory();
    for (const f of m.cohort.files) Object.assign(f, { source, sha256: createHash('sha256').update(bytes).digest('hex') });
    let uploaded = 0;
    const api = async (route, body, type) => {
      if (route === '/instances' && body) {
        assert.deepEqual(body, bytes); assert.equal(type, 'application/dicom'); uploaded++;
        return { Status: uploaded % 2 ? 'Success' : 'AlreadyStored', ID: 'stored-id' };
      }
      return m.api(route, body);
    };
    const result = await importCohort(m.cohort, api);
    assert.equal(result.stored, 14); assert.equal(result.alreadyStored, 14);
    assert.equal(result.instances, 28); assert.equal(uploaded, 28);
    await assert.rejects(importCohort(m.cohort, async (route, body) => {
      if (route === '/instances' && body) return { Status: 'Failure' };
      return m.api(route, body);
    }), /confirm storage/);
    await writeFile(source, 'changed');
    uploaded = 0;
    await assert.rejects(importCohort(m.cohort, api), /Source changed/);
    assert.equal(uploaded, 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('bad seal fails before source reads or network requests', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'orthanc-seal-test-'));
  try {
    await writeFile(path.join(dir, 'manifest.json'), '{}');
    await writeFile(path.join(dir, 'manifest.sha256'), 'not-the-hash');
    await assert.rejects(loadCohort(dir), /seal mismatch/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('deployment is pinned, isolated, loopback-only, with no DICOM TCP publication', async () => {
  const yaml = await readFile(new URL('./compose.yaml', import.meta.url), 'utf8');
  const config = JSON.parse(await readFile(new URL('./orthanc.json', import.meta.url)));
  assert.match(yaml, /orthancteam\/orthanc:26\.11\.0@sha256:[a-f0-9]{64}/);
  assert.match(yaml, /127\.0\.0\.1:8043:8042/);
  assert.match(yaml, /driver: bridge/);
  assert.doesNotMatch(yaml, /4242|Downloads|\.private|latest|CORS/i);
  assert.equal(config.AuthenticationEnabled, false);
  assert.equal(config.RemoteAccessAllowed, true);
  assert.equal(config.DicomServerEnabled, false);
  assert.equal(config.OverwriteInstances, false);
  assert.equal(config.DicomWeb.Root, '/dicom-web/');
});

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import https from 'node:https';

const { username, password } = JSON.parse(await readFile(new URL('../.private/orthanc/https/credentials.json', import.meta.url), 'utf8'));
const local = process.argv.includes('--local');
const auth = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
function request(path, { method = 'GET', authorization } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'orthanc.katelyncmorrison.com', port: 443, path, method,
      ...(local ? { lookup: (_host, options, callback) => options.all
        ? callback(null, [{ address: '127.0.0.1', family: 4 }])
        : callback(null, '127.0.0.1', 4) } : {}),
      headers: authorization ? { Authorization: authorization } : {},
      timeout: 15000,
      // Production always uses normal certificate and hostname verification.
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, body: Buffer.concat(chunks) }));
      response.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('HTTPS verification timed out')));
    req.on('error', reject);
    req.end();
  });
}
for (const path of ['/', '/system', '/instances', '/dicom-web/studies', '/instances/nonexistent/file']) {
  assert.equal((await request(path)).status, 401, 'Anonymous request must be denied');
}
assert.equal((await request('/system', { authorization: 'Basic ' + Buffer.from('reviewer:wrong-password').toString('base64') })).status, 401);
const series = await request('/series', { authorization: auth });
assert.equal(series.status, 200);
assert.equal(JSON.parse(series.body).length, 28);
const instances = await request('/instances', { authorization: auth });
assert.equal(instances.status, 200);
const ids = JSON.parse(instances.body);
assert.equal(ids.length, 7168);
const image = await request(`/instances/${ids[0]}/file`, { authorization: auth });
assert.equal(image.status, 200);
assert.equal(image.body.subarray(128, 132).toString(), 'DICM');
assert.equal((await request('/dicom-web/studies', { authorization: auth })).status, 200);
for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
  assert.equal((await request('/nonexistent-security-test', { method, authorization: auth })).status, 403);
}
console.log(`PASS (${local ? 'loopback routing' : 'public DNS routing'}): trusted TLS; password required; authenticated image/DICOMweb access; writes denied; 28 series / 7,168 images unchanged.`);

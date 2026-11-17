import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import https from 'node:https';

const root = fileURLToPath(new URL('./', import.meta.url));
const privateRoot = fileURLToPath(new URL('../.private/orthanc/https/', import.meta.url));
const image = 'caddy:2-alpine@sha256:78bd35025c7ba85961dd149ae670315129954e77abe2383ac47c89106b35ade9';
const credentials = JSON.parse(await readFile(`${privateRoot}/credentials.json`, 'utf8'));
const config = await readFile(`${root}/Caddyfile`, 'utf8');
const acme = '\ttls {\n\t\tissuer acme {\n\t\t\tdisable_http_challenge\n\t\t}\n\t}';
assert.ok(config.includes(acme), 'Expected production ACME block');
const testConfig = `${privateRoot}/Caddyfile.test`;
await writeFile(testConfig, config.replace(acme, '\ttls internal'), { mode: 0o600 });
const name = `orthanc-auth-test-${process.pid}`;
function docker(args) {
  const result = spawnSync('docker', args, { encoding: 'utf8' });
  if (result.status !== 0) throw new Error('Docker proxy test operation failed.');
  return result.stdout.trim();
}
function request(path, { method = 'GET', auth } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: '127.0.0.1', port: 18443, servername: 'orthanc.katelyncmorrison.com',
      path, method, headers: { Host: 'orthanc.katelyncmorrison.com', ...(auth ? { Authorization: auth } : {}) },
      // Only for this ephemeral loopback test container's internal CA.
      // Never use this setting for the production/public endpoint.
      rejectUnauthorized: false, timeout: 5000,
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) }));
      response.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('Loopback test timed out')));
    req.on('error', reject);
    req.end();
  });
}
try {
  docker(['run', '--rm', '-d', '--name', name, '--network', 'frozen-review-orthanc_local-only',
    '-p', '127.0.0.1:18443:443',
    '-v', `${testConfig}:/etc/caddy/Caddyfile:ro`,
    '-v', `${privateRoot}/users.caddy:/run/secrets/orthanc-users:ro`,
    '-v', `${privateRoot}/review-upstream.caddy:/run/secrets/review-upstream:ro`, image]);
  const deadline = Date.now() + 20000;
  for (;;) {
    try { await request('/system'); break; }
    catch (error) {
      if (Date.now() > deadline) throw error;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }
  for (const path of ['/', '/system', '/instances', '/dicom-web/studies', '/instances/not-a-real-instance/file']) {
    const response = await request(path);
    assert.equal(response.status, 401, 'Unauthenticated path must be blocked');
    assert.match(response.headers['www-authenticate'], /^Basic /);
  }
  const bad = 'Basic ' + Buffer.from('reviewer:not-the-password').toString('base64');
  assert.equal((await request('/system', { auth: bad })).status, 401);
  const auth = 'Basic ' + Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64');
  assert.equal((await request('/system', { auth })).status, 200);
  const series = await request('/series', { auth });
  assert.equal(series.status, 200);
  assert.equal(series.headers['cache-control'], 'no-store');
  assert.equal(JSON.parse(series.body).length, 28);
  const instances = await request('/instances', { auth });
  assert.equal(instances.status, 200);
  const ids = JSON.parse(instances.body);
  assert.equal(ids.length, 7168);
  const file = await request(`/instances/${ids[0]}/file`, { auth });
  assert.equal(file.status, 200);
  assert.equal(file.body.subarray(128, 132).toString(), 'DICM');
  const studies = await request('/dicom-web/studies', { auth });
  assert.equal(studies.status, 200);
  assert.equal(JSON.parse(studies.body).length, 2);
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
    assert.equal((await request('/nonexistent-security-test', { method, auth })).status, 403);
  }
  console.log('PASS: anonymous/wrong password blocked; authenticated DICOM and DICOMweb reads work; writes blocked; exact 28 series / 7,168 instances preserved.');
} finally {
  spawnSync('docker', ['rm', '-f', name], { stdio: 'ignore' });
  await unlink(testConfig).catch(() => {});
}

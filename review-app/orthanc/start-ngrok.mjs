import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';

const policyFile = fileURLToPath(new URL('./ngrok-policy.json', import.meta.url));
const policy = JSON.parse(await readFile(policyFile, 'utf8'));
if (policy.on_http_request?.[0]?.actions?.[0]?.type !== 'oauth' ||
    !policy.on_http_request?.[1]?.expressions?.[0]?.includes('katelyncmorrison98@gmail.com') ||
    !policy.on_http_request?.[1]?.actions?.some(a => a.type === 'deny') ||
    !policy.on_http_request?.[2]?.actions?.some(a => a.type === 'deny')) {
  throw new Error('Required OAuth, account allowlist, and read-only protections are missing.');
}
const check = spawnSync('ngrok', ['config', 'check'], { stdio: 'inherit' });
if (check.status !== 0) {
  console.error('Configure the ngrok authtoken directly in your terminal first. Never paste it into chat.');
  process.exit(1);
}
const response = await fetch('http://127.0.0.1:8043/system', { signal: AbortSignal.timeout(10000) });
if (!response.ok) throw new Error('Local Orthanc is unavailable.');
await response.body?.cancel();
console.log('Starting protected, read-only Orthanc access at https://orthanc.katelynmorrison.com');
console.log('Only the configured Google account is allowed. Ctrl+C stops external access.');
const child = spawn('ngrok', ['http', 'http://127.0.0.1:8043', '--url=https://orthanc.katelynmorrison.com', '--traffic-policy-file=' + policyFile, '--inspect=false'], { stdio: 'inherit' });
child.on('error', () => { console.error('Unable to launch ngrok.'); process.exitCode = 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', code => { process.exitCode = code ?? 1; });

import { randomBytes } from 'node:crypto';
import { readFile, writeFile, mkdir, chmod } from 'node:fs/promises';

process.umask(0o077);
const directory = new URL('../.private/orthanc/https/', import.meta.url);
await mkdir(directory, { recursive: true, mode: 0o700 });
await chmod(directory, 0o700);
const configFile = new URL('review-proxy.json', directory);
let config;
try { config = JSON.parse(await readFile(configFile, 'utf8')); }
catch (error) {
  if (error.code !== 'ENOENT') throw error;
  config = { origin: 'https://genai-radiology-verify.web.app', proxyToken: randomBytes(32).toString('hex') };
  await writeFile(configFile, JSON.stringify(config) + '\n', { mode: 0o600, flag: 'wx' });
}
if (config.origin !== 'https://genai-radiology-verify.web.app' || !/^[a-f0-9]{64}$/.test(config.proxyToken)) throw new Error('Invalid proxy configuration');
await writeFile(new URL('review-upstream.caddy', directory), `reverse_proxy host.docker.internal:4318 {
  header_up Host 127.0.0.1:4318
  header_up X-Review-Proxy ${config.proxyToken}
  header_up -Authorization
  header_up -Proxy-Authorization
  header_down -Access-Control-Allow-Origin
  header_down -Access-Control-Expose-Headers
  header_down -Vary
}\n`, { mode: 0o600 });
console.log('Private review proxy configuration prepared. Secret not printed.');

import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, writeFile, readFile, access, chmod } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const directory = fileURLToPath(new URL('../.private/orthanc/https/', import.meta.url));
const image = 'caddy:2-alpine@sha256:78bd35025c7ba85961dd149ae670315129954e77abe2383ac47c89106b35ade9';
process.umask(0o077);
await mkdir(directory, { recursive: true, mode: 0o700 });
await chmod(directory, 0o700);
try {
  await access(`${directory}/credentials.json`);
  const credentials = JSON.parse(await readFile(`${directory}/credentials.json`, 'utf8'));
  if (credentials.url !== 'https://orthanc.katelyncmorrison.com') {
    credentials.url = 'https://orthanc.katelyncmorrison.com';
    await writeFile(`${directory}/credentials.json`, JSON.stringify(credentials, null, 2) + '\n', { mode: 0o600 });
  }
  console.log('Existing credentials preserved. No password changed.');
  process.exit(0);
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
const username = 'reviewer';
const password = randomBytes(24).toString('base64url');
const result = spawnSync('docker', ['run', '--rm', '-i', image, 'caddy', 'hash-password', '--algorithm', 'argon2id'], {
  input: password + '\n', encoding: 'utf8', maxBuffer: 1024 * 1024,
});
const hash = result.stdout?.trim();
if (result.status !== 0 || !/^\$argon2id\$[^\s]+$/.test(hash ?? '')) {
  throw new Error('Password hashing failed. No proxy started and no credential output printed.');
}
await writeFile(`${directory}/users.caddy`, `${username} ${hash}\n`, { flag: 'wx', mode: 0o600 });
await writeFile(`${directory}/credentials.json`, JSON.stringify({ url: 'https://orthanc.katelyncmorrison.com', username, password }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
console.log('Generated private credentials for username reviewer. Password not printed.');
console.log('Saved under review-app/.private/orthanc/https/credentials.json (owner-only; ignored by Git).');
console.log('Only the password hash is mounted in Caddy. No proxy has been started.');

import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';

const token = execFileSync('gcloud', ['auth', 'print-access-token', '--quiet'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const headers = { Authorization: `Bearer ${token}`, 'x-goog-user-project': 'genai-radiology' };
async function get(url) {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error('Unable to back up deployed rules');
  return response.json();
}
const release = await get('https://firebaserules.googleapis.com/v1/projects/genai-radiology/releases/cloud.firestore');
const ruleset = await get(`https://firebaserules.googleapis.com/v1/${release.rulesetName}`);
const content = ruleset.source?.files?.[0]?.content;
if (ruleset.source.files.length !== 1 || typeof content !== 'string' ||
    !content.includes('match /{document=**}') || !content.includes('allow read, write;') ||
    (content.match(/allow\s/g) || []).length !== 1) throw new Error('Rules changed since inspection; refusing automatic replacement');
const directory = new URL('./.private/firestore-rules/', import.meta.url);
await mkdir(directory, { recursive: true, mode: 0o700 });
await writeFile(new URL(`before-${Date.now()}.json`, directory), JSON.stringify({ release, ruleset }, null, 2), { mode: 0o600, flag: 'wx' });
console.log('Previous public rules backed up privately; verified original policy before narrowing afrooz-review access.');

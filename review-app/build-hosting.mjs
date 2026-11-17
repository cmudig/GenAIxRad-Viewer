import { mkdir, readFile, readdir, writeFile, lstat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const output = path.join(here, '.hosting');
const assets = ['index.html', 'app.js', 'style.css'];
const apiOrigin = 'https://orthanc.katelyncmorrison.com';

// Fixed destination and exact allowlist: never traverse/copy private inputs.
await mkdir(output, { recursive: true });
if ((await lstat(output)).isSymbolicLink()) throw new Error('Hosting output must not be a symlink');
for (const name of await readdir(output)) {
  if (!assets.includes(name) || !(await lstat(path.join(output, name))).isFile()) {
    throw new Error('Unexpected hosting output entry; refusing to build');
  }
}
for (const name of assets) {
  if (!(await lstat(path.join(here, name))).isFile()) throw new Error('Source asset must be a regular file');
  let content = await readFile(path.join(here, name), 'utf8');
  if (name === 'index.html') {
    if (content.includes('name="review-api-origin"')) throw new Error('Source HTML must remain local by default');
    content = content.replace('<head>', `<head>\n  <meta name="review-api-origin" content="${apiOrigin}">`);
  }
  await writeFile(path.join(output, name), content);
}
console.log('Prepared three public assets in review-app/.hosting (no deployment).');

import { readFile, mkdir, writeFile, chmod } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';

const here = path.dirname(fileURLToPath(import.meta.url));
const privateDir = path.resolve(process.env.REVIEW_PRIVATE_DIR || path.join(here, '.private'));
const downloads = path.join(os.homedir(), 'Downloads');
const python = process.env.REVIEW_PYTHON || path.join(downloads, '.trajectory-dicom-venv/bin/python');
execFileSync(python, ['-c', 'import numpy, pydicom'], { stdio: 'inherit' });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const html = await readFile(path.join(downloads, 'explanation-trajectory-report.html'));
const indexBytes = await readFile(path.join(downloads, 'trajectory-dicom-series.json'));
const match = html.toString().match(/<script id="snapshot" type="application\/json">([\s\S]*?)<\/script>/);
if (!match) throw new Error('Snapshot not found; no live query fallback is permitted.');
const snapshot = JSON.parse(match[1]);
const index = JSON.parse(indexBytes);
const allowed = new Set(['678543127898756', '620043239794181']);
const key = row => JSON.stringify([row.studyUID, row.seriesUID]);
const selected = snapshot.variations.filter(v => allowed.has(v.studyUID) && snapshot.sessions.some(s => v.t >= s.start && v.t < s.end));
if (selected.some(v => !v.seriesUID)) throw new Error('Missing target series UID.');
const targets = [...new Map(selected.map(v => [key(v), { studyUID: v.studyUID, seriesUID: v.seriesUID }])).values()].sort((a, b) => key(a).localeCompare(key(b), 'en'));
const local = new Map(index.series.map(s => [key(s), s]));
const matched = targets.filter(t => local.has(key(t)));
if (targets.length !== 29 || matched.length !== 28) throw new Error('Expected exactly 29 frozen targets and 28 local matches.');
if (new Set(matched.map(t => t.seriesUID)).size !== 28) throw new Error('A source series cannot appear twice.');
await mkdir(privateDir, { recursive: true, mode: 0o700 });
const frozen = { version: 1, snapshotSHA256: hash(html), indexSHA256: hash(indexBytes), snapshotGeneratedAt: snapshot.generatedAt, boundary: 'schedule-start-inclusive-end-exclusive', targets, unmatched: targets.filter(t => !local.has(key(t))), cases: matched.map((t, i) => ({ id: `case-${String(i + 1).padStart(3, '0')}`, title: `Case ${String(i + 1).padStart(3, '0')}`, ...t, expectedFiles: local.get(key(t)).fileCount })) };
const targetPath = path.join(privateDir, 'targets.json');
const frozenBytes = JSON.stringify(frozen, null, 2);
try {
	await writeFile(targetPath, frozenBytes, { flag: 'wx', mode: 0o600 });
} catch (error) {
	if (error.code !== 'EEXIST' || await readFile(targetPath, 'utf8') !== frozenBytes) throw error;
	// Resume only an identical, interrupted target-only freeze; never replace it.
}
await chmod(targetPath, 0o400);
execFileSync(python, [path.join(here, 'pixels.py'), '--index', privateDir], { stdio: 'inherit' });
const manifestPath = path.join(privateDir, 'manifest.json');
const bytes = await readFile(manifestPath);
await writeFile(path.join(privateDir, 'manifest.sha256'), hash(bytes) + '\n', { flag: 'wx', mode: 0o400 });
await chmod(manifestPath, 0o400);
console.log('Frozen 29 targets / 28 matched cases. Private manifest sealed; no remote requests made.');

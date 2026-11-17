import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createFirestoreStore, validateMigrationRecords } from './firestore-store.mjs';

/** --check is source-only and never requests credentials or contacts Firestore. */
export async function main(args = process.argv.slice(2)) {
  if (args.length !== 1 || !['--check', '--apply'].includes(args[0])) throw new Error('Specify --check or --apply');
  const privateDir = path.resolve(process.env.REVIEW_PRIVATE_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), '.private'));
  const bytes = await readFile(path.join(privateDir, 'manifest.json'));
  const manifestHash = createHash('sha256').update(bytes).digest('hex');
  if ((await readFile(path.join(privateDir, 'manifest.sha256'), 'utf8')).trim() !== manifestHash) throw new Error('Invalid sealed source');
  const manifest = JSON.parse(bytes);
  if (!Array.isArray(manifest.cases) || manifest.cases.length !== 28 ||
      manifest.provenance?.targets?.length !== 29 || manifest.provenance?.unmatched?.length !== 1 ||
      new Set(manifest.cases.map(item => item.seriesUID)).size !== 28 ||
      manifest.cases.some(item => typeof item.seriesUID !== 'string' || !item.seriesUID)) throw new Error('Invalid sealed source');
  const caseIds = manifest.cases.map(item => item.id);
  const text = await readFile(path.join(privateDir, 'ratings', 'revisions.ndjson'), 'utf8');
  const records = validateMigrationRecords(text.split('\n').filter(line => line.trim()).map(line => JSON.parse(line)), { manifestHash, caseIds });
  if (args[0] === '--check') return { records: records.length, cases: new Set(records.map(record => record.caseId)).size, writes: 0 };
  const store = await createFirestoreStore({ manifestHash, caseIds });
  return store.migrate(records);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await main())); }
  catch { console.error('Assessment migration failed; source unchanged.'); process.exitCode = 1; }
}

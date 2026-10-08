/**
 * One-off: run the Infloww historical import from the command line, against the
 * project in FIREBASE_SERVICE_ACCOUNT. The same code path as CA Admin → Sales →
 * Historical import (`inflowwImportService.ts`), minus the HTTP route.
 *
 *   cd src && node --env-file=.env.local --conditions=react-server \
 *     --import tsx scripts/run-historical-import.ts <sales|creator-stats> <file.xlsx> [--commit]
 *
 * Dry run unless `--commit` is passed. Prints totals only — no fan names.
 * Delete with the rest of the historical import once the history is in.
 */
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { importCreatorStats, importInflowwSales } from '../lib/services/inflowwImportService';
import { announceTierCrossings } from '../lib/services/tierNotices';

async function main() {
  const [kind, file, flag] = process.argv.slice(2);
  if ((kind !== 'sales' && kind !== 'creator-stats') || !file) {
    console.error('usage: run-historical-import.ts <sales|creator-stats> <file.xlsx> [--commit]');
    process.exit(2);
  }
  const dryRun = flag !== '--commit';
  const buffer = readFileSync(file);
  console.log(`${dryRun ? 'DRY RUN' : 'COMMIT'} · ${kind} · ${basename(file)}`);

  if (kind === 'creator-stats') {
    const stats = await importCreatorStats({ buffer, dryRun });
    console.log(JSON.stringify(stats, null, 2));
    return;
  }

  const { result, touched } = await importInflowwSales({
    buffer,
    fileName: basename(file),
    actorUid: 'cli-historical-import',
    actorName: 'Historical import (CLI)',
    dryRun,
  });
  const { perUser, skipped, ...rest } = result;
  console.log(JSON.stringify(rest, null, 2));
  console.log('\nPer agent:');
  for (const u of perUser) console.log(`  ${u.displayName.padEnd(28)} ${String(u.rows).padStart(6)} rows  $${u.gross.toFixed(2)}`);
  console.log('\nNot imported:');
  for (const s of skipped) console.log(`  ${String(s.rowCount).padStart(6)} × ${s.reason}: ${s.detail}`);
  if (!dryRun && touched.length > 0) {
    const sent = await announceTierCrossings(new Set(touched));
    console.log(`\nCommission-tier notices sent: ${sent}`);
  }
}

main().then(
  () => process.exit(0),
  err => {
    console.error(err);
    process.exit(1);
  },
);

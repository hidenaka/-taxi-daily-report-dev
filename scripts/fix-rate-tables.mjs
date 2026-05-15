#!/usr/bin/env node
/**
 * userConfigs/{userId}.rateTable の各テーブルを正しいデータに修正する
 *
 * 使い方:
 *   node scripts/fix-rate-tables.mjs <userId> --dry-run                # プレビューのみ
 *   node scripts/fix-rate-tables.mjs <userId> --execute                # 実行
 *   node scripts/fix-rate-tables.mjs <userId> --dry-run --project=...  # プロジェクト指定
 *
 * 例:
 *   node scripts/fix-rate-tables.mjs user_self --dry-run
 *   node scripts/fix-rate-tables.mjs user_self --execute --project=taxi-dailydata-dev
 *   node scripts/fix-rate-tables.mjs user_self --execute --project=taxi-dailydata
 *
 * 正解データは scripts/data/correct-rate-tables.json から読み込む。
 */

import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const correctTablesPath = resolve(__dirname, 'data/correct-rate-tables.json');
const correctTables = JSON.parse(readFileSync(correctTablesPath, 'utf-8'));

const args = process.argv.slice(2);
const userId = args.find((a) => !a.startsWith('--'));
const projectArg = args.find((a) => a.startsWith('--project='));
const projectId = projectArg ? projectArg.split('=')[1] : 'taxi-dailydata-dev';
const isDryRun = args.includes('--dry-run');
const isExecute = args.includes('--execute');

if (!userId || (!isDryRun && !isExecute)) {
  console.error('Usage: node scripts/fix-rate-tables.mjs <userId> --dry-run | --execute [--project=<projectId>]');
  process.exit(1);
}
if (isDryRun && isExecute) {
  console.error('Cannot use --dry-run and --execute together');
  process.exit(1);
}

console.log(`Project: ${projectId}`);
console.log(`userId:  ${userId}`);
console.log(`Mode:    ${isExecute ? 'EXECUTE' : 'DRY-RUN'}`);
console.log('');

const app = initializeApp({ credential: applicationDefault(), projectId });
const db = getFirestore(app);

const snap = await db.collection('userConfigs').doc(userId).get();
if (!snap.exists) {
  console.error(`userConfigs/${userId} not found`);
  process.exit(1);
}
const current = snap.data();
const currentRateTable = current.rateTable || {};

// 各テーブルごとに比較
const tableKeys = Object.keys(correctTables).filter((k) => !k.startsWith('_'));
let totalDiffCount = 0;
const newRateTable = { ...currentRateTable };

for (const key of tableKeys) {
  const correct = correctTables[key];
  const cur = currentRateTable[key];

  if (!Array.isArray(cur)) {
    console.log(`=== rateTable["${key}"]: NEW (will be added, ${correct.length} tiers) ===`);
    totalDiffCount += correct.length;
    newRateTable[key] = correct;
    continue;
  }

  const diffs = [];
  for (let i = 0; i < Math.max(cur.length, correct.length); i++) {
    const c = cur[i];
    const r = correct[i];
    if (!c) { diffs.push({ idx: i, kind: 'add', new: r }); continue; }
    if (!r) { diffs.push({ idx: i, kind: 'remove', old: c }); continue; }
    if (c.salesMin !== r.salesMin || c.salesMax !== r.salesMax || c.rate !== r.rate) {
      diffs.push({ idx: i, kind: 'update', old: c, new: r });
    }
  }

  if (diffs.length === 0) {
    console.log(`=== rateTable["${key}"]: OK (no change) ===`);
    continue;
  }

  console.log(`=== rateTable["${key}"]: ${diffs.length} change(s) ===`);
  console.log(`  idx | salesMin   | salesMax   | rate   | (current → correct)`);
  console.log(`  ----+------------+------------+--------+---------------------`);
  for (const d of diffs) {
    if (d.kind === 'update') {
      const minDiff = d.old.salesMin === d.new.salesMin ? '' : ` (was ${d.old.salesMin})`;
      const maxDiff = d.old.salesMax === d.new.salesMax ? '' : ` (was ${d.old.salesMax})`;
      const rateDiff = d.old.rate === d.new.rate ? '' : ` (was ${d.old.rate})`;
      console.log(`  ${String(d.idx).padStart(3)} | ${String(d.new.salesMin).padStart(8)}${minDiff} | ${String(d.new.salesMax).padStart(8)}${maxDiff} | ${d.new.rate}${rateDiff}`);
    } else if (d.kind === 'add') {
      console.log(`  ${String(d.idx).padStart(3)} | ADD: salesMin=${d.new.salesMin} salesMax=${d.new.salesMax} rate=${d.new.rate}`);
    } else if (d.kind === 'remove') {
      console.log(`  ${String(d.idx).padStart(3)} | REMOVE: salesMin=${d.old.salesMin} salesMax=${d.old.salesMax} rate=${d.old.rate}`);
    }
  }
  console.log('');
  totalDiffCount += diffs.length;
  newRateTable[key] = correct;
}

console.log(`Total changes across all tables: ${totalDiffCount}`);
console.log('');

if (isDryRun) {
  console.log('(dry-run: no changes written)');
  process.exit(0);
}

if (totalDiffCount === 0) {
  console.log('No changes to apply, exiting.');
  process.exit(0);
}

await db.collection('userConfigs').doc(userId).set(
  { rateTable: newRateTable },
  { merge: true }
);

console.log(`✓ rateTable updated for userConfigs/${userId} in project ${projectId}`);

#!/usr/bin/env node
/**
 * userConfigs/{userId}.rateTable を取得して表示する
 *
 * 使い方:
 *   node scripts/get-rate-table.mjs <userId> [--project=<projectId>]
 *
 * 例:
 *   node scripts/get-rate-table.mjs user_self --project=taxi-dailydata
 */

import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const args = process.argv.slice(2);
const userId = args.find((a) => !a.startsWith('--'));
const projectArg = args.find((a) => a.startsWith('--project='));
const projectId = projectArg ? projectArg.split('=')[1] : 'taxi-dailydata-dev';

if (!userId) {
  console.error('Usage: node scripts/get-rate-table.mjs <userId> [--project=<projectId>]');
  process.exit(1);
}

const app = initializeApp({ credential: applicationDefault(), projectId });
const db = getFirestore(app);

try {
  const snap = await db.collection('userConfigs').doc(userId).get();
  if (!snap.exists) {
    console.error(`userConfigs/${userId} not found`);
    process.exit(1);
  }
  const data = snap.data();
  console.log(`Project: ${projectId}`);
  console.log(`userId:  ${userId}`);
  console.log('');

  if (!data.rateTable) {
    console.log('(rateTable not set in userConfigs)');
    process.exit(0);
  }

  for (const [tierKey, tiers] of Object.entries(data.rateTable)) {
    console.log(`=== rateTable["${tierKey}"] ===`);
    if (!Array.isArray(tiers)) {
      console.log(`  (not an array): ${JSON.stringify(tiers)}`);
      continue;
    }
    console.log(`  idx | salesMin     | salesMax     | rate`);
    console.log(`  ----+--------------+--------------+------`);
    tiers.forEach((t, i) => {
      const min = String(t.salesMin ?? '?').padStart(10);
      const max = String(t.salesMax ?? '?').padStart(10);
      const rate = String(t.rate ?? '?');
      console.log(`  ${String(i).padStart(3)} | ${min}   | ${max}   | ${rate}`);
    });
    console.log('');
  }
} catch (e) {
  console.error('Failed:', e.message);
  process.exit(1);
}

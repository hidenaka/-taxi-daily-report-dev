#!/usr/bin/env node
/**
 * adminUids コレクションの内容を一覧表示する
 *
 * 使い方:
 *   node scripts/list-admin-uids.mjs [--project=<projectId>]
 */

import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const args = process.argv.slice(2);
const projectArg = args.find((a) => a.startsWith('--project='));
const projectId = projectArg ? projectArg.split('=')[1] : 'taxi-dailydata-dev';

console.log(`Project: ${projectId}`);
console.log('');

const app = initializeApp({ credential: applicationDefault(), projectId });
const db = getFirestore(app);

try {
  const snap = await db.collection('adminUids').get();
  if (snap.empty) {
    console.log('(adminUids collection is empty)');
  } else {
    console.log(`Found ${snap.size} admin(s):`);
    for (const doc of snap.docs) {
      const data = doc.data();
      console.log(`  ${doc.id}`);
      console.log(`    email:     ${data.email ?? '(not set)'}`);
      console.log(`    note:      ${data.note ?? '(not set)'}`);
      console.log(`    createdAt: ${data.createdAt ?? '(not set)'}`);
    }
  }
} catch (e) {
  console.error('Failed:', e.message);
  process.exit(1);
}

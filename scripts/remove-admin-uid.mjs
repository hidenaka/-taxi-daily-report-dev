#!/usr/bin/env node
/**
 * adminUids コレクションから admin を削除する (email または UID 指定)
 *
 * 使い方:
 *   node scripts/remove-admin-uid.mjs <email-or-uid> [--project=<projectId>]
 *
 * 例:
 *   node scripts/remove-admin-uid.mjs admin@taxi.local
 *   node scripts/remove-admin-uid.mjs abc123XYZ...
 */

import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

const args = process.argv.slice(2);
const target = args.find((a) => !a.startsWith('--'));
const projectArg = args.find((a) => a.startsWith('--project='));
const projectId = projectArg ? projectArg.split('=')[1] : 'taxi-dailydata-dev';

if (!target) {
  console.error('Usage: node scripts/remove-admin-uid.mjs <email-or-uid> [--project=<projectId>]');
  process.exit(1);
}

console.log(`Project: ${projectId}`);
console.log(`Target:  ${target}`);
console.log('');

const app = initializeApp({ credential: applicationDefault(), projectId });
const db = getFirestore(app);
const auth = getAuth(app);

try {
  // Resolve email -> uid if needed.
  let uid = target;
  if (target.includes('@')) {
    const user = await auth.getUserByEmail(target);
    uid = user.uid;
    console.log(`Resolved ${target} -> ${uid}`);
  }

  const ref = db.collection('adminUids').doc(uid);
  const snap = await ref.get();
  if (!snap.exists) {
    console.log(`(no entry: adminUids/${uid})`);
    process.exit(0);
  }

  await ref.delete();
  console.log(`✓ Removed adminUids/${uid}`);
} catch (e) {
  console.error('Failed:', e.message);
  process.exit(1);
}

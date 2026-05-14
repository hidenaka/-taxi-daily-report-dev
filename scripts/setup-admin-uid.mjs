#!/usr/bin/env node
/**
 * adminUids コレクションに admin の Firebase Auth UID を登録する
 *
 * 使い方:
 *   node scripts/setup-admin-uid.mjs <email> [--project=<projectId>]
 *
 * 例:
 *   node scripts/setup-admin-uid.mjs admin@taxi.local                                # dev (default)
 *   node scripts/setup-admin-uid.mjs admin@taxi.local --project=taxi-dailydata-dev   # dev (明示)
 *   node scripts/setup-admin-uid.mjs admin@taxi.local --project=taxi-dailydata       # prod
 *
 * 事前準備:
 *   1. firebase-admin SDK が必要: `npm install --save-dev firebase-admin`
 *   2. gcloud CLI でログイン: `gcloud auth application-default login`
 */

import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

const args = process.argv.slice(2);
const email = args.find((a) => !a.startsWith('--'));
const projectArg = args.find((a) => a.startsWith('--project='));
const projectId = projectArg ? projectArg.split('=')[1] : 'taxi-dailydata-dev';

if (!email) {
  console.error('Usage: node scripts/setup-admin-uid.mjs <email> [--project=<projectId>]');
  console.error('Example: node scripts/setup-admin-uid.mjs admin@taxi.local');
  process.exit(1);
}

console.log(`Project: ${projectId}`);
console.log(`Email:   ${email}`);
console.log('');

const app = initializeApp({ credential: applicationDefault(), projectId });

try {
  const user = await getAuth(app).getUserByEmail(email);
  console.log(`Found Firebase Auth user: ${user.uid}`);

  await getFirestore(app).collection('adminUids').doc(user.uid).set({
    note: 'admin',
    email,
    createdAt: new Date().toISOString()
  });

  console.log(`✓ adminUids/${user.uid} created in project ${projectId}`);
} catch (e) {
  console.error('Failed:', e.message);
  if (e.code === 'auth/user-not-found') {
    console.error(`The email "${email}" was not found in Firebase Auth.`);
    console.error('Make sure the user was created via the application first.');
  }
  process.exit(1);
}

#!/usr/bin/env node
/**
 * パスワードを忘れたユーザーのパスワードを再設定する（本人確認用データの表示つき）。
 *
 * このアプリはメール/電話を保存していないため、Firebase 標準の「リセットメール送信」は使えない。
 * 運営が本人確認したうえで、このスクリプトで手動リセットする。個人情報は新たに集めない方針。
 *
 * 使い方:
 *   # 1) 本人確認: 直近の日報（日付＋営業収入の概算）を表示する（リセットしない）
 *   node scripts/reset-password.mjs <userId>
 *
 *   # 2) 申告と合致したら再設定（newPassword は8文字以上）
 *   node scripts/reset-password.mjs <userId> <newPassword>
 *
 *   # 本番に対して実行する場合は --project を明示
 *   node scripts/reset-password.mjs <userId> <newPassword> --project=taxi-dailydata
 *
 * 既定プロジェクト: taxi-dailydata-dev (dev)
 * 事前準備: scripts/README-firebase-admin.md 参照
 *   （npm install + gcloud auth application-default login）
 */

import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith('--'));
const userId = positional[0];
const newPassword = positional[1];
const projectArg = args.find((a) => a.startsWith('--project='));
const projectId = projectArg ? projectArg.split('=')[1] : 'taxi-dailydata-dev';

if (!userId) {
  console.error('Usage: node scripts/reset-password.mjs <userId> [newPassword] [--project=<projectId>]');
  console.error('  newPassword 省略 = 本人確認用に直近の日報を表示（リセットしない）');
  console.error('  newPassword 指定 = パスワードを再設定（8文字以上）');
  process.exit(1);
}

const email = `${userId}@taxi.local`;
const isProd = projectId === 'taxi-dailydata';

console.log(`Project: ${projectId}${isProd ? '  ⚠ 本番' : '  (dev)'}`);
console.log(`UserId:  ${userId}`);
console.log(`Email:   ${email}`);
console.log('');

const app = initializeApp({ credential: applicationDefault(), projectId });
const auth = getAuth(app);
const db = getFirestore(app);

// 1) ユーザー存在確認
let user;
try {
  user = await auth.getUserByEmail(email);
  console.log(`✓ Firebase Auth ユーザー発見: uid=${user.uid}`);
} catch (e) {
  if (e.code === 'auth/user-not-found') {
    console.error(`✗ ログインID "${userId}" は Firebase Auth に存在しません。IDの綴りを再確認してください。`);
  } else {
    console.error('Failed:', e.message);
  }
  process.exit(1);
}

// 2) 本人確認用: 直近の日報（日付＋営業収入概算）
console.log('');
console.log('--- 本人確認用: 直近の日報（日付＋営業収入の概算）---');
try {
  const snap = await db.collection('drives').doc(userId).collection('daily').get();
  const rows = [];
  snap.forEach((doc) => {
    const d = doc.data() || {};
    const trips = Array.isArray(d.trips) ? d.trips : [];
    let total = 0;
    for (const t of trips) {
      const fare = Number(t && (t.fare ?? t.amount ?? t['運賃']));
      if (!Number.isNaN(fare)) total += fare;
    }
    rows.push({ date: doc.id, total, count: trips.length });
  });
  rows.sort((a, b) => (a.date < b.date ? 1 : -1)); // 日付降順
  if (rows.length === 0) {
    console.log('（日報データなし）');
  } else {
    for (const r of rows.slice(0, 10)) {
      console.log(`  ${r.date}  営業収入≈¥${r.total.toLocaleString()}  (${r.count}件)`);
    }
    console.log(`  … 全${rows.length}日分`);
  }
} catch (e) {
  console.log('（日報の読み取りに失敗:', e.message, '）');
}

// 3) リセット実行 or 確認のみ
if (!newPassword) {
  console.log('');
  console.log('▶ 上記と本人の申告（最後に乗務した日・その日のおおよその営業収入）がざっくり合致したら、');
  console.log('  次を実行してパスワードを再設定:');
  console.log(`    node scripts/reset-password.mjs ${userId} <新パスワード8文字以上>${isProd ? ' --project=taxi-dailydata' : ''}`);
  process.exit(0);
}

if (String(newPassword).length < 8) {
  console.error('✗ パスワードは8文字以上にしてください。');
  process.exit(1);
}

try {
  await auth.updateUser(user.uid, { password: String(newPassword) });
  console.log('');
  console.log(`✅ パスワードを再設定しました: userId=${userId} (uid=${user.uid})`);
  console.log('  新パスワードを本人に伝え、ログイン後に本人で変更してもらってください。');
} catch (e) {
  console.error('✗ 再設定に失敗:', e.message);
  process.exit(1);
}

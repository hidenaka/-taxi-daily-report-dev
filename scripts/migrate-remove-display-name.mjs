// scripts/migrate-remove-display-name.mjs
//
// 既存の Firestore userConfigs/* ドキュメントから `displayName` フィールドを削除する1回限りの移行。
// 設計方針（decisions 10, 2026-05-20）: 表示名はサーバーに保存しない。
// 個人特定情報を取得・保存しない設計のため、displayName 入力UIごと廃止。
// C案匿名集計の方針とも整合（集計画面は完全匿名・displayName を表示する場面なし）。
//
// 使い方:
//   SA=<service account json path> node scripts/migrate-remove-display-name.mjs
//   ※ dev/prod それぞれで実行する（プロジェクトごとに別の SA を渡す）。
//   ※ dry-run したい場合は環境変数 DRY=1 を付与。
//
// 動作: userConfigs コレクションを列挙 → displayName フィールドがあるドキュメントだけ
// updateMask=displayName で PATCH（body の fields に displayName を含めない＝そのフィールドが削除される）。

import crypto from 'node:crypto';
import fs from 'node:fs';

const sa = JSON.parse(fs.readFileSync(process.env.SA, 'utf8'));
const dryRun = process.env.DRY === '1';

const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

// --- JWT で OAuth2 access token を取得 ---
const now = Math.floor(Date.now() / 1000);
const claim = b({
  iss: sa.client_email,
  scope: 'https://www.googleapis.com/auth/datastore',
  aud: 'https://oauth2.googleapis.com/token',
  iat: now,
  exp: now + 3600,
});
const unsigned = b({ alg: 'RS256', typ: 'JWT' }) + '.' + claim;
const sig = crypto.sign('RSA-SHA256', Buffer.from(unsigned), sa.private_key).toString('base64url');
const tr = await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: 'grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=' + unsigned + '.' + sig,
});
const token = (await tr.json()).access_token;
if (!token) {
  console.error('OAuth token 取得失敗');
  process.exit(1);
}

const base = `https://firestore.googleapis.com/v1/projects/${sa.project_id}/databases/(default)/documents`;
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

// --- userConfigs コレクション列挙 ---
const listRes = await fetch(`${base}/userConfigs?pageSize=300`, { headers });
const listJson = await listRes.json();
const docs = listJson.documents || [];
console.log(`[${sa.project_id}] userConfigs: ${docs.length}件${dryRun ? ' (DRY-RUN)' : ''}`);

let removed = 0;
let skipped = 0;

for (const doc of docs) {
  const docPath = doc.name; // フルパス: "projects/.../userConfigs/{userId}"
  const userId = docPath.split('/').pop();
  const fields = doc.fields || {};
  if (!('displayName' in fields)) {
    skipped++;
    continue;
  }
  const currentValue = fields.displayName?.stringValue || '(non-string)';
  if (dryRun) {
    console.log(`  ${userId}: displayName="${currentValue}" を削除 (DRY-RUN)`);
    removed++;
    continue;
  }
  // PATCH: updateMask=displayName + body の fields に displayName を含めない → そのフィールドが削除される
  const patchUrl = `${base}/userConfigs/${userId}?updateMask.fieldPaths=displayName`;
  const patchRes = await fetch(patchUrl, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ fields: {} }),
  });
  if (!patchRes.ok) {
    const err = await patchRes.text();
    console.error(`  ${userId}: PATCH 失敗 (${patchRes.status}): ${err}`);
    continue;
  }
  console.log(`  ${userId}: displayName="${currentValue}" を削除完了`);
  removed++;
}

console.log(`\n結果: 削除 ${removed}件 / skip(既にdisplayNameなし) ${skipped}件`);

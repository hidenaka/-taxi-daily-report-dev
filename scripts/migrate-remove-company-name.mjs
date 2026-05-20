// scripts/migrate-remove-company-name.mjs
//
// 既存の Firestore companies/* ドキュメントから `name` フィールドを削除する1回限りの移行。
// 設計方針（2026-05-20 決定）: 会社名はサーバーに保存しない。流出時の特定リスク低減のため、
// companies は slug ＋ 運用設定のみを保持する。
//
// 使い方:
//   SA=<service account json path> node scripts/migrate-remove-company-name.mjs
//   ※ dev/prod それぞれで実行する（プロジェクトごとに別の SA を渡す）。
//   ※ dry-run したい場合は環境変数 DRY=1 を付与。
//
// 動作: companies コレクションを列挙 → name フィールドがあるドキュメントだけ
// updateMask=name で PATCH（body の fields に name を含めない＝そのフィールドが削除される）。

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

// --- companies コレクション列挙 ---
const listRes = await fetch(`${base}/companies`, { headers });
const listJson = await listRes.json();
const docs = listJson.documents || [];
console.log(`[${sa.project_id}] companies: ${docs.length}件${dryRun ? ' (DRY-RUN)' : ''}`);

let removed = 0;
let skipped = 0;

for (const doc of docs) {
  // doc.name は Firestore 内部のドキュメントパス（"projects/.../companies/keiho"）
  const docPath = doc.name; // フルパス
  const slug = docPath.split('/').pop();
  const fields = doc.fields || {};
  if (!('name' in fields)) {
    console.log(`  ${slug}: 既に name なし — skip`);
    skipped++;
    continue;
  }
  const currentName = fields.name?.stringValue || '(non-string)';
  if (dryRun) {
    console.log(`  ${slug}: name="${currentName}" を削除 (DRY-RUN)`);
    removed++;
    continue;
  }
  // PATCH: updateMask=name + body の fields に name を含めない → そのフィールドが削除される
  const patchUrl = `${base}/companies/${slug}?updateMask.fieldPaths=name`;
  const patchRes = await fetch(patchUrl, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ fields: {} }),
  });
  if (!patchRes.ok) {
    const err = await patchRes.text();
    console.error(`  ${slug}: PATCH 失敗 (${patchRes.status}): ${err}`);
    continue;
  }
  console.log(`  ${slug}: name="${currentName}" を削除完了`);
  removed++;
}

console.log(`\n結果: 削除 ${removed}件 / skip ${skipped}件`);

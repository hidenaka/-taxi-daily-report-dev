// scripts/migrate-anonymize-slug.mjs
//
// 既存の Firestore companies/* のレガシー slug（ローマ字会社名）を匿名識別子 `co-XXXXXX` に
// rename する1回限りの移行。
// 設計方針（2026-05-20 決定 7）: slug 自体が会社特定の漏洩経路になる（例 `keiho` → 恵豊）ため、
// slug をランダム base32 に変える。`users/{uid}.companyId` も同時に更新する。
//
// 使い方:
//   SA=<service account json path> node scripts/migrate-anonymize-slug.mjs
//   ※ dev/prod それぞれで実行する（プロジェクトごとに別の SA を渡す）。
//   ※ dry-run したい場合は環境変数 DRY=1 を付与。
//
// 動作:
//   1. companies コレクションを列挙
//   2. レガシー slug (isLegacySlug=true) の doc について:
//      - 新 slug を generateSlug で発行
//      - companies/{newSlug} に同じ fields を書込
//      - users コレクション全列挙して companyId === oldSlug の uid を全件 PATCH（companyId を newSlug に）
//      - companies/{oldSlug} を削除
//   3. 最後に「oldSlug → newSlug」マップを出力。**ユーザーが 1Password / Notes.app 等に保存する**
//      （これが「どの slug がどの会社か」を後で知る唯一の手段）

import crypto from 'node:crypto';
import fs from 'node:fs';
import { generateSlug, isLegacySlug } from '../js/slug-gen.js';

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
const companyDocs = listJson.documents || [];

// --- users コレクション列挙（companyId フィルタを JS 側で実施） ---
const userRes = await fetch(`${base}/users`, { headers });
const userJson = await userRes.json();
const userDocs = userJson.documents || [];

console.log(`[${sa.project_id}] companies: ${companyDocs.length}件 / users: ${userDocs.length}件${dryRun ? ' (DRY-RUN)' : ''}\n`);

const slugMap = []; // { old, new }
let renamed = 0;
let skipped = 0;

for (const doc of companyDocs) {
  const oldSlug = doc.name.split('/').pop();
  if (!isLegacySlug(oldSlug)) {
    console.log(`  ${oldSlug}: 既に匿名化済 — skip`);
    skipped++;
    continue;
  }
  const newSlug = generateSlug();
  console.log(`  ${oldSlug} → ${newSlug}`);
  slugMap.push({ old: oldSlug, new: newSlug });

  if (dryRun) {
    renamed++;
    continue;
  }

  // 1. companies/{newSlug} に同じ fields を書込
  const createRes = await fetch(`${base}/companies?documentId=${newSlug}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ fields: doc.fields || {} }),
  });
  if (!createRes.ok) {
    console.error(`    companies/${newSlug} 作成失敗 (${createRes.status}): ${await createRes.text()}`);
    continue;
  }

  // 2. users.companyId === oldSlug の uid を全部 update
  let userUpdated = 0;
  for (const u of userDocs) {
    const userFields = u.fields || {};
    const currentCompanyId = userFields.companyId?.stringValue;
    if (currentCompanyId !== oldSlug) continue;
    const uid = u.name.split('/').pop();
    const patchRes = await fetch(`${base}/users/${uid}?updateMask.fieldPaths=companyId`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ fields: { companyId: { stringValue: newSlug } } }),
    });
    if (patchRes.ok) {
      userUpdated++;
    } else {
      console.error(`    users/${uid} PATCH failed: ${patchRes.status}`);
    }
  }
  console.log(`    users 更新: ${userUpdated}件`);

  // 3. companies/{oldSlug} を削除
  const delRes = await fetch(`${base}/companies/${oldSlug}`, {
    method: 'DELETE',
    headers,
  });
  if (!delRes.ok) {
    console.error(`    companies/${oldSlug} 削除失敗 (${delRes.status})`);
    continue;
  }
  console.log(`    companies/${oldSlug} 削除完了`);
  renamed++;
}

console.log(`\n結果: rename ${renamed}件 / skip ${skipped}件`);

if (slugMap.length > 0) {
  console.log('\n=== ⚠️ 重要: 以下の slug マップを 1Password / Notes.app 等の暗号化メモに保存してください ===');
  console.log('(これは「どの slug がどの会社か」を後で参照する唯一の手段。サーバーには会社名が残らない設計です)');
  console.log('');
  for (const m of slugMap) {
    console.log(`  ${m.old}  →  ${m.new}`);
  }
  console.log('');
  console.log('=================================================================================\n');
  console.log('⚠️ 配布済み招待URLがある場合は再発行が必要です:');
  for (const m of slugMap) {
    console.log(`  旧: https://taxicabis.com/?company=${m.old}`);
    console.log(`  新: https://taxicabis.com/?company=${m.new}`);
  }
}

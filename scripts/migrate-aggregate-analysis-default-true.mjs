// scripts/migrate-aggregate-analysis-default-true.mjs
// 使い方: SA=<path-to-service-account-json> node scripts/migrate-aggregate-analysis-default-true.mjs
// users コレクションを走査し、participatesInAggregateAnalysis フィールドが未定義の doc に true をセットする。
// 既に true/false が設定されている doc は触らない（OFFのユーザーをONに巻き戻さない）。
// C案（提供と閲覧を連動）の移行時に1回だけ実行する想定。
import crypto from 'node:crypto';
import fs from 'node:fs';

const sa = JSON.parse(fs.readFileSync(process.env.SA, 'utf8'));
const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const unsigned = b({ alg: 'RS256', typ: 'JWT' }) + '.' + b({ iss: sa.client_email,
  scope: 'https://www.googleapis.com/auth/datastore', aud: 'https://oauth2.googleapis.com/token',
  iat: now, exp: now + 3600 });
const sig = crypto.sign('RSA-SHA256', Buffer.from(unsigned), sa.private_key).toString('base64url');
const tr = await fetch('https://oauth2.googleapis.com/token', { method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: 'grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=' + unsigned + '.' + sig });
const token = (await tr.json()).access_token;
const base = `https://firestore.googleapis.com/v1/projects/${sa.project_id}/databases/(default)/documents`;

const list = await (await fetch(base + '/users?pageSize=300',
  { headers: { Authorization: 'Bearer ' + token } })).json();
let touched = 0, skipped = 0;
for (const doc of (list.documents || [])) {
  const uid = doc.name.split('/').pop();
  const userId = doc.fields?.userId?.stringValue || '(none)';
  const current = doc.fields?.participatesInAggregateAnalysis;
  if (current && current.booleanValue !== undefined) {
    console.log(userId, '(' + uid + ') -> skip (already', current.booleanValue, ')');
    skipped++;
    continue;
  }
  const r = await fetch(`${base}/users/${uid}?updateMask.fieldPaths=participatesInAggregateAnalysis`, {
    method: 'PATCH',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: { participatesInAggregateAnalysis: { booleanValue: true } } }) });
  console.log(userId, '(' + uid + ') -> set true, status', r.status);
  touched++;
}
console.log(`\n完了: ${touched} 件にセット、${skipped} 件は既設定でスキップ`);

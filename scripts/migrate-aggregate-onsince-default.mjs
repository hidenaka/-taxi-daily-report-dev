// scripts/migrate-aggregate-onsince-default.mjs
// 使い方: SA=<path-to-service-account-json> node scripts/migrate-aggregate-onsince-default.mjs
// 既存ユーザーの users/{uid}.aggregateOnSince が未設定 かつ participatesInAggregateAnalysis≠false の doc に、
// 「365日前」のISO8601をセットする。これでE案の閲覧レベル判定で full（20+出番）として扱われ、
// 既存ユーザーは「いきなり閲覧制限された」状態を回避できる。
// 既に aggregateOnSince が設定済みの doc / 参加=false の doc は触らない（冪等）。
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

// 365日前のISO8601を準備
const oneYearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();

const list = await (await fetch(base + '/users?pageSize=300',
  { headers: { Authorization: 'Bearer ' + token } })).json();
let touched = 0, skipped = 0;
for (const doc of (list.documents || [])) {
  const uid = doc.name.split('/').pop();
  const userId = doc.fields?.userId?.stringValue || '(none)';
  const partFlag = doc.fields?.participatesInAggregateAnalysis;
  const onSince = doc.fields?.aggregateOnSince;
  // 参加=false の doc は触らない（明示的に OFF にした人を勝手に ON 扱いしない）
  if (partFlag && partFlag.booleanValue === false) {
    console.log(userId, '(' + uid + ') -> skip (participatesInAggregateAnalysis=false)');
    skipped++;
    continue;
  }
  // 既に aggregateOnSince が設定されている doc は触らない（冪等）
  if (onSince && onSince.timestampValue) {
    console.log(userId, '(' + uid + ') -> skip (aggregateOnSince=' + onSince.timestampValue + ')');
    skipped++;
    continue;
  }
  if (onSince && onSince.stringValue) {
    console.log(userId, '(' + uid + ') -> skip (aggregateOnSince=' + onSince.stringValue + ')');
    skipped++;
    continue;
  }
  const r = await fetch(`${base}/users/${uid}?updateMask.fieldPaths=aggregateOnSince`, {
    method: 'PATCH',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: { aggregateOnSince: { stringValue: oneYearAgo } } }) });
  console.log(userId, '(' + uid + ') -> set aggregateOnSince=' + oneYearAgo + ', status', r.status);
  touched++;
}
console.log(`\n完了: ${touched} 件にセット、${skipped} 件は既設定/不参加でスキップ`);

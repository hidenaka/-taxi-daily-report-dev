// scripts/migrate-existing-users-companyid.mjs
// 使い方: SA=<path> node scripts/migrate-existing-users-companyid.mjs
// user_self / mm の users ドキュメントに companyId=keiho を付与する。
// （userId ではなく Firebase Auth uid キーのため、users 全件から該当 userId を探す）
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

// users 全件取得 → userId が user_self / mm の uid に companyId=keiho を PATCH
const list = await (await fetch(base + '/users?pageSize=300',
  { headers: { Authorization: 'Bearer ' + token } })).json();
for (const doc of (list.documents || [])) {
  const uid = doc.name.split('/').pop();
  const userId = doc.fields?.userId?.stringValue;
  if (userId === 'user_self' || userId === 'mm') {
    const r = await fetch(`${base}/users/${uid}?updateMask.fieldPaths=companyId`, {
      method: 'PATCH',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { companyId: { stringValue: 'keiho' } } }) });
    console.log(userId, '(' + uid + ') ->', r.status);
  }
}

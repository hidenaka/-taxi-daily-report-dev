// scripts/seed-keiho-company.mjs
// 使い方: SA=<service account json path> node scripts/seed-keiho-company.mjs
// companies/keiho ドキュメントを Firestore に作成する。
import crypto from 'node:crypto';
import fs from 'node:fs';
import { buildKeihoProfile } from '../js/company-profiles.js';

const sa = JSON.parse(fs.readFileSync(process.env.SA, 'utf8'));
const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

function toFirestoreValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') {
    return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  }
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) {
    return { arrayValue: { values: v.map(toFirestoreValue) } };
  }
  const fields = {};
  for (const k of Object.keys(v)) fields[k] = toFirestoreValue(v[k]);
  return { mapValue: { fields } };
}

const now = Math.floor(Date.now() / 1000);
const claim = b({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/datastore',
  aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 });
const unsigned = b({ alg: 'RS256', typ: 'JWT' }) + '.' + claim;
const sig = crypto.sign('RSA-SHA256', Buffer.from(unsigned), sa.private_key).toString('base64url');
const tr = await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: 'grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=' + unsigned + '.' + sig });
const token = (await tr.json()).access_token;

const profile = buildKeihoProfile();
const fields = {};
for (const k of Object.keys(profile)) fields[k] = toFirestoreValue(profile[k]);

const url = `https://firestore.googleapis.com/v1/projects/${sa.project_id}`
  + `/databases/(default)/documents/companies?documentId=keiho`;
const res = await fetch(url, {
  method: 'POST',
  headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
  body: JSON.stringify({ fields }) });
console.log('HTTP', res.status, res.status === 200 ? 'companies/keiho 作成OK' : await res.text());

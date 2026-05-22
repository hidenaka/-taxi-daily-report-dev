// scripts/seed-keiho-company.mjs
// 使い方:
//   新規発行(匿名slug自動生成):   SA=<service account json> node scripts/seed-keiho-company.mjs
//   既存会社を更新(slug固定):      SA=<...> SLUG=co-xxxxxx node scripts/seed-keiho-company.mjs
// companies/<匿名slug> ドキュメントを Firestore に作成/更新する。
// slug は必ず co-xxxxxx 形式(平文の会社名は使わない・decisions 7)。SLUG 未指定なら自動生成。
import crypto from 'node:crypto';
import fs from 'node:fs';
import { buildKeihoProfile } from '../js/company-profiles.js';
import { generateSlug, isAnonymizedSlug } from '../js/slug-gen.js';

// 既存会社の更新は SLUG=co-xxxxxx で固定指定。未指定なら新規の匿名 slug を発行。
const slug = process.env.SLUG || generateSlug();
if (!isAnonymizedSlug(slug)) {
  console.error(`SLUG は co-xxxxxx 形式で指定してください (受領: ${slug})`);
  process.exit(1);
}

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

const profile = buildKeihoProfile(slug);
const fields = {};
for (const k of Object.keys(profile)) fields[k] = toFirestoreValue(profile[k]);

const url = `https://firestore.googleapis.com/v1/projects/${sa.project_id}`
  + `/databases/(default)/documents/companies?documentId=${encodeURIComponent(slug)}`;
const res = await fetch(url, {
  method: 'POST',
  headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
  body: JSON.stringify({ fields }) });
console.log('HTTP', res.status, res.status === 200
  ? `companies/${slug} 作成OK (ログイン: ?company=${slug})`
  : await res.text());

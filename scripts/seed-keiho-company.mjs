// scripts/seed-keiho-company.mjs
// ⚠️ 取扱注意: companies コレクションへ直接書き込む。意図を明示しないと中止する設計。
//   - 既存会社の更新:  SA=<鍵> SLUG=co-xxxxxx node scripts/seed-keiho-company.mjs
//       本番の既存会社 = co-swyg3o / dev の既存会社 = co-7q7ros
//   - 新規会社の発行:  SA=<鍵> NEW=1 node scripts/seed-keiho-company.mjs   (匿名slugを自動生成)
//   どちらも指定しないと「中止」する(SLUG忘れで重複会社docを作る事故を防ぐため)。
//   slug は必ず co-xxxxxx 形式。平文の会社名は使わない(decisions 7)。
//   ※ 実行前に必ず .company/engineering/docs/danger-company-seed.md を読み、本人に確認すること。
import crypto from 'node:crypto';
import fs from 'node:fs';
import { buildKeihoProfile } from '../js/company-profiles.js';
import { generateSlug, isAnonymizedSlug } from '../js/slug-gen.js';

// 意図の明示を必須にする: SLUG(更新) か NEW=1(新規) のどちらかが無ければ中止。
const envSlug = process.env.SLUG;
const wantNew = process.env.NEW === '1';
if (!envSlug && !wantNew) {
  console.error('中止: 意図が不明です。既存会社の更新は SLUG=co-xxxxxx を、新規発行は NEW=1 を指定してください。');
  console.error('(SLUG 忘れで別の重複会社 doc を作る事故を防ぐためのガードです)');
  process.exit(1);
}
const slug = envSlug || generateSlug();
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

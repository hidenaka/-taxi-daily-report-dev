#!/usr/bin/env node
/**
 * companies/{slug} の premiumIncentive "だけ" を merge 更新する。
 * 他フィールド(rateTable, plan, active, payrollMode 等)は温存する
 * (Firestore REST の PATCH + updateMask により、指定フィールドのみ書き換え)。
 *
 * 新値は js/default-config.js の DEFAULT_CONFIG を唯一のソースとして読む。
 * history(過去の基準額)も一緒に入るので、過去の月度は当時の基準で計算され続ける。
 *
 * 使い方:
 *   SA=~/Downloads/taxi-dailydata-dev-firebase-adminsdk-fbsvc-68fe3f675f.json \
 *     node scripts/update-company-premium-incentive.mjs --slug=co-7q7ros --dry-run
 *   SA=... node scripts/update-company-premium-incentive.mjs --slug=co-7q7ros --execute
 *   # 本番: dev 確認後のみ (--slug=co-swyg3o)
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import { DEFAULT_CONFIG } from '../js/default-config.js';

const args = process.argv.slice(2);
const getArg = (k) => {
  const a = args.find((x) => x.startsWith(`--${k}=`));
  return a ? a.split('=')[1] : undefined;
};
const slug = getArg('slug');
const isExecute = args.includes('--execute');

if (!slug) {
  console.error('Usage: SA=<path> node scripts/update-company-premium-incentive.mjs --slug=<co-xxxxxx> [--dry-run|--execute]');
  process.exit(1);
}
if (!process.env.SA) {
  console.error('環境変数 SA に service account json のパスを渡してください。');
  process.exit(1);
}

const sa = JSON.parse(fs.readFileSync(process.env.SA.replace(/^~/, process.env.HOME), 'utf8'));
const projectId = sa.project_id;

function toFirestoreValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toFirestoreValue) } };
  const fields = {};
  for (const k of Object.keys(v)) fields[k] = toFirestoreValue(v[k]);
  return { mapValue: { fields } };
}
function fromFirestoreValue(v) {
  if (!v) return undefined;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('stringValue' in v) return v.stringValue;
  if ('nullValue' in v) return null;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fromFirestoreValue);
  if ('mapValue' in v) {
    const o = {};
    for (const k of Object.keys(v.mapValue.fields || {})) o[k] = fromFirestoreValue(v.mapValue.fields[k]);
    return o;
  }
  return undefined;
}

const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const claim = b({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/datastore',
  aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 });
const unsigned = b({ alg: 'RS256', typ: 'JWT' }) + '.' + claim;
const sig = crypto.sign('RSA-SHA256', Buffer.from(unsigned), sa.private_key).toString('base64url');
const tr = await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: 'grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=' + unsigned + '.' + sig });
const token = (await tr.json()).access_token;
if (!token) { console.error('トークン取得失敗'); process.exit(1); }

const docUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/companies/${slug}`;

console.log(`Project:      ${projectId}`);
console.log(`Company doc:  companies/${slug}`);
console.log(`Mode:         ${isExecute ? 'EXECUTE (PATCH merge)' : 'DRY-RUN (読み取りのみ)'}\n`);

const getRes = await fetch(docUrl, { headers: { Authorization: 'Bearer ' + token } });
if (getRes.status !== 200) { console.error(`GET 失敗 ${getRes.status}:`, await getRes.text()); process.exit(1); }
const curFields = (await getRes.json()).fields || {};
const cur = fromFirestoreValue(curFields.premiumIncentive) || {};
const NEW = DEFAULT_CONFIG.premiumIncentive;

console.log('--- premiumIncentive ---');
console.log(`  現在: ${JSON.stringify(cur)}`);
console.log(`  新値: ${JSON.stringify(NEW)}`);
console.log('--- 温存される他フィールド ---');
for (const k of Object.keys(curFields)) {
  if (k !== 'premiumIncentive') console.log(`  ${k} (変更なし)`);
}
console.log('');

if (!isExecute) { console.log('(dry-run: 書き込みなし。--execute で反映)'); process.exit(0); }

const res = await fetch(docUrl + '?updateMask.fieldPaths=premiumIncentive', {
  method: 'PATCH',
  headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
  body: JSON.stringify({ fields: { premiumIncentive: toFirestoreValue(NEW) } }) });
if (res.status === 200) console.log(`✓ companies/${slug} の premiumIncentive を更新 (project ${projectId})`);
else { console.error(`PATCH 失敗 ${res.status}:`, await res.text()); process.exit(1); }

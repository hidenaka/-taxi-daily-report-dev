#!/usr/bin/env node
/**
 * companies/{slug} の rateTable と takeHomeRate "だけ" を merge 更新する。
 * 他フィールド(standsMapEnabled, adminUids, plan, active, payrollMode 等)は温存する
 * (Firestore REST の PATCH + updateMask により、指定フィールドのみ書き換え)。
 *
 * 新値は js/default-config.js の DEFAULT_CONFIG を唯一のソースとして読む。
 * 依存ゼロ(firebase-admin 不要)。SA 鍵で JWT を作り REST を直接叩く。
 *
 * ⚠️ 会社全体を上書きする旧スクリプトは使わないこと(本番の会社識別子を壊す危険)。
 *
 * 使い方:
 *   # dev: 確認(読み取りのみ) → 反映
 *   SA=~/Downloads/taxi-dailydata-dev-firebase-adminsdk-fbsvc-68fe3f675f.json \
 *     node scripts/update-company-rate-table.mjs --slug=co-7q7ros --dry-run
 *   SA=... node scripts/update-company-rate-table.mjs --slug=co-7q7ros --execute
 *   # 本番: dev 確認後のみ
 *   SA=~/Downloads/taxi-dailydata-firebase-adminsdk-fbsvc-47418face6.json \
 *     node scripts/update-company-rate-table.mjs --slug=co-swyg3o --dry-run
 *   SA=... node scripts/update-company-rate-table.mjs --slug=co-swyg3o --execute
 *
 * project_id は SA 鍵から自動で取る。デフォルトは --dry-run。--execute 明示時のみ書き込む。
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
const isDryRun = !isExecute;

if (!slug) {
  console.error('Usage: SA=<path> node scripts/update-company-rate-table.mjs --slug=<co-xxxxxx> [--dry-run|--execute]');
  process.exit(1);
}
if (!process.env.SA) {
  console.error('環境変数 SA に service account json のパスを渡してください。');
  process.exit(1);
}

const sa = JSON.parse(fs.readFileSync(process.env.SA.replace(/^~/, process.env.HOME), 'utf8'));
const projectId = sa.project_id;

// --- Firestore 値エンコード/デコード ---
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

// --- OAuth トークン ---
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

const base = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
const docUrl = `${base}/companies/${slug}`;

console.log(`Project:      ${projectId}`);
console.log(`Company doc:  companies/${slug}`);
console.log(`Mode:         ${isExecute ? 'EXECUTE (PATCH merge)' : 'DRY-RUN (読み取りのみ)'}`);
console.log('');

// --- 現状取得 ---
const getRes = await fetch(docUrl, { headers: { Authorization: 'Bearer ' + token } });
if (getRes.status !== 200) { console.error(`GET 失敗 ${getRes.status}:`, await getRes.text()); process.exit(1); }
const cur = await getRes.json();
const curFields = cur.fields || {};
const curRate = fromFirestoreValue(curFields.rateTable) || {};
const curTHR = fromFirestoreValue(curFields.takeHomeRate);

const NEW = { rateTable: DEFAULT_CONFIG.rateTable, takeHomeRate: DEFAULT_CONFIG.takeHomeRate, paidLeaveAmount: DEFAULT_CONFIG.paidLeaveAmount };
const findRate = (t, s) => { if (!Array.isArray(t)) return null; for (const x of t) if (s >= x.salesMin && s < x.salesMax) return x.rate; return t.length ? t[t.length - 1].rate : null; };

console.log('--- takeHomeRate ---');
console.log(`  現在: ${curTHR}  →  新: ${NEW.takeHomeRate}`);
console.log('--- paidLeaveAmount ---');
const curPLA=fromFirestoreValue(curFields.paidLeaveAmount);
console.log(`  現在: ${curPLA}  →  新: ${NEW.paidLeaveAmount}`);
console.log('--- rateTable[11] 代表点(税抜営収 → 歩率) ---');
for (const s of [550000, 715000, 825000, 865064, 880000, 1100000]) {
  console.log(`  @${s}: ${findRate(curRate['11'], s)} → ${findRate(NEW.rateTable['11'], s)}`);
}
console.log(`--- rateTable keys: 現在[${Object.keys(curRate).sort().join(',')}] → 新[${Object.keys(NEW.rateTable).sort().join(',')}]`);
console.log('--- 温存される他フィールド ---');
for (const k of Object.keys(curFields)) {
  if (k === 'rateTable' || k === 'takeHomeRate') continue;
  console.log(`  ${k} (変更なし)`);
}
console.log('');

if (isDryRun) { console.log('(dry-run: 書き込みなし。--execute で反映)'); process.exit(0); }

// --- PATCH (updateMask で rateTable + takeHomeRate のみ書き換え、他は温存) ---
const patchUrl = docUrl + '?updateMask.fieldPaths=rateTable&updateMask.fieldPaths=takeHomeRate&updateMask.fieldPaths=paidLeaveAmount';
const body = { fields: { rateTable: toFirestoreValue(NEW.rateTable), takeHomeRate: toFirestoreValue(NEW.takeHomeRate), paidLeaveAmount: toFirestoreValue(NEW.paidLeaveAmount) } };
const res = await fetch(patchUrl, { method: 'PATCH',
  headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
  body: JSON.stringify(body) });
if (res.status === 200) console.log(`✓ companies/${slug} の rateTable + takeHomeRate + paidLeaveAmount を更新 (project ${projectId})`);
else { console.error(`PATCH 失敗 ${res.status}:`, await res.text()); process.exit(1); }

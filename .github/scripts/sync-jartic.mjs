#!/usr/bin/env node
// 国土交通省「交通量API」から、23区とそのまわりの国道の観測点の1時間値を取り、tools/data/jartic-traffic.json を更新する。
// 1時間に1回動かす（.github/workflows/sync-jartic.yml）。1回に取りに行くのは2回だけ（常設とCCTV）。
// 初めて動かすとき（データが無いとき）だけ、8日分を1日ずつ、間を空けて取る。
//
// 規約（交通量API 利用規約）で守ること:
//   第5条 出典と「国土交通省が保証したものではない」旨を、地図を使うたびに見える所に出す（地図の層が出す）
//   第6条 短い時間に大量に取りに行かない（1回に2件・間を3秒空ける）
//   第8条 取りに行った記録を残す（.github/scripts/data/jartic-access-log.tsv に60日分）
//
// 使い方: node .github/scripts/sync-jartic.mjs [--dry]   （--dry は書き込まない）
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { toRecord, mergeHistory, jstHourKey, addHours, KEEP_HOURS } from '../../tools/js/jartic-data.js';
import { loadRoadData } from './lib/koji-road-shape.mjs';

const ROOT = new URL('../../', import.meta.url).pathname;
const OUT = `${ROOT}tools/data/jartic-traffic.json`;
const LOG = `${ROOT}.github/scripts/data/jartic-access-log.tsv`;
const BBOX = [139.56, 35.52, 139.92, 35.82];   // 23区がおさまる四角（まわりの市も少し入る）
const TYPES = { perm: 't_travospublic_measure_1h', cctv: 't_travospublic_measure_1h_img' };
const API = 'https://api.jartic-open-traffic.org/geoserver';
const dry = process.argv.includes('--dry');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const logLines = [];
async function fetchType(kind, fromKey, toKey) {
  const cql = `道路種別='3' AND 時間コード>=${fromKey}00 AND 時間コード<=${toKey}00 AND BBOX(ジオメトリ,${BBOX.join(',')},'EPSG:4326')`;
  const url = `${API}?service=WFS&version=2.0.0&request=GetFeature&typeNames=${TYPES[kind]}&srsName=EPSG:4326&outputFormat=application/json&exceptions=application/json&cql_filter=${encodeURIComponent(cql)}`;
  const at = new Date().toISOString();
  let status = 0; let count = 0;
  try {
    const res = await fetch(url, { headers: { 'user-agent': 'cabis-jartic-sync' }, signal: AbortSignal.timeout(60000) });
    status = res.status;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const d = await res.json();
    const F = d.features || [];
    count = F.length;
    return F.map((f) => ({ ...toRecord(f.properties, kind), kind, c: f.geometry?.coordinates?.[0] || f.geometry?.coordinates }));
  } finally {
    logLines.push([at, kind, fromKey, toKey, status, count].join('\t'));
  }
}

/** 観測点の近くの道の名前（OSM）。40m 以内に無ければ空 */
function namer() {
  const { lines } = loadRoadData();
  return ([lon, lat]) => {
    const k = Math.cos((lat * Math.PI) / 180) * 111320;
    let best = null;
    for (const L of lines) {
      if (!L.n) continue;
      for (let i = 1; i < L.c.length; i++) {
        const a = L.c[i - 1]; const b = L.c[i];
        if (Math.abs(a[0] - lon) > 0.002 && Math.abs(b[0] - lon) > 0.002) continue;
        if (Math.abs(a[1] - lat) > 0.002 && Math.abs(b[1] - lat) > 0.002) continue;
        const ax = (a[0] - lon) * k; const ay = (a[1] - lat) * 110540; const bx = (b[0] - lon) * k; const by = (b[1] - lat) * 110540;
        const dx = bx - ax; const dy = by - ay; const L2 = dx * dx + dy * dy;
        const t = L2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L2)) : 0;
        const d = Math.hypot(ax + dx * t, ay + dy * t) - (L.main ? 5 : 0);   // 同じくらいなら幹線を選ぶ
        if (!best || d < best.d) best = { d, n: L.n };
      }
    }
    return best && best.d <= 40 ? best.n : '';
  };
}

async function main() {
  const doc = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : null;
  // 値はだいたい1〜2時間遅れて入る。前の時間までをそろえ、遅れて入った分も拾えるよう6時間前から取り直す
  const nowKey = addHours(jstHourKey(), -1);
  const records = [];
  const first = !doc?.points?.length;
  const ranges = [];
  if (first) for (let d = 7; d >= 0; d--) ranges.push([addHours(nowKey, -d * 24 - 23), addHours(nowKey, -d * 24)]);
  else ranges.push([addHours(nowKey, -6), nowKey]);
  for (const [from, to] of ranges) {
    for (const kind of Object.keys(TYPES)) {
      try { records.push(...(await fetchType(kind, from, to))); } catch (e) { console.warn(`[交通量API] ${kind} ${from}〜${to} を取れませんでした: ${e.message}`); }
      await sleep(3000);
    }
  }
  const got = records.length;
  if (!got && !doc) throw new Error('交通量API から1件も取れませんでした');
  const nameOf = namer();
  const out = mergeHistory(doc, records, nowKey, { keep: KEEP_HOURS, nameOf });
  out.meta.updatedAt = new Date().toISOString();
  out.meta.bbox = BBOX;
  const filled = out.points.filter((p) => p.v[p.v.length - 1] || p.v[p.v.length - 2]).length;
  console.log(`交通量API: ${got}件 取得・観測点 ${out.points.length}（最近2時間に値がある ${filled}）・〜${nowKey}時台`);
  if (dry) return;
  writeFileSync(OUT, `${JSON.stringify(out)}\n`);
  // 記録は60日分だけ残す
  const old = existsSync(LOG) ? readFileSync(LOG, 'utf8').split('\n').filter((l) => l && !l.startsWith('#')) : [];
  const cut = new Date(Date.now() - 60 * 86400e3).toISOString();
  const keep = [...old, ...logLines].filter((l) => l.split('\t')[0] >= cut);
  writeFileSync(LOG, `# 取りに行った時刻(UTC)\t種類\t時間コードから\tまで\tHTTP\t件数\n${keep.join('\n')}\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });

// 工事マップ（工事レーダー）のデータを1日1回取り込んで tools/data/koji.json に置く。
//
// なぜ取り込むのか: 配信元 https://osanpo-safety.haqei64384.workers.dev は CORS ヘッダを付けて
// いないため、アプリ（別ドメイン）から直接 fetch できない。引き継ぎ資料 §8 の推奨どおり
// 「1日1回サーバ側で取得して保存」する。更新は元データ側も1日1回（朝6:10）なので十分。
//
// 出典（画面に必ず出す）: 東京都建設局 路上工事情報 (CC BY 4.0) / 道路の形と名前 © OpenStreetMap contributors (ODbL)
// 対象は東京23区の都道のみ。区道・国道・高速は含まれない。
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { addRoadShape } from './lib/koji-road-shape.mjs';   // 工事のまわりの信号・カーブ・坂（工事の絵に使う）

const SRC = 'https://osanpo-safety.haqei64384.workers.dev/api/restrictions/geojson';
const OUT = new URL('../../tools/data/koji.json', import.meta.url).pathname;

// 画面で使う項目だけ残す（risk_* は歩行者向けの旧機能・タクシーでは使わない）
const KEEP = ['id', 'title', 'restrictionType', 'startAt', 'endAt', 'timeWindow',
  'lanesRestricted', 'lanesTotal', 'roadSide', 'laneSummary', 'placement', 'roadBearing', 'source'];

const round = (n) => Math.round(n * 1e5) / 1e5;   // 小数5桁 ≒ 1m

function slimGeometry(g) {
  if (!g) return null;
  if (g.type === 'Point') return { type: 'Point', coordinates: g.coordinates.slice(0, 2).map(round) };
  if (g.type === 'LineString') return { type: 'LineString', coordinates: g.coordinates.map((c) => [round(c[0]), round(c[1])]) };
  return g;
}

function slim(fc) {
  const features = [];
  for (const f of fc.features || []) {
    const p = {};
    for (const k of KEEP) if (f.properties?.[k] !== undefined && f.properties[k] !== null) p[k] = f.properties[k];
    const geometry = slimGeometry(f.geometry);
    if (!geometry) continue;
    features.push({ type: 'Feature', geometry, properties: p });
  }
  return features;
}

// 道の形を足す。失敗しても工事のデータは出す
async function withRoadShape(features) {
  try {
    const r = await addRoadShape(features);
    console.log(`道の形: 信号 ${r.signals}件・カーブ ${r.curves}件・道の形 ${r.profiles}件・坂 ${r.slopes}件（標高タイル ${r.tiles}枚・失敗 ${r.failedTiles}）`);
  } catch (e) {
    console.warn('道の形を足せませんでした（工事のデータはそのまま出す）', e.message);
  }
}

async function main() {
  // --local: 取りに行かず、いまの koji.json に道の形だけ足し直す（手で試すとき）
  if (process.argv.includes('--local')) {
    const doc = JSON.parse(readFileSync(OUT, 'utf8'));
    for (const f of doc.features) for (const k of ['sigAt', 'curveDeg', 'roadU', 'slopePct']) delete f.properties[k];
    await withRoadShape(doc.features);
    writeFileSync(OUT, JSON.stringify(doc));
    return;
  }
  const res = await fetch(SRC, { headers: { 'user-agent': 'cabis-koji-sync' } });
  if (!res.ok) throw new Error(`取得できませんでした: ${res.status}`);
  const fc = await res.json();
  const features = slim(fc);
  if (features.length < 50) throw new Error(`件数が少なすぎます(${features.length})。元データの異常の可能性`);
  await withRoadShape(features);

  let status = null;
  try {
    const s = await fetch('https://osanpo-safety.haqei64384.workers.dev/api/status');
    if (s.ok) status = await s.json();
  } catch { /* 無くても表示はできる */ }

  const out = {
    type: 'FeatureCollection',
    fetchedAt: new Date().toISOString(),
    count: features.length,
    source: {
      name: '東京都建設局 路上工事情報',
      license: 'CC BY 4.0',
      roads: '© OpenStreetMap contributors (ODbL)',
      elevation: '国土地理院 標高タイル（坂）',
      via: 'osanpo-safety.haqei64384.workers.dev',
      dataset: status?.tokyo?.sourceLabel || null,
      importedAt: status?.tokyo?.importedAt || null,
    },
    features,
  };
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(out));
  console.log(`koji.json: ${features.length}件 / ${(JSON.stringify(out).length / 1024).toFixed(0)}KB`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });

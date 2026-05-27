// scripts/generate-lines-semantic.mjs — Phase 3 バッチ
// sketch-semantics-keiho.json と Overpass APIから approaches[].line を生成し seed JSON を更新。
// 使い方: node scripts/generate-lines-semantic.mjs [<id1> <id2> ...]
import { readFileSync, writeFileSync } from 'node:fs';
import { fetchRoadWays } from './lib/overpass-fetch.mjs';
import { buildApproachLine, buildApproachLineFromWaypoints } from './lib/sketch-to-line.mjs';
import { geocodeLandmark } from './lib/nominatim-fetch.mjs';

// 地名のキャッシュ（同じランドマークを何度も叩かない）
const _geoCache = new Map();
const geocoder = {
  async resolve(name, pin) {
    const key = `${name}::${pin.lat.toFixed(4)},${pin.lng.toFixed(4)}`;
    if (_geoCache.has(key)) return _geoCache.get(key);
    const r = await geocodeLandmark(name, pin);
    _geoCache.set(key, r);
    await new Promise((s) => setTimeout(s, 1100)); // Nominatim 1req/sec マナー
    return r;
  },
};

const SEED = 'scripts/data/stands-seed-keiho.json';
const SEM  = 'scripts/data/sketch-semantics-keiho.json';

const stands = JSON.parse(readFileSync(SEED, 'utf8'));
const sem    = JSON.parse(readFileSync(SEM, 'utf8'));
const only = process.argv.slice(2);

let updated = 0; const skipped = [];

for (const s of stands) {
  if (only.length && !only.includes(s.id)) continue;
  const entry = sem[s.id];
  if (!entry || !Array.isArray(entry.approaches)) continue;
  if (!s.pin) { skipped.push(`${s.id}: pin なし`); continue; }
  if (!Array.isArray(s.approaches) || s.approaches.length === 0) { skipped.push(`${s.id}: seed approaches なし`); continue; }

  for (let i = 0; i < entry.approaches.length; i++) {
    if (i >= s.approaches.length) break;
    const a = entry.approaches[i];
    try {
      // ①新方式: waypoints（ランドマーク列）が指定されていれば、Nominatimで解決して折れ線化
      if (Array.isArray(a.waypoints) && a.waypoints.length >= 2) {
        const line = await buildApproachLineFromWaypoints({ waypoints: a.waypoints, pin: s.pin, geocoder });
        if (line.length >= 2) {
          s.approaches[i].line = line;
          updated += 1;
          console.log(`✓ ${s.id}[${i}]: waypoints[${a.waypoints.length}] → ${line.length}点`);
          continue;
        }
        skipped.push(`${s.id}[${i}]: waypoints解決失敗（Nominatim hit不足）`);
        continue;
      }
      // ②旧方式: main_road + entry_direction（後方互換）
      if (!a.main_road) { skipped.push(`${s.id}[${i}]: main_road/waypoints なし`); continue; }
      const mainWays = await fetchRoadWays(a.main_road, s.pin.lat, s.pin.lng, 600);
      let turnWays = null;
      if (a.turn_road) turnWays = await fetchRoadWays(a.turn_road, s.pin.lat, s.pin.lng, 600);
      const line = buildApproachLine({ semantics: a, mainWays, turnWays, pin: s.pin });
      if (line.length >= 2) {
        s.approaches[i].line = line;
        updated += 1;
        console.log(`✓ ${s.id}[${i}]: ${a.main_road} (${a.entry_direction}) → ${line.length}点`);
      } else {
        skipped.push(`${s.id}[${i}]: 線が短い（OSMで道路ヒットせず？）`);
      }
    } catch (e) {
      skipped.push(`${s.id}[${i}]: ${e.message}`);
    }
    await new Promise((r) => setTimeout(r, 200));
  }
}

writeFileSync(SEED, JSON.stringify(stands, null, 2) + '\n');
console.log(`\n結果: ${updated} approach を更新`);
if (skipped.length) {
  console.log('スキップ:');
  for (const w of skipped) console.log('  ' + w);
}

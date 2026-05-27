# Semantic Sketch-to-Map Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 手描き略図PDFを画像処理せず、Claudeの意味理解＋OSM道路網（Overpass API）から実地図上の正確な進入線を自動生成する仕組みを構築する。

**Architecture:** 4層に分離。①Claudeが47PDFを読解した構造化記述JSON（データ）。②Overpass APIアダプタ（道路ways取得）。③純関数で道路網グラフ＋進入線生成（TDD）。④バッチで semantics + ways → seed JSON の `approaches[].line` を上書き。既存ビューアはそのまま動く。

**Tech Stack:** Node 22 ESM, `node:test`+`./tests/run.js` ラッパ, Overpass API（OSM・無料）, vanilla（依存追加ゼロ）。

**作業ブランチ/worktree:** `~/work/taxi-dev-stands`（branch `feat/stands-entry-route-map`）。`npm test` は `node --test tests/*.test.js`。

**関連spec:** `docs/superpowers/specs/2026-05-27-semantic-sketch-to-map-design.md`

---

## File Structure

| ファイル | 種別 | 責務 | テスト |
|---|---|---|---|
| `scripts/lib/road-network.mjs` | 純関数 | ways配列→1本ポリライン結合、最近接点、方角フィルタ | ✅ node:test |
| `scripts/lib/sketch-to-line.mjs` | 純関数 | semantics(1approach) + ways → line(lat,lng) | ✅ node:test |
| `scripts/lib/overpass-fetch.mjs` | アダプタ | 道路名+pin周辺で Overpass GET（fetch・キャッシュなし） | 手動 |
| `scripts/data/sketch-semantics-keiho.json` | データ | Claude が47PDF読解→構造化記述 | — |
| `scripts/generate-lines-semantic.mjs` | バッチ | semantics+OverpassでベクトルなしのJSONを更新 | 手動 |

依存ゼロ。Node 22 にビルトインの `fetch` を使う。

データ形（既存schemaにマージするだけ・schema変更不要）:
```json
{
  "roppongi_hills": {
    "approaches": [
      { "label_ja": "六本木通り側から進入", "main_road": "六本木通り",
        "entry_direction": "east", "destination_side": "south", "turn": "left",
        "_pdf_notes": "..." }
    ]
  }
}
```

純関数の I/F（型整合のため明示）:
- `mergeWaysToPolyline(ways) → [{lat,lng}, ...]`
- `nearestPointOnPolyline(polyline, pin) → { point:{lat,lng}, index, t }`
- `directionalEndpoint(polyline, pin, direction) → {lat,lng}` （direction: `"east"|"west"|"north"|"south"`）
- `sliceBetween(polyline, fromIdx, toIdx) → [{lat,lng}, ...]`
- `buildApproachLine({ semantics, mainWays, turnWays?, pin }) → [{lat,lng}, ...]`

---

## Task 1: road-network 純関数（merge / nearest / directional）TDD

**Files:**
- Create: `scripts/lib/road-network.mjs`
- Test: `tests/road-network.test.js`

- [ ] **Step 1: 失敗するテストを書く** → `tests/road-network.test.js`
```javascript
import { test, assert } from './run.js';
import {
  mergeWaysToPolyline, nearestPointOnPolyline, directionalEndpoint,
} from '../scripts/lib/road-network.mjs';

// 単純な3本の way（端点が共有されている）
const ways = [
  { geometry: [{ lat: 35.66, lng: 139.72 }, { lat: 35.66, lng: 139.73 }] },
  { geometry: [{ lat: 35.66, lng: 139.73 }, { lat: 35.66, lng: 139.74 }] },
  { geometry: [{ lat: 35.66, lng: 139.74 }, { lat: 35.66, lng: 139.75 }] },
];

test('mergeWaysToPolyline: 端点共有のways3本を1本のpolylineに結合', () => {
  const poly = mergeWaysToPolyline(ways);
  assert.equal(poly.length, 4);
  assert.equal(poly[0].lng, 139.72);
  assert.equal(poly[3].lng, 139.75);
});

test('mergeWaysToPolyline: 逆向きwayも吸収（端点でマージ）', () => {
  const reversed = [
    { geometry: [{ lat: 35.66, lng: 139.73 }, { lat: 35.66, lng: 139.72 }] },
    { geometry: [{ lat: 35.66, lng: 139.73 }, { lat: 35.66, lng: 139.74 }] },
  ];
  const poly = mergeWaysToPolyline(reversed);
  assert.equal(poly.length, 3);
});

test('mergeWaysToPolyline: 空配列なら空', () => {
  assert.deepEqual(mergeWaysToPolyline([]), []);
});

test('nearestPointOnPolyline: pinに最も近い点を返す', () => {
  const poly = [{ lat: 35.66, lng: 139.72 }, { lat: 35.66, lng: 139.73 }, { lat: 35.66, lng: 139.74 }];
  const r = nearestPointOnPolyline(poly, { lat: 35.66, lng: 139.7305 });
  assert.equal(r.index, 1);
  assert.ok(Math.abs(r.point.lng - 139.7305) < 0.001);
});

test('directionalEndpoint: east 指定で polyline の東端を返す', () => {
  const poly = [{ lat: 35.66, lng: 139.72 }, { lat: 35.66, lng: 139.75 }];
  const p = directionalEndpoint(poly, { lat: 35.66, lng: 139.735 }, 'east');
  assert.equal(p.lng, 139.75);
});

test('directionalEndpoint: north 指定で polyline の北端を返す', () => {
  const poly = [{ lat: 35.65, lng: 139.73 }, { lat: 35.67, lng: 139.73 }];
  const p = directionalEndpoint(poly, { lat: 35.66, lng: 139.73 }, 'north');
  assert.equal(p.lat, 35.67);
});
```

- [ ] **Step 2: 失敗を確認**
Run: `node --test tests/road-network.test.js`
Expected: FAIL（モジュール未定義）

- [ ] **Step 3: 実装** → `scripts/lib/road-network.mjs`
```javascript
// scripts/lib/road-network.mjs — 道路網の純関数ヘルパー

const eq = (a, b, eps = 1e-7) => Math.abs(a.lat - b.lat) < eps && Math.abs(a.lng - b.lng) < eps;

function hav(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat), lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

// 端点共有の ways を順に連結（双方向 OK）。離れた塊は最も長い塊のみ採用。
export function mergeWaysToPolyline(ways) {
  if (!Array.isArray(ways) || ways.length === 0) return [];
  const remaining = ways.map((w) => (w.geometry || []).map((p) => ({ lat: p.lat, lng: p.lng })))
    .filter((g) => g.length >= 2);
  if (remaining.length === 0) return [];
  // 最初の way を起点に
  let chain = remaining.shift();
  let progressed = true;
  while (progressed && remaining.length > 0) {
    progressed = false;
    for (let i = 0; i < remaining.length; i++) {
      const w = remaining[i];
      const head = chain[0], tail = chain[chain.length - 1];
      const wHead = w[0], wTail = w[w.length - 1];
      if (eq(tail, wHead)) { chain = chain.concat(w.slice(1)); remaining.splice(i, 1); progressed = true; break; }
      if (eq(tail, wTail)) { chain = chain.concat(w.slice().reverse().slice(1)); remaining.splice(i, 1); progressed = true; break; }
      if (eq(head, wTail)) { chain = w.slice(0, -1).concat(chain); remaining.splice(i, 1); progressed = true; break; }
      if (eq(head, wHead)) { chain = w.slice().reverse().slice(0, -1).concat(chain); remaining.splice(i, 1); progressed = true; break; }
    }
  }
  return chain;
}

// pin に最も近い polyline 上の点と index を返す
export function nearestPointOnPolyline(polyline, pin) {
  if (!Array.isArray(polyline) || polyline.length === 0) return null;
  let best = { point: polyline[0], index: 0, dist: hav(polyline[0], pin) };
  for (let i = 1; i < polyline.length; i++) {
    const d = hav(polyline[i], pin);
    if (d < best.dist) best = { point: polyline[i], index: i, dist: d };
  }
  return { point: best.point, index: best.index, t: best.dist };
}

// 方角指定で polyline の端点（極値）を返す
export function directionalEndpoint(polyline, pin, direction) {
  if (!Array.isArray(polyline) || polyline.length === 0) return null;
  const cmps = {
    east:  (a, b) => b.lng - a.lng,
    west:  (a, b) => a.lng - b.lng,
    north: (a, b) => b.lat - a.lat,
    south: (a, b) => a.lat - b.lat,
  };
  const cmp = cmps[direction] || cmps.east;
  let best = polyline[0];
  for (const p of polyline) if (cmp(best, p) > 0) best = p;
  return best;
}
```

- [ ] **Step 4: PASS 確認**
Run: `node --test tests/road-network.test.js`
Expected: 6 tests pass

- [ ] **Step 5: 回帰**
Run: `npm test`
Expected: exit 0

- [ ] **Step 6: Commit**
```bash
git add scripts/lib/road-network.mjs tests/road-network.test.js
git commit -m "feat(stands): road-network 純関数（merge/nearest/directional）"
```

---

## Task 2: sketch-to-line 純関数（buildApproachLine）TDD

**Files:**
- Create: `scripts/lib/sketch-to-line.mjs`
- Test: `tests/sketch-to-line.test.js`

- [ ] **Step 1: 失敗するテストを書く** → `tests/sketch-to-line.test.js`
```javascript
import { test, assert } from './run.js';
import { buildApproachLine } from '../scripts/lib/sketch-to-line.mjs';

// 東西に走る直線道路（pinの北側を通る）
const mainWays = [
  { geometry: [
    { lat: 35.66, lng: 139.72 }, { lat: 35.66, lng: 139.725 },
    { lat: 35.66, lng: 139.73 }, { lat: 35.66, lng: 139.735 }, { lat: 35.66, lng: 139.74 },
  ] },
];
const pin = { lat: 35.658, lng: 139.730 };

test('buildApproachLine: east から進入で東端→pinの最近点まで', () => {
  const line = buildApproachLine({
    semantics: { entry_direction: 'east', turn: null },
    mainWays, turnWays: null, pin,
  });
  assert.ok(line.length >= 2);
  // 起点は道路の東端
  assert.equal(line[0].lng, 139.74);
  // 終点は pin に最も近い道路上点 (139.73)
  assert.ok(Math.abs(line[line.length - 1].lng - 139.73) < 1e-6);
});

test('buildApproachLine: west から進入で西端→pinの最近点まで', () => {
  const line = buildApproachLine({
    semantics: { entry_direction: 'west', turn: null },
    mainWays, turnWays: null, pin,
  });
  assert.equal(line[0].lng, 139.72);
  assert.ok(Math.abs(line[line.length - 1].lng - 139.73) < 1e-6);
});

test('buildApproachLine: mainWays 空なら空配列', () => {
  const line = buildApproachLine({ semantics: { entry_direction: 'east' }, mainWays: [], pin });
  assert.deepEqual(line, []);
});

test('buildApproachLine: turn + turnWays で道路Bに繋がる', () => {
  // 東西道路（main）が pin の北側を通り、南北道路（turn）が pin の東側を通る
  const turnWays = [
    { geometry: [
      { lat: 35.66, lng: 139.735 }, { lat: 35.659, lng: 139.735 },
      { lat: 35.658, lng: 139.735 }, { lat: 35.657, lng: 139.735 },
    ] },
  ];
  const line = buildApproachLine({
    semantics: { entry_direction: 'east', turn: 'right' },
    mainWays, turnWays, pin,
  });
  // 起点(東端)→main上を西へ→交差点(35.66, 139.735)→turn上を南へ→pin最近点
  assert.ok(line.length >= 3);
  assert.equal(line[0].lng, 139.74);
  // 線の中に交差点 (35.66, 139.735) が含まれる
  const hasJunction = line.some((p) => Math.abs(p.lat - 35.66) < 1e-6 && Math.abs(p.lng - 139.735) < 1e-6);
  assert.ok(hasJunction, 'junction point should be in line');
});
```

- [ ] **Step 2: 失敗を確認**
Run: `node --test tests/sketch-to-line.test.js`
Expected: FAIL

- [ ] **Step 3: 実装** → `scripts/lib/sketch-to-line.mjs`
```javascript
// scripts/lib/sketch-to-line.mjs — semantics + ways → 進入線（純関数）
import {
  mergeWaysToPolyline, nearestPointOnPolyline, directionalEndpoint,
} from './road-network.mjs';

function sliceBetween(polyline, i0, i1) {
  if (i0 === i1) return [polyline[i0]];
  if (i0 < i1) return polyline.slice(i0, i1 + 1);
  return polyline.slice(i1, i0 + 1).reverse();
}

function nearestToPoint(polyline, target) {
  return nearestPointOnPolyline(polyline, target);
}

export function buildApproachLine({ semantics, mainWays, turnWays, pin }) {
  if (!Array.isArray(mainWays) || mainWays.length === 0) return [];
  const main = mergeWaysToPolyline(mainWays);
  if (main.length < 2) return [];

  const startPoint = directionalEndpoint(main, pin, semantics.entry_direction || 'east');
  if (!startPoint) return [];
  const startIdx = main.findIndex((p) => p.lat === startPoint.lat && p.lng === startPoint.lng);
  const nearestOnMain = nearestPointOnPolyline(main, pin);
  if (!nearestOnMain) return [];

  // 折れ込みなし → main 上を起点→pin最近点まで切り取り
  if (!semantics.turn || !Array.isArray(turnWays) || turnWays.length === 0) {
    return sliceBetween(main, startIdx, nearestOnMain.index);
  }

  // 折れ込みあり: turn 道路を結合し、main と turn の最近接点(交差点近似)で繋ぐ
  const turn = mergeWaysToPolyline(turnWays);
  if (turn.length < 2) return sliceBetween(main, startIdx, nearestOnMain.index);

  // main 上で turn に最も近い点 = junction（おおよその交差点）
  let bestMainIdx = 0, bestTurnIdx = 0, bestD = Infinity;
  for (let i = 0; i < main.length; i++) {
    const r = nearestPointOnPolyline(turn, main[i]);
    if (r && r.t < bestD) { bestD = r.t; bestMainIdx = i; bestTurnIdx = r.index; }
  }

  // turn 上の pin 最近点
  const nearestOnTurn = nearestPointOnPolyline(turn, pin);

  const seg1 = sliceBetween(main, startIdx, bestMainIdx);
  const seg2 = sliceBetween(turn, bestTurnIdx, nearestOnTurn.index);
  // 連結（重複の交差点を1つに）
  const last1 = seg1[seg1.length - 1];
  const first2 = seg2[0];
  if (last1 && first2 && Math.abs(last1.lat - first2.lat) < 1e-6 && Math.abs(last1.lng - first2.lng) < 1e-6) {
    return seg1.concat(seg2.slice(1));
  }
  return seg1.concat(seg2);
}
```

- [ ] **Step 4: PASS 確認**
Run: `node --test tests/sketch-to-line.test.js`
Expected: 4 tests pass

- [ ] **Step 5: 回帰**
Run: `npm test`
Expected: exit 0

- [ ] **Step 6: Commit**
```bash
git add scripts/lib/sketch-to-line.mjs tests/sketch-to-line.test.js
git commit -m "feat(stands): sketch-to-line 純関数（semantics+ways→line）"
```

---

## Task 3: Overpass APIアダプタ

**Files:**
- Create: `scripts/lib/overpass-fetch.mjs`

- [ ] **Step 1: 実装**（アダプタ・テストは手動）→ `scripts/lib/overpass-fetch.mjs`
```javascript
// scripts/lib/overpass-fetch.mjs — Overpass APIから道路ways取得（最小・依存ゼロ）

const ENDPOINT = 'https://overpass-api.de/api/interpreter';

// 指定中心から radius_m の範囲で、name 一致の highway way を取得。out geom で geometry 配列を含む。
// 戻り値: [{ id, geometry: [{lat,lng}...], tags }]
export async function fetchRoadWays(name, lat, lng, radius_m = 600) {
  const q = `
    [out:json][timeout:25];
    (
      way["highway"]["name"="${name}"](around:${radius_m},${lat},${lng});
    );
    out geom;
  `;
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'data=' + encodeURIComponent(q),
  });
  if (!res.ok) throw new Error('Overpass HTTP ' + res.status);
  const data = await res.json();
  return (data.elements || [])
    .filter((e) => e.type === 'way' && Array.isArray(e.geometry))
    .map((e) => ({
      id: e.id,
      geometry: e.geometry.map((g) => ({ lat: g.lat, lng: g.lon })),
      tags: e.tags || {},
    }));
}
```

- [ ] **Step 2: 構文チェック**
Run: `node --check scripts/lib/overpass-fetch.mjs`
Expected: no output, exit 0

- [ ] **Step 3: 手動疎通確認（六本木通りで実際に取得）**
Run:
```bash
node -e "import('./scripts/lib/overpass-fetch.mjs').then(async m => {
  const ways = await m.fetchRoadWays('六本木通り', 35.6604, 139.7292, 600);
  console.log('ways:', ways.length, 'first geom len:', (ways[0]||{}).geometry?.length);
});"
```
Expected: `ways: ` の数が1以上、geom len が複数（道路の点列）

- [ ] **Step 4: Commit**
```bash
git add scripts/lib/overpass-fetch.mjs
git commit -m "feat(stands): Overpass APIアダプタ（道路ways取得）"
```

---

## Task 4: 六本木ヒルズだけ semantics 投入 + バッチで実証

**Files:**
- Create: `scripts/data/sketch-semantics-keiho.json`
- Create: `scripts/generate-lines-semantic.mjs`

- [ ] **Step 1: sketch-semantics-keiho.json を作成（六本木ヒルズのみ）**
`scripts/data/sketch-semantics-keiho.json`:
```json
{
  "_comment": "Claudeが47PDFを読解した構造化記述。main_road=OSM道路名(日本語)、entry_direction=east|west|north|south、turn=left|right|null",
  "roppongi_hills": {
    "approaches": [
      { "label_ja": "六本木通り側から進入", "main_road": "六本木通り", "entry_direction": "east", "destination_side": "south", "turn": null, "_pdf_notes": "六本木通り西行き→センターループ入口A" },
      { "label_ja": "けやき坂側から進入", "main_road": "六本木けやき坂通り", "entry_direction": "west", "destination_side": "north", "turn": null, "_pdf_notes": "けやき坂を西進→入口B" }
    ]
  }
}
```

- [ ] **Step 2: バッチスクリプトを作成** → `scripts/generate-lines-semantic.mjs`
```javascript
// scripts/generate-lines-semantic.mjs — Phase 3 バッチ
// sketch-semantics-keiho.json と Overpass APIから approaches[].line を生成し seed JSON を更新。
// 使い方: node scripts/generate-lines-semantic.mjs [<id1> <id2> ...]
import { readFileSync, writeFileSync } from 'node:fs';
import { fetchRoadWays } from './lib/overpass-fetch.mjs';
import { buildApproachLine } from './lib/sketch-to-line.mjs';

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
    if (!a.main_road) { skipped.push(`${s.id}[${i}]: main_road なし`); continue; }
    try {
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
    // Overpass API へのレート配慮で少し待つ
    await new Promise((r) => setTimeout(r, 200));
  }
}

writeFileSync(SEED, JSON.stringify(stands, null, 2) + '\n');
console.log(`\n結果: ${updated} approach を更新`);
if (skipped.length) {
  console.log('スキップ:');
  for (const w of skipped) console.log('  ' + w);
}
```

- [ ] **Step 3: 構文チェック**
Run: `node --check scripts/generate-lines-semantic.mjs`
Expected: no output, exit 0

- [ ] **Step 4: 六本木ヒルズで実行**
Run: `node scripts/generate-lines-semantic.mjs roppongi_hills`
Expected: `✓ roppongi_hills[0]: 六本木通り (east) → N点` のようなOK出力（少なくとも1approachが更新される）

- [ ] **Step 5: 結果検証**
Run:
```bash
node -e "const j=JSON.parse(require('fs').readFileSync('scripts/data/stands-seed-keiho.json','utf8'));
const r=j.find(x=>x.id==='roppongi_hills');
r.approaches.forEach((a,i)=>console.log('['+i+']',a.label,a.line.length+'点', a.line[0], a.line[a.line.length-1]));"
```
Expected: approach[0]/[1] に多点のline、緯度経度が六本木ヒルズ周辺（35.65〜35.67, 139.72〜139.73）

- [ ] **Step 6: Commit**
```bash
git add scripts/data/sketch-semantics-keiho.json scripts/generate-lines-semantic.mjs scripts/data/stands-seed-keiho.json
git commit -m "feat(stands): 六本木ヒルズで Semantic Sketch-to-Map を実証"
```

---

## Task 5: dev反映＋実機確認

- [ ] **Step 1: SW bump（コード追加なのでbump）**
`sw.js` の `CACHE_NAME = CACHE_PREFIX + 'v230'` を `v231` に（実行時の origin/main の値+1）。
コードはバックエンドのみなのでSTATIC_FILES追加は不要。CACHE_NAMEだけbump。

- [ ] **Step 2: コミット＆push**
```bash
cd ~/work/taxi-dev-stands
git add sw.js
git commit -m "chore(stands): SW v231（semantic batch反映用）"
bash scripts/dpush-retry.sh
```

- [ ] **Step 3: dev seed deploy**
```bash
cd ~/work/taxi-dev-stands && bash scripts/deploy-stands-to-dev.sh
```
Expected: 完了メッセージ。`wrote roppongi_hills 六本木ヒルズ` が含まれる

- [ ] **Step 4: 実機確認（kimi-webbridge）**
- `https://hidenaka.github.io/-taxi-daily-report-dev/tools/stands.html?company=co-7q7ros` を reload
- 六本木ヒルズのピンをタップ
- **線が六本木通り（首都高3号下）と六本木けやき坂通りの上に乗っているか目視確認**
- スクショを `レビュー/乗り場マップ-Semantic-六本木-2026-05-27.jpg` に保存

成功基準: 線が**実OSM道路の上に乗っている**こと（前回の SIFT/ホモグラフィ結果は道路から数十m外れていた → 今回は原理的に道路の上）。

---

## Phase 2（本plan範囲外・Phase 1 OK後に着手）

- 残り46施設の semantics を Claude が読解→ `sketch-semantics-keiho.json` に追加
- `node scripts/generate-lines-semantic.mjs` で全件再生成
- dev反映→全件確認
- ヒットしない施設（OSM道路名と一致しない・構内専用）はリストアップし、別途PDF補助表示でカバー

---

## Self-Review

### Spec coverage
- **semantics構造化記述** → Task 4 Step 1 ✅
- **Overpass APIアダプタ** → Task 3 ✅
- **road-network 純関数** → Task 1 ✅
- **sketch-to-line 純関数** → Task 2 ✅
- **バッチで seed JSON 更新** → Task 4 Step 2-5 ✅
- **既存ビューアで描画** → コード変更なしで動く（既存drawRouteがapproaches[].lineを描画する）✅
- **テスト**: road-network 6 + sketch-to-line 4 = TDD 10 ✅
- **エラー処理**（道路名HITなし・線が短い）→ Task 4 Step 2 のskipped出力 ✅
- **複数業界への汎用化** → Phase 2 後の課題として spec に明記済（本plan範囲外）

### Placeholder scan
- 「TBD」「TODO」「Similar to Task N」「あとで実装」等のプレースホルダ: なし
- 各タスクで完全なコード/コマンドを明示

### 型整合
- `mergeWaysToPolyline(ways)` の戻り値 `[{lat,lng}]` は `nearestPointOnPolyline`/`directionalEndpoint`/`sliceBetween`/`buildApproachLine` すべてで一致
- semantics の `entry_direction` は `east|west|north|south`、 `turn` は `left|right|null`、 Task 2 のテストと Task 4 のデータと完全一致
- way 形式 `{ id, geometry:[{lat,lng}...], tags }` は overpass-fetch の戻り値と road-network/sketch-to-line の入力で一致

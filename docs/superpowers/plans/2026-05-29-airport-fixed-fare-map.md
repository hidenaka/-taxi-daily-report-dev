# 空港定額運賃マップ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 到着便ページから飛べる「羽田・成田の定額運賃を地図タッチ or 区名検索で確認する」ツールを tools/ に追加する。

**Architecture:** 純関数（時刻判定・検索・緯度経度投影・カードモデル・検証）を `airport-fare-data.js` に集約してユニットテストする。DOM描画（地図SVG・料金カード）と統合は別モジュールに分け、smoke検証する。データは25エリア×{緯度経度, 羽田昼/夜, 成田昼/夜}の静的JSONを同梱。公式定額表をWeb調査して投入し出典併記。地図は緯度経度centroidをSVG viewBoxに投影した「ざっくり位置」のタップ可能ノード。地図タイル/Leafletは使わない（オフライン）。

**Tech Stack:** Vanilla ESM（既存tools/jsと同じ）、`node --test`（tests/run.js）、Service Worker precache、enforceAccess課金ゲート。

**基準:** dev/main @ `a817026f3`、本番確認 2026-05-29。ブランチ `feat/airport-fixed-fare-map`（`~/work/taxi-dev`、origin=dev）。spec: `docs/superpowers/specs/2026-05-29-airport-fixed-fare-map-design.md`。

---

## File Structure

- Create: `tools/js/airport-fare-data.js` — 純関数（`isLateNight` / `findAreasByQuery` / `lookupArea` / `computeBounds` / `projectLatLng` / `buildCardModel` / `formatFare` / `validateFares`）と `loadFares`（fetch）。
- Create: `tools/data/airport-fixed-fares.json` — 25エリア×{name,key,lat,lng,haneda{day,night},narita{day,night}} ＋ 出典メタ。
- Create: `tools/js/airport-fare-card.js` — `buildCardModel` の結果をHTML化して container に描画。
- Create: `tools/js/airport-fare-map.js` — areas を投影してSVGノードを描画、タップで `onSelect(key)` 発火、選択ハイライト。
- Create: `tools/js/airport-fare-app.js` — ページ統合（access後にデータ読込→地図+検索+カードを配線、戻り導線、bottom nav）。
- Create: `tools/airport-fare.html` — ページシェル（既存tools各ページと同じhead/access/nav骨格）。
- Create: `tests/airport-fare-data.test.js` — 純関数のテスト。
- Modify: `tools/arrivals.html` — terminal-tabs行の `#arrivals-reload` 直前に「💴 空港定額」ボタン追加。
- Modify: `sw.js` — `CACHE_NAME` を `v244`→`v245` に bump、新規6ファイルを precache 配列に追加。

---

## Task 1: 純関数モジュール `airport-fare-data.js`（時刻・検索・投影）

**Files:**
- Create: `tools/js/airport-fare-data.js`
- Test: `tests/airport-fare-data.test.js`

- [ ] **Step 1: Write the failing test**

`tests/airport-fare-data.test.js`:

```js
import { test, assert } from './run.js';
import {
  isLateNight, findAreasByQuery, lookupArea, computeBounds, projectLatLng
} from '../tools/js/airport-fare-data.js';

const AREAS = [
  { key: 'chiyoda', name: '千代田区', lat: 35.694, lng: 139.753 },
  { key: 'shibuya', name: '渋谷区',   lat: 35.664, lng: 139.698 },
  { key: 'musashino', name: '武蔵野市', lat: 35.718, lng: 139.566 }
];

test('isLateNight: 22:00 と 04:59 は深夜、05:00 と 21:59 は昼', () => {
  assert.equal(isLateNight(new Date('2026-05-29T22:00:00')), true);
  assert.equal(isLateNight(new Date('2026-05-29T04:59:00')), true);
  assert.equal(isLateNight(new Date('2026-05-29T05:00:00')), false);
  assert.equal(isLateNight(new Date('2026-05-29T21:59:00')), false);
  assert.equal(isLateNight(new Date('2026-05-29T12:00:00')), false);
});

test('findAreasByQuery: 部分一致（区名）、空クエリは全件', () => {
  assert.deepEqual(findAreasByQuery(AREAS, '渋').map(a => a.key), ['shibuya']);
  assert.deepEqual(findAreasByQuery(AREAS, '武蔵').map(a => a.key), ['musashino']);
  assert.equal(findAreasByQuery(AREAS, '').length, 3);
  assert.equal(findAreasByQuery(AREAS, 'なし').length, 0);
});

test('lookupArea: key で取得、無ければ null', () => {
  assert.equal(lookupArea(AREAS, 'shibuya').name, '渋谷区');
  assert.equal(lookupArea(AREAS, 'xxx'), null);
});

test('computeBounds: 緯度経度の min/max', () => {
  const b = computeBounds(AREAS);
  assert.equal(b.minLng, 139.566);
  assert.equal(b.maxLng, 139.753);
  assert.equal(b.minLat, 35.664);
  assert.equal(b.maxLat, 35.718);
});

test('projectLatLng: 西端は左、北端は上に投影される', () => {
  const b = computeBounds(AREAS);
  const size = { w: 100, h: 100 };
  const west = projectLatLng({ lat: 35.69, lng: 139.566 }, b, size, 0);
  const east = projectLatLng({ lat: 35.69, lng: 139.753 }, b, size, 0);
  assert.ok(west.x < east.x, '西は東より x が小さい');
  const north = projectLatLng({ lat: 35.718, lng: 139.65 }, b, size, 0);
  const south = projectLatLng({ lat: 35.664, lng: 139.65 }, b, size, 0);
  assert.ok(north.y < south.y, '北は南より y が小さい（上）');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/work/taxi-dev && node --test tests/airport-fare-data.test.js`
Expected: FAIL（`Cannot find module '../tools/js/airport-fare-data.js'` もしくは export 未定義）

- [ ] **Step 3: Write minimal implementation**

`tools/js/airport-fare-data.js`:

```js
// 深夜割増の時間帯: 22:00〜翌4:59（5:00から昼）
export function isLateNight(date) {
  const h = date.getHours();
  return h >= 22 || h < 5;
}

// 区名の部分一致。空クエリは全件。
export function findAreasByQuery(areas, query) {
  const q = (query || '').trim();
  if (!q) return areas.slice();
  return areas.filter(a => a.name.includes(q) || a.key.includes(q));
}

export function lookupArea(areas, key) {
  return areas.find(a => a.key === key) || null;
}

export function computeBounds(areas) {
  const lats = areas.map(a => a.lat);
  const lngs = areas.map(a => a.lng);
  return {
    minLat: Math.min(...lats), maxLat: Math.max(...lats),
    minLng: Math.min(...lngs), maxLng: Math.max(...lngs)
  };
}

// 緯度経度を SVG 座標へ。経度→x（東が右）、緯度→y（北が上＝小さいy）。pad は内側余白。
export function projectLatLng(pt, bounds, size, pad = 0) {
  const { minLat, maxLat, minLng, maxLng } = bounds;
  const wSpan = (maxLng - minLng) || 1;
  const hSpan = (maxLat - minLat) || 1;
  const x = pad + ((pt.lng - minLng) / wSpan) * (size.w - 2 * pad);
  const y = pad + ((maxLat - pt.lat) / hSpan) * (size.h - 2 * pad);
  return { x, y };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ~/work/taxi-dev && node --test tests/airport-fare-data.test.js`
Expected: PASS（5 tests）

- [ ] **Step 5: Commit**

```bash
cd ~/work/taxi-dev
git add tools/js/airport-fare-data.js tests/airport-fare-data.test.js
git commit -m "feat(airport-fare): pure helpers (time/search/projection) + tests"
```

---

## Task 2: カードモデルと整形・検証（`airport-fare-data.js` に追記）

**Files:**
- Modify: `tools/js/airport-fare-data.js`
- Test: `tests/airport-fare-data.test.js`（追記）

- [ ] **Step 1: Write the failing test**（`tests/airport-fare-data.test.js` の末尾に追記）

```js
import { buildCardModel, formatFare, validateFares } from '../tools/js/airport-fare-data.js';

const AREA = {
  key: 'shibuya', name: '渋谷区', lat: 35.664, lng: 139.698,
  haneda: { day: 6900, night: 8100 },
  narita: { day: 24000, night: null }
};

test('formatFare: 数値は ¥カンマ区切り、null は —', () => {
  assert.equal(formatFare(6900), '¥6,900');
  assert.equal(formatFare(null), '—');
});

test('buildCardModel: 深夜帯は isLate=true、昼帯は false', () => {
  const night = buildCardModel(AREA, new Date('2026-05-29T23:00:00'));
  assert.equal(night.isLate, true);
  assert.equal(night.name, '渋谷区');
  assert.equal(night.haneda.day, 6900);
  assert.equal(night.narita.night, null);
  const day = buildCardModel(AREA, new Date('2026-05-29T13:00:00'));
  assert.equal(day.isLate, false);
});

test('validateFares: 25件・各4料金フィールド必須、欠ければ throw', () => {
  const good = { areas: Array.from({ length: 25 }, (_, i) => ({
    key: 'k' + i, name: 'n' + i, lat: 35.7, lng: 139.7,
    haneda: { day: 1, night: 2 }, narita: { day: 3, night: 4 }
  })) };
  assert.equal(validateFares(good), true);

  const tooFew = { areas: good.areas.slice(0, 24) };
  assert.throws(() => validateFares(tooFew), /25/);

  const missingField = { areas: good.areas.map((a, i) =>
    i === 0 ? { ...a, haneda: { day: 1 } } : a) };
  assert.throws(() => validateFares(missingField), /haneda\.night/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/work/taxi-dev && node --test tests/airport-fare-data.test.js`
Expected: FAIL（`buildCardModel` 等 未定義）

- [ ] **Step 3: Write minimal implementation**（`tools/js/airport-fare-data.js` に追記）

```js
export function formatFare(v) {
  return (v == null) ? '—' : '¥' + Number(v).toLocaleString('ja-JP');
}

// 料金カード描画用の純データ。now で深夜判定。
export function buildCardModel(area, now) {
  return {
    key: area.key,
    name: area.name,
    haneda: { day: area.haneda?.day ?? null, night: area.haneda?.night ?? null },
    narita: { day: area.narita?.day ?? null, night: area.narita?.night ?? null },
    isLate: isLateNight(now)
  };
}

// データ整合: 25件・各エリアに haneda/narita の day/night（number か null）。
export function validateFares(data) {
  const areas = data?.areas;
  if (!Array.isArray(areas) || areas.length !== 25) {
    throw new Error(`airport-fixed-fares: areas は25件必須（実際 ${areas?.length}）`);
  }
  const okVal = v => v === null || typeof v === 'number';
  for (const a of areas) {
    for (const ap of ['haneda', 'narita']) {
      for (const t of ['day', 'night']) {
        if (a[ap] === undefined || a[ap][t] === undefined || !okVal(a[ap][t])) {
          throw new Error(`airport-fixed-fares: ${a.key} の ${ap}.${t} が不正`);
        }
      }
    }
  }
  return true;
}

// ページから使う読込（fetch）。tools/ からの相対パス。
export async function loadFares() {
  const data = await (await fetch('./data/airport-fixed-fares.json')).json();
  validateFares(data);
  return data;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ~/work/taxi-dev && node --test tests/airport-fare-data.test.js`
Expected: PASS（8 tests）

- [ ] **Step 5: Commit**

```bash
cd ~/work/taxi-dev
git add tools/js/airport-fare-data.js tests/airport-fare-data.test.js
git commit -m "feat(airport-fare): card model, fare formatting, data validation + tests"
```

---

## Task 3: データJSON 作成（公式表をWeb調査して投入）

**Files:**
- Create: `tools/data/airport-fixed-fares.json`
- Test: `tests/airport-fare-data.test.js`（統合テスト追記）

**調査ソース（実行時にWebFetch/WebSearchで確認し、出典URL+取得日をJSONに記録）:**
- 羽田空港 定額運賃: 東京ハイヤー・タクシー協会／大手各社（日本交通・kmタクシー・大和自動車・帝都自動車）の「羽田空港 定額運賃表（区市別）」、および国交省関東運輸局の認可定額。
- 成田空港 定額運賃: 各社の「成田空港 定額運賃表」（東京23区・武蔵野市・三鷹市への定額）。
- 深夜割増: 22:00〜翌5:00。定額の深夜額は各表の「深夜・早朝」欄。**高速代は定額に含めない（別途実費）**ことを確認。
- 値が確認できないエリア/区分は `null`（画面「—」）。確実な値のみ投入し、断定できない数字を入れない。

- [ ] **Step 1: centroid 雛形でファイルを作る**（25エリアの緯度経度は確定値。料金は調査前は仮に null）

`tools/data/airport-fixed-fares.json`:

```json
{
  "_source_haneda": "（実行時に記入：羽田 定額運賃表のURL）",
  "_source_narita": "（実行時に記入：成田 定額運賃表のURL）",
  "_acquired": "（実行時に記入：YYYY-MM-DD）",
  "_note": "定額に高速代は含まず（別途実費）。深夜割増 22:00-翌5:00。値はnullは未確認=画面「—」。",
  "areas": [
    { "key": "chiyoda",  "name": "千代田区", "lat": 35.694, "lng": 139.753, "haneda": { "day": null, "night": null }, "narita": { "day": null, "night": null } },
    { "key": "chuo",     "name": "中央区",   "lat": 35.671, "lng": 139.772, "haneda": { "day": null, "night": null }, "narita": { "day": null, "night": null } },
    { "key": "minato",   "name": "港区",     "lat": 35.658, "lng": 139.751, "haneda": { "day": null, "night": null }, "narita": { "day": null, "night": null } },
    { "key": "shinjuku", "name": "新宿区",   "lat": 35.694, "lng": 139.703, "haneda": { "day": null, "night": null }, "narita": { "day": null, "night": null } },
    { "key": "bunkyo",   "name": "文京区",   "lat": 35.718, "lng": 139.745, "haneda": { "day": null, "night": null }, "narita": { "day": null, "night": null } },
    { "key": "taito",    "name": "台東区",   "lat": 35.713, "lng": 139.780, "haneda": { "day": null, "night": null }, "narita": { "day": null, "night": null } },
    { "key": "sumida",   "name": "墨田区",   "lat": 35.710, "lng": 139.801, "haneda": { "day": null, "night": null }, "narita": { "day": null, "night": null } },
    { "key": "koto",     "name": "江東区",   "lat": 35.673, "lng": 139.817, "haneda": { "day": null, "night": null }, "narita": { "day": null, "night": null } },
    { "key": "shinagawa","name": "品川区",   "lat": 35.609, "lng": 139.730, "haneda": { "day": null, "night": null }, "narita": { "day": null, "night": null } },
    { "key": "meguro",   "name": "目黒区",   "lat": 35.641, "lng": 139.698, "haneda": { "day": null, "night": null }, "narita": { "day": null, "night": null } },
    { "key": "ota",      "name": "大田区",   "lat": 35.561, "lng": 139.716, "haneda": { "day": null, "night": null }, "narita": { "day": null, "night": null } },
    { "key": "setagaya", "name": "世田谷区", "lat": 35.646, "lng": 139.653, "haneda": { "day": null, "night": null }, "narita": { "day": null, "night": null } },
    { "key": "shibuya",  "name": "渋谷区",   "lat": 35.664, "lng": 139.698, "haneda": { "day": null, "night": null }, "narita": { "day": null, "night": null } },
    { "key": "nakano",   "name": "中野区",   "lat": 35.707, "lng": 139.664, "haneda": { "day": null, "night": null }, "narita": { "day": null, "night": null } },
    { "key": "suginami", "name": "杉並区",   "lat": 35.700, "lng": 139.636, "haneda": { "day": null, "night": null }, "narita": { "day": null, "night": null } },
    { "key": "toshima",  "name": "豊島区",   "lat": 35.726, "lng": 139.716, "haneda": { "day": null, "night": null }, "narita": { "day": null, "night": null } },
    { "key": "kita",     "name": "北区",     "lat": 35.753, "lng": 139.734, "haneda": { "day": null, "night": null }, "narita": { "day": null, "night": null } },
    { "key": "arakawa",  "name": "荒川区",   "lat": 35.736, "lng": 139.783, "haneda": { "day": null, "night": null }, "narita": { "day": null, "night": null } },
    { "key": "itabashi", "name": "板橋区",   "lat": 35.751, "lng": 139.709, "haneda": { "day": null, "night": null }, "narita": { "day": null, "night": null } },
    { "key": "nerima",   "name": "練馬区",   "lat": 35.736, "lng": 139.652, "haneda": { "day": null, "night": null }, "narita": { "day": null, "night": null } },
    { "key": "adachi",   "name": "足立区",   "lat": 35.775, "lng": 139.804, "haneda": { "day": null, "night": null }, "narita": { "day": null, "night": null } },
    { "key": "katsushika","name": "葛飾区",  "lat": 35.743, "lng": 139.847, "haneda": { "day": null, "night": null }, "narita": { "day": null, "night": null } },
    { "key": "edogawa",  "name": "江戸川区", "lat": 35.707, "lng": 139.868, "haneda": { "day": null, "night": null }, "narita": { "day": null, "night": null } },
    { "key": "musashino","name": "武蔵野市", "lat": 35.718, "lng": 139.566, "haneda": { "day": null, "night": null }, "narita": { "day": null, "night": null } },
    { "key": "mitaka",   "name": "三鷹市",   "lat": 35.683, "lng": 139.560, "haneda": { "day": null, "night": null }, "narita": { "day": null, "night": null } }
  ]
}
```

- [ ] **Step 2: 公式表をWeb調査して料金を投入**

WebSearch/WebFetch で上記ソースを確認し、各エリアの `haneda.day/night`・`narita.day/night` を実値で埋める。`_source_haneda`/`_source_narita`/`_acquired` を記入。確認できない値は `null` のまま残す（嘘を入れない）。23区の成田定額が公式でゾーン束ね（同額が複数区）なら同額を各区に展開。

- [ ] **Step 3: 統合テストを追記**（`tests/airport-fare-data.test.js`）

```js
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

test('airport-fixed-fares.json: 25件で validateFares を通る', () => {
  const path = fileURLToPath(new URL('../tools/data/airport-fixed-fares.json', import.meta.url));
  const data = JSON.parse(readFileSync(path, 'utf8'));
  assert.equal(data.areas.length, 25);
  assert.equal(validateFares(data), true);
  const keys = new Set(data.areas.map(a => a.key));
  assert.equal(keys.size, 25, 'key は一意');
  assert.ok(keys.has('musashino') && keys.has('mitaka'), '武蔵野・三鷹を含む');
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ~/work/taxi-dev && node --test tests/airport-fare-data.test.js`
Expected: PASS（9 tests）

- [ ] **Step 5: Commit**

```bash
cd ~/work/taxi-dev
git add tools/data/airport-fixed-fares.json tests/airport-fare-data.test.js
git commit -m "feat(airport-fare): 25-area fixed-fare dataset (official tables) + integration test"
```

---

## Task 4: 料金カード描画 `airport-fare-card.js`

**Files:**
- Create: `tools/js/airport-fare-card.js`

（DOM描画。純ロジックは Task 2 の `buildCardModel`/`formatFare` を再利用するため、ここはテストせず Task 7 のsmokeで確認。）

- [ ] **Step 1: 実装を書く**

`tools/js/airport-fare-card.js`:

```js
import { buildCardModel, formatFare } from './airport-fare-data.js';

// container に料金カードを描画。area=null なら初期メッセージ。
export function renderFareCard(container, area, now = new Date()) {
  if (!area) {
    container.innerHTML = '<div class="fare-empty">区を地図でタッチ、または検索してください</div>';
    return;
  }
  const m = buildCardModel(area, now);
  const dayCls = m.isLate ? '' : ' is-now';
  const nightCls = m.isLate ? ' is-now' : '';
  const badge = m.isLate
    ? '<span class="fare-badge">今は深夜料金</span>'
    : '<span class="fare-badge fare-badge-day">今は昼料金</span>';
  container.innerHTML = `
    <div class="fare-card">
      <div class="fare-card-head">${m.name} ${badge}</div>
      <table class="fare-table">
        <thead><tr><th></th><th>羽田</th><th>成田</th></tr></thead>
        <tbody>
          <tr class="fare-row-day${dayCls}">
            <td>定額（昼）</td><td>${formatFare(m.haneda.day)}</td><td>${formatFare(m.narita.day)}</td>
          </tr>
          <tr class="fare-row-night${nightCls}">
            <td>定額（深夜 22-5時）</td><td>${formatFare(m.haneda.night)}</td><td>${formatFare(m.narita.night)}</td>
          </tr>
        </tbody>
      </table>
      <div class="fare-note">※定額に高速代は含みません（ルート・時間帯で変動・別途）</div>
    </div>`;
}
```

- [ ] **Step 2: Commit**

```bash
cd ~/work/taxi-dev
git add tools/js/airport-fare-card.js
git commit -m "feat(airport-fare): fare card renderer"
```

---

## Task 5: 地図SVG描画 `airport-fare-map.js`

**Files:**
- Create: `tools/js/airport-fare-map.js`

（DOM/SVG描画。投影は Task 1 の `projectLatLng`/`computeBounds` を再利用。smokeで確認。）

- [ ] **Step 1: 実装を書く**

`tools/js/airport-fare-map.js`:

```js
import { computeBounds, projectLatLng } from './airport-fare-data.js';

const VB = { w: 1000, h: 1000 };
const PAD = 90;
const SVG_NS = 'http://www.w3.org/2000/svg';

// container に25エリアのノードを緯度経度投影で描画。タップで onSelect(key)。
// 戻り値: { select(key) } で外部（検索）からも選択ハイライトできる。
export function renderFareMap(container, areas, onSelect) {
  const bounds = computeBounds(areas);
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${VB.w} ${VB.h}`);
  svg.setAttribute('class', 'fare-map');
  svg.setAttribute('role', 'group');
  svg.setAttribute('aria-label', '行き先エリア地図');

  const nodeByKey = new Map();
  for (const a of areas) {
    const { x, y } = projectLatLng(a, bounds, VB, PAD);
    const g = document.createElementNS(SVG_NS, 'g');
    g.setAttribute('class', 'fare-area');
    g.setAttribute('data-area', a.key);
    g.setAttribute('tabindex', '0');
    g.setAttribute('role', 'button');
    g.setAttribute('aria-label', a.name);

    const w = 96, h = 40;
    const rect = document.createElementNS(SVG_NS, 'rect');
    rect.setAttribute('x', x - w / 2); rect.setAttribute('y', y - h / 2);
    rect.setAttribute('width', w); rect.setAttribute('height', h);
    rect.setAttribute('rx', 10);
    const label = document.createElementNS(SVG_NS, 'text');
    label.setAttribute('x', x); label.setAttribute('y', y);
    label.setAttribute('text-anchor', 'middle');
    label.setAttribute('dominant-baseline', 'central');
    label.textContent = a.name.replace(/[区市]$/, '');
    g.appendChild(rect); g.appendChild(label);

    const fire = () => { select(a.key); onSelect(a.key); };
    g.addEventListener('click', fire);
    g.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fire(); } });
    svg.appendChild(g);
    nodeByKey.set(a.key, g);
  }
  container.innerHTML = '';
  container.appendChild(svg);

  function select(key) {
    for (const [k, g] of nodeByKey) g.classList.toggle('is-selected', k === key);
  }
  return { select };
}
```

- [ ] **Step 2: Commit**

```bash
cd ~/work/taxi-dev
git add tools/js/airport-fare-map.js
git commit -m "feat(airport-fare): rough geographic SVG map with tappable areas"
```

---

## Task 6: ページ統合 `airport-fare-app.js`

**Files:**
- Create: `tools/js/airport-fare-app.js`

- [ ] **Step 1: 実装を書く**

`tools/js/airport-fare-app.js`:

```js
import { loadFares, findAreasByQuery, lookupArea } from './airport-fare-data.js';
import { renderFareMap } from './airport-fare-map.js';
import { renderFareCard } from './airport-fare-card.js';

const $ = id => document.getElementById(id);

export async function initAirportFare() {
  const errEl = $('fare-error');
  let data;
  try {
    data = await loadFares();
  } catch (e) {
    errEl.hidden = false;
    errEl.textContent = '料金データの読み込みに失敗しました: ' + e.message;
    return;
  }
  const areas = data.areas;

  // 検索サジェスト（datalist）に全エリア名を投入
  const list = $('fare-area-list');
  list.innerHTML = areas.map(a => `<option value="${a.name}"></option>`).join('');

  const cardEl = $('fare-card-host');
  renderFareCard(cardEl, null);

  function show(key) {
    const area = lookupArea(areas, key);
    if (area) renderFareCard(cardEl, area, new Date());
  }

  const map = renderFareMap($('fare-map-host'), areas, show);

  // 検索: 入力が区名に一致したら地図選択＋カード表示
  const input = $('fare-search');
  input.addEventListener('change', () => {
    const matches = findAreasByQuery(areas, input.value);
    const exact = matches.find(a => a.name === input.value.trim()) || matches[0];
    if (exact) { map.select(exact.key); show(exact.key); }
  });
}
```

- [ ] **Step 2: Commit**

```bash
cd ~/work/taxi-dev
git add tools/js/airport-fare-app.js
git commit -m "feat(airport-fare): page glue (load, map+search+card wiring)"
```

---

## Task 7: ページシェル `airport-fare.html` ＋ smoke 確認

**Files:**
- Create: `tools/airport-fare.html`

- [ ] **Step 1: ページを書く**（arrivals/ic と同じ access/nav 骨格）

`tools/airport-fare.html`:

```html
<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=5, viewport-fit=cover">
  <title>Cabis ｜ 空港定額</title>
  <link rel="stylesheet" href="css/style.css">
  <link rel="icon" type="image/png" sizes="180x180" href="icon-180.png">
  <link rel="apple-touch-icon" sizes="180x180" href="icon-180.png">
  <link rel="manifest" href="../manifest.webmanifest">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="theme-color" content="#0a0a0f">
  <meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">
  <style>
    .fare-toolbar { display: flex; align-items: center; gap: 10px; padding: 10px 12px; }
    .fare-back { color: var(--sub, #888); text-decoration: none; font-size: 14px; }
    .fare-search-wrap { padding: 0 12px 8px; }
    #fare-search { width: 100%; padding: 10px 12px; font-size: 16px; border-radius: 8px;
      border: 1px solid #333; background: #16161c; color: #e8e8e8; }
    #fare-map-host { padding: 4px 12px 0; }
    .fare-map { width: 100%; height: auto; display: block; touch-action: manipulation; }
    .fare-area rect { fill: #1a1a22; stroke: #3a3a48; stroke-width: 1.5; }
    .fare-area text { fill: #cfd6e6; font-size: 22px; font-family: -apple-system, system-ui, sans-serif; }
    .fare-area.is-selected rect { fill: #2f6fd0; stroke: #7fb0ff; }
    .fare-area.is-selected text { fill: #fff; font-weight: 700; }
    #fare-card-host { padding: 8px 12px 24px; }
    .fare-empty { color: #888; text-align: center; padding: 20px 0; font-size: 14px; }
    .fare-card { background: #16161c; border: 1px solid #2a2a35; border-radius: 12px; padding: 14px; }
    .fare-card-head { font-size: 17px; font-weight: 700; margin-bottom: 10px; display: flex; align-items: center; gap: 8px; }
    .fare-badge { font-size: 12px; padding: 2px 8px; border-radius: 999px; background: #3a2a10; color: #ffd84d; font-weight: 700; }
    .fare-badge-day { background: #16302a; color: #6ec96e; }
    .fare-table { width: 100%; border-collapse: collapse; }
    .fare-table th, .fare-table td { padding: 10px 8px; text-align: right; border-bottom: 1px solid #222; font-variant-numeric: tabular-nums; }
    .fare-table th:first-child, .fare-table td:first-child { text-align: left; color: #aaa; }
    .fare-table tr.is-now td { background: rgba(255,216,77,0.10); font-weight: 700; }
    .fare-note { margin-top: 10px; color: #888; font-size: 12px; }
    #fare-error { background: #4a1a1a; color: #ffb; padding: 8px; border-radius: 4px; margin: 8px 12px; }
    body { padding-bottom: 64px; }
  </style>
  <style>body{visibility:hidden;pointer-events:none;}</style>
</head>
<body>
  <script type="module">
    import { enforceAccess } from '../js/access-control.js';
    if (!(await enforceAccess('core', { redirect: '../subscribe.html' }))) {
      throw new Error('access-denied: redirected');
    }
    import('../js/gps-privacy-banner.js').then(m => m.showGpsPrivacyBanner && m.showGpsPrivacyBanner());
  </script>
  <nav class="app-tabs" role="tablist" aria-label="アプリ切替">
    <a href="./" class="app-tab">⏱ 乗務タイマー</a>
    <a href="ic.html" class="app-tab">🛣 IC判定</a>
    <a href="arrivals.html" class="app-tab">✈ 到着便</a>
    <a href="airport-fare.html" class="app-tab active" aria-current="page">💴 空港定額</a>
  </nav>

  <div class="fare-toolbar">
    <a href="arrivals.html" class="fare-back">← 到着便に戻る</a>
  </div>

  <div id="fare-error" hidden></div>

  <div class="fare-search-wrap">
    <input type="text" id="fare-search" list="fare-area-list" placeholder="区名で検索（例: 渋谷）" autocomplete="off">
    <datalist id="fare-area-list"></datalist>
  </div>

  <div id="fare-map-host"></div>
  <div id="fare-card-host"></div>

  <script type="module">
    import { initAirportFare } from './js/airport-fare-app.js';
    initAirportFare();
  </script>
  <script>
    document.querySelectorAll('.app-tab').forEach(a => {
      a.addEventListener('click', (e) => {
        if (e.ctrlKey || e.metaKey || e.shiftKey) return;
        e.preventDefault();
        window.location.href = a.getAttribute('href');
      });
    });
  </script>
  <div id="navHost"></div>
  <script type="module">
    import { renderBottomNav } from '../js/app.js';
    document.getElementById('navHost').innerHTML = renderBottomNav('tools', '../');
  </script>
</body>
</html>
```

- [ ] **Step 2: smoke 確認（ヘッドレス描画）**

`reference_taxi-tool-page-smoke-test` の手順で、`enforceAccess('core')` を通すため localStorage `taxi_user_id` と sessionStorage `taxi_sub_cache_v1` を seed したうえで `tools/airport-fare.html` を開き、地図に25ノードが出る／区タップでカードが出る／深夜行ハイライトを確認。`python3 -m http.server 8000`（`npm run serve`）でローカル配信し Playwright で描画確認。

Expected: 25エリアのノードが表示、タップで料金カード表示、検索で同じ着地。

- [ ] **Step 3: Commit**

```bash
cd ~/work/taxi-dev
git add tools/airport-fare.html
git commit -m "feat(airport-fare): page shell (map + search + card)"
```

---

## Task 8: 到着便ページに導線ボタン追加

**Files:**
- Modify: `tools/arrivals.html`（terminal-tabs 行、`#arrivals-reload` の直前）

- [ ] **Step 1: ボタンを追加**

`tools/arrivals.html` の terminal-tabs 内、`<button id="arrivals-reload" ...>↻</button>` の**直前**に以下を挿入（`margin-left:auto` は既存の reload が持つので、定額ボタンを先に置けば reload の左隣に並ぶ）:

```html
    <a href="airport-fare.html" id="tab-airport-fare" class="terminal-tab" style="margin-left:auto; text-decoration:none;">💴 空港定額</a>
```

挿入後、既存の `#arrivals-reload` から `margin-left:auto` を削除（auto が2つあると崩れるため）。reload の style を次に変更:

```html
    <button id="arrivals-reload" style="background:transparent; color:var(--sub); border:none; cursor:pointer;">↻</button>
```

- [ ] **Step 2: PWAタブ遷移の確認**

arrivals.html は app-tab に `window.location.href` の遷移ハンドラを既に持つ。今回追加は terminal-tab（通常の `<a>`）なので標準遷移でよい。タップで `airport-fare.html` に遷移することを確認。

- [ ] **Step 3: Commit**

```bash
cd ~/work/taxi-dev
git add tools/arrivals.html
git commit -m "feat(arrivals): add 空港定額 entry button next to reload"
```

---

## Task 9: Service Worker キャッシュ更新

**Files:**
- Modify: `sw.js`（`CACHE_NAME` と precache 配列）

- [ ] **Step 1: CACHE_NAME を bump**

`sw.js:2` を変更:

```js
const CACHE_NAME = CACHE_PREFIX + 'v245';
```

- [ ] **Step 2: precache に新規ファイルを追加**

`sw.js` の precache 配列（`'./tools/stands.html',` の並び付近）に追記:

```js
  './tools/airport-fare.html',
  './tools/js/airport-fare-app.js',
  './tools/js/airport-fare-data.js',
  './tools/js/airport-fare-map.js',
  './tools/js/airport-fare-card.js',
  './tools/data/airport-fixed-fares.json',
```

- [ ] **Step 3: 全テスト実行（リグレッション確認）**

Run: `cd ~/work/taxi-dev && npm test`
Expected: 既存テスト＋airport-fare のテストが全て PASS

- [ ] **Step 4: Commit**

```bash
cd ~/work/taxi-dev
git add sw.js
git commit -m "chore(sw): cache airport-fare assets, bump to v245"
```

---

## Task 10: dev 反映（ユーザー操作）

- [ ] **Step 1: dev へ push（Claudeは実行しない。ユーザーに提示）**

ユーザーに次の1行を提示（行頭 `!`、worktreeなし＝メインclone）:

```
!~/work/taxi-dev/dpush.sh
```

- [ ] **Step 2: dev確認URLで動作確認**

dev環境の `tools/arrivals.html` から「💴 空港定額」→ 地図タップ→料金表示→検索→深夜ハイライトを確認。PWAはキャッシュ更新のため再起動を案内（`feedback_taxi-daily-report-sw-cache-deploy`）。

- [ ] **Step 3: ユーザー承認後に本番（タグ）**

dev でOKが出たら本番反映はタグ push（`feedback_taxi-daily-report-deploy-flow`）。本番反映までは Claude から提案しない（ユーザー承認後のみ）。

---

## Self-Review

**Spec coverage:**
- §1 ユースケース → Task 6/7（地図or検索→カード）✔
- §2 25エリア → Task 3（centroid＋fare、武蔵野/三鷹含む）+ validateFares ✔
- §3 料金4種・深夜ハイライト・高速代出さない → Task 2 buildCardModel / Task 4 card（is-now＋fare-note）✔
- §4 様式化SVG・オフライン → Task 5（projectLatLng、タイル不使用）✔
- §5 検索（区名サジェスト） → Task 6（datalist＋findAreasByQuery）✔
- §6 導線（↻隣ボタン）・戻り → Task 8 / Task 7（戻りリンク）✔
- §8 データ（出典・未確認—） → Task 3（_source/_acquired、null→「—」formatFare）✔
- §9 access/SW/deploy → Task 7（enforceAccess）/ Task 9（v245）/ Task 10 ✔
- §11 テスト → Task 1/2/3（純関数・整合）＋ Task 7 smoke ✔

**Placeholder scan:** 料金の実値のみ Task 3 のWeb調査で確定（プランは schema＋検証＋centroid を完全提示）。コードのプレースホルダなし。

**Type consistency:** `area` 形状（key/name/lat/lng/haneda{day,night}/narita{day,night}）は Task1テスト・Task3 JSON・Task2 buildCardModel・Task4 card・Task5 map で一致。`renderFareMap` は `{select}` を返し Task6 が `map.select(key)` で使用。`renderFareCard(container, area, now)`・`buildCardModel(area, now)`・`formatFare(v)`・`findAreasByQuery(areas,q)`・`lookupArea(areas,key)`・`loadFares()` のシグネチャは全タスクで一致。

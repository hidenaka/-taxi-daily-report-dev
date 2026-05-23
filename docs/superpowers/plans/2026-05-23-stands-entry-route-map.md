# 乗り場入港ルール・マップ（stands）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 京北提供の施設データを、Leaflet＋Esri航空写真の地図上に進入ルート線（矢印）＋注意事項テキストで表示し、管理者はアプリ内エディタで作成・編集できる新ページを日報アプリに追加する。

**Architecture:** 純関数（schema検証・幾何）を node:test でTDD、Leaflet/Firestore/DOMはアダプタ（headlessスモーク）。データは `Firestore companies/{companyId}/stands/{standId}` に会社単位保存。閲覧＝会社所属ドライバー（Rulesで制御）、編集＝管理者（adminUids）。

**Tech Stack:** Vanilla ES Modules（バンドラなし）、Leaflet 1.9.4（vendor同梱・global `L`）、Esri World Imagery タイル、Firebase v11.6.1 modular SDK（gstatic）、firebase-admin（seed）、Node 組み込み test runner（`./run.js` ラッパ）。

**作業ブランチ/worktree:** `~/work/taxi-dev-stands`（branch `feat/stands-entry-route-map`, dev/main基点）。`npm test` は `node --test tests/*.test.js`。dev反映は `!~/work/taxi-dev/dpush.sh ~/work/taxi-dev-stands`（Claudeはpushしない）。

**関連spec:** `docs/superpowers/specs/2026-05-23-stands-entry-route-map-design.md`

---

## File Structure

| ファイル | 種別 | 責務 | テスト |
|---|---|---|---|
| `vendor/leaflet/leaflet.js` / `leaflet.css` / `images/*` | 新規(asset) | Leaflet本体を同梱（オフライン枠） | — |
| `tools/js/stands-schema.js` | 新規(純関数) | `validateStand` / `normalizeStand` / `STAND_CATEGORIES` | ✅ node:test |
| `tools/js/stands-geo.js` | 新規(純関数) | `bearingDeg` / `findNearestStands` / `arrowMarkersForRoute` | ✅ node:test |
| `tools/js/stands-data.js` | 新規(adapter) | Firestore I/O：`loadStands`/`saveStand`/`deleteStand`/`getIsAdmin` | headless |
| `tools/js/stands-map.js` | 新規(adapter) | Leaflet初期化・ピン描画・ルート＋矢印描画・ボトムシート | headless |
| `tools/js/stands-editor.js` | 新規(adapter) | 管理者用：ピン配置/ルート描画/注意事項入力/保存/参照画像 | headless |
| `tools/js/stands-app.js` | 新規(adapter) | 起動・access判定・会社解決・GPS・閲覧/編集切替 | headless |
| `tools/stands.html` | 新規 | ページ枠・地図コンテナ・ボトムシート・編集ツールバー | headless |
| `scripts/seed-stands.mjs` | 新規 | firebase-admin で stands をシード（dev） | 手動実行 |
| `scripts/data/stands-seed-sample.json` | 新規 | 代表5施設のサンプルseedデータ | — |
| `firestore.rules` | 変更 | `myCompanyId()` 追加＋`companies/{c}/stands/{s}` match | 手動検証 |
| `tools.html` | 変更 | stands カード追加（会社フラグで表示） | headless |
| `sw.js` | 変更 | STATIC_FILES に stands/vendor 追加＋CACHE_NAME bump | — |
| `tests/stands-schema.test.js` / `tests/stands-geo.test.js` | 新規 | 上記純関数のテスト | — |

**データ構造（Firestore `companies/{companyId}/stands/{standId}`）:**
```json
{
  "name": "六本木ヒルズ",
  "category": "commercial",
  "pin": { "lat": 35.6605, "lng": 139.7292 },
  "routes": [
    { "points": [{"lat":35.6612,"lng":139.7305},{"lat":35.6605,"lng":139.7292}],
      "label": "進入", "kind": "approach" }
  ],
  "notes": "けやき坂側から進入。待機3台まで。",
  "sourcePdf": "01_roppongi_hills.pdf",
  "updatedAt": "2026-05-23T...Z",
  "updatedBy": "<userId>"
}
```

---

## Task 1: Leaflet を vendor 同梱

**Files:**
- Create: `vendor/leaflet/leaflet.js`, `vendor/leaflet/leaflet.css`, `vendor/leaflet/images/` 一式

- [ ] **Step 1: Leaflet 1.9.4 をダウンロードして配置**

Run:
```bash
cd ~/work/taxi-dev-stands
mkdir -p vendor/leaflet
curl -sL https://unpkg.com/leaflet@1.9.4/dist/leaflet.js  -o vendor/leaflet/leaflet.js
curl -sL https://unpkg.com/leaflet@1.9.4/dist/leaflet.css -o vendor/leaflet/leaflet.css
mkdir -p vendor/leaflet/images
for f in marker-icon.png marker-icon-2x.png marker-shadow.png layers.png layers-2x.png; do
  curl -sL "https://unpkg.com/leaflet@1.9.4/dist/images/$f" -o "vendor/leaflet/images/$f"
done
```

- [ ] **Step 2: 取得を検証**

Run: `ls -la vendor/leaflet vendor/leaflet/images && head -c 50 vendor/leaflet/leaflet.js`
Expected: `leaflet.js`（約140KB）/`leaflet.css`（約14KB）/images に5ファイル。`leaflet.js` 冒頭に `/* @preserve ... Leaflet 1.9.4` が見える。

- [ ] **Step 3: leaflet.css の画像相対パスを確認**

Run: `grep -o "images/[a-z0-9-]*\.png" vendor/leaflet/leaflet.css | sort -u`
Expected: `images/layers.png` 等。CSS は `images/` 相対参照なので `vendor/leaflet/images/` 配置でそのまま解決する（追加修正不要）。

- [ ] **Step 4: Commit**

```bash
git add vendor/leaflet
git commit -m "chore(stands): vendor Leaflet 1.9.4 for offline shell"
```

---

## Task 2: stand スキーマ（純関数）— validate / normalize

**Files:**
- Create: `tools/js/stands-schema.js`
- Test: `tests/stands-schema.test.js`

- [ ] **Step 1: 失敗するテストを書く**

`tests/stands-schema.test.js`:
```javascript
import { test, assert } from './run.js';
import {
  STAND_CATEGORIES, validateStand, normalizeStand,
} from '../tools/js/stands-schema.js';

const valid = {
  name: '六本木ヒルズ',
  category: 'commercial',
  pin: { lat: 35.6605, lng: 139.7292 },
  routes: [{ points: [{ lat: 35.6612, lng: 139.7305 }, { lat: 35.6605, lng: 139.7292 }], label: '進入', kind: 'approach' }],
  notes: 'けやき坂側から進入。',
};

test('validateStand: 正常データは valid', () => {
  const r = validateStand(valid);
  assert.equal(r.valid, true);
  assert.deepEqual(r.errors, []);
});

test('validateStand: name 空は invalid', () => {
  const r = validateStand({ ...valid, name: '  ' });
  assert.equal(r.valid, false);
  assert.ok(r.errors.some(e => e.includes('name')));
});

test('validateStand: pin 範囲外(東京外)は invalid', () => {
  const r = validateStand({ ...valid, pin: { lat: 10, lng: 10 } });
  assert.equal(r.valid, false);
  assert.ok(r.errors.some(e => e.includes('pin')));
});

test('validateStand: routes の points が1点は invalid', () => {
  const r = validateStand({ ...valid, routes: [{ points: [{ lat: 35.66, lng: 139.73 }] }] });
  assert.equal(r.valid, false);
  assert.ok(r.errors.some(e => e.includes('route')));
});

test('validateStand: routes 省略は valid（ピンのみ可）', () => {
  const { routes, ...noRoutes } = valid;
  assert.equal(validateStand(noRoutes).valid, true);
});

test('normalizeStand: 不正categoryは既定(other)・notes/routes欠落は補完', () => {
  const n = normalizeStand({ name: 'X', pin: { lat: 35.7, lng: 139.7 }, category: 'zzz' });
  assert.equal(n.category, 'other');
  assert.equal(n.notes, '');
  assert.deepEqual(n.routes, []);
  assert.equal(n.name, 'X');
});

test('normalizeStand: name 前後空白をtrim', () => {
  assert.equal(normalizeStand({ name: '  泉ガーデン ', pin: { lat: 35.7, lng: 139.7 } }).name, '泉ガーデン');
});

test('STAND_CATEGORIES に other を含む', () => {
  assert.ok(STAND_CATEGORIES.includes('other'));
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `cd ~/work/taxi-dev-stands && node --test tests/stands-schema.test.js`
Expected: FAIL（`Cannot find module '../tools/js/stands-schema.js'`）

- [ ] **Step 3: 最小実装**

`tools/js/stands-schema.js`:
```javascript
// tools/js/stands-schema.js — stand データの検証・正規化（純関数）

export const STAND_CATEGORIES = ['office', 'hotel', 'hospital', 'commercial', 'other'];

// 東京近郊の妥当範囲（緯度経度）。範囲外は座標ミスとして弾く。
const LAT_MIN = 35.3, LAT_MAX = 36.1;
const LNG_MIN = 139.2, LNG_MAX = 140.3;

function isFiniteNum(v) { return typeof v === 'number' && Number.isFinite(v); }

function isValidLatLng(p) {
  return p && isFiniteNum(p.lat) && isFiniteNum(p.lng)
    && p.lat >= LAT_MIN && p.lat <= LAT_MAX
    && p.lng >= LNG_MIN && p.lng <= LNG_MAX;
}

export function validateStand(obj) {
  const errors = [];
  if (!obj || typeof obj !== 'object') return { valid: false, errors: ['stand: object でない'] };
  if (typeof obj.name !== 'string' || obj.name.trim() === '') errors.push('name: 必須・非空');
  if (!isValidLatLng(obj.pin)) errors.push('pin: lat/lng が必須かつ東京近郊範囲内');
  if (obj.routes !== undefined) {
    if (!Array.isArray(obj.routes)) {
      errors.push('routes: 配列でない');
    } else {
      obj.routes.forEach((r, i) => {
        if (!r || !Array.isArray(r.points) || r.points.length < 2) {
          errors.push(`route[${i}]: points は2点以上`);
        } else if (!r.points.every(isValidLatLng)) {
          errors.push(`route[${i}]: points に不正な座標`);
        }
      });
    }
  }
  return { valid: errors.length === 0, errors };
}

export function normalizeStand(obj) {
  const src = obj || {};
  const category = STAND_CATEGORIES.includes(src.category) ? src.category : 'other';
  const routes = Array.isArray(src.routes)
    ? src.routes.map((r) => ({
        points: Array.isArray(r.points) ? r.points.map((p) => ({ lat: p.lat, lng: p.lng })) : [],
        label: typeof r.label === 'string' ? r.label : '',
        kind: r.kind === 'onsite' ? 'onsite' : 'approach',
      }))
    : [];
  return {
    name: typeof src.name === 'string' ? src.name.trim() : '',
    category,
    pin: src.pin ? { lat: src.pin.lat, lng: src.pin.lng } : null,
    routes,
    notes: typeof src.notes === 'string' ? src.notes : '',
    sourcePdf: typeof src.sourcePdf === 'string' ? src.sourcePdf : '',
  };
}
```

- [ ] **Step 4: テストを実行して成功を確認**

Run: `node --test tests/stands-schema.test.js`
Expected: PASS（8 tests）

- [ ] **Step 5: Commit**

```bash
git add tools/js/stands-schema.js tests/stands-schema.test.js
git commit -m "feat(stands): add stand schema validate/normalize (pure)"
```

---

## Task 3: ルート幾何（純関数）— bearing / nearest / arrows

**Files:**
- Create: `tools/js/stands-geo.js`
- Test: `tests/stands-geo.test.js`

- [ ] **Step 1: 失敗するテストを書く**

`tests/stands-geo.test.js`:
```javascript
import { test, assert } from './run.js';
import { bearingDeg, findNearestStands, arrowMarkersForRoute } from '../tools/js/stands-geo.js';

test('bearingDeg: 真東は約90度', () => {
  const b = bearingDeg({ lat: 35.7, lng: 139.7 }, { lat: 35.7, lng: 139.8 });
  assert.ok(Math.abs(b - 90) < 1, `got ${b}`);
});

test('bearingDeg: 真北は約0度', () => {
  const b = bearingDeg({ lat: 35.7, lng: 139.7 }, { lat: 35.8, lng: 139.7 });
  assert.ok(b < 1 || b > 359, `got ${b}`);
});

test('findNearestStands: pin が近い順に n 件', () => {
  const here = { lat: 35.66, lng: 139.73 };
  const stands = [
    { id: 'far', pin: { lat: 35.80, lng: 139.90 } },
    { id: 'near', pin: { lat: 35.661, lng: 139.731 } },
    { id: 'mid', pin: { lat: 35.70, lng: 139.75 } },
  ];
  const r = findNearestStands(here, stands, 2);
  assert.equal(r.length, 2);
  assert.equal(r[0].stand.id, 'near');
  assert.ok(r[0].distKm < r[1].distKm);
});

test('findNearestStands: pos が null なら空配列', () => {
  assert.deepEqual(findNearestStands(null, [{ id: 'a', pin: { lat: 35.7, lng: 139.7 } }], 3), []);
});

test('arrowMarkersForRoute: 各セグメント中点に向き付きで返る', () => {
  const pts = [{ lat: 35.70, lng: 139.70 }, { lat: 35.70, lng: 139.72 }, { lat: 35.71, lng: 139.72 }];
  const arrows = arrowMarkersForRoute(pts);
  assert.equal(arrows.length, 2); // セグメント数 = 点数-1
  assert.ok(Math.abs(arrows[0].angleDeg - 90) < 2); // 1本目は東向き
  assert.ok('lat' in arrows[0] && 'lng' in arrows[0]);
});

test('arrowMarkersForRoute: 点が1個以下なら空', () => {
  assert.deepEqual(arrowMarkersForRoute([{ lat: 35.7, lng: 139.7 }]), []);
  assert.deepEqual(arrowMarkersForRoute([]), []);
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `node --test tests/stands-geo.test.js`
Expected: FAIL（モジュール未定義）

- [ ] **Step 3: 最小実装**

`tools/js/stands-geo.js`:
```javascript
// tools/js/stands-geo.js — ルート幾何ヘルパー（純関数）
import { haversineKm } from './util.js';

// a→b の方位角（0=北, 90=東, 時計回り, 0..360）
export function bearingDeg(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const toDeg = (r) => (r * 180) / Math.PI;
  const φ1 = toRad(a.lat), φ2 = toRad(b.lat);
  const Δλ = toRad(b.lng - a.lng);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

// 現在地から近い stand を n 件（pin 基準）
export function findNearestStands(pos, stands, n = 5) {
  if (!pos || !Array.isArray(stands)) return [];
  return stands
    .filter((s) => s && s.pin && typeof s.pin.lat === 'number' && typeof s.pin.lng === 'number')
    .map((s) => ({ stand: s, distKm: haversineKm(pos, s.pin) }))
    .sort((a, b) => a.distKm - b.distKm)
    .slice(0, n);
}

// polyline の各セグメント中点に「向き矢印」を置くためのデータ
export function arrowMarkersForRoute(points) {
  if (!Array.isArray(points) || points.length < 2) return [];
  const out = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    out.push({
      lat: (a.lat + b.lat) / 2,
      lng: (a.lng + b.lng) / 2,
      angleDeg: bearingDeg(a, b),
    });
  }
  return out;
}
```

- [ ] **Step 4: テストを実行して成功を確認**

Run: `node --test tests/stands-geo.test.js`
Expected: PASS（6 tests）

- [ ] **Step 5: 全テスト回帰**

Run: `npm test`
Expected: 既存テスト＋今回分すべて PASS（exit code 0）

- [ ] **Step 6: Commit**

```bash
git add tools/js/stands-geo.js tests/stands-geo.test.js
git commit -m "feat(stands): add route geometry helpers (pure)"
```

---

## Task 4: Firestore I/O アダプタ（stands-data.js）

**Files:**
- Create: `tools/js/stands-data.js`

- [ ] **Step 1: 実装（アダプタ・node:test 対象外）**

`tools/js/stands-data.js`:
```javascript
// tools/js/stands-data.js — stands の Firestore I/O（アダプタ）
import { db, auth } from '../../js/firebase-init.js';
import {
  collection, getDocs, doc, setDoc, deleteDoc, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js';
import { getMyCompanyId } from '../../js/firebase-storage.js';
import { normalizeStand, validateStand } from './stands-schema.js';

export { getMyCompanyId };

// 現ユーザーが管理者か（adminUids/{uid} の存在で判定）
export async function getIsAdmin() {
  const user = auth.currentUser;
  if (!user) return false;
  try {
    const snap = await (await import('https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js'))
      .getDoc(doc(db, 'adminUids', user.uid));
    return snap.exists();
  } catch (e) {
    console.warn('getIsAdmin failed', e);
    return false;
  }
}

// 会社の stands を全件読む（id 付き）
export async function loadStands(companyId) {
  if (!companyId) return [];
  const snap = await getDocs(collection(db, 'companies', companyId, 'stands'));
  const out = [];
  snap.forEach((d) => {
    const data = d.data();
    const v = validateStand(data);
    if (!v.valid) { console.warn(`stand ${d.id} 不正でskip:`, v.errors); return; }
    out.push({ id: d.id, ...normalizeStand(data) });
  });
  return out;
}

// stand を保存（id 未指定なら自動採番）。戻り値: 保存した id。
export async function saveStand(companyId, stand) {
  if (!companyId) throw new Error('companyId が必要');
  const norm = normalizeStand(stand);
  const v = validateStand(norm);
  if (!v.valid) throw new Error('stand 検証失敗: ' + v.errors.join(', '));
  const id = stand.id || doc(collection(db, 'companies', companyId, 'stands')).id;
  const userId = (() => { try { return localStorage.getItem('taxi_user_id'); } catch { return null; } })();
  await setDoc(doc(db, 'companies', companyId, 'stands', id), {
    ...norm,
    updatedAt: serverTimestamp(),
    updatedBy: userId || null,
  });
  return id;
}

export async function deleteStand(companyId, id) {
  if (!companyId || !id) throw new Error('companyId と id が必要');
  await deleteDoc(doc(db, 'companies', companyId, 'stands', id));
}
```

- [ ] **Step 2: 構文チェック**

Run: `node --check tools/js/stands-data.js`
Expected: エラーなし（出力なし・exit 0）。※gstatic import は実行しないので構文のみ確認。

- [ ] **Step 3: Commit**

```bash
git add tools/js/stands-data.js
git commit -m "feat(stands): add Firestore I/O adapter (load/save/delete/isAdmin)"
```

---

## Task 5: 地図描画アダプタ（stands-map.js）

**Files:**
- Create: `tools/js/stands-map.js`

`L` は `tools/stands.html` が `vendor/leaflet/leaflet.js` を classic script で読み込むため global にある前提。

- [ ] **Step 1: 実装**

`tools/js/stands-map.js`:
```javascript
// tools/js/stands-map.js — Leaflet 地図描画（アダプタ）。global L 前提。
import { arrowMarkersForRoute } from './stands-geo.js';

const TOKYO_CENTER = [35.6655, 139.7314];
const CATEGORY_COLOR = {
  office: '#2980b9', hotel: '#8e44ad', hospital: '#c0392b',
  commercial: '#e67e22', other: '#16a085',
};

export function createStandsMap(elId) {
  const map = L.map(elId, { zoomControl: true }).setView(TOKYO_CENTER, 13);
  L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    { maxZoom: 19, attribution: 'Tiles © Esri' },
  ).addTo(map);
  // 道路名・地名ラベル（透過）
  L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
    { maxZoom: 19, opacity: 0.9 },
  ).addTo(map);
  return map;
}

function pinIcon(category) {
  const color = CATEGORY_COLOR[category] || CATEGORY_COLOR.other;
  return L.divIcon({
    className: 'stand-pin',
    html: `<span style="display:inline-block;width:18px;height:18px;border-radius:50% 50% 50% 0;`
      + `background:${color};border:2px solid #fff;transform:rotate(-45deg);box-shadow:0 1px 3px rgba(0,0,0,.5)"></span>`,
    iconSize: [22, 22], iconAnchor: [11, 22],
  });
}

// ピン群を描画。onSelect(stand) はタップ時。戻り値はレイヤ管理オブジェクト。
export function renderPins(map, stands, onSelect) {
  const layer = L.layerGroup().addTo(map);
  stands.forEach((s) => {
    if (!s.pin) return;
    L.marker([s.pin.lat, s.pin.lng], { icon: pinIcon(s.category), title: s.name })
      .on('click', () => onSelect(s))
      .addTo(layer);
  });
  return layer;
}

function arrowIcon(angleDeg) {
  return L.divIcon({
    className: 'stand-arrow',
    html: `<span style="display:inline-block;color:#ffd400;font-size:16px;`
      + `transform:rotate(${angleDeg - 90}deg);text-shadow:0 0 2px #000">▶</span>`,
    iconSize: [16, 16], iconAnchor: [8, 8],
  });
}

// 1施設のルート線＋矢印を描画。clearRoute で消す前提のレイヤを返す。
export function drawRoute(map, stand, { fit = true } = {}) {
  const layer = L.layerGroup().addTo(map);
  (stand.routes || []).forEach((r) => {
    if (!Array.isArray(r.points) || r.points.length < 2) return;
    const latlngs = r.points.map((p) => [p.lat, p.lng]);
    L.polyline(latlngs, { color: r.kind === 'onsite' ? '#1abc9c' : '#ffd400', weight: 5, opacity: 0.9 }).addTo(layer);
    arrowMarkersForRoute(r.points).forEach((a) => {
      L.marker([a.lat, a.lng], { icon: arrowIcon(a.angleDeg), interactive: false }).addTo(layer);
    });
  });
  if (fit) {
    const all = (stand.routes || []).flatMap((r) => r.points || []).map((p) => [p.lat, p.lng]);
    if (stand.pin) all.push([stand.pin.lat, stand.pin.lng]);
    if (all.length) map.fitBounds(L.latLngBounds(all).pad(0.3), { maxZoom: 18 });
  }
  return layer;
}

export function clearLayer(map, layer) {
  if (layer) map.removeLayer(layer);
}
```

- [ ] **Step 2: 構文チェック**

Run: `node --check tools/js/stands-map.js`
Expected: エラーなし。

- [ ] **Step 3: Commit**

```bash
git add tools/js/stands-map.js
git commit -m "feat(stands): add Leaflet map render adapter (pins/route/arrows)"
```

---

## Task 6: ページ＋起動（stands.html / stands-app.js）— 閲覧

**Files:**
- Create: `tools/stands.html`, `tools/js/stands-app.js`

- [ ] **Step 1: ページを作る**

`tools/stands.html`（`tools/ic.html` の枠に倣う。Leaflet は classic script で global 化）:
```html
<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=5, viewport-fit=cover">
  <title>Cabis ｜ 乗り場マップ</title>
  <link rel="stylesheet" href="css/style.css">
  <link rel="stylesheet" href="../vendor/leaflet/leaflet.css">
  <link rel="icon" type="image/png" sizes="180x180" href="icon-180.png">
  <link rel="apple-touch-icon" sizes="180x180" href="icon-180.png">
  <link rel="manifest" href="../manifest.webmanifest">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="mobile-web-app-capable" content="yes">
  <meta name="theme-color" content="#0a0a0f">
  <meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">
  <style>
    body{visibility:hidden;pointer-events:none;}
    #stands-map{position:fixed;top:48px;left:0;right:0;bottom:0;}
    .app-tabs{position:fixed;top:0;left:0;right:0;z-index:1200;}
    #stand-sheet{position:fixed;left:0;right:0;bottom:0;z-index:1300;background:var(--surface,#15151c);
      color:var(--text,#fff);border-top-left-radius:14px;border-top-right-radius:14px;
      padding:14px 16px 22px;box-shadow:0 -4px 16px rgba(0,0,0,.4);transform:translateY(110%);
      transition:transform .2s;max-height:55vh;overflow:auto;}
    #stand-sheet.open{transform:translateY(0);}
    #stand-sheet h3{margin:0 0 6px;font-size:17px;}
    #stand-sheet .notes{white-space:pre-wrap;font-size:14px;line-height:1.6;}
    #stand-sheet .close{position:absolute;top:8px;right:12px;font-size:20px;background:none;border:none;color:inherit;}
    #stands-editbar{position:fixed;top:54px;right:8px;z-index:1250;display:none;flex-direction:column;gap:6px;}
    #stands-editbar.show{display:flex;}
    #stands-editbar button{font-size:13px;padding:6px 10px;border-radius:8px;border:1px solid var(--border,#333);background:#222;color:#fff;}
  </style>
</head>
<body>
  <script type="module">
    import { enforceAccess } from '../js/access-control.js';
    if (!(await enforceAccess('core', { redirect: '../subscribe.html' }))) {
      throw new Error('access-denied: redirected');
    }
  </script>
  <script src="../vendor/leaflet/leaflet.js"></script>
  <nav class="app-tabs" role="tablist" aria-label="アプリ切替">
    <a href="./" class="app-tab">⏱ 乗務タイマー</a>
    <a href="ic.html" class="app-tab">🛣 IC判定</a>
    <a href="stands.html" class="app-tab active" aria-current="page">📍 乗り場</a>
  </nav>
  <div id="stands-map"></div>
  <div id="stands-editbar">
    <button id="ed-toggle" type="button">✏️ 編集モード</button>
  </div>
  <div id="stand-sheet" aria-live="polite">
    <button class="close" id="sheet-close" type="button" aria-label="閉じる">×</button>
    <h3 id="sheet-name"></h3>
    <div class="notes" id="sheet-notes"></div>
  </div>
  <script type="module" src="js/stands-app.js"></script>
</body>
</html>
```

- [ ] **Step 2: 起動スクリプトを書く**

`tools/js/stands-app.js`:
```javascript
// tools/js/stands-app.js — 起動・会社解決・閲覧/編集切替（アダプタ）
import { createStandsMap, renderPins, drawRoute, clearLayer } from './stands-map.js';
import { loadStands, getMyCompanyId, getIsAdmin } from './stands-data.js';
import { createGeoWatcher } from './geo.js';

const sheet = document.getElementById('stand-sheet');
const sheetName = document.getElementById('sheet-name');
const sheetNotes = document.getElementById('sheet-notes');
document.getElementById('sheet-close').addEventListener('click', () => sheet.classList.remove('open'));

let map, routeLayer = null;

function showStand(stand) {
  sheetName.textContent = stand.name;
  sheetNotes.textContent = stand.notes || '（注意事項は未登録）';
  sheet.classList.add('open');
  clearLayer(map, routeLayer);
  routeLayer = drawRoute(map, stand);
}

async function main() {
  map = createStandsMap('stands-map');

  const companyId = await getMyCompanyId();
  if (!companyId) {
    sheetName.textContent = '利用できません';
    sheetNotes.textContent = 'この機能は所属会社が登録されたユーザー向けです。';
    sheet.classList.add('open');
    return;
  }

  let stands = [];
  try {
    stands = await loadStands(companyId);
  } catch (e) {
    console.error('loadStands failed', e);
    sheetName.textContent = '読み込みエラー';
    sheetNotes.textContent = 'データを取得できませんでした。通信状況をご確認ください。';
    sheet.classList.add('open');
    return;
  }
  window.__standsCount = stands.length; // smoke 検証用
  renderPins(map, stands, showStand);

  // GPS 現在地（任意・既存パターン）
  const watcher = createGeoWatcher({
    onUpdate: (pos) => {
      if (window.__meMarker) map.removeLayer(window.__meMarker);
      window.__meMarker = L.circleMarker([pos.lat, pos.lng], { radius: 6, color: '#3498db', fillOpacity: 0.9 }).addTo(map);
    },
  });
  watcher.start();

  // 管理者なら編集モードを動的ロード
  if (await getIsAdmin()) {
    document.getElementById('stands-editbar').classList.add('show');
    const { initEditor } = await import('./stands-editor.js');
    initEditor({ map, companyId, stands, renderPins, drawRoute, clearLayer, showStand });
  }
}

main();
```

- [ ] **Step 3: 構文チェック**

Run: `node --check tools/js/stands-app.js`
Expected: エラーなし。

- [ ] **Step 4: Commit**

```bash
git add tools/stands.html tools/js/stands-app.js
git commit -m "feat(stands): add viewer page + bootstrap (map/pins/sheet/GPS)"
```

---

## Task 7: 描画エディタ（stands-editor.js）— 管理者

**Files:**
- Create: `tools/js/stands-editor.js`

- [ ] **Step 1: 実装**

`tools/js/stands-editor.js`:
```javascript
// tools/js/stands-editor.js — 管理者用 描画エディタ（アダプタ）
import { saveStand, deleteStand } from './stands-data.js';

// 編集状態: 1施設ずつ。ピン1つ＋ルート点列（1本）＋notes。
export function initEditor(ctx) {
  const { map, companyId } = ctx;
  const bar = document.getElementById('stands-editbar');
  let editing = false;
  let pinMarker = null;
  let routePts = [];
  let routeLine = null;
  let current = null; // 編集中の既存 stand（新規は null）

  const btnToggle = document.getElementById('ed-toggle');

  // 追加ボタン群を生成
  const btnNew = mkBtn('＋ 新規施設');
  const btnPin = mkBtn('📍 ピン配置');
  const btnRoute = mkBtn('〰 ルート描画');
  const btnUndo = mkBtn('↩ 1点戻す');
  const btnSave = mkBtn('💾 保存');
  const btnCancel = mkBtn('✖ やめる');
  [btnNew, btnPin, btnRoute, btnUndo, btnSave, btnCancel].forEach((b) => { b.style.display = 'none'; bar.appendChild(b); });

  function mkBtn(label) { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; return b; }
  function setEditButtons(on) { [btnNew, btnPin, btnRoute, btnUndo, btnSave, btnCancel].forEach((b) => { b.style.display = on ? '' : 'none'; }); }

  btnToggle.addEventListener('click', () => {
    editing = !editing;
    btnToggle.textContent = editing ? '👁 閲覧モード' : '✏️ 編集モード';
    setEditButtons(editing);
    if (!editing) resetDraft();
  });

  let mode = null; // 'pin' | 'route' | null
  btnNew.addEventListener('click', () => { resetDraft(); current = null; alert('新規施設: 「ピン配置」で乗り場を置き、「ルート描画」で線を引いて保存'); });
  btnPin.addEventListener('click', () => { mode = 'pin'; });
  btnRoute.addEventListener('click', () => { mode = 'route'; });
  btnUndo.addEventListener('click', () => {
    if (routePts.length) { routePts.pop(); redrawRoute(); }
  });

  map.on('click', (e) => {
    if (!editing || !mode) return;
    const { lat, lng } = e.latlng;
    if (mode === 'pin') {
      if (pinMarker) map.removeLayer(pinMarker);
      pinMarker = L.marker([lat, lng], { draggable: true }).addTo(map);
    } else if (mode === 'route') {
      routePts.push({ lat, lng });
      redrawRoute();
    }
  });

  function redrawRoute() {
    if (routeLine) map.removeLayer(routeLine);
    if (routePts.length >= 2) {
      routeLine = L.polyline(routePts.map((p) => [p.lat, p.lng]), { color: '#ffd400', weight: 5, dashArray: '6' }).addTo(map);
    }
  }

  btnSave.addEventListener('click', async () => {
    if (!pinMarker) { alert('ピンを配置してください'); return; }
    const name = prompt('施設名', current ? current.name : '');
    if (!name) return;
    const notes = prompt('注意事項（自由文）', current ? current.notes : '') || '';
    const ll = pinMarker.getLatLng();
    const stand = {
      id: current ? current.id : undefined,
      name,
      category: current ? current.category : 'other',
      pin: { lat: ll.lat, lng: ll.lng },
      routes: routePts.length >= 2 ? [{ points: routePts.slice(), label: '進入', kind: 'approach' }] : [],
      notes,
      sourcePdf: current ? current.sourcePdf : '',
    };
    try {
      const id = await saveStand(companyId, stand);
      alert('保存しました: ' + id);
      location.reload(); // 反映を確実に（ピン再描画）
    } catch (e) {
      alert('保存に失敗: ' + e.message);
    }
  });

  btnCancel.addEventListener('click', resetDraft);

  function resetDraft() {
    mode = null;
    if (pinMarker) { map.removeLayer(pinMarker); pinMarker = null; }
    if (routeLine) { map.removeLayer(routeLine); routeLine = null; }
    routePts = [];
    current = null;
  }
}
```

- [ ] **Step 2: 構文チェック**

Run: `node --check tools/js/stands-editor.js`
Expected: エラーなし。

- [ ] **Step 3: Commit**

```bash
git add tools/js/stands-editor.js
git commit -m "feat(stands): add admin drawing editor (pin/route/notes/save)"
```

---

## Task 8: Firestore Rules — stands の会社スコープ

**Files:**
- Modify: `firestore.rules`（helper 追加＋match 追加）

- [ ] **Step 1: `myCompanyId()` ヘルパーを追加**

`firestore.rules` の `isOwnerByUserId` 関数の直後（28行目付近）に追加:
```
    function myCompanyId() {
      return get(/databases/$(database)/documents/users/$(request.auth.uid)).data.companyId;
    }
```

- [ ] **Step 2: stands match を追加**

`companies/{companyId}` の match ブロック（`allow write: if isAdmin();` の閉じ `}` の直後、85行目付近）に追加:
```
    // --- companies/{companyId}/stands/{standId} ---
    // 乗り場入港ルール。閲覧は当該会社所属ユーザーのみ、編集は管理者のみ。
    match /companies/{companyId}/stands/{standId} {
      allow read: if isSignedIn() && myCompanyId() == companyId;
      allow read, write: if isAdmin();
    }
```

- [ ] **Step 3: Rules 構文を検証（デプロイのドライラン）**

Run: `cd ~/work/taxi-dev-stands && npx -y firebase-tools firestore:rules --help >/dev/null 2>&1 || true; npx -y firebase-tools deploy --only firestore:rules --project taxi-dailydata-dev --dry-run 2>&1 | tail -8`
Expected: 構文エラーなし（compile 成功のメッセージ）。※認証が要る場合は実 deploy は Step 5 の手動手順で行う。

- [ ] **Step 4: Commit**

```bash
git add firestore.rules
git commit -m "feat(stands): firestore rules for companies/{c}/stands (company-scoped)"
```

- [ ] **Step 5: dev へ rules を deploy（手動・要 firebase ログイン）**

Run: `cd ~/work/taxi-dev-stands && npx -y firebase-tools deploy --only firestore:rules --project taxi-dailydata-dev`
Expected: `Deploy complete!`。失敗時はユーザーに `! npx firebase-tools login` を依頼。

---

## Task 9: tools.html カード追加（会社フラグで表示）＋ SW 登録

**Files:**
- Modify: `tools.html`（カード追加＋表示制御）、`sw.js`（STATIC_FILES＋bump）

- [ ] **Step 1: カードを追加（既定 hidden）**

`tools.html` の `<a href="tools/ic.html" class="tool-card">…</a>` ブロックの直後に追加:
```html
  <a href="tools/stands.html" class="tool-card" id="stands-card" style="display:none">
    <div class="icon">📍</div>
    <h3>乗り場マップ</h3>
    <p>施設ごとの入港ルート・注意事項を地図で確認</p>
  </a>
```

- [ ] **Step 2: 会社フラグで表示する script を追加**

`tools.html` の `</body>` 直前に追加（会社プロファイルに `standsMapEnabled:true` がある会社にだけ出す）:
```html
  <script type="module">
    import { getMyCompanyProfile } from './js/firebase-storage.js';
    try {
      const c = await getMyCompanyProfile();
      if (c && c.standsMapEnabled === true) {
        const el = document.getElementById('stands-card');
        if (el) el.style.display = '';
      }
    } catch (e) { /* 未ログイン等は出さないままで良い */ }
  </script>
```

- [ ] **Step 3: sw.js に新規ファイルを登録し CACHE_NAME を bump**

`sw.js` の `STATIC_FILES` 配列の `'./tools/ic.html',` の近くに追加:
```javascript
  './tools/stands.html',
  './tools/js/stands-app.js',
  './tools/js/stands-data.js',
  './tools/js/stands-map.js',
  './tools/js/stands-geo.js',
  './tools/js/stands-schema.js',
  './tools/js/stands-editor.js',
  './vendor/leaflet/leaflet.js',
  './vendor/leaflet/leaflet.css',
```
そして 2行目の `CACHE_NAME` を1つ上げる:
```javascript
const CACHE_NAME = CACHE_PREFIX + 'v208';
```
※ rebase 後に `sw.js` の番号が v207 より大きければ、その値+1 にする（他セッションの bump と衝突回避）。

- [ ] **Step 4: 構文チェック**

Run: `node --check sw.js && echo OK`
Expected: `OK`

- [ ] **Step 5: 全テスト回帰**

Run: `npm test`
Expected: exit code 0（全 PASS）

- [ ] **Step 6: Commit**

```bash
git add tools.html sw.js
git commit -m "feat(stands): add gated tools card + register in service worker (vXXX)"
```

---

## Task 10: シードスクリプト＋代表5施設サンプル（dev）

**Files:**
- Create: `scripts/seed-stands.mjs`, `scripts/data/stands-seed-sample.json`

- [ ] **Step 1: サンプルデータを書く**

`scripts/data/stands-seed-sample.json`（代表5施設・座標は概略・ルートは仮の2点。後で本人がエディタで微調整）:
```json
[
  { "id": "roppongi_hills", "name": "六本木ヒルズ", "category": "commercial",
    "pin": { "lat": 35.6605, "lng": 139.7292 },
    "routes": [{ "points": [{ "lat": 35.6614, "lng": 139.7305 }, { "lat": 35.6605, "lng": 139.7292 }], "label": "進入", "kind": "approach" }],
    "notes": "（仮）けやき坂側から進入。エディタで要調整。", "sourcePdf": "01_roppongi_hills.pdf" },
  { "id": "izumi_garden", "name": "泉ガーデン", "category": "office",
    "pin": { "lat": 35.6655, "lng": 139.7397 },
    "routes": [{ "points": [{ "lat": 35.6662, "lng": 139.7405 }, { "lat": 35.6655, "lng": 139.7397 }], "label": "進入", "kind": "approach" }],
    "notes": "（仮）エディタで要調整。", "sourcePdf": "02_izumi_garden.pdf" },
  { "id": "atago_green_hills", "name": "愛宕グリーンヒルズ", "category": "commercial",
    "pin": { "lat": 35.6647, "lng": 139.7480 },
    "routes": [{ "points": [{ "lat": 35.6653, "lng": 139.7488 }, { "lat": 35.6647, "lng": 139.7480 }], "label": "進入", "kind": "approach" }],
    "notes": "（仮）エディタで要調整。", "sourcePdf": "03_atago_green_hills.pdf" },
  { "id": "toranomon_hills", "name": "虎ノ門ヒルズ", "category": "office",
    "pin": { "lat": 35.6669, "lng": 139.7496 },
    "routes": [{ "points": [{ "lat": 35.6676, "lng": 139.7503 }, { "lat": 35.6669, "lng": 139.7496 }], "label": "進入", "kind": "approach" }],
    "notes": "（仮）エディタで要調整。", "sourcePdf": "27_toranomon_hills.pdf" },
  { "id": "tokyo_midtown", "name": "東京ミッドタウン", "category": "commercial",
    "pin": { "lat": 35.6657, "lng": 139.7307 },
    "routes": [{ "points": [{ "lat": 35.6664, "lng": 139.7314 }, { "lat": 35.6657, "lng": 139.7307 }], "label": "進入", "kind": "approach" }],
    "notes": "（仮）エディタで要調整。", "sourcePdf": "12_tokyo_midtown.pdf" }
]
```

- [ ] **Step 2: seed スクリプトを書く**

`scripts/seed-stands.mjs`:
```javascript
// scripts/seed-stands.mjs — companies/{companyId}/stands を firebase-admin でシード
// 使い方:
//   GOOGLE_APPLICATION_CREDENTIALS=<dev SA鍵> \
//   node scripts/seed-stands.mjs --project taxi-dailydata-dev --company co-7q7ros --file scripts/data/stands-seed-sample.json
import { readFileSync } from 'node:fs';
import admin from 'firebase-admin';

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}
const projectId = arg('project', 'taxi-dailydata-dev');
const companyId = arg('company');
const file = arg('file', 'scripts/data/stands-seed-sample.json');
const dryRun = process.argv.includes('--dry-run');

if (!companyId) { console.error('--company <slug> が必須'); process.exit(1); }

admin.initializeApp({ projectId });
const db = admin.firestore();

const items = JSON.parse(readFileSync(file, 'utf8'));
console.log(`project=${projectId} company=${companyId} 件数=${items.length} dryRun=${dryRun}`);

for (const s of items) {
  const id = s.id;
  const { id: _omit, ...data } = s;
  const doc = { ...data, updatedAt: admin.firestore.FieldValue.serverTimestamp(), updatedBy: 'seed-script' };
  if (dryRun) { console.log('would write', id, data.name); continue; }
  await db.collection('companies').doc(companyId).collection('stands').doc(id).set(doc);
  console.log('wrote', id, data.name);
}
console.log('done');
process.exit(0);
```

- [ ] **Step 3: dry-run で構文＆データ読込を検証**

Run: `cd ~/work/taxi-dev-stands && node scripts/seed-stands.mjs --company co-7q7ros --dry-run`
Expected: `would write roppongi_hills 六本木ヒルズ` 等が5件＋`done`。（admin 初期化は dry-run でも走るが書き込みはしない。認証エラーが出る場合は Step 5 の本実行で SA 鍵を設定）

- [ ] **Step 4: Commit**

```bash
git add scripts/seed-stands.mjs scripts/data/stands-seed-sample.json
git commit -m "feat(stands): add seed script + 5 sample facilities (dev)"
```

- [ ] **Step 5: dev の company に standsMapEnabled フラグを立て、サンプルを投入（手動）**

会社フラグ（カード表示用）を dev の京北 doc に付与し、サンプル stands を投入する:
```bash
cd ~/work/taxi-dev-stands
export GOOGLE_APPLICATION_CREDENTIALS=<dev サービスアカウント鍵のパス>
# standsMapEnabled フラグ
node -e "import('firebase-admin').then(async ({default:a})=>{a.initializeApp({projectId:'taxi-dailydata-dev'});await a.firestore().collection('companies').doc('co-7q7ros').set({standsMapEnabled:true},{merge:true});console.log('flag set');process.exit(0)})"
# サンプル stands
node scripts/seed-stands.mjs --project taxi-dailydata-dev --company co-7q7ros --file scripts/data/stands-seed-sample.json
```
Expected: `flag set` ＋ 5件 `wrote …`。
※ iCloud 配下では実行しない（worktree はiCloud外なのでOK）。会社 doc は `merge:true` で stands フラグのみ追加（既存値は壊さない）。**会社seed誤実行ガードレール**: これは `seed-keiho-company.mjs` ではない別物だが、本番（`co-swyg3o`）への実行は本人承認後のみ。

---

## Task 11: ヘッドレス・スモーク（dev seed の閲覧描画確認）

**Files:**
- Create: `scripts/smoke-stands.mjs`（playwright で dev ページを描画確認）

前提: Task 10 Step 5 で dev に5件 seed 済み。dev ページ URL は `https://hidenaka.github.io/-taxi-daily-report-dev/tools/stands.html`（dpush 後）。ローカル確認する場合は `npm run serve` で `http://localhost:8000/tools/stands.html`。

- [ ] **Step 1: スモークスクリプトを書く**

`scripts/smoke-stands.mjs`:
```javascript
// scripts/smoke-stands.mjs — stands.html のピン描画をヘッドレス確認
// 使い方: node scripts/smoke-stands.mjs <baseUrl> <userId>
// 例: node scripts/smoke-stands.mjs https://hidenaka.github.io/-taxi-daily-report-dev <京北の検証userId>
import { chromium } from 'playwright';

const base = process.argv[2] || 'http://localhost:8000';
const userId = process.argv[3];
if (!userId) { console.error('userId が必要（京北所属の検証ユーザー）'); process.exit(1); }

const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();
// access ゲート回避用に localStorage / sub_cache を seed（既存スモーク手順）
await page.addInitScript((uid) => {
  localStorage.setItem('taxi_user_id', uid);
  sessionStorage.setItem('taxi_sub_cache_v1', JSON.stringify({
    userId: uid, ts: Date.now(), sub: { status: 'active', plan: 'full' },
  }));
}, userId);

const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(`${base}/tools/stands.html`, { waitUntil: 'networkidle' });
await page.waitForTimeout(3000);
const count = await page.evaluate(() => window.__standsCount);
const pins = await page.locator('.stand-pin').count();
console.log('console errors:', errors);
console.log('__standsCount =', count, ' .stand-pin DOM =', pins);
if ((count ?? 0) < 1) { console.error('FAIL: stands が読み込まれていない'); process.exit(1); }
console.log('SMOKE OK');
await browser.close();
```

- [ ] **Step 2: スモークを実行**

Run: `cd ~/work/taxi-dev-stands && node scripts/smoke-stands.mjs http://localhost:8000 <京北検証userId>`（別ターミナルで `npm run serve` 起動が必要。dev反映後は dev URL でも可）
Expected: `__standsCount = 5` 以上、`.stand-pin DOM = 5`、`SMOKE OK`、console errors は空配列。

- [ ] **Step 3: Commit**

```bash
git add scripts/smoke-stands.mjs
git commit -m "test(stands): add headless smoke for viewer pin rendering"
```

---

## Task 12: dev 反映と動作確認（手動）

- [ ] **Step 1: 全テスト最終確認**

Run: `cd ~/work/taxi-dev-stands && npm test`
Expected: exit code 0（全 PASS）

- [ ] **Step 2: dev へ反映（ユーザー実行）**

ユーザーに依頼: `! ~/work/taxi-dev/dpush.sh ~/work/taxi-dev-stands`
（Claude は push しない。dpush.sh が fetch+rebase+push を担う。rebase で `sw.js` の CACHE_NAME 衝突が出たら大きい方+1 に直して再実行）

- [ ] **Step 3: dev 実機確認（ユーザー）**

ユーザーに案内: dev プロファイルの既存タブで `https://hidenaka.github.io/-taxi-daily-report-dev/tools/stands.html` を **reload**。
確認: ①航空写真地図＋5ピン表示 ②ピンタップでルート線＋矢印＋注意事項シート ③管理者ログインで「✏️編集モード」表示 ④編集→ピン/ルート/注意事項→保存→reloadで反映。
※ PWA 更新のため SW 再起動（アプリ再読込）を案内。

---

## Phase 2 / Phase 3（後続・本計画のTDD対象外）

- **Phase 2（全43シード）**: Claude が43個のPDFを読み、`scripts/data/stands-seed-keiho-43.json` を生成（pin=geocode / routes=概略 / notes=PDF読取）→ `seed-stands.mjs` で dev 投入。本人がエディタで微調整。
- **Phase 3（本番）**: 本人が dev で全件確認 → 本番会社 `co-swyg3o` に `standsMapEnabled` ＋ stands を投入（**本人承認後**）→ アプリは `v*` タグ（`! ~/work/taxi-dev/tagpush.sh`）で本番反映。Rules は本番にも deploy（`--project=prod`）。

---

## Self-Review（spec 照合）

- **データ構造（pin/routes[向き]/notes/sourcePdf）** → Task 2(schema)/Task 4(I/O)/Task 10(seed)で実装 ✅
- **地図＝Leaflet＋Esri航空写真＋ラベル・敷地内粒度** → Task 1(vendor)/Task 5(createStandsMap, maxZoom19) ✅
- **ルート線＋矢印描画** → Task 3(arrowMarkersForRoute)/Task 5(drawRoute) ✅
- **ボトムシートで注意事項テキスト** → Task 6(stands.html #stand-sheet, stands-app showStand) ✅
- **描画エディタ（管理者・同ページモード・ピン/ルート/注意事項/保存）** → Task 7 ✅
- **アクセス制御（閲覧=会社所属 / 編集=管理者 / 非所属はカード非表示＋直アクセス弾き）** → Task 8(rules myCompanyId)/Task 9(カード会社フラグ)/Task 6(companyId無し時の「利用できません」) ✅
- **Claudeの下書きシード** → Task 10(機構)＋Phase 2(全43) ✅
- **GPS現在地** → Task 6(createGeoWatcher) ✅
- **SW bump・Leaflet同梱** → Task 1/Task 9 ✅
- **テスト（schema/geo の単体・headlessスモーク）** → Task 2/3/11 ✅
- **デプロイ（worktree→dpush.sh／本番tag・rules deploy）** → Task 8 Step5/Task 12/Phase 3 ✅
- **参照PDFパネル**: spec の「nice to have」。本計画では Phase 2 で参照画像をエディタに足す前提とし、Phase 1 のエディタは画像なしで成立（縮退）。→ spec のスコープ外注記と整合。
- プレースホルダ走査: `<dev SA鍵のパス>` `<京北検証userId>` `vXXX` は実行時に値を入れる手動手順の指定子（コード内プレースホルダではない）。型整合: `clearLayer`/`drawRoute`/`renderPins`/`findNearestStands`/`arrowMarkersForRoute` の名称はタスク間で一致。

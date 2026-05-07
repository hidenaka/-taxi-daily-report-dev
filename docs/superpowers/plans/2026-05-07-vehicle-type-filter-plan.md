# 車種別データ分割フィルター 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** index/review/support/calendar の4ページに車種別タブ（すべて/ジャパンタクシー/プレミアム）を導入し、共通モジュール `js/vehicle-filter.js` で状態と振る舞いを統一する。

**Architecture:** 純粋関数（フィルタリング・デフォルト判定）と DOM/sessionStorage アダプタ（タブUI・状態永続化）を1モジュールに分離。各ページは「タブ設置箇所」と「フィルタ適用箇所」だけを追加する。Firestoreスキーマ変更なし、既存 `drive.vehicleType` をそのまま利用。

**Tech Stack:** Vanilla JS (ESM, `"type":"module"`)、Firebase Firestore、`node --test`。テストフレームワーク `tests/run.js`（薄いラッパー）。デプロイは dev リポジトリにpush → タグでprod自動デプロイ。

**設計仕様**: `docs/superpowers/specs/2026-05-07-vehicle-type-filter-design.md` を参照。

---

## ファイル構造

| 種別 | パス | 責務 |
|---|---|---|
| 新規 | `js/vehicle-filter.js` | 車種フィルタの全API（純粋関数 + UIアダプタ） |
| 新規 | `tests/vehicle-filter.test.js` | 純粋関数のユニットテスト |
| 編集 | `css/style.css` | `.vehicle-tabs` スタイル追記 |
| 編集 | `index.html` | タブ設置 + 月次集計フィルタ注入 |
| 編集 | `review.html` | タブ設置 + 各セクションフィルタ注入 |
| 編集 | `support.html` | タブ設置 + 全員統合/自分データ両方フィルタ + ユーザー数再計算 |
| 編集 | `calendar.html` | タブ設置 + 月セル描画フィルタ注入 |

**重要な注意事項**:
- 開発は **dev リポジトリ** で行う（カレントディレクトリが dev）
- 編集後は必ず `npm test` を実行
- HTML編集時は ESM importの順序を崩さない
- 既存の `drives` / `allDrives` / `myDrives` / `drivesThisMonth` 変数名はそのまま使い、フィルタは描画直前にかける

---

## Task 1: `js/vehicle-filter.js` の純粋関数 — TDD

**Files:**
- Create: `js/vehicle-filter.js`
- Test: `tests/vehicle-filter.test.js`

### - [ ] Step 1.1: テストファイルを作成（失敗するテスト）

`tests/vehicle-filter.test.js` を新規作成:

```javascript
import { test, assert } from './run.js';
import {
  filterDrivesByVehicle,
  pickDefaultVehicleType,
  isValidVehicleType,
} from '../js/vehicle-filter.js';

// --- isValidVehicleType ---
test('isValidVehicleType: 有効な値を受け入れる', () => {
  assert.equal(isValidVehicleType('all'), true);
  assert.equal(isValidVehicleType('japantaxi'), true);
  assert.equal(isValidVehicleType('premium'), true);
});

test('isValidVehicleType: 無効な値を拒否する', () => {
  assert.equal(isValidVehicleType('regular'), false);
  assert.equal(isValidVehicleType(''), false);
  assert.equal(isValidVehicleType(null), false);
  assert.equal(isValidVehicleType(undefined), false);
  assert.equal(isValidVehicleType('JT'), false);
});

// --- filterDrivesByVehicle ---
const sampleDrives = [
  { date: '2026-05-01', vehicleType: 'japantaxi' },
  { date: '2026-05-02', vehicleType: 'premium' },
  { date: '2026-05-03', vehicleType: '' },
  { date: '2026-05-04', vehicleType: 'regular' }, // 旧値
  { date: '2026-05-05' },                         // フィールドなし
];

test('filterDrivesByVehicle: all は全件返す', () => {
  const result = filterDrivesByVehicle(sampleDrives, 'all');
  assert.equal(result.length, 5);
});

test('filterDrivesByVehicle: japantaxi はJTのみ + regularも含む', () => {
  const result = filterDrivesByVehicle(sampleDrives, 'japantaxi');
  // 'japantaxi' と 'regular'（旧値→JTマッピング）
  assert.equal(result.length, 2);
  assert.deepEqual(result.map(d => d.date), ['2026-05-01', '2026-05-04']);
});

test('filterDrivesByVehicle: premium はプレミアムのみ', () => {
  const result = filterDrivesByVehicle(sampleDrives, 'premium');
  assert.equal(result.length, 1);
  assert.equal(result[0].date, '2026-05-02');
});

test('filterDrivesByVehicle: 空/未定義の vehicleType は all のみで含まれる', () => {
  const all = filterDrivesByVehicle(sampleDrives, 'all');
  assert.equal(all.filter(d => !d.vehicleType).length, 2);
  const jt = filterDrivesByVehicle(sampleDrives, 'japantaxi');
  assert.equal(jt.filter(d => !d.vehicleType).length, 0);
  const pr = filterDrivesByVehicle(sampleDrives, 'premium');
  assert.equal(pr.filter(d => !d.vehicleType).length, 0);
});

test('filterDrivesByVehicle: 無効な type は all 扱い', () => {
  const result = filterDrivesByVehicle(sampleDrives, 'unknown');
  assert.equal(result.length, 5);
});

test('filterDrivesByVehicle: drives が null/undefined でも空配列を返す', () => {
  assert.deepEqual(filterDrivesByVehicle(null, 'all'), []);
  assert.deepEqual(filterDrivesByVehicle(undefined, 'premium'), []);
});

// --- pickDefaultVehicleType ---
test('pickDefaultVehicleType: 今日のドライブのvehicleTypeを優先', () => {
  const today = { vehicleType: 'premium' };
  const config = { defaults: { vehicleType: 'japantaxi' } };
  assert.equal(pickDefaultVehicleType(today, config), 'premium');
});

test('pickDefaultVehicleType: 今日なし → configを使う', () => {
  const config = { defaults: { vehicleType: 'premium' } };
  assert.equal(pickDefaultVehicleType(null, config), 'premium');
});

test('pickDefaultVehicleType: 今日のvehicleTypeが空 → configにフォールバック', () => {
  const today = { vehicleType: '' };
  const config = { defaults: { vehicleType: 'japantaxi' } };
  assert.equal(pickDefaultVehicleType(today, config), 'japantaxi');
});

test('pickDefaultVehicleType: 両方なし → all', () => {
  assert.equal(pickDefaultVehicleType(null, null), 'all');
  assert.equal(pickDefaultVehicleType(null, {}), 'all');
  assert.equal(pickDefaultVehicleType(null, { defaults: {} }), 'all');
});

test('pickDefaultVehicleType: 不正値（today=taxi, config=japan）→ allにフォールバック', () => {
  assert.equal(pickDefaultVehicleType({ vehicleType: 'taxi' }, { defaults: { vehicleType: 'foo' } }), 'all');
});

test('pickDefaultVehicleType: regular値はjapantaxiにマップ', () => {
  assert.equal(pickDefaultVehicleType({ vehicleType: 'regular' }, null), 'japantaxi');
});
```

### - [ ] Step 1.2: テスト実行 → 失敗を確認

Run: `npm test -- tests/vehicle-filter.test.js`

Expected: ERR_MODULE_NOT_FOUND（`js/vehicle-filter.js` がまだ存在しない）

### - [ ] Step 1.3: `js/vehicle-filter.js` を新規作成（純粋関数のみ）

```javascript
// js/vehicle-filter.js — 車種別フィルタリング共通モジュール

const VALID_TYPES = ['all', 'japantaxi', 'premium'];
const STORAGE_KEY = 'activeVehicleType';

// ============================================================
// 純粋関数（テスト対象）
// ============================================================

export function isValidVehicleType(type) {
  return VALID_TYPES.includes(type);
}

// 内部: 旧値や空文字を正規化
function normalizeType(t) {
  if (t === 'regular') return 'japantaxi';
  return t;
}

export function filterDrivesByVehicle(drives, type) {
  if (!Array.isArray(drives)) return [];
  if (!isValidVehicleType(type) || type === 'all') {
    return drives.slice();
  }
  return drives.filter(d => normalizeType(d?.vehicleType) === type);
}

export function pickDefaultVehicleType(todayDrive, config) {
  // 1) 今日のドライブの値（'japantaxi' or 'premium' に正規化後）
  const todayType = normalizeType(todayDrive?.vehicleType);
  if (todayType === 'japantaxi' || todayType === 'premium') return todayType;

  // 2) config.defaults.vehicleType
  const cfgType = normalizeType(config?.defaults?.vehicleType);
  if (cfgType === 'japantaxi' || cfgType === 'premium') return cfgType;

  // 3) フォールバック
  return 'all';
}

// ============================================================
// DOM/sessionStorage アダプタ（テスト対象外、各ページで使用）
// ============================================================

export function getActiveVehicleType() {
  try {
    const v = sessionStorage.getItem(STORAGE_KEY);
    return isValidVehicleType(v) ? v : 'all';
  } catch {
    return _memoryFallback || 'all';
  }
}

let _memoryFallback = null;

export function setActiveVehicleType(type) {
  if (!isValidVehicleType(type)) return false;
  try {
    sessionStorage.setItem(STORAGE_KEY, type);
  } catch {
    _memoryFallback = type;
  }
  // 同ページ内の購読者に通知
  window.dispatchEvent(new CustomEvent('vehicle-filter-change', { detail: { type } }));
  return true;
}

export function subscribeVehicleChange(callback) {
  const handler = (e) => callback(e.detail.type);
  window.addEventListener('vehicle-filter-change', handler);
  return () => window.removeEventListener('vehicle-filter-change', handler);
}

export async function resolveDefaultVehicleType(deps) {
  // deps: { getDrive, getConfig, todayDateStr }
  // 依存注入で外部storageを渡す（テスト容易化）
  try {
    const today = await deps.getDrive(deps.todayDateStr);
    const config = await deps.getConfig();
    return pickDefaultVehicleType(today, config);
  } catch {
    return 'all';
  }
}

export function renderVehicleTabs(container, options = {}) {
  if (!container) return;
  const onChange = options.onChange || (() => {});
  const showAll = options.showAll !== false;

  const tabs = [];
  if (showAll) tabs.push({ key: 'all', label: 'すべて' });
  tabs.push({ key: 'japantaxi', label: 'ジャパンタクシー' });
  tabs.push({ key: 'premium', label: 'プレミアム' });

  const current = getActiveVehicleType();
  container.innerHTML = `<div class="vehicle-tabs" role="tablist">${
    tabs.map(t => `<button type="button" role="tab" data-vt="${t.key}" class="${t.key === current ? 'active' : ''}">${t.label}</button>`).join('')
  }</div>`;

  container.querySelectorAll('.vehicle-tabs button').forEach(btn => {
    btn.addEventListener('click', () => {
      const type = btn.dataset.vt;
      if (setActiveVehicleType(type)) {
        container.querySelectorAll('.vehicle-tabs button').forEach(b => b.classList.toggle('active', b === btn));
        onChange(type);
      }
    });
  });
}

// 初回呼び出し用ヘルパ（各ページの初期化を統一）
export async function ensureActiveVehicleType(deps) {
  const current = sessionStorage?.getItem?.(STORAGE_KEY);
  if (isValidVehicleType(current)) return current;
  const def = await resolveDefaultVehicleType(deps);
  setActiveVehicleType(def);
  return def;
}
```

### - [ ] Step 1.4: テスト実行 → 全パスを確認

Run: `npm test -- tests/vehicle-filter.test.js`

Expected: All tests pass（13テスト全部）

### - [ ] Step 1.5: 全テスト実行（既存テストへの影響なしを確認）

Run: `npm test`

Expected: 既存の全テスト + vehicle-filterテストが pass。新たな失敗なし。

### - [ ] Step 1.6: コミット

```bash
git add js/vehicle-filter.js tests/vehicle-filter.test.js
git commit -m "feat: add vehicle-filter module with pure-function tests"
```

---

## Task 2: CSS スタイル追記

**Files:**
- Modify: `css/style.css`（末尾追記）

### - [ ] Step 2.1: `.vehicle-tabs` スタイルを追記

`css/style.css` の末尾に以下を追記:

```css

/* === 車種フィルタタブ === */
.vehicle-tabs { display: flex; gap: 4px; margin: 8px 0; }
.vehicle-tabs button {
  flex: 1; background: #f0f0f0; color: #333; border: none;
  padding: 8px 4px; border-radius: 4px; font-size: 12px; cursor: pointer;
  font-family: inherit;
}
.vehicle-tabs button.active {
  background: var(--primary); color: #fff; font-weight: 600;
}
```

### - [ ] Step 2.2: コミット

```bash
git add css/style.css
git commit -m "feat: add vehicle-tabs CSS styles"
```

---

## Task 3: `index.html`（ホーム）にタブ設置

**Files:**
- Modify: `index.html`

### - [ ] Step 3.1: 現状の構造確認

Run: `grep -n "今月のサマリ\|drives = await getDrivesForMonth" index.html`

期待: `getDrivesForMonth` の呼び出しと「今月のサマリ」セクションの位置を把握する。

### - [ ] Step 3.2: import に vehicle-filter を追加

`index.html` の `<script type="module">` 内、既存の storage.js import 行の直後に追加:

```javascript
import { getDrivesForMonth, getDrive, getConfig, /* ...既存のimport... */ } from './js/storage.js';
import {
  ensureActiveVehicleType,
  getActiveVehicleType,
  filterDrivesByVehicle,
  renderVehicleTabs,
} from './js/vehicle-filter.js';
```

（`getDrive` がまだimportされていなければ追加）

### - [ ] Step 3.3: タブ設置箇所のHTMLを追加

`index.html` で「今月のサマリ」セクションの直前に空のコンテナを追加:

```html
<div id="vehicleTabsContainer"></div>
<!-- 既存の「今月のサマリ」 -->
```

### - [ ] Step 3.4: 初期化と再描画ロジックを追加

ページの初期化フロー（既存の `recalcStats` などを呼ぶ箇所）を以下のように変更:

```javascript
// 既存の getDrivesForMonth 後、最初の集計呼び出しの前に:
const todayStr = new Date().toISOString().slice(0, 10);
await ensureActiveVehicleType({
  getDrive: () => getDrive(todayStr).catch(() => null),
  getConfig: () => getConfig().catch(() => null),
  todayDateStr: todayStr,
});

renderVehicleTabs(document.getElementById('vehicleTabsContainer'), {
  onChange: () => recalcStats(),  // 既存の集計関数名に合わせる
});

// 既存の集計関数 recalcStats / renderHome 等の最初で:
//   const allDrives = drives;  // 既存
//   const filtered = filterDrivesByVehicle(allDrives, getActiveVehicleType());
//   以降の集計は filtered を使う
```

`index.html` の現在の集計関数（`recalcStats` 等）内の `drives` 変数を直接使っている箇所を、関数冒頭で `const drives = filterDrivesByVehicle(rawDrives, getActiveVehicleType());` に置き換える。元の生配列は別名（例: `rawDrives`）で保持する。

具体的には:
1. ファイル冒頭スコープに `let rawDrives = [];` を追加
2. `drives = await getDrivesForMonth(viewPeriod);` を `rawDrives = await getDrivesForMonth(viewPeriod);` に変更
3. 集計関数の冒頭で `const drives = filterDrivesByVehicle(rawDrives, getActiveVehicleType());`

### - [ ] Step 3.5: dev サーバ起動して手動確認

Run: `npm run serve` （別ターミナルで）

ブラウザで `http://localhost:8000/index.html` を開く:
- タブが表示される
- デフォルトタブが今日の車種（or settings）に基づいて選択される
- タブ切替で月次サマリが変わる
- ブラウザのデベロッパーツールConsoleにエラーがないこと

### - [ ] Step 3.6: コミット

```bash
git add index.html
git commit -m "feat: add vehicle filter tabs to index.html"
```

---

## Task 4: `review.html`（分析）にタブ設置

**Files:**
- Modify: `review.html`

### - [ ] Step 4.1: 現状把握

Run: `grep -n "buildMonthSummaries\|drivesByMonth\|getDrivesForMonth" review.html | head -10`

期待: `buildMonthSummaries(periods, drivesByMonth)` がヒートマップ・トレンド等を作っている。フィルタはここに注入する。

### - [ ] Step 4.2: import に vehicle-filter を追加

`review.html` の `<script type="module">` 内:

```javascript
import { getDrivesForMonth, getDrivesForMonthCached, getConfig, getConfigCached, getDrive } from './js/storage.js';
import {
  ensureActiveVehicleType,
  getActiveVehicleType,
  filterDrivesByVehicle,
  renderVehicleTabs,
} from './js/vehicle-filter.js';
```

（`getDrive` を import に追加）

### - [ ] Step 4.3: タブ設置のHTML追加

`review.html` で `<h1 style="margin-top:0;">分析</h1>` の直後に追加:

```html
<h1 style="margin-top:0;">分析</h1>
<div id="vehicleTabsContainer"></div>
<!-- 既存の振り返りボタン等 -->
```

### - [ ] Step 4.4: 初期化と再描画ロジックを追加

`review.html` の既存の初期化処理（`drivesByMonth` を作る前後）の後に:

```javascript
// 生データ保持 (フィルタ前)
let rawDrivesByMonth = [];

// 初期化フロー内、drivesByMonth フェッチ完了後:
rawDrivesByMonth = drivesByMonth.slice();

const todayStr = new Date().toISOString().slice(0, 10);
await ensureActiveVehicleType({
  getDrive: () => getDrive(todayStr).catch(() => null),
  getConfig: () => getConfig().catch(() => null),
  todayDateStr: todayStr,
});

renderVehicleTabs(document.getElementById('vehicleTabsContainer'), {
  onChange: () => rerenderAll(),
});

// 既存の rerender / 描画関数を一つにまとめた rerenderAll を作る:
function rerenderAll() {
  const type = getActiveVehicleType();
  const filtered = rawDrivesByMonth.map(arr => filterDrivesByVehicle(arr, type));
  monthSummaries = buildMonthSummaries(periods, filtered);
  // 既存の描画関数を順に呼ぶ（ヒートマップ・ランキング・トレンド・メモ一覧）
  renderHeatmap();
  renderRanking();
  renderTrend();
  renderMemos();
}
rerenderAll();
```

具体的な既存関数名は実装時に `grep -n "function render" review.html` で確認して、全ての描画関数を `rerenderAll()` から呼ぶ。

### - [ ] Step 4.5: 期間タブ切替との整合性確認

期間タブ（`range-tabs`）切替時に `rawDrivesByMonth` が再フェッチされ、その後 `rerenderAll()` が呼ばれることを確認。期間切替ハンドラ内でフェッチ後 `rerenderAll()` を呼ぶように修正。

### - [ ] Step 4.6: dev サーバで手動確認

ブラウザで `http://localhost:8000/review.html`:
- タブ表示OK
- ヒートマップ・ランキング・トレンドが車種で切り替わる
- 期間タブ切替も正しく動く
- Console エラーなし

### - [ ] Step 4.7: コミット

```bash
git add review.html
git commit -m "feat: add vehicle filter tabs to review.html"
```

---

## Task 5: `support.html`（営業サポート）にタブ設置 — **最複雑**

**Files:**
- Modify: `support.html`

### - [ ] Step 5.1: 現状把握

`support.html` には:
- `myDrives`（自分のみ）
- `allDrives`（全員統合）
- 「全員モード: Nユーザー / 合計M乗務(自分: K乗務)」表示

両方のドライブセットにフィルタを適用し、ユーザー数と件数を再計算する必要がある。

Run: `grep -n "myDrives\|allDrives" support.html | head -30`

### - [ ] Step 5.2: import に vehicle-filter を追加

```javascript
import {
  // 既存のimport
  getDrive,
  // ...
} from './js/storage.js';
import {
  ensureActiveVehicleType,
  getActiveVehicleType,
  filterDrivesByVehicle,
  renderVehicleTabs,
} from './js/vehicle-filter.js';
```

### - [ ] Step 5.3: タブ設置のHTML追加

期間表示の下に空コンテナを追加:

```html
<div id="vehicleTabsContainer"></div>
```

具体位置は `grep -n "billingPeriod\|formatBillingPeriod" support.html` で「期間表示」のセクションを特定して、その直後の `<section>` 終了直前。

### - [ ] Step 5.4: 生データ保持 + フィルタ済みビューの分離

`support.html` 既存の:

```javascript
let myDrives = [];      // フィルタ適用済み（描画用）
let allDrives = [];     // フィルタ適用済み（描画用）
```

これに加えて:

```javascript
let rawMyDrives = [];   // フェッチ生データ
let rawAllDrives = [];  // フェッチ生データ
```

を追加。フェッチ箇所（`myDrives = myParts.flat(); allDrives = allParts.flat();`）を:

```javascript
rawMyDrives = myParts.flat();
rawAllDrives = allParts.flat();
applyVehicleFilter();
```

に変更し、新関数:

```javascript
function applyVehicleFilter() {
  const type = getActiveVehicleType();
  myDrives = filterDrivesByVehicle(rawMyDrives, type);
  allDrives = filterDrivesByVehicle(rawAllDrives, type);
  // ユーザー数表示の再計算
  updateAggregationLabel();
}

function updateAggregationLabel() {
  const el = document.querySelector('[data-aggregation-label]') || /* 既存の表示要素を grep で特定 */;
  if (!el) return;
  const userIds = new Set(allDrives.map(d => d.userId).filter(Boolean));
  el.textContent = `全員モード: ${userIds.size}ユーザー / 合計${allDrives.length}乗務(自分: ${myDrives.length}乗務)`;
}
```

既存の `el.textContent = '全員モード...'` 行（line 350付近）に `data-aggregation-label` 属性を追加し、`updateAggregationLabel()` から参照できるようにする。

### - [ ] Step 5.5: 初期化とタブ描画

ページ初期化フロー内、`rawAllDrives` フェッチ完了後:

```javascript
const todayStr = new Date().toISOString().slice(0, 10);
await ensureActiveVehicleType({
  getDrive: () => getDrive(todayStr).catch(() => null),
  getConfig: () => getConfig().catch(() => null),
  todayDateStr: todayStr,
});

renderVehicleTabs(document.getElementById('vehicleTabsContainer'), {
  onChange: () => {
    applyVehicleFilter();
    rerenderAllSections();  // 既存の各セクション描画をまとめた関数
  },
});

applyVehicleFilter();
rerenderAllSections();
```

`rerenderAllSections()` は support.html の既存の描画関数（推奨検索・高期待値エリア・降車エリア別など）を順に呼ぶラッパー。既存の何処で個別に呼ばれているかを `grep -n "function render\|^render\|paceState" support.html | head -20` で確認して全部呼ぶ。

### - [ ] Step 5.6: `paceState.allDrives` も追従させる

`support.html:183` の `paceState = { allDrives: drives, ... }` は描画用 myDrives/allDrives と同期する必要がある。既存の paceState 更新箇所も `applyVehicleFilter()` 後に `paceState.allDrives = myDrives;` を呼ぶように修正。

### - [ ] Step 5.7: dev サーバで手動確認

ブラウザで `http://localhost:8000/support.html`:
- タブ表示OK
- 切替で推奨検索・高期待値エリア・降車エリア別が変わる
- 「全員モード: Nユーザー / 合計M乗務(自分: K乗務)」の数値がフィルタ後の値で更新
- 期間切替・Pace表示も正しく追従
- Console エラーなし

### - [ ] Step 5.8: コミット

```bash
git add support.html
git commit -m "feat: add vehicle filter tabs to support.html"
```

---

## Task 6: `calendar.html` にタブ設置

**Files:**
- Modify: `calendar.html`

### - [ ] Step 6.1: import 追加

```javascript
import { getConfig, saveConfig, getDrivesForMonth, getDrive } from './js/storage.js';
import {
  ensureActiveVehicleType,
  getActiveVehicleType,
  filterDrivesByVehicle,
  renderVehicleTabs,
} from './js/vehicle-filter.js';
```

### - [ ] Step 6.2: タブ設置HTML

カレンダー本体の上、月切替コントロールの下に:

```html
<div id="vehicleTabsContainer"></div>
```

具体位置は `grep -n "calendar-grid\|月切替" calendar.html` で確定する。

### - [ ] Step 6.3: 生データ保持 + フィルタ適用

既存:

```javascript
let drivesThisMonth = [];
```

を:

```javascript
let rawDrivesThisMonth = [];
let drivesThisMonth = [];
```

に分割。フェッチ箇所:

```javascript
rawDrivesThisMonth = await getDrivesForMonth(viewPeriod);
drivesThisMonth = filterDrivesByVehicle(rawDrivesThisMonth, getActiveVehicleType());
```

### - [ ] Step 6.4: 初期化 + onChange

```javascript
const todayStr = new Date().toISOString().slice(0, 10);
await ensureActiveVehicleType({
  getDrive: () => getDrive(todayStr).catch(() => null),
  getConfig: () => getConfig().catch(() => null),
  todayDateStr: todayStr,
});

renderVehicleTabs(document.getElementById('vehicleTabsContainer'), {
  onChange: () => {
    drivesThisMonth = filterDrivesByVehicle(rawDrivesThisMonth, getActiveVehicleType());
    renderCalendar();  // 既存のカレンダー描画関数名
  },
});
```

既存のカレンダー描画関数名は `grep -n "function render\|^function" calendar.html | head` で確認。

### - [ ] Step 6.5: 月切替時の整合性

月切替（前月/翌月ボタン）でフェッチ後、`drivesThisMonth = filterDrivesByVehicle(...)` を呼ぶように修正。

### - [ ] Step 6.6: dev サーバで手動確認

ブラウザで `http://localhost:8000/calendar.html`:
- タブ表示OK
- カレンダーセルが車種で切り替わる
- 月切替も正しく動く

### - [ ] Step 6.7: コミット

```bash
git add calendar.html
git commit -m "feat: add vehicle filter tabs to calendar.html"
```

---

## Task 7: 全ページ統合テスト（手動）

**Files:** なし（動作確認のみ）

### - [ ] Step 7.1: 全テストpass確認

Run: `npm test`

Expected: 全テスト pass

### - [ ] Step 7.2: ページ間状態維持の確認

ブラウザで:
1. `index.html` でタブを「プレミアム」に切替
2. ナビで `review.html` に移動 → タブが「プレミアム」のままであることを確認
3. `support.html` に移動 → 同上
4. `calendar.html` に移動 → 同上
5. ブラウザを閉じて再度開く → デフォルトに戻る（sessionStorageの仕様）

### - [ ] Step 7.3: 掛け持ちユーザーの確認

両車種のドライブを持つユーザー（自分でも他人でも）が:
- 「すべて」タブで全ドライブが見える
- 「ジャパンタクシー」タブでJTドライブのみ
- 「プレミアム」タブでプレミアムドライブのみ
- support.htmlのユーザー数が車種ごとに正しく更新

### - [ ] Step 7.4: 不明データの確認

`vehicleType` が空のドライブ（古いbulkインポート分など）が:
- 「すべて」タブで見える
- JT/プレミアムタブでは除外される

### - [ ] Step 7.5: コンソールエラー確認

各ページでブラウザのConsoleに新規エラー・警告が出ていないこと。既存のエラーは無視（git diff範囲で増えていなければOK）。

### - [ ] Step 7.6: 結果記録

確認できた項目をチェックし、問題があればこの計画に追記または別Issue化。問題なしなら次へ。

---

## Task 8: dev環境デプロイ → 動作確認

**Files:** なし（GitHub操作のみ）

### - [ ] Step 8.1: dev リポジトリにpush

```bash
git push origin main
```

### - [ ] Step 8.2: dev URLで動作確認

`https://hidenaka.github.io/-taxi-daily-report-dev/` を開く:
- 「🚧 開発環境」バッジが出ている
- タブが各ページに表示される
- フィルタ動作OK

GitHub Pagesは反映に1-2分かかる可能性あり。

### - [ ] Step 8.3: 必要なら修正・再push

問題があれば修正してコミット → push → 再確認。

---

## Task 9: 本番デプロイ（タグpush）— **ユーザー承認後のみ実行**

**Files:** なし（GitHub操作のみ）

このTaskは **ユーザーがdev環境で動作確認OKと明示的に承認してから** 実行する。自動実行しない。

### - [ ] Step 9.1: 現在のタグを確認

```bash
git tag --sort=-v:refname | head -5
```

### - [ ] Step 9.2: 次のバージョンタグを決定

ユーザーに確認:「次のバージョンは `v1.x.0` で良いか？」既存タグから patch/minor/major を提案。

### - [ ] Step 9.3: タグ作成 + push

```bash
git tag v<決定したバージョン>
git push origin v<決定したバージョン>
```

### - [ ] Step 9.4: GitHub Actions の実行確認

```bash
gh run list --workflow=deploy --limit 3
```

または GitHub Actions ページを確認。緑チェックを待つ（1-2分）。

### - [ ] Step 9.5: 本番URLで動作確認

`https://hidenaka.github.io/taxi-daily-report/` を開く:
- 「🚧 開発環境」バッジが**ない**
- タブ表示・フィルタ動作OK

---

## 完了基準

- [x] `tests/vehicle-filter.test.js` 全パス
- [x] `npm test` で既存テストへの新規失敗ゼロ
- [x] index/review/support/calendar の4ページでタブ動作確認
- [x] sessionStorage で同セッション内のページ遷移後もタブ維持
- [x] 掛け持ちユーザー・不明データの扱いが仕様通り
- [x] dev環境でユーザーが動作確認OK
- [x] 本番デプロイ完了

## 既知のリスク・注意点

- `support.html` は最も複雑（myDrives + allDrives 両方フィルタ + Nユーザー再計算 + paceState 同期）。Task 5 は他より時間がかかる前提で計画する。
- `review.html` の既存の描画関数群が個別に呼ばれている可能性があり、まとめて `rerenderAll()` で呼ぶリファクタが必要。実装時に `grep` で関数を網羅すること。
- カレンダーの月セル色付け関数の名前は実装時に確認（`renderCalendar` が無い場合は実態の関数名に合わせる）。
- `getDrive(todayStr)` は今日のデータがなければ throw or null を返す可能性あり → `.catch(() => null)` で吸収済み。
- iCloudパス（スペース・日本語・チルダ）でnpm/gitが時折挙動不安定。問題が出たら一度カレントを確認してから再実行。

# 予定セルの車種トグル — 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** カレンダー予定セルに JT/プレ を排他的に内包させ、タップ循環で切替。ホームでも JP バッジで車種を視認可能にする。

**Architecture:** `config.shifts.plannedVehicles: Record<DateISO, 'japantaxi'|'premium'>` を新規追加（既存 `expandedDates` は維持）。純粋関数モジュール `js/planned-shifts.js` に循環ロジック・参照ヘルパーを集約しテスト可能化。`calendar.html` の車種フィルタタブは削除、循環ロジックを置換。`index.html` のカレンダーセル描画を拡張し車種クラス + JP バッジを付与。

**Tech Stack:** Vanilla JS ES Modules / `node --test` / HTML + inline `<style>` / `css/style.css` 共通

**Spec:** `docs/superpowers/specs/2026-05-13-planned-vehicle-toggle-design.md`

**デプロイ方針:** dev リポジトリで実装 → `https://hidenaka.github.io/-taxi-daily-report-dev/` で動作確認 → ユーザー承認後にタグ付けして本番反映。

---

## File Structure

| ファイル | 種別 | 責務 |
|---|---|---|
| `js/planned-shifts.js` | 新規 | UI非依存の純粋関数群（状態取得・循環・適用・整合性保証） |
| `tests/planned-shifts.test.js` | 新規 | `planned-shifts.js` のユニットテスト |
| `js/default-config.js` | 編集 | `shifts.plannedVehicles: {}`, `shifts.paidLeaveDates: []` を初期スキーマに追加 |
| `css/style.css` | 編集 | `.cal-cell.planned.japantaxi` / `.cal-cell.planned.premium` / `.vt-badge` 共通スタイル |
| `calendar.html` | 編集 | 車種フィルタタブ削除 / セル描画拡張 / `cycleStatus` 置換 / 曜日一括時の車種同時セット / 凡例とヘルプ更新 |
| `index.html` | 編集 | `renderCalendar` のセル描画拡張（車種クラス + JP バッジ） / 凡例更新 / `getConfig` 後の正規化 |

タスクは TDD（純粋関数）→ スキーマ → スタイル → 画面1 → 画面2 の順で進める。各タスクは独立してコミット可能。

---

## Task 1: `planned-shifts.js` 純粋関数（TDD）

**Files:**
- Create: `js/planned-shifts.js`
- Create: `tests/planned-shifts.test.js`

- [ ] **Step 1: 失敗するテストを書く（`tests/planned-shifts.test.js`）**

```javascript
import { test, assert } from './run.js';
import {
  isValidVehicle,
  getPlannedVehicle,
  getShiftStateForDate,
  cycleShiftState,
  applyShiftState,
  pruneOrphanVehicles,
} from '../js/planned-shifts.js';

// --- isValidVehicle ---
test('isValidVehicle: 有効値を受け入れる', () => {
  assert.equal(isValidVehicle('japantaxi'), true);
  assert.equal(isValidVehicle('premium'), true);
});

test('isValidVehicle: 無効値を拒否する', () => {
  assert.equal(isValidVehicle('all'), false);
  assert.equal(isValidVehicle(''), false);
  assert.equal(isValidVehicle(null), false);
  assert.equal(isValidVehicle(undefined), false);
});

// --- getPlannedVehicle ---
function makeConfig({ planned = [], paid = [], vehicles = {}, defaultVehicle = 'japantaxi' } = {}) {
  return {
    shifts: { expandedDates: planned.slice(), paidLeaveDates: paid.slice(), plannedVehicles: { ...vehicles } },
    defaults: { vehicleType: defaultVehicle },
  };
}

test('getPlannedVehicle: 明示済の値を返す', () => {
  const cfg = makeConfig({ planned: ['2026-05-12'], vehicles: { '2026-05-12': 'premium' } });
  assert.equal(getPlannedVehicle('2026-05-12', cfg), 'premium');
});

test('getPlannedVehicle: expandedDates にあり明示なし → defaults.vehicleType', () => {
  const cfg = makeConfig({ planned: ['2026-05-12'], defaultVehicle: 'premium' });
  assert.equal(getPlannedVehicle('2026-05-12', cfg), 'premium');
});

test('getPlannedVehicle: defaults.vehicleType が不正 → japantaxi にフォールバック', () => {
  const cfg = makeConfig({ planned: ['2026-05-12'], defaultVehicle: '' });
  assert.equal(getPlannedVehicle('2026-05-12', cfg), 'japantaxi');
});

test('getPlannedVehicle: expandedDates に無い → null', () => {
  const cfg = makeConfig({ planned: [] });
  assert.equal(getPlannedVehicle('2026-05-12', cfg), null);
});

// --- getShiftStateForDate ---
test('getShiftStateForDate: 未', () => {
  const cfg = makeConfig();
  assert.deepEqual(getShiftStateForDate('2026-05-12', cfg), { planned: false, vehicle: null, paid: false });
});

test('getShiftStateForDate: 予定(明示)', () => {
  const cfg = makeConfig({ planned: ['2026-05-12'], vehicles: { '2026-05-12': 'premium' } });
  assert.deepEqual(getShiftStateForDate('2026-05-12', cfg), { planned: true, vehicle: 'premium', paid: false });
});

test('getShiftStateForDate: 有給', () => {
  const cfg = makeConfig({ paid: ['2026-05-12'] });
  assert.deepEqual(getShiftStateForDate('2026-05-12', cfg), { planned: false, vehicle: null, paid: true });
});

// --- cycleShiftState (defaultType='japantaxi') ---
test('cycleShiftState JT: 未 → JT予定', () => {
  const next = cycleShiftState({ planned: false, vehicle: null, paid: false }, 'japantaxi');
  assert.deepEqual(next, { planned: true, vehicle: 'japantaxi', paid: false });
});

test('cycleShiftState JT: JT予定 → プレ予定', () => {
  const next = cycleShiftState({ planned: true, vehicle: 'japantaxi', paid: false }, 'japantaxi');
  assert.deepEqual(next, { planned: true, vehicle: 'premium', paid: false });
});

test('cycleShiftState JT: プレ予定 → 有給', () => {
  const next = cycleShiftState({ planned: true, vehicle: 'premium', paid: false }, 'japantaxi');
  assert.deepEqual(next, { planned: false, vehicle: null, paid: true });
});

test('cycleShiftState JT: 有給 → 未', () => {
  const next = cycleShiftState({ planned: false, vehicle: null, paid: true }, 'japantaxi');
  assert.deepEqual(next, { planned: false, vehicle: null, paid: false });
});

// --- cycleShiftState (defaultType='premium') ---
test('cycleShiftState プレ: 未 → プレ予定', () => {
  const next = cycleShiftState({ planned: false, vehicle: null, paid: false }, 'premium');
  assert.deepEqual(next, { planned: true, vehicle: 'premium', paid: false });
});

test('cycleShiftState プレ: プレ予定 → JT予定', () => {
  const next = cycleShiftState({ planned: true, vehicle: 'premium', paid: false }, 'premium');
  assert.deepEqual(next, { planned: true, vehicle: 'japantaxi', paid: false });
});

// --- applyShiftState ---
test('applyShiftState: 未 → 予定 で expandedDates と plannedVehicles に追加', () => {
  const cfg = makeConfig();
  applyShiftState(cfg, '2026-05-12', { planned: true, vehicle: 'premium', paid: false });
  assert.deepEqual(cfg.shifts.expandedDates, ['2026-05-12']);
  assert.equal(cfg.shifts.plannedVehicles['2026-05-12'], 'premium');
  assert.deepEqual(cfg.shifts.paidLeaveDates, []);
});

test('applyShiftState: 予定 → 有給 で expandedDates/plannedVehicles から削除し paidLeaveDates に追加', () => {
  const cfg = makeConfig({ planned: ['2026-05-12'], vehicles: { '2026-05-12': 'japantaxi' } });
  applyShiftState(cfg, '2026-05-12', { planned: false, vehicle: null, paid: true });
  assert.deepEqual(cfg.shifts.expandedDates, []);
  assert.equal(cfg.shifts.plannedVehicles['2026-05-12'], undefined);
  assert.deepEqual(cfg.shifts.paidLeaveDates, ['2026-05-12']);
});

test('applyShiftState: 有給 → 未 で paidLeaveDates から削除', () => {
  const cfg = makeConfig({ paid: ['2026-05-12'] });
  applyShiftState(cfg, '2026-05-12', { planned: false, vehicle: null, paid: false });
  assert.deepEqual(cfg.shifts.paidLeaveDates, []);
});

test('applyShiftState: 予定 → 別車種予定 で plannedVehicles 上書き', () => {
  const cfg = makeConfig({ planned: ['2026-05-12'], vehicles: { '2026-05-12': 'japantaxi' } });
  applyShiftState(cfg, '2026-05-12', { planned: true, vehicle: 'premium', paid: false });
  assert.deepEqual(cfg.shifts.expandedDates, ['2026-05-12']);
  assert.equal(cfg.shifts.plannedVehicles['2026-05-12'], 'premium');
});

test('applyShiftState: 重複追加が起きない（既に予定の日に再度予定）', () => {
  const cfg = makeConfig({ planned: ['2026-05-12'], vehicles: { '2026-05-12': 'japantaxi' } });
  applyShiftState(cfg, '2026-05-12', { planned: true, vehicle: 'japantaxi', paid: false });
  assert.deepEqual(cfg.shifts.expandedDates, ['2026-05-12']);
});

// --- pruneOrphanVehicles ---
test('pruneOrphanVehicles: expandedDates に無い plannedVehicles のキーを削除', () => {
  const cfg = makeConfig({ planned: ['2026-05-12'], vehicles: { '2026-05-12': 'premium', '2026-04-01': 'japantaxi' } });
  pruneOrphanVehicles(cfg);
  assert.deepEqual(Object.keys(cfg.shifts.plannedVehicles).sort(), ['2026-05-12']);
});

test('pruneOrphanVehicles: plannedVehicles が無い config でも例外を出さない', () => {
  const cfg = { shifts: { expandedDates: ['2026-05-12'] } };
  pruneOrphanVehicles(cfg);
  assert.equal(cfg.shifts.plannedVehicles, undefined);
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `npm test -- --test-name-pattern="planned-shifts" 2>&1 | tail -30`

期待: モジュールが存在しないため import エラー。または `npm test` 全体で `Cannot find module '../js/planned-shifts.js'`。

- [ ] **Step 3: 最小実装を書く（`js/planned-shifts.js`）**

```javascript
// js/planned-shifts.js — 予定シフトの状態・車種を扱う純粋関数群
const VALID_VEHICLES = ['japantaxi', 'premium'];

export function isValidVehicle(v) {
  return VALID_VEHICLES.includes(v);
}

function fallbackVehicle(config) {
  const def = config?.defaults?.vehicleType;
  return isValidVehicle(def) ? def : 'japantaxi';
}

export function getPlannedVehicle(date, config) {
  const planned = config?.shifts?.expandedDates;
  if (!Array.isArray(planned) || !planned.includes(date)) return null;
  const explicit = config?.shifts?.plannedVehicles?.[date];
  if (isValidVehicle(explicit)) return explicit;
  return fallbackVehicle(config);
}

export function getShiftStateForDate(date, config) {
  const planned = config?.shifts?.expandedDates?.includes(date) ?? false;
  const paid = config?.shifts?.paidLeaveDates?.includes(date) ?? false;
  const vehicle = planned ? getPlannedVehicle(date, config) : null;
  return { planned, vehicle, paid };
}

export function cycleShiftState(current, defaultType) {
  const def = isValidVehicle(defaultType) ? defaultType : 'japantaxi';
  const other = def === 'japantaxi' ? 'premium' : 'japantaxi';
  if (!current.planned && !current.paid) {
    return { planned: true, vehicle: def, paid: false };
  }
  if (current.planned && current.vehicle === def) {
    return { planned: true, vehicle: other, paid: false };
  }
  if (current.planned && current.vehicle === other) {
    return { planned: false, vehicle: null, paid: true };
  }
  if (current.paid) {
    return { planned: false, vehicle: null, paid: false };
  }
  return { planned: false, vehicle: null, paid: false };
}

function removeFromArray(arr, v) {
  const i = arr.indexOf(v);
  if (i >= 0) arr.splice(i, 1);
}

export function applyShiftState(config, date, next) {
  config.shifts = config.shifts || {};
  config.shifts.expandedDates = config.shifts.expandedDates || [];
  config.shifts.paidLeaveDates = config.shifts.paidLeaveDates || [];
  config.shifts.plannedVehicles = config.shifts.plannedVehicles || {};
  removeFromArray(config.shifts.expandedDates, date);
  removeFromArray(config.shifts.paidLeaveDates, date);
  delete config.shifts.plannedVehicles[date];
  if (next.planned && isValidVehicle(next.vehicle)) {
    config.shifts.expandedDates.push(date);
    config.shifts.expandedDates.sort();
    config.shifts.plannedVehicles[date] = next.vehicle;
  } else if (next.paid) {
    config.shifts.paidLeaveDates.push(date);
    config.shifts.paidLeaveDates.sort();
  }
  return config;
}

export function pruneOrphanVehicles(config) {
  if (!config?.shifts?.plannedVehicles) return config;
  const planned = new Set(config.shifts.expandedDates || []);
  for (const d of Object.keys(config.shifts.plannedVehicles)) {
    if (!planned.has(d)) delete config.shifts.plannedVehicles[d];
  }
  return config;
}
```

- [ ] **Step 4: テストを実行して全件パス確認**

Run: `npm test 2>&1 | tail -40`

期待: 既存テスト + 新規 `planned-shifts.test.js` の全テストがパス。最終行に `# fail 0` の表示。

- [ ] **Step 5: コミット**

```bash
cd "/Users/hideakimacbookair/Library/Mobile Documents/com~apple~CloudDocs/タクシー乗務アプリ/タクシー日報"
git add js/planned-shifts.js tests/planned-shifts.test.js
git commit -m "feat(shifts): planned-shifts.js pure functions for vehicle toggle"
```

---

## Task 2: `default-config.js` にスキーマ追加

**Files:**
- Modify: `js/default-config.js:1-10`

- [ ] **Step 1: `shifts` ブロックを更新**

`js/default-config.js` の `shifts` を以下に差し替え:

```javascript
  shifts: {
    patterns: [],
    exceptions: { added: [], removed: [], swapped: [] },
    expandedDates: [],
    paidLeaveDates: [],
    plannedVehicles: {}
  },
```

(`paidLeaveDates: []` は他箇所で使われていたが `default-config.js` には無かったため、ここで明示的に追加して整合する)

- [ ] **Step 2: テスト全体を実行（既存テストを壊していないか確認）**

Run: `npm test 2>&1 | tail -20`

期待: 全テストパス。

- [ ] **Step 3: コミット**

```bash
git add js/default-config.js
git commit -m "feat(config): add plannedVehicles and paidLeaveDates to default shifts schema"
```

---

## Task 3: CSS 共通スタイル追加

**Files:**
- Modify: `css/style.css`（末尾に追記）

- [ ] **Step 1: スタイル追記**

`css/style.css` の末尾に以下を追加:

```css

/* ─── 予定セルの車種色分け & JP バッジ（calendar.html / index.html 共通） ─── */
.cal-cell { position: relative; }
.cal-cell.planned.japantaxi {
  background: #26c6da;
  border-color: #00acc1;
  color: #fff;
  font-weight: 600;
}
.cal-cell.planned.premium {
  background: #1976d2;
  border-color: #0d47a1;
  color: #fff;
  font-weight: 600;
}
.cal-cell .vt-badge {
  position: absolute;
  top: 2px;
  right: 2px;
  font-size: 9px;
  font-weight: 700;
  line-height: 1;
  padding: 2px 4px;
  border-radius: 3px;
  background: rgba(255,255,255,0.88);
  color: #333;
  pointer-events: none;
}
```

- [ ] **Step 2: コミット**

```bash
git add css/style.css
git commit -m "feat(style): add vehicle-typed planned cell colors and JP badge"
```

---

## Task 4: `calendar.html` を予定セル車種トグル仕様に改修

**Files:**
- Modify: `calendar.html`

このタスクは複数の編集を伴うが、変更内容は仕様で確定済みのため、まとめて編集してから動作確認する。

- [ ] **Step 1: 上部車種フィルタタブの DOM 要素と関連 import を削除**

`calendar.html` の以下を編集:

(a) 44行目付近の `<div id="vehicleTabsContainer"></div>` を **削除**。

(b) 80–85行目の import 文を以下に置換:

```javascript
import {
  getShiftStateForDate,
  cycleShiftState,
  applyShiftState,
  getPlannedVehicle,
  pruneOrphanVehicles,
} from './js/planned-shifts.js';
```

(`./js/vehicle-filter.js` からの import は **全削除**。`ensureActiveVehicleType` / `getActiveVehicleType` / `filterDrivesByVehicle` / `renderVehicleTabs` を呼ぶコードも削除する。)

- [ ] **Step 2: `load()` 関数を更新**

`async function load() { ... }` を以下に置換:

```javascript
async function load() {
  config = await getConfig();
  if (!config) return alert('config.json未取得');
  config.shifts = config.shifts || {};
  config.shifts.plannedVehicles = config.shifts.plannedVehicles || {};
  config.shifts.paidLeaveDates = config.shifts.paidLeaveDates || [];
  pruneOrphanVehicles(config);
  await render();
}
```

- [ ] **Step 3: `render()` 関数を更新**

`async function render() { ... }` を以下に置換（車種フィルタ無し、全件で集計）:

```javascript
async function render() {
  document.getElementById('monthLabel').textContent = formatBillingPeriod(viewPeriod);
  drivesThisMonth = await getDrivesForMonth(viewPeriod);
  renderGrid();
  renderDowToggles();
  renderSummary();
}
```

(`rawDrivesThisMonth` と `drivesThisMonth` を分けていた箇所を、フィルタなしの `drivesThisMonth` 1本に統一。`let rawDrivesThisMonth = [];` の宣言行も削除。)

- [ ] **Step 4: 既存の `let drivesThisMonth = [];` 宣言を確認**

`let rawDrivesThisMonth = [];` 行を削除し、`let drivesThisMonth = [];` のみ残す。

- [ ] **Step 5: `renderGrid()` 内のセル描画を更新**

`renderGrid` 関数内の `for (const iso of periodDates) { ... }` ループの中身を以下に置換:

```javascript
  for (const iso of periodDates) {
    const day = parseInt(iso.split('-')[2]);
    const cell = document.createElement('div');
    cell.className = 'cal-cell';
    const hasActual = isActual(iso);
    if (hasActual) {
      cell.classList.add('actual');
    } else if (isPaidLeave(iso)) {
      cell.classList.add('paidleave');
    } else if (isPlanned(iso)) {
      cell.classList.add('planned');
      const v = getPlannedVehicle(iso, config);
      if (v) cell.classList.add(v);
    }
    if (iso === todayIso()) cell.classList.add('today');
    cell.textContent = day;
    if (hasActual) {
      cell.style.cursor = 'pointer';
      cell.onclick = () => location.href = `detail.html?date=${iso}`;
    } else {
      cell.onclick = () => cycleStatus(iso);
    }
    grid.appendChild(cell);
  }
```

- [ ] **Step 6: `cycleStatus()` を新ロジックに置換**

`async function cycleStatus(iso) { ... }` を以下に置換:

```javascript
async function cycleStatus(iso) {
  if (isActual(iso)) return alert('実績入力済の日は変更できません');
  const defaultType = config?.defaults?.vehicleType || 'japantaxi';
  const current = getShiftStateForDate(iso, config);
  const next = cycleShiftState(current, defaultType);
  applyShiftState(config, iso, next);
  await saveConfig(config);
  await render();
}
```

- [ ] **Step 7: `renderDowToggles()` 内の予定追加時に車種を同時セット**

`renderDowToggles` 内の `btn.onclick = async () => { ... }` の本体、`for (const iso of eachDateInRange(start, end)) { ... }` ループ部分を以下に置換:

```javascript
      const defaultType = config?.defaults?.vehicleType || 'japantaxi';
      const { start, end } = getBillingPeriodRange(viewPeriod);
      config.shifts.plannedVehicles = config.shifts.plannedVehicles || {};
      for (const iso of eachDateInRange(start, end)) {
        const dt = new Date(iso + 'T00:00:00+09:00');
        const dowName = DOW[dt.getDay()];
        if (config.shifts.patterns.includes(dowName) && !config.shifts.expandedDates.includes(iso) && !isActual(iso)) {
          config.shifts.expandedDates.push(iso);
          config.shifts.plannedVehicles[iso] = defaultType;
        }
      }
      config.shifts.expandedDates.sort();
      await saveConfig(config);
      await render();
```

- [ ] **Step 8: 凡例セクションを更新**

カレンダーの凡例（57–61行目付近、`<div style="margin-top:12px;font-size:11px;display:flex;gap:8px;flex-wrap:wrap;">` 内）を以下に差し替え:

```html
    <div style="margin-top:12px;font-size:11px;display:flex;gap:8px;flex-wrap:wrap;">
      <span><span style="display:inline-block;width:10px;height:10px;background:var(--primary);border-radius:2px;"></span> 実績</span>
      <span><span style="display:inline-block;width:10px;height:10px;background:#26c6da;border-radius:2px;"></span> JT予定</span>
      <span><span style="display:inline-block;width:10px;height:10px;background:#1976d2;border-radius:2px;"></span> プレ予定</span>
      <span><span style="display:inline-block;width:10px;height:10px;background:#ce93d8;border-radius:2px;"></span> 有給</span>
      <span><span style="display:inline-block;width:10px;height:10px;background:#fff;box-shadow:0 0 0 2px #f57f17 inset;border-radius:2px;"></span> 今日</span>
    </div>
```

- [ ] **Step 9: ヘルプ文を更新**

`<p class="help">タップで「未→予定→有給→未」と循環。実績入力済の日（青）は変更不可。</p>` を以下に置換:

```html
    <p class="help">タップで「未 → デフォルト車種予定 → もう一方の車種予定 → 有給 → 未」と循環。デフォルト車種は設定で変更。実績入力済の日は変更不可。</p>
```

- [ ] **Step 10: インライン `<style>` に予定セル基本スタイルを残しつつ、車種色は `style.css` に委ねる**

`calendar.html` の `<style>` ブロック内の以下行（11行目付近）:

```css
.cal-cell.planned { background: var(--green); color: #fff; font-weight: 600; border-color: var(--green); }
```

を以下に置換（車種クラスが付かないケース＝既存データのフォールバックを兼ねた既定色を保ちつつ、`.japantaxi` / `.premium` クラスが優先されるよう CSS 詳細度を考慮）:

```css
.cal-cell.planned { background: var(--green); color: #fff; font-weight: 600; border-color: var(--green); }
.cal-cell.planned.japantaxi { background: #26c6da; border-color: #00acc1; color: #fff; }
.cal-cell.planned.premium { background: #1976d2; border-color: #0d47a1; color: #fff; }
```

(注: `css/style.css` にも同じ車種色ルールが存在するが、インラインに二重に書くことで、calendar.html のローカル `.cal-cell` 定義（背景白）に対する詳細度競合を確実に解決する。)

- [ ] **Step 11: ローカルサーバーを起動してブラウザで動作確認**

```bash
cd "/Users/hideakimacbookair/Library/Mobile Documents/com~apple~CloudDocs/タクシー乗務アプリ/タクシー日報"
python3 -m http.server 8000
```

別ターミナルで `open http://localhost:8000/calendar.html` を実行し、以下を手動確認:

- [ ] 上部の車種フィルタタブが消えている
- [ ] 未来の空セルをタップ → デフォルト車種色（settings で JT なら水色、プレなら青）になる
- [ ] もう一度タップ → 非デフォルト車種色に切り替わる
- [ ] さらにタップ → 紫（有給）になる
- [ ] もう一度タップ → 元の白に戻る
- [ ] 設定で `vehicleType` を `premium` に変更 → リロード → 空セルタップで青(プレ)が先に出る
- [ ] 曜日トグル ON → 該当曜日が一括追加され、デフォルト車種色で表示される
- [ ] 実績済セル（青）をタップ → `alert` が出て遷移しない
- [ ] 凡例に JT予定（水色）/ プレ予定（青）/ 有給（紫）が表示される

- [ ] **Step 12: ユニットテスト全体実行（リグレッション確認）**

Run: `npm test 2>&1 | tail -20`

期待: 全テストパス。

- [ ] **Step 13: コミット**

```bash
git add calendar.html
git commit -m "feat(calendar): replace vehicle filter tabs with planned-vehicle cell toggle"
```

---

## Task 5: `index.html` ホームカレンダーに車種色 + JP バッジ

**Files:**
- Modify: `index.html`

- [ ] **Step 1: `getConfig` 後の正規化を追加**

`index.html` の `async function load() { ... }` 内、`config = await getConfig();` の直後に以下を挿入:

```javascript
  if (config) {
    config.shifts = config.shifts || {};
    config.shifts.plannedVehicles = config.shifts.plannedVehicles || {};
    config.shifts.paidLeaveDates = config.shifts.paidLeaveDates || [];
  }
```

- [ ] **Step 2: `planned-shifts.js` をインポート**

`index.html` の `<script type="module">` ブロック内の既存 import 群に追加:

```javascript
import { getPlannedVehicle, pruneOrphanVehicles } from './js/planned-shifts.js';
```

そして上記 Step 1 の正規化に `pruneOrphanVehicles(config);` を追加:

```javascript
  if (config) {
    config.shifts = config.shifts || {};
    config.shifts.plannedVehicles = config.shifts.plannedVehicles || {};
    config.shifts.paidLeaveDates = config.shifts.paidLeaveDates || [];
    pruneOrphanVehicles(config);
  }
```

- [ ] **Step 3: `renderCalendar` のセル描画を拡張**

`renderCalendar` 関数内、セル組み立てループ（557行目付近の `for (const iso of periodDates) { ... }`）を以下に置換:

```javascript
  for (const iso of periodDates) {
    const day = parseInt(iso.split('-')[2]);
    const drive = driveByDate[iso];
    const isToday = iso === today;
    const isPlanned = plannedSet.has(iso);
    const isPaid = paidSet.has(iso);
    const cls = ['cal-cell'];
    let plannedVehicle = null;
    if (drive) {
      cls.push('actual');
    } else if (isPaid) {
      cls.push('paid');
    } else if (isPlanned && iso >= today) {
      cls.push('planned');
      plannedVehicle = getPlannedVehicle(iso, config);
      if (plannedVehicle) cls.push(plannedVehicle);
    }
    if (isToday) cls.push('today');
    let badge = '';
    if (drive && (drive.vehicleType === 'premium' || drive.vehicleType === 'japantaxi')) {
      badge = `<span class="vt-badge">${drive.vehicleType === 'premium' ? 'P' : 'J'}</span>`;
    } else if (plannedVehicle) {
      badge = `<span class="vt-badge">${plannedVehicle === 'premium' ? 'P' : 'J'}</span>`;
    }
    let inner;
    if (drive) {
      const sales = calcDailySales(drive);
      const wIcon = pickWeatherIcon(drive.weather);
      inner = `<div class="day">${day}</div><div class="ic">${wIcon}</div><div class="yen">${shortYen(sales.inclTax)}</div>`;
    } else if (isPaid) {
      inner = `<div class="day">${day}</div><div class="tag">有給</div>`;
    } else if (isPlanned && iso >= today) {
      inner = `<div class="day">${day}</div><div class="tag">予定</div>`;
    } else {
      inner = `<div class="day">${day}</div>`;
    }
    const onclick = drive ? ` onclick="location.href='detail.html?date=${iso}'"` : ((isPlanned || isPaid) ? ` onclick="location.href='calendar.html'"` : '');
    const cursor = drive || isPlanned || isPaid ? 'cursor:pointer;' : '';
    html += `<div class="${cls.join(' ')}" style="${cursor}"${onclick}>${badge}${inner}</div>`;
  }
```

- [ ] **Step 4: 凡例を更新**

`renderCalendar` 内の凡例（586–592行目付近の `// 凡例` 直後の HTML）を以下に置換:

```javascript
  html += `
    <div style="display:flex;gap:10px;margin-top:6px;font-size:10px;color:var(--muted);flex-wrap:wrap;">
      <span><span style="display:inline-block;width:10px;height:10px;background:#e3f2fd;border:1px solid var(--primary);border-radius:2px;vertical-align:middle;"></span> 実績(J/P)</span>
      <span><span style="display:inline-block;width:10px;height:10px;background:#b2ebf2;border:1px dashed #00acc1;border-radius:2px;vertical-align:middle;"></span> JT予定</span>
      <span><span style="display:inline-block;width:10px;height:10px;background:#bbdefb;border:1px dashed #1976d2;border-radius:2px;vertical-align:middle;"></span> プレ予定</span>
      <span><span style="display:inline-block;width:10px;height:10px;background:#f3e5f5;border:1px solid #ce93d8;border-radius:2px;vertical-align:middle;"></span> 有給</span>
    </div>
  `;
```

- [ ] **Step 5: インライン `<style>` で予定セルの車種色を上書き**

`index.html` の `<style>` ブロック内、23行目付近の以下行:

```css
.cal-cell.planned { background: #e8f5e9; border-color: #66bb6a; border-style: dashed; }
```

の直後に以下を追加:

```css
.cal-cell.planned.japantaxi { background: #b2ebf2; border-color: #00acc1; border-style: dashed; }
.cal-cell.planned.premium { background: #bbdefb; border-color: #1976d2; border-style: dashed; }
.cal-cell.planned.japantaxi .tag,
.cal-cell.planned.premium .tag { color: #0d47a1; }
```

(注: ホームの予定セルは calendar.html と違って薄い色（パステル）でデザイン統一されているため、JT予定は `#b2ebf2`（薄シアン）、プレ予定は `#bbdefb`（薄ブルー）にする。Tag テキスト色も車種色に合わせて濃紺に調整。既存の `.cal-cell .tag` の font-size/font-weight 定義はそのまま残す。)

- [ ] **Step 6: ブラウザで動作確認**

ローカルサーバーが立っていなければ起動:

```bash
cd "/Users/hideakimacbookair/Library/Mobile Documents/com~apple~CloudDocs/タクシー乗務アプリ/タクシー日報"
python3 -m http.server 8000
```

`http://localhost:8000/index.html` で以下を手動確認:

- [ ] 実績セルに `J` または `P` のバッジが右上に表示される（`drive.vehicleType` が `japantaxi` / `premium` のもの）
- [ ] 実績セルで `vehicleType` が空の場合はバッジが出ない
- [ ] 未来の予定セルが車種色（薄シアン / 薄ブルー）で表示される
- [ ] 予定セル右上にも `J`/`P` バッジが出る
- [ ] 有給セルは紫のままバッジ無し
- [ ] 凡例が「実績(J/P)」「JT予定」「プレ予定」「有給」になっている

- [ ] **Step 7: ユニットテスト全体実行**

Run: `npm test 2>&1 | tail -20`

期待: 全テストパス。

- [ ] **Step 8: コミット**

```bash
git add index.html
git commit -m "feat(home): show vehicle color and JP badge on home calendar cells"
```

---

## Task 6: dev デプロイと最終確認

**Files:** （変更なし、運用タスク）

- [ ] **Step 1: 既存リグレッションテスト全体を実行**

```bash
cd "/Users/hideakimacbookair/Library/Mobile Documents/com~apple~CloudDocs/タクシー乗務アプリ/タクシー日報"
npm test 2>&1 | tail -30
```

期待: 全テストパス（`# fail 0`）。

- [ ] **Step 2: dev リポジトリへ push**

dev リポジトリ・リモートの正確な名前は AGENTS.md / プロジェクト運用に従う。一般的には:

```bash
git push origin <current-branch>
```

または既存の `-dev` リポジトリへの remote が別名で設定されていれば、それを使う。

- [ ] **Step 3: dev URL で動作確認**

ブラウザで `https://hidenaka.github.io/-taxi-daily-report-dev/` を開き、以下を再確認:

- [ ] `calendar.html`: タップ循環が想定通り
- [ ] `index.html`: ホームカレンダーに車種色 + バッジ
- [ ] settings の vehicleType を変えると循環順が入れ替わる
- [ ] 既存の有給・実績挙動が壊れていない
- [ ] 他ページ（review / support / detail / input）の挙動に副作用が無いか軽く巡回

- [ ] **Step 4: ユーザーに dev 確認を依頼**

ユーザーに「dev で確認して、OK なら本番タグ付けする」と連絡。

- [ ] **Step 5: ユーザー承認後、本番タグ付け（別セッションで対応）**

承認後にタグ付け → 本番デプロイ。タグ名は既存命名規則に従う（例: `v1.x.0`）。

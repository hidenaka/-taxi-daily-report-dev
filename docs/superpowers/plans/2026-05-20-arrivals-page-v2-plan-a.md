# 到着便ページ v2 — Plan A 実装計画（Phase 1+2、日報repo）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** タクシー日報 到着便ページに、航空会社別の色分け＋ターミナル文字タグ・当日累計出庫台数・出発地別便集計セクションを追加する。

**Architecture:** 純関数（airline-color, aggregateByOrigin, computeAccumulatedTotal）をテスト駆動で実装し、既存 render 関数を最小侵襲で拡張する。新セクション `<section id="origin-summary">` をヒートマップと到着便リストの間に追加。既存データ（`tools/data/arrivals.json` と `tools/data/stall-actuals.json`）のみ使用し、Phase 3 の `stallCandidates` には依存しない。

**Tech Stack:** Vanilla JS (ES Modules), node:test, CSS variables

**作業 worktree:** `/Users/hideakimacbookair/Library/Mobile Documents/com~apple~CloudDocs/タクシー乗務アプリ/タクシー日報-wt-arrivals-v2` (branch: `feat/arrivals-page-v2`)

**仕様参照:** `docs/superpowers/specs/2026-05-20-arrivals-page-v2-design.md`

---

## File Structure

| ファイル | 役割 | 操作 |
|---|---|---|
| `tools/js/airline-color.js` | airline コード → 色キー の純関数 | 新規 |
| `tools/js/arrivals-render.js` | `renderFlightList` を拡張（左ボーダー色・ターミナルタグ）／ `renderOriginSummary` を追加 | 変更 |
| `tools/js/arrivals-data.js` | `aggregateByOrigin` を追加 | 変更 |
| `tools/js/arrivals-app.js` | `render()` で `renderOriginSummary` を呼ぶ | 変更 |
| `tools/js/forecast-section.js` | `computeAccumulatedTotal` を追加、`renderActualsMode` 拡張 | 変更 |
| `tools/arrivals.html` | 航空会社色 CSS変数、ターミナルタグ CSS、`<section id="origin-summary">` 追加、累計表示 CSS | 変更 |
| `tests/airline-color.test.js` | airline-color テスト | 新規 |
| `tests/arrivals-data.test.js` | `aggregateByOrigin` テスト追加 | 変更 |
| `tests/forecast-section.test.js` | `computeAccumulatedTotal` テスト追加 | 変更 |

---

## Task 1: airline-color 純関数

**Files:**
- Create: `tools/js/airline-color.js`
- Test: `tests/airline-color.test.js`

- [ ] **Step 1: Write the failing test**

`tests/airline-color.test.js` を作成:

```javascript
import { test, assert } from './run.js';
import { airlineToColorKey, AIRLINE_COLORS } from '../tools/js/airline-color.js';

test('airlineToColorKey: 主要キャリアを返す', () => {
  assert.equal(airlineToColorKey('JAL'), 'jal');
  assert.equal(airlineToColorKey('ANA'), 'ana');
  assert.equal(airlineToColorKey('JJP'), 'jjp');
  assert.equal(airlineToColorKey('SKY'), 'sky');
  assert.equal(airlineToColorKey('ADO'), 'ado');
  assert.equal(airlineToColorKey('SNA'), 'sna');
  assert.equal(airlineToColorKey('SFJ'), 'sfj');
});

test('airlineToColorKey: 未知のキャリアは other', () => {
  assert.equal(airlineToColorKey('XYZ'), 'other');
  assert.equal(airlineToColorKey(''), 'other');
  assert.equal(airlineToColorKey(null), 'other');
  assert.equal(airlineToColorKey(undefined), 'other');
});

test('AIRLINE_COLORS: 全キーに hex 色が定義されている', () => {
  for (const key of ['jal', 'ana', 'jjp', 'sky', 'ado', 'sna', 'sfj', 'other']) {
    assert.match(AIRLINE_COLORS[key], /^#[0-9a-f]{6}$/i, `${key} は hex 色`);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd "/Users/hideakimacbookair/Library/Mobile Documents/com~apple~CloudDocs/タクシー乗務アプリ/タクシー日報-wt-arrivals-v2"
node --test tests/airline-color.test.js
```

Expected: FAIL with "Cannot find module '../tools/js/airline-color.js'"

- [ ] **Step 3: Implement**

`tools/js/airline-color.js` を作成:

```javascript
// 航空会社コード（ODPT odpt:airline の末尾、例: 'JAL'/'ANA'/'JJP'/'SKY'/'ADO'/'SNA'/'SFJ'）から
// 色キー名を返す純関数と、色キー → hex 色のマップ。
//
// 色は各社のコーポレートカラーに寄せている。SFJ は黒だと背景に紛れるためグレー寄せ。

export const AIRLINE_COLORS = {
  jal:   '#e60012', // JAL 赤
  ana:   '#013193', // ANA 青
  jjp:   '#ff5e1f', // Jetstar 橙
  sky:   '#00b6f0', // Skymark 水
  ado:   '#4ea83a', // Air Do 緑
  sna:   '#f4cd00', // Solaseed 黄
  sfj:   '#4a4a4a', // StarFlyer 黒→グレー
  other: '#777777', // その他 灰
};

const KNOWN = new Set(['JAL', 'ANA', 'JJP', 'SKY', 'ADO', 'SNA', 'SFJ']);

export function airlineToColorKey(airline) {
  if (!airline || typeof airline !== 'string') return 'other';
  return KNOWN.has(airline) ? airline.toLowerCase() : 'other';
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
node --test tests/airline-color.test.js
```

Expected: PASS, all assertions ok.

- [ ] **Step 5: Commit**

```bash
git add tools/js/airline-color.js tests/airline-color.test.js
git commit -m "feat(arrivals): 航空会社→色キー の純関数 (airline-color)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 2: flight-row の左ボーダー色 + ターミナル文字タグ

**Files:**
- Modify: `tools/arrivals.html` (CSS 部分)
- Modify: `tools/js/arrivals-render.js` (`renderFlightList`)

CSS は手動目視のため、テスト無し。render は既存テストが無いため、本タスクではテスト追加せず（render の小さな拡張のみ）。

- [ ] **Step 1: CSS 変数と class を追加**

`tools/arrivals.html` の `<style>` 内、`.flight-row.is-delayed` のすぐ下に追記:

```css
/* 航空会社色（左ボーダー）。色 hex は tools/js/airline-color.js と同期 */
.flight-row.airline-jal   { border-left: 3px solid #e60012; padding-left: 7px; }
.flight-row.airline-ana   { border-left: 3px solid #013193; padding-left: 7px; }
.flight-row.airline-jjp   { border-left: 3px solid #ff5e1f; padding-left: 7px; }
.flight-row.airline-sky   { border-left: 3px solid #00b6f0; padding-left: 7px; }
.flight-row.airline-ado   { border-left: 3px solid #4ea83a; padding-left: 7px; }
.flight-row.airline-sna   { border-left: 3px solid #f4cd00; padding-left: 7px; }
.flight-row.airline-sfj   { border-left: 3px solid #4a4a4a; padding-left: 7px; }
.flight-row.airline-other { border-left: 3px solid #777777; padding-left: 7px; }

/* ターミナル文字タグ。色は会社色と衝突しない単色グレー */
.terminal-tag { display: inline-block; padding: 1px 6px; border-radius: 3px;
  background: rgba(255,255,255,0.08); color: var(--sub); font-size: 11px;
  font-weight: 600; margin-left: 6px; letter-spacing: 0.5px; }
```

- [ ] **Step 2: `renderFlightList` を拡張**

`tools/js/arrivals-render.js` の `renderFlightList` を以下に置き換える:

```javascript
export function renderFlightList(container, flights) {
  container.innerHTML = '';
  if (flights.length === 0) {
    container.innerHTML = '<div class="empty">表示可能な便がありません</div>';
    return;
  }
  for (const f of flights) {
    const row = document.createElement('div');
    const isDelayed = f.status === '遅延';
    const isUnknown = f.aircraftCode === null;
    const colorKey = airlineToColorKey(f.airline);
    row.className = 'flight-row'
      + ` airline-${colorKey}`
      + (isDelayed ? ' is-delayed' : '')
      + (isUnknown ? ' is-unknown' : '');
    const time = f.estimatedTime ?? f.scheduledTime ?? '--:--';
    const aircraft = f.aircraftCode ?? '機材不明';
    const hasPax = f.estimatedPax !== null && f.estimatedPax !== undefined;
    const hasSeats = f.seatCount !== null && f.seatCount !== undefined;
    const paxLine = hasPax
      ? `<span class="pax-est">推定搭乗 ${f.estimatedPax}人</span>`
        + (hasSeats ? `<span class="pax-max">（最大 ${f.seatCount}人）</span>` : '')
      : `<span class="pax-est">搭乗人数 推定不可</span>`;
    const statusIcon = isDelayed ? ' ⚠' : '';
    const reachIcon = f.reachTier === 'high' ? '🟢'
                    : f.reachTier === 'mid'  ? '🟡'
                    : f.reachTier === 'low'  ? '🟡'
                    : f.reachTier === 'none' ? '🔴'
                    : '';
    const delayBoostBadge = (f.taxiDelayBoost && f.taxiDelayBoost > 1.0)
      ? ` <span class="delay-boost">遅延+深夜</span>`
      : '';
    const lightningBadge = (f.taxiLightningBoost && f.taxiLightningBoost > 1.0)
      ? ` <span class="lightning-boost">⚡ラッシュ</span>`
      : '';
    const terminalTag = f.terminal ? `<span class="terminal-tag">${f.terminal}</span>` : '';
    row.innerHTML = `
      <div class="flight-line1">
        <span class="time">${time}</span>
        <span class="flight-no">${f.flightNumber}</span>
        <span class="from">${f.fromName}</span>
        <span class="reach">${reachIcon}</span>
        ${terminalTag}
      </div>
      <div class="flight-line2">${paxLine}</div>
      <div class="flight-line3">機材 ${aircraft} ・ <span class="status">${f.status}${statusIcon}${delayBoostBadge}${lightningBadge}</span></div>
    `;
    container.appendChild(row);
  }
}
```

ファイル先頭の import 行に `airlineToColorKey` を追加。ファイル冒頭を以下に変更:

```javascript
import { airlineToColorKey } from './airline-color.js';

const TIER_INFO = {
  high: { label: '多い', emoji: '🟥' },
  mid:  { label: '普通', emoji: '🟧' },
  low:  { label: '少ない', emoji: '🟦' }
};
```

- [ ] **Step 3: 全テストが通ることを確認**

```bash
npm test
```

Expected: 既存テストすべて PASS（renderFlightList は直接テストしないが import エラーが無いこと）

- [ ] **Step 4: 手動確認**

```bash
cd "/Users/hideakimacbookair/Library/Mobile Documents/com~apple~CloudDocs/タクシー乗務アプリ/タクシー日報-wt-arrivals-v2"
python3 -m http.server 8000 &
```

ブラウザで `http://localhost:8000/tools/arrivals.html` を開き、便リストの左に色ボーダーとターミナルタグ（T1/T2/T3）が表示されることを確認。確認後 `pkill -f "python3 -m http.server 8000"` で停止。

- [ ] **Step 5: Commit**

```bash
git add tools/arrivals.html tools/js/arrivals-render.js
git commit -m "feat(arrivals): 便リストに航空会社色ボーダーとターミナル文字タグを追加

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 3: computeAccumulatedTotal 純関数

**Files:**
- Modify: `tools/js/forecast-section.js` (関数 export 追加)
- Modify: `tests/forecast-section.test.js` (テスト追加)

- [ ] **Step 1: Write the failing test**

`tests/forecast-section.test.js` の末尾に以下を追記:

```javascript
import { computeAccumulatedTotal } from '../tools/js/forecast-section.js';

test('computeAccumulatedTotal: JST 5:00 以降の当日 slot の total を合計', () => {
  const now = new Date('2026-05-20T10:30:00+09:00');
  const slots = [
    { slotStart: '05:00', slotEnd: '05:15', total: 3 },
    { slotStart: '06:30', slotEnd: '06:45', total: 5 },
    { slotStart: '10:00', slotEnd: '10:15', total: 7 },
  ];
  assert.equal(computeAccumulatedTotal(slots, now), 15);
});

test('computeAccumulatedTotal: 5:00 より前のスロットは除外', () => {
  const now = new Date('2026-05-20T10:00:00+09:00');
  const slots = [
    { slotStart: '04:45', slotEnd: '05:00', total: 100 },
    { slotStart: '05:00', slotEnd: '05:15', total: 3 },
  ];
  assert.equal(computeAccumulatedTotal(slots, now), 3);
});

test('computeAccumulatedTotal: 空配列は 0', () => {
  const now = new Date('2026-05-20T10:00:00+09:00');
  assert.equal(computeAccumulatedTotal([], now), 0);
  assert.equal(computeAccumulatedTotal(null, now), 0);
  assert.equal(computeAccumulatedTotal(undefined, now), 0);
});

test('computeAccumulatedTotal: total が欠落しているスロットは 0 扱い', () => {
  const now = new Date('2026-05-20T10:00:00+09:00');
  const slots = [
    { slotStart: '05:00', slotEnd: '05:15' },           // total なし
    { slotStart: '06:00', slotEnd: '06:15', total: 4 },
  ];
  assert.equal(computeAccumulatedTotal(slots, now), 4);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node --test tests/forecast-section.test.js
```

Expected: FAIL with "computeAccumulatedTotal is not a function" or "is not exported".

- [ ] **Step 3: Implement**

`tools/js/forecast-section.js` の **`toMinutes` 関数の直後**（既存ファイル内、`toHHMM` の手前）に以下を追加:

```javascript
// 当日 JST 5:00 以降の出庫スロットの total を合計する純関数。
// stall-actuals.json は JST5時前を含まない想定だが、関数側でフィルタすることで
// 上流の挙動変化に依存しない。
export function computeAccumulatedTotal(slots, now) {
  if (!Array.isArray(slots) || slots.length === 0) return 0;
  return slots.reduce((sum, s) => {
    const minutes = toMinutes(s.slotStart);
    if (Number.isNaN(minutes) || minutes < 5 * 60) return sum;
    return sum + (s.total || 0);
  }, 0);
}
```

注: 関数は `now` を受け取るが現在の実装ではJSTの「当日」判定に使わない（`stall-actuals.json` は当日分のみ含む前提）。将来日跨ぎ運用時の拡張ポイントとして引数を残す。

- [ ] **Step 4: Run test to verify it passes**

```bash
node --test tests/forecast-section.test.js
```

Expected: PASS, all assertions ok.

- [ ] **Step 5: Commit**

```bash
git add tools/js/forecast-section.js tests/forecast-section.test.js
git commit -m "feat(arrivals): 当日累計出庫台数の純関数 computeAccumulatedTotal

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 4: 実績メタに当日累計を表示

**Files:**
- Modify: `tools/js/forecast-section.js` (`renderActualsMode`)

- [ ] **Step 1: `renderActualsMode` を拡張**

`tools/js/forecast-section.js` の `renderActualsMode` 関数を以下に置き換える（既存の関数全体を差し替え）:

```javascript
// 実績モードを描画する。
async function renderActualsMode(metaEl, tableEl) {
  const { data, error } = await loadActuals();
  if (error) {
    metaEl.textContent = `実績データを取得できていません（${error}）`;
    tableEl.innerHTML = '';
    return;
  }
  const ts = (data.generatedAt || '').slice(0, 16).replace('T', ' ');
  if (isStale(data.generatedAt, new Date(), STALE_MINUTES)) {
    metaEl.textContent = ts
      ? `実績データを取得できていません（最終 ${ts}）`
      : '実績データを取得できていません';
    tableEl.innerHTML = '';
    return;
  }
  const accum = computeAccumulatedTotal(data.slots, new Date());
  const tsPart = ts ? `実績 ${ts} 時点まで` : '';
  const accumPart = `JST 5:00 起点 累計 ${accum}台`;
  metaEl.textContent = tsPart ? `${tsPart}  /  ${accumPart}` : accumPart;
  tableEl.innerHTML = renderActualsTable(data.slots);
}
```

- [ ] **Step 2: テスト実行（既存テストの回帰確認）**

```bash
npm test
```

Expected: 全 PASS（既存テスト＋Task 3 のテスト）

- [ ] **Step 3: 手動確認**

`python3 -m http.server 8000` を起動し、`/tools/arrivals.html` を開く。`forecast-section` の `forecast-meta` に「実績 ... 時点まで / JST 5:00 起点 累計 N台」と表示されることを確認。

- [ ] **Step 4: Commit**

```bash
git add tools/js/forecast-section.js
git commit -m "feat(arrivals): 実績モードに JST 5:00 起点の当日累計出庫台数を表示

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 5: aggregateByOrigin 純関数

**Files:**
- Modify: `tools/js/arrivals-data.js` (関数 export 追加)
- Modify: `tests/arrivals-data.test.js` (テスト追加)

- [ ] **Step 1: Write the failing test**

`tests/arrivals-data.test.js` の末尾に以下を追記。すでにファイル先頭で import している `arrivals-data.js` の import 行に `aggregateByOrigin` を追加:

```javascript
import { aggregateByOrigin } from '../tools/js/arrivals-data.js';

test('aggregateByOrigin: fromName 単位で groupCount と totalEstimatedTaxiPax を集計', () => {
  const flights = [
    { fromName: '伊丹', estimatedTaxiPax: 8,  status: '到着' },
    { fromName: '伊丹', estimatedTaxiPax: 6,  status: '飛行中' },
    { fromName: '関空', estimatedTaxiPax: 4,  status: '飛行中' },
    { fromName: '札幌', estimatedTaxiPax: 10, status: '到着' },
  ];
  const result = aggregateByOrigin(flights);
  // 結果は totalEstimatedTaxiPax 降順
  assert.deepEqual(result, [
    { fromName: '札幌', flightCount: 1, totalEstimatedTaxiPax: 10 },
    { fromName: '伊丹', flightCount: 2, totalEstimatedTaxiPax: 14 },
    { fromName: '関空', flightCount: 1, totalEstimatedTaxiPax: 4 },
  ]);
});

test('aggregateByOrigin: 欠航便は除外', () => {
  const flights = [
    { fromName: '札幌', estimatedTaxiPax: 10, status: '到着' },
    { fromName: '札幌', estimatedTaxiPax: 5,  status: '欠航' },
  ];
  const result = aggregateByOrigin(flights);
  assert.deepEqual(result, [
    { fromName: '札幌', flightCount: 1, totalEstimatedTaxiPax: 10 },
  ]);
});

test('aggregateByOrigin: estimatedTaxiPax が null/undefined のものは 0 扱い', () => {
  const flights = [
    { fromName: '札幌', estimatedTaxiPax: null,      status: '到着' },
    { fromName: '札幌', estimatedTaxiPax: undefined, status: '到着' },
    { fromName: '札幌', estimatedTaxiPax: 7,         status: '到着' },
  ];
  const result = aggregateByOrigin(flights);
  assert.deepEqual(result, [
    { fromName: '札幌', flightCount: 3, totalEstimatedTaxiPax: 7 },
  ]);
});

test('aggregateByOrigin: fromName が無い便はスキップ', () => {
  const flights = [
    { fromName: '札幌', estimatedTaxiPax: 5, status: '到着' },
    { fromName: null,   estimatedTaxiPax: 3, status: '到着' },
    { estimatedTaxiPax: 2, status: '到着' },
  ];
  const result = aggregateByOrigin(flights);
  assert.deepEqual(result, [
    { fromName: '札幌', flightCount: 1, totalEstimatedTaxiPax: 5 },
  ]);
});

test('aggregateByOrigin: 空配列は空配列を返す', () => {
  assert.deepEqual(aggregateByOrigin([]), []);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node --test tests/arrivals-data.test.js
```

Expected: FAIL with "aggregateByOrigin is not exported".

- [ ] **Step 3: Implement**

`tools/js/arrivals-data.js` の末尾に以下を追記:

```javascript
// 当日全便を fromName 単位で集計し、totalEstimatedTaxiPax 降順で返す純関数。
// 欠航便・fromName 無し便は除外。estimatedTaxiPax の null/undefined は 0 扱い。
// 同点ソートは fromName 昇順で安定化させる。
export function aggregateByOrigin(flights) {
  if (!Array.isArray(flights) || flights.length === 0) return [];
  const map = new Map();
  for (const f of flights) {
    if (f.status === '欠航') continue;
    if (!f.fromName) continue;
    const key = f.fromName;
    if (!map.has(key)) {
      map.set(key, { fromName: key, flightCount: 0, totalEstimatedTaxiPax: 0 });
    }
    const g = map.get(key);
    g.flightCount += 1;
    g.totalEstimatedTaxiPax += (f.estimatedTaxiPax || 0);
  }
  return [...map.values()].sort((a, b) => {
    if (b.totalEstimatedTaxiPax !== a.totalEstimatedTaxiPax) {
      return b.totalEstimatedTaxiPax - a.totalEstimatedTaxiPax;
    }
    return a.fromName.localeCompare(b.fromName);
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
node --test tests/arrivals-data.test.js
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tools/js/arrivals-data.js tests/arrivals-data.test.js
git commit -m "feat(arrivals): 出発地別集計の純関数 aggregateByOrigin

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 6: 出発地別 UI セクション

**Files:**
- Modify: `tools/arrivals.html` (新セクション DOM + CSS)
- Modify: `tools/js/arrivals-render.js` (`renderOriginSummary` 新規)
- Modify: `tools/js/arrivals-app.js` (`render()` で呼ぶ)

- [ ] **Step 1: HTML 新セクション追加**

`tools/arrivals.html` の `<section>` で囲まれた `flight-list` の **直前**（heatmap セクションの直後）に以下を追加:

```html
  <section id="origin-summary-section">
    <h2>🛫 出発地別（今日 全便）</h2>
    <div id="origin-summary"></div>
  </section>
```

- [ ] **Step 2: CSS 追加**

`tools/arrivals.html` の `<style>` 内、既存 `#flight-list .flight-row` の手前に追加:

```css
#origin-summary-section { padding: 0 12px 8px; }
#origin-summary { display: flex; flex-direction: column; gap: 4px; }
#origin-summary .origin-row { display: grid; grid-template-columns: 1fr auto auto;
  gap: 8px; align-items: baseline; padding: 4px 0;
  border-bottom: 1px solid #1a1a1d; font-size: 13px; }
#origin-summary .origin-name { color: var(--fg); font-weight: 600; }
#origin-summary .origin-count { color: var(--sub); font-variant-numeric: tabular-nums; }
#origin-summary .origin-pax { color: var(--accent); font-variant-numeric: tabular-nums; font-weight: 600; }
#origin-summary .empty { color: var(--sub); font-size: 12px; padding: 8px 0; }
```

- [ ] **Step 3: `renderOriginSummary` を `arrivals-render.js` に追加**

`tools/js/arrivals-render.js` の末尾（`renderUpdatedAt` の後）に追加:

```javascript
// 出発地別集計の行リストを描画する。groups は totalEstimatedTaxiPax 降順前提。
export function renderOriginSummary(container, groups) {
  if (!container) return;
  container.innerHTML = '';
  if (!groups || groups.length === 0) {
    container.innerHTML = '<div class="empty">表示可能な集計がありません</div>';
    return;
  }
  for (const g of groups) {
    const row = document.createElement('div');
    row.className = 'origin-row';
    row.innerHTML = `
      <span class="origin-name">${g.fromName}</span>
      <span class="origin-count">${g.flightCount}便</span>
      <span class="origin-pax">推定タクシー客 ${g.totalEstimatedTaxiPax}人</span>
    `;
    container.appendChild(row);
  }
}
```

- [ ] **Step 4: `arrivals-app.js` を更新**

`tools/js/arrivals-app.js` の import 行と `render()` 関数を以下に置き換える:

import 行（ファイル最上部、既存 import 2行を以下に差し替え）:

```javascript
import { loadArrivals, filterByTerminals, filterByTimeWindow, aggregateHeatmapClient, summarizeFlights, detectTopics, sortFlightsByTime, aggregateByOrigin } from './arrivals-data.js';
import { renderHeatmap, renderFlightList, renderUpdatedAt, renderSummary, renderLegend, renderTopics, renderWeatherBanner, renderOriginSummary } from './arrivals-render.js';
```

`render()` 関数を以下に差し替え:

```javascript
function render() {
  const terminals = TAB_TERMINALS[state.tab] ?? ['T1'];
  const all = filterByTerminals(state.arrivals, terminals);
  const visible = state.detailMode ? all : filterByTimeWindow(all, new Date(), 30, 180);
  const bins = aggregateHeatmapClient(visible);
  const summaryOpts = state.detailMode
    ? { windowHours: 19, windowLabel: '今日全体' }
    : { windowHours: 3.5, windowLabel: '直近3時間' };
  const summary = summarizeFlights(visible, summaryOpts);
  const topics = detectTopics(all);
  const originGroups = aggregateByOrigin(all);
  renderWeatherBanner(document.getElementById('weather-banner'), state.arrivals.weather ?? null);
  renderTopics(document.getElementById('topics'), topics);
  renderSummary(document.getElementById('summary'), summary);
  renderHeatmap(document.getElementById('heatmap'), bins);
  renderOriginSummary(document.getElementById('origin-summary'), originGroups);
  renderFlightList(document.getElementById('flight-list'), sortFlightsByTime(visible));
  renderUpdatedAt(
    document.getElementById('arrivals-footer'),
    state.arrivals.updatedAt,
    state.arrivals.stats.unknownAircraft
  );
  document.querySelectorAll('.terminal-tab').forEach(el => {
    el.classList.toggle('is-active', el.dataset.terminal === state.tab);
  });
  updateDetailButton();
}
```

注: `aggregateByOrigin` には `all`（その時のターミナルタブで filterByTerminals した全便）を渡す。`visible` ではなく `all` を使うことで、ターミナル切替で集計範囲は変わるが、時間窓フィルターはかけない（仕様: 当日全便）。

- [ ] **Step 5: 全テストが PASS することを確認**

```bash
npm test
```

Expected: 全テスト PASS

- [ ] **Step 6: 手動確認**

```bash
python3 -m http.server 8000 &
```

ブラウザで `/tools/arrivals.html` を開き、ヒートマップ直下に「🛫 出発地別（今日 全便）」セクションが表示され、`大阪 N便 / 推定タクシー客 X人` の形式でリストが並ぶことを確認。降順ソートも確認。

- [ ] **Step 7: Commit**

```bash
git add tools/arrivals.html tools/js/arrivals-render.js tools/js/arrivals-app.js
git commit -m "feat(arrivals): 出発地別集計セクションを到着便ページに追加

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 7: 動作確認とDevプッシュ

**Files:** なし（運用タスク）

- [ ] **Step 1: 全テストPASS再確認**

```bash
cd "/Users/hideakimacbookair/Library/Mobile Documents/com~apple~CloudDocs/タクシー乗務アプリ/タクシー日報-wt-arrivals-v2"
npm test
```

Expected: 全テスト PASS

- [ ] **Step 2: ブラウザでDOMと表示確認**

`python3 -m http.server 8000` を起動、`/tools/arrivals.html` を開き、以下を確認:
- 便リストの左ボーダーが各社の色になっている（JAL赤、ANA青等）
- 便リスト各行の右側にターミナル文字タグ（T1/T2/T3）が表示される
- 実績モードの forecast-meta に「JST 5:00 起点 累計 N台」が表示される
- ヒートマップ直下に「🛫 出発地別（今日 全便）」セクションがあり、行が降順で並ぶ
- T1/T2/T1+T2/T3 タブを切り替えても各機能が正しく動く

確認終わったら `pkill -f "python3 -m http.server 8000"` で停止。

- [ ] **Step 3: dev push & ユーザー承認待ち**

```bash
git push -u dev feat/arrivals-page-v2
```

その後、ユーザーに dev 環境（taxi-daily-report-dev の GitHub Pages）で動作確認を依頼。OK出るまで本番反映しない。

- [ ] **Step 4: 本番反映（ユーザー承認後のみ）**

`deploy/arrivals-page-v2` ブランチを `origin/main` から作り、Plan A の全コミットを cherry-pick:

```bash
git fetch origin
git checkout -b deploy/arrivals-page-v2 origin/main
# Plan A の各コミット SHA を cherry-pick（feat/arrivals-page-v2 の log で確認）
git log feat/arrivals-page-v2 --oneline | head -10
# 例:
# git cherry-pick <sha1> <sha2> ...
git push origin deploy/arrivals-page-v2
```

GitHub UI で PR を作って `origin/main` にマージ、または直接 `git push origin deploy/arrivals-page-v2:main`。

完了後、Plan A 終了。Plan B（Phase 3a/3b/3c）の議論へ進む。

---

## Plan A 完了基準

- 全テスト PASS（既存テスト含む）
- 手動確認で 4機能（色分け・ターミナルタグ・累計・出発地別）が表示される
- dev 環境で動作確認済、ユーザー承認済
- 本番反映済

## 注意事項

- 既存テストファイル `tests/forecast-section.test.js` と `tests/arrivals-data.test.js` に**追記**する。既存テストは触らない
- `tools/arrivals.html` の CSS は既存スタイル定義を**削除しない**。新規追加のみ
- `arrivals-app.js` の `render()` を差し替える際、既存ロジック（`setInterval`, `setupTerminalTabs` 等）は触らない
- worktree 作業中に `git pull` をすると dev/main の更新が来る。relay コミットが頻繁に来るので、リベース時はコンフリクトに注意

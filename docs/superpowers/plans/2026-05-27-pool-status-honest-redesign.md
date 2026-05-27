# タクシープール現況UI 誠実再設計 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** カメラ検出の絶対値（在台・待ち目安・タクシー予想人数）をUIから廃止し、信頼度の高い指標（同条件過去比較・運航データの便リスト・乗り場間相対比較）に差し替える。

**Architecture:** ic-helperで `jp-holidays.json` と `holiday-context.mjs` を新設、`buildPoolStatus` に `activity.sameConditionCompare` / `stalls.*.rankHint` / `terminalArrivalsList` を追加（既存フィールドは後方互換のため残置）。日報UI側は `pool-status-section.js` を大幅改修し、絶対値表示を撤去して新3ブロック（今日の流れ／乗り場の動き／これからお客がロビーに出る便）に再構成する。

**Tech Stack:** Node.js ESM 純関数 + `node --test`。UIはvanilla JS module。Service Worker。

**2リポジトリ構成:**
- **Phase A** = `~/repos/taxi-ic-helper` branch `feat/pool-status`（テスト: `npm test`、ファイル `*.mjs`、テスト `tests/*.test.mjs`）
- **Phase B** = `~/work/taxi-dev-wt-pool-status` branch `feat/pool-status`（テスト: `npm test`、テスト `tests/*.test.js`、dev反映: `bash ~/work/taxi-dev-wt-pool-status/PUSH-genkyo.sh`）

**設計書**: `~/work/taxi-dev-wt-pool-status/docs/superpowers/specs/2026-05-27-pool-status-honest-redesign-design.md`

---

## File Structure

### Phase A — `~/repos/taxi-ic-helper`
- Create: `data/jp-holidays.json` — 2026年の日本祝日リスト
- Create: `scripts/lib/holiday-context.mjs` — `getDayContext(date, holidays)` 純関数
- Create: `tests/holiday-context.test.mjs` — 単体テスト
- Modify: `scripts/lib/pool-status.mjs` — `sameConditionCompare` / `buildStallRankHint` / `buildTerminalArrivalsList` 追加、`buildPoolStatus` 統合
- Modify: `tests/pool-status.test.mjs` — 新関数のテスト追加
- Modify: `scripts/publish-pool-status.mjs` — `jp-holidays.json` 読み込み配線

### Phase B — `~/work/taxi-dev-wt-pool-status`
- Modify: `tools/js/pool-status-section.js` — 純フォーマッタ新設＋render刷新
- Modify: `tools/arrivals.html` — 説明文ⓘ刷新、`#pool-status-occ` 削除
- Modify: `tests/pool-status-section.test.js` — 新フォーマッタのテスト
- Modify: `sw.js` — CACHE_NAME bump

---

# Phase A — ic-helper（データ生成）

> 作業ディレクトリ: `~/repos/taxi-ic-helper`。テスト実行: `cd ~/repos/taxi-ic-helper && npm test`

### Task A1: 日本祝日カレンダー投入

**Files:**
- Create: `~/repos/taxi-ic-helper/data/jp-holidays.json`

- [ ] **Step 1: 2026年の祝日JSONを投入**

Write to `~/repos/taxi-ic-helper/data/jp-holidays.json`:

```json
[
  { "date": "2026-01-01", "name": "元日" },
  { "date": "2026-01-12", "name": "成人の日" },
  { "date": "2026-02-11", "name": "建国記念の日" },
  { "date": "2026-02-23", "name": "天皇誕生日" },
  { "date": "2026-03-20", "name": "春分の日" },
  { "date": "2026-04-29", "name": "昭和の日" },
  { "date": "2026-05-03", "name": "憲法記念日" },
  { "date": "2026-05-04", "name": "みどりの日" },
  { "date": "2026-05-05", "name": "こどもの日" },
  { "date": "2026-05-06", "name": "振替休日" },
  { "date": "2026-07-20", "name": "海の日" },
  { "date": "2026-08-11", "name": "山の日" },
  { "date": "2026-09-21", "name": "敬老の日" },
  { "date": "2026-09-23", "name": "秋分の日" },
  { "date": "2026-10-12", "name": "スポーツの日" },
  { "date": "2026-11-03", "name": "文化の日" },
  { "date": "2026-11-23", "name": "勤労感謝の日" }
]
```

- [ ] **Step 2: 形式確認**

Run: `cd ~/repos/taxi-ic-helper && node -e "const h=require('./data/jp-holidays.json'); console.log('件数:', h.length, '/ 最初:', h[0], '/ 最後:', h[h.length-1])"`
Expected: `件数: 17 / 最初: { date: '2026-01-01', name: '元日' } / 最後: { date: '2026-11-23', name: '勤労感謝の日' }`

- [ ] **Step 3: コミット**

```bash
cd ~/repos/taxi-ic-helper
git add data/jp-holidays.json
git commit -m "data: 2026年日本祝日カレンダー投入（同条件比較用）"
```

---

### Task A2: holiday-context.mjs（曜日・祝日・連休判定）

**Files:**
- Create: `~/repos/taxi-ic-helper/scripts/lib/holiday-context.mjs`
- Test: `~/repos/taxi-ic-helper/tests/holiday-context.test.mjs`

- [ ] **Step 1: 失敗するテストを書く**

Write to `~/repos/taxi-ic-helper/tests/holiday-context.test.mjs`:

```js
import { test } from 'node:test';
import { strict as assert } from 'node:assert/strict';
import { getDayContext } from '../scripts/lib/holiday-context.mjs';

// テスト用祝日: 2026/05/03(憲法)/04(みどり)/05(こども)/06(振替) → 5/3〜5/6 が連休
const HOLIDAYS = [
  { date: '2026-05-03', name: '憲法記念日' },
  { date: '2026-05-04', name: 'みどりの日' },
  { date: '2026-05-05', name: 'こどもの日' },
  { date: '2026-05-06', name: '振替休日' },
  { date: '2026-02-11', name: '建国記念の日' }, // 単独祝日（前後平日）
];

test('getDayContext: 平日（火曜）', () => {
  const ctx = getDayContext(new Date('2026-05-12T12:00:00+09:00'), HOLIDAYS);
  assert.equal(ctx.weekday, 2);
  assert.equal(ctx.dayKind, 'weekday');
  assert.equal(ctx.dayLabel, '火曜平日');
});

test('getDayContext: 土曜（祝日でない）', () => {
  const ctx = getDayContext(new Date('2026-05-09T12:00:00+09:00'), HOLIDAYS);
  assert.equal(ctx.weekday, 6);
  assert.equal(ctx.dayKind, 'weekend');
  assert.equal(ctx.dayLabel, '土曜・週末');
});

test('getDayContext: 単独祝日（建国記念の日・水曜・前後平日）', () => {
  const ctx = getDayContext(new Date('2026-02-11T12:00:00+09:00'), HOLIDAYS);
  assert.equal(ctx.dayKind, 'holiday');
  assert.equal(ctx.dayLabel, '水曜・祝日');
});

test('getDayContext: 連休初日（5/3日曜・憲法記念日）', () => {
  const ctx = getDayContext(new Date('2026-05-03T12:00:00+09:00'), HOLIDAYS);
  assert.equal(ctx.dayKind, 'consecutive-first');
  assert.equal(ctx.dayLabel, '日曜・連休初日');
});

test('getDayContext: 連休中日（5/4月曜・みどりの日）', () => {
  const ctx = getDayContext(new Date('2026-05-04T12:00:00+09:00'), HOLIDAYS);
  assert.equal(ctx.dayKind, 'consecutive-middle');
  assert.equal(ctx.dayLabel, '月曜・連休中日');
});

test('getDayContext: 連休最終日（5/6水曜・振替休日）', () => {
  const ctx = getDayContext(new Date('2026-05-06T12:00:00+09:00'), HOLIDAYS);
  assert.equal(ctx.dayKind, 'consecutive-last');
  assert.equal(ctx.dayLabel, '水曜・連休最終日');
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd ~/repos/taxi-ic-helper && node --test tests/holiday-context.test.mjs`
Expected: FAIL — `Cannot find module '../scripts/lib/holiday-context.mjs'`

- [ ] **Step 3: 最小実装を書く**

Write to `~/repos/taxi-ic-helper/scripts/lib/holiday-context.mjs`:

```js
// 日付の文脈（曜日・祝日・連休位置）を判定する純関数。
// date は Date オブジェクト、holidays は [{date:"YYYY-MM-DD", name:"..."}, ...] 配列。

const WEEKDAY_JA = ['日', '月', '火', '水', '木', '金', '土'];

/** 日付を JST の "YYYY-MM-DD" 文字列に。 */
function toJstDateString(date) {
  const jst = new Date(date.getTime() + 9 * 3600 * 1000);
  const y = jst.getUTCFullYear();
  const m = String(jst.getUTCMonth() + 1).padStart(2, '0');
  const d = String(jst.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** date を1日加算した Date を返す（参照透過）。 */
function addDays(date, n) {
  return new Date(date.getTime() + n * 86400000);
}

/** "YYYY-MM-DD" が祝日リストに含まれるか。 */
function isHolidayDate(dateStr, holidays) {
  return holidays.some(h => h.date === dateStr);
}

/** JST 曜日番号（0=日..6=土）を返す。 */
function jstWeekday(date) {
  const jst = new Date(date.getTime() + 9 * 3600 * 1000);
  return jst.getUTCDay();
}

/** 「休み」= 祝日 or 土日。 */
function isOffDay(date, holidays) {
  const w = jstWeekday(date);
  if (w === 0 || w === 6) return true;
  return isHolidayDate(toJstDateString(date), holidays);
}

/** dayKind を判定する（weekday / weekend / holiday / consecutive-{first,middle,last}）。 */
function classifyDayKind(date, holidays) {
  const w = jstWeekday(date);
  const dateStr = toJstDateString(date);
  const isHol = isHolidayDate(dateStr, holidays);
  if (!isHol) {
    if (w === 0 || w === 6) return 'weekend';
    return 'weekday';
  }
  // 祝日: 前日・翌日が休みか見て連休判定
  const prevOff = isOffDay(addDays(date, -1), holidays);
  const nextOff = isOffDay(addDays(date, +1), holidays);
  if (prevOff && nextOff) return 'consecutive-middle';
  if (!prevOff && nextOff) return 'consecutive-first';
  if (prevOff && !nextOff) return 'consecutive-last';
  return 'holiday'; // 単独祝日
}

const KIND_LABEL = {
  weekday: '平日',
  weekend: '週末',
  holiday: '祝日',
  'consecutive-first': '連休初日',
  'consecutive-middle': '連休中日',
  'consecutive-last': '連休最終日',
};

/** 表示用ラベル "火曜平日" / "土曜・週末" / "水曜・連休最終日" 等。 */
function buildDayLabel(weekday, dayKind) {
  const wj = WEEKDAY_JA[weekday];
  const kj = KIND_LABEL[dayKind];
  if (dayKind === 'weekday') return `${wj}曜${kj}`; // 連結なし: 火曜平日
  return `${wj}曜・${kj}`; // ナカグロ付き: 土曜・週末、水曜・連休最終日
}

/** date の {weekday, dayKind, dayLabel} を返す。 */
export function getDayContext(date, holidays) {
  const weekday = jstWeekday(date);
  const dayKind = classifyDayKind(date, holidays);
  const dayLabel = buildDayLabel(weekday, dayKind);
  return { weekday, dayKind, dayLabel };
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `cd ~/repos/taxi-ic-helper && node --test tests/holiday-context.test.mjs`
Expected: PASS（6/6 tests）

- [ ] **Step 5: コミット**

```bash
cd ~/repos/taxi-ic-helper
git add scripts/lib/holiday-context.mjs tests/holiday-context.test.mjs
git commit -m "feat(holiday): 曜日×祝日×連休位置の判定純関数 getDayContext"
```

---

### Task A3: sameConditionCompare（同条件過去比較）

**Files:**
- Modify: `~/repos/taxi-ic-helper/scripts/lib/pool-status.mjs`
- Test: `~/repos/taxi-ic-helper/tests/pool-status.test.mjs`

- [ ] **Step 1: 失敗するテストを書く**

`tests/pool-status.test.mjs` の import 行に `sameConditionCompare` を追加し、ファイル末尾に追記:

```js
// (import に追加)
import { sameConditionCompare } from '../scripts/lib/pool-status.mjs';

const TEST_HOLIDAYS = [
  { date: '2026-05-03', name: '憲法記念日' },
  { date: '2026-05-04', name: 'みどりの日' },
  { date: '2026-05-05', name: 'こどもの日' },
  { date: '2026-05-06', name: '振替休日' },
];

function buildHistoryRows(daysAgoList, depPerHour) {
  // 過去 daysAgoList[i] 日前の 12:00 JST の前後1h分、深さ depPerHour の出庫が発生するように
  // 在台が depPerHour 台減るような行を1分毎に生成する。簡略のため、まず full 在台 で開始し、
  // 終端で depPerHour 台減らす。
  const rows = [];
  for (const d of daysAgoList) {
    const targetBase = Date.parse('2026-05-12T12:00:00+09:00') - d * 86400000;
    // 11:00〜12:00 の60分間、毎分1tick。在台が depPerHour 台減るよう線形に減少
    const startOcc = 30;
    const endOcc = 30 - depPerHour;
    for (let i = 0; i <= 60; i++) {
      const ts = new Date(targetBase - (60 - i) * 60000).toISOString();
      const occ = Math.max(0, Math.round(startOcc - (startOcc - endOcc) * (i / 60)));
      rows.push({ ts, mode: 'day', stalls: {
        stall1: { occ }, stall2: { occ: 0 }, stall3: { occ: 0 }, stall4: { occ: 0 }, stall4_back: { occ: 0 }
      }});
    }
  }
  return rows;
}

test('sameConditionCompare: 同曜日(火)平日のサンプル3つ以上で percent と label が出る', () => {
  // 2026-05-12(火)平日。過去同曜日: 5/5(火・連休最終)→除外, 4/28(火)・5/5除外/ → ここでは4/28, 4/21, 4/14, 4/7 を生成
  const now = new Date('2026-05-12T12:00:00+09:00');
  // 過去4週の火曜(全て平日): 5/5は祝日なので除外 → 使うのは 4/28, 4/21, 4/14
  // 全部 8台/h で安定 → today=12 なら +50%, today=4 なら -50%, today=8 なら 0%
  const past = buildHistoryRows([7 * 1, 7 * 2, 7 * 3], 8); // 1,2,3週前の火曜
  const today = buildHistoryRows([0], 12);
  const r = sameConditionCompare([...past, ...today], now, TEST_HOLIDAYS);
  assert.equal(r.peers_typical, 8);
  assert.equal(r.percent, 50);
  assert.equal(r.label, 'いつもより活発');
  assert.equal(r.dayLabel, '火曜平日');
});

test('sameConditionCompare: percentがしきい値以内なら "いつも通り"', () => {
  const now = new Date('2026-05-12T12:00:00+09:00');
  const past = buildHistoryRows([7, 14, 21], 10);
  const today = buildHistoryRows([0], 11); // +10%
  const r = sameConditionCompare([...past, ...today], now, TEST_HOLIDAYS);
  assert.equal(r.label, 'いつも通り');
});

test('sameConditionCompare: -15%以下で "いつもより少なめ"', () => {
  const now = new Date('2026-05-12T12:00:00+09:00');
  const past = buildHistoryRows([7, 14, 21], 10);
  const today = buildHistoryRows([0], 8); // -20%
  const r = sameConditionCompare([...past, ...today], now, TEST_HOLIDAYS);
  assert.equal(r.label, 'いつもより少なめ');
});

test('sameConditionCompare: サンプル不足(<3)は fallback (label=null, percent=null)', () => {
  const now = new Date('2026-05-12T12:00:00+09:00');
  const past = buildHistoryRows([7, 14], 10); // 2サンプルしかない
  const today = buildHistoryRows([0], 12);
  const r = sameConditionCompare([...past, ...today], now, TEST_HOLIDAYS);
  assert.equal(r.peers_typical, null);
  assert.equal(r.percent, null);
  assert.equal(r.label, null);
  assert.equal(r.dayLabel, '火曜平日'); // dayLabel は常に返す
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd ~/repos/taxi-ic-helper && node --test tests/pool-status.test.mjs`
Expected: FAIL — `sameConditionCompare is not a function` または import エラー

- [ ] **Step 3: 最小実装を書く**

`scripts/lib/pool-status.mjs` の先頭付近の `import { computeSlotActuals }` の直後に追記:

```js
import { getDayContext } from './holiday-context.mjs';
```

`typical1hDepartures` の直後（既存）に追記:

```js
/** rows から指定 Date の直近1h出庫合計を返す（computeSlotActuals total の合算）。 */
function recent1hAt(rows, atDate) {
  return computeSlotActuals(rows, atDate, 60).reduce((s, b) => s + b.total, 0);
}

/** 過去 weeks 週間の同(weekday, dayKind)の同時間帯サンプルから median を取る。 */
export function sameConditionCompare(rows, now, holidays, weeks = 4) {
  const today = getDayContext(now, holidays);
  const today1h = recent1hAt(rows, now);
  const samples = [];
  for (let w = 1; w <= weeks; w++) {
    const past = new Date(now.getTime() - w * 7 * 86400000);
    const ctx = getDayContext(past, holidays);
    if (ctx.weekday !== today.weekday) continue; // 念のため
    if (ctx.dayKind !== today.dayKind) continue;
    samples.push(recent1hAt(rows, past));
  }
  if (samples.length < 3) {
    return { peers_typical: null, percent: null, label: null, dayLabel: today.dayLabel };
  }
  samples.sort((a, b) => a - b);
  const m = Math.floor(samples.length / 2);
  const peers_typical = samples.length % 2 ? samples[m] : Math.round((samples[m - 1] + samples[m]) / 2);
  if (!(peers_typical > 0)) {
    return { peers_typical, percent: null, label: null, dayLabel: today.dayLabel };
  }
  const percent = Math.round((today1h / peers_typical - 1) * 100);
  let label;
  if (percent >= 15) label = 'いつもより活発';
  else if (percent <= -15) label = 'いつもより少なめ';
  else label = 'いつも通り';
  return { peers_typical, percent, label, dayLabel: today.dayLabel };
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `cd ~/repos/taxi-ic-helper && node --test tests/pool-status.test.mjs`
Expected: PASS（既存テスト全部＋新4テスト）

- [ ] **Step 5: コミット**

```bash
cd ~/repos/taxi-ic-helper
git add scripts/lib/pool-status.mjs tests/pool-status.test.mjs
git commit -m "feat(pool-status): 同条件過去比較 sameConditionCompare（同曜日×祝日連休フラグ）"
```

---

### Task A4: buildStallRankHint（乗り場間相対順位）

**Files:**
- Modify: `~/repos/taxi-ic-helper/scripts/lib/pool-status.mjs`
- Test: `~/repos/taxi-ic-helper/tests/pool-status.test.mjs`

- [ ] **Step 1: 失敗するテストを書く**

`tests/pool-status.test.mjs` import 追加:

```js
import { buildStallRankHint } from '../scripts/lib/pool-status.mjs';
```

末尾追記:

```js
test('buildStallRankHint: 最大に most-active、最小に most-low', () => {
  const stalls = {
    stall1: { recent1hDep: 10 },
    stall2: { recent1hDep: 25 },
    stall3: { recent1hDep: 5 },
    stall4: { recent1hDep: 15 },
  };
  const h = buildStallRankHint(stalls);
  assert.equal(h.stall1, null);
  assert.equal(h.stall2, 'most-active');
  assert.equal(h.stall3, 'most-low');
  assert.equal(h.stall4, null);
});

test('buildStallRankHint: 全て0なら全て null', () => {
  const stalls = {
    stall1: { recent1hDep: 0 }, stall2: { recent1hDep: 0 },
    stall3: { recent1hDep: 0 }, stall4: { recent1hDep: 0 },
  };
  const h = buildStallRankHint(stalls);
  assert.deepEqual(h, { stall1: null, stall2: null, stall3: null, stall4: null });
});

test('buildStallRankHint: 同率最大は全部 most-active', () => {
  const stalls = {
    stall1: { recent1hDep: 10 }, stall2: { recent1hDep: 10 },
    stall3: { recent1hDep: 5 }, stall4: { recent1hDep: 8 },
  };
  const h = buildStallRankHint(stalls);
  assert.equal(h.stall1, 'most-active');
  assert.equal(h.stall2, 'most-active');
  assert.equal(h.stall3, 'most-low');
  assert.equal(h.stall4, null);
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd ~/repos/taxi-ic-helper && node --test tests/pool-status.test.mjs`
Expected: FAIL — `buildStallRankHint is not a function`

- [ ] **Step 3: 最小実装**

`scripts/lib/pool-status.mjs` の `buildStalls` の直前（または直後）に追記:

```js
/** 乗り場間の recent1hDep を比較し、最大に 'most-active' / 最小に 'most-low' / 他 null を付与。
 * 全て0なら全て null。同率は同じヒントが複数の乗り場に付く。 */
export function buildStallRankHint(stalls) {
  const out = { stall1: null, stall2: null, stall3: null, stall4: null };
  const deps = Object.keys(out).map(k => ({ k, v: stalls[k]?.recent1hDep ?? 0 }));
  const max = Math.max(...deps.map(d => d.v));
  const min = Math.min(...deps.map(d => d.v));
  if (max === 0) return out; // 全部0
  for (const { k, v } of deps) {
    if (v === max && v > 0) out[k] = 'most-active';
    else if (v === min) out[k] = 'most-low';
  }
  return out;
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `cd ~/repos/taxi-ic-helper && node --test tests/pool-status.test.mjs`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
cd ~/repos/taxi-ic-helper
git add scripts/lib/pool-status.mjs tests/pool-status.test.mjs
git commit -m "feat(pool-status): 乗り場間相対順位 buildStallRankHint"
```

---

### Task A5: buildTerminalArrivalsList（便リスト）

**Files:**
- Modify: `~/repos/taxi-ic-helper/scripts/lib/pool-status.mjs`
- Test: `~/repos/taxi-ic-helper/tests/pool-status.test.mjs`

- [ ] **Step 1: 失敗するテストを書く**

`tests/pool-status.test.mjs` import 追加:

```js
import { buildTerminalArrivalsList } from '../scripts/lib/pool-status.mjs';
```

末尾追記:

```js
test('buildTerminalArrivalsList: T1/T2のlobbyExitTime順、各最大5便、T3除外、過去・60分超は除外', () => {
  const now = new Date(Date.parse('2026-05-25T12:00:00+09:00'));
  const arrivals = { flights: [
    { terminal: 'T1', flightNumber: 'JL024', airline: 'JAL', fromName: '関西', seatCount: 244, lobbyExitTime: '12:10' },
    { terminal: 'T1', flightNumber: 'JL026', airline: 'JAL', fromName: '福岡', seatCount: 322, lobbyExitTime: '12:45' },
    { terminal: 'T2', flightNumber: 'NH032', airline: 'ANA', fromName: '新千歳', seatCount: 195, lobbyExitTime: '12:08' },
    { terminal: 'T3', flightNumber: 'JL001', airline: 'JAL', fromName: 'SFO', seatCount: 244, lobbyExitTime: '12:15' }, // 除外
    { terminal: 'T1', flightNumber: 'JL022', airline: 'JAL', fromName: '伊丹', seatCount: 244, lobbyExitTime: '11:55' }, // 過去
    { terminal: 'T2', flightNumber: 'NH128', airline: 'ANA', fromName: '那覇', seatCount: 381, lobbyExitTime: '13:30' }, // 60分超
  ] };
  const r = buildTerminalArrivalsList(arrivals, now);
  assert.equal(r.T1.length, 2);
  assert.equal(r.T1[0].flightNumber, 'JL024');
  assert.equal(r.T1[0].lobbyExitMinutes, 10);
  assert.equal(r.T1[0].fromName, '関西');
  assert.equal(r.T1[0].seatCount, 244);
  assert.equal(r.T1[0].lobbyExitTime, '12:10');
  assert.equal(r.T1[1].flightNumber, 'JL026');
  assert.equal(r.T2.length, 1);
  assert.equal(r.T2[0].flightNumber, 'NH032');
});

test('buildTerminalArrivalsList: 各ターミナル最大5便（6便目は捨てる）', () => {
  const now = new Date(Date.parse('2026-05-25T12:00:00+09:00'));
  const flights = [];
  for (let i = 0; i < 7; i++) {
    flights.push({ terminal: 'T1', flightNumber: `JL10${i}`, airline: 'JAL', fromName: '伊丹', seatCount: 244, lobbyExitTime: `12:${String(5 + i * 5).padStart(2, '0')}` });
  }
  const r = buildTerminalArrivalsList({ flights }, now);
  assert.equal(r.T1.length, 5);
  assert.equal(r.T1[4].flightNumber, 'JL104');
});

test('buildTerminalArrivalsList: flights 無し/null は空配列', () => {
  const now = new Date(Date.parse('2026-05-25T12:00:00+09:00'));
  assert.deepEqual(buildTerminalArrivalsList(null, now), { T1: [], T2: [] });
  assert.deepEqual(buildTerminalArrivalsList({ flights: [] }, now), { T1: [], T2: [] });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd ~/repos/taxi-ic-helper && node --test tests/pool-status.test.mjs`
Expected: FAIL — `buildTerminalArrivalsList is not a function`

- [ ] **Step 3: 最小実装**

`scripts/lib/pool-status.mjs` の既存 `buildTerminalArrivals` の直後に追記:

```js
/** 各ターミナル(T1/T2)の今後60分以内に lobbyExit を迎える便を最大5件返す。
 * 過去便・60分超・T3は除外。並び: lobbyExitMinutes 昇順、同値時 flightNumber 順。 */
export function buildTerminalArrivalsList(arrivals, now) {
  const out = { T1: [], T2: [] };
  const flights = arrivals?.flights ?? [];
  const nowMs = now.getTime();
  const ms60 = nowMs + 60 * 60000;
  for (const f of flights) {
    const t = f.terminal;
    if (t !== 'T1' && t !== 'T2') continue;
    const d = lobbyExitDate(f.lobbyExitTime, now);
    if (!d) continue;
    const ms = d.getTime();
    if (ms <= nowMs || ms > ms60) continue;
    const lobbyExitMinutes = Math.round((ms - nowMs) / 60000);
    out[t].push({
      flightNumber: f.flightNumber,
      airline: f.airline,
      fromName: f.fromName,
      seatCount: f.seatCount,
      lobbyExitMinutes,
      lobbyExitTime: f.lobbyExitTime,
    });
  }
  for (const t of ['T1', 'T2']) {
    out[t].sort((a, b) => a.lobbyExitMinutes - b.lobbyExitMinutes || a.flightNumber.localeCompare(b.flightNumber));
    out[t] = out[t].slice(0, 5);
  }
  return out;
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `cd ~/repos/taxi-ic-helper && node --test tests/pool-status.test.mjs`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
cd ~/repos/taxi-ic-helper
git add scripts/lib/pool-status.mjs tests/pool-status.test.mjs
git commit -m "feat(pool-status): 便リスト buildTerminalArrivalsList（運航データ直送・最大5便/T）"
```

---

### Task A6: buildPoolStatus 統合（後方互換）

**Files:**
- Modify: `~/repos/taxi-ic-helper/scripts/lib/pool-status.mjs`
- Test: `~/repos/taxi-ic-helper/tests/pool-status.test.mjs`

- [ ] **Step 1: 失敗するテストを書く**

`tests/pool-status.test.mjs` 末尾追記:

```js
test('buildPoolStatus: 新フィールド統合（後方互換も維持）', () => {
  const base = Date.parse('2026-05-12T12:00:00+09:00');
  const rows = [];
  for (let i = 0; i < 20; i++) rows.push(occRow(new Date(base + i * 30000).toISOString(), 12, 10, 14, 4, 8));
  const arrivals = { flights: [
    { terminal: 'T1', flightNumber: 'JL024', airline: 'JAL', fromName: '関西', seatCount: 244, lobbyExitTime: '12:10' },
  ] };
  const st = buildPoolStatus(rows, new Date(base + 20 * 30000), arrivals, TEST_HOLIDAYS);
  // 既存フィールド維持
  assert.ok(st.cameras);
  assert.ok(st.total);
  assert.ok(st.activity);
  assert.ok(st.stalls);
  assert.ok(st.terminalArrivals); // 既存・後方互換
  // 新フィールド
  assert.ok('sameConditionCompare' in st.activity);
  assert.equal(typeof st.stalls.stall1.rankHint, 'object'); // null or string
  assert.ok(Array.isArray(st.terminalArrivalsList.T1));
  assert.equal(st.terminalArrivalsList.T1[0].flightNumber, 'JL024');
});

test('buildPoolStatus: holidays 省略時も sameConditionCompare は null fallback', () => {
  const base = Date.parse('2026-05-12T12:00:00+09:00');
  const rows = [];
  for (let i = 0; i < 20; i++) rows.push(occRow(new Date(base + i * 30000).toISOString(), 12, 10, 14, 4, 8));
  const st = buildPoolStatus(rows, new Date(base + 20 * 30000)); // arrivals/holidays 省略
  assert.equal(st.activity.sameConditionCompare, null);
  assert.equal(st.terminalArrivals, null);
  assert.deepEqual(st.terminalArrivalsList, { T1: [], T2: [] });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd ~/repos/taxi-ic-helper && node --test tests/pool-status.test.mjs`
Expected: FAIL — `st.terminalArrivalsList is undefined` 等

- [ ] **Step 3: 最小実装**

`scripts/lib/pool-status.mjs` の `buildPoolStatus` シグネチャと return を次に置き換え:

```js
export function buildPoolStatus(rows, now = new Date(), arrivals = null, holidays = null) {
```

return 直前で stalls に rankHint を付与し、return オブジェクトに新フィールドを追加。既存 `buildStalls(rows, now)` の戻り値をそのまま return せず、rankHint をマージする。具体的には:

```js
  const stallsBase = buildStalls(rows, now);
  const rankHints = buildStallRankHint(stallsBase);
  const stalls = {};
  for (const k of ['stall1', 'stall2', 'stall3', 'stall4']) {
    stalls[k] = { ...stallsBase[k], rankHint: rankHints[k] };
  }
  const sameCompare = holidays ? sameConditionCompare(rows, now, holidays) : null;
  return {
    generatedAt: jstIso(now),
    cameras,
    total: { occ: totalOcc, level: occLevel(totalOcc, totalRef) },
    activity: {
      recent1hDepartures: recent,
      typical1h: typical,
      ratio: act.ratio,
      level: act.level,
      arrow: act.arrow,
      sameConditionCompare: sameCompare,
    },
    stalls,
    terminalArrivals: arrivals ? buildTerminalArrivals(arrivals, now) : null,
    terminalArrivalsList: buildTerminalArrivalsList(arrivals, now),
  };
```

- [ ] **Step 4: テストが通ることを確認**

Run: `cd ~/repos/taxi-ic-helper && npm test`
Expected: PASS（全テスト緑、既存テストも壊れない）

- [ ] **Step 5: コミット**

```bash
cd ~/repos/taxi-ic-helper
git add scripts/lib/pool-status.mjs tests/pool-status.test.mjs
git commit -m "feat(pool-status): buildPoolStatus に rankHint/sameConditionCompare/terminalArrivalsList 統合（後方互換）"
```

---

### Task A7: publish-pool-status.mjs に holidays 配線

**Files:**
- Modify: `~/repos/taxi-ic-helper/scripts/publish-pool-status.mjs`

- [ ] **Step 1: 実装（TDD対象外、I/O配線）**

`scripts/publish-pool-status.mjs` の `main()` 内 `const status = buildPoolStatus(rows, new Date(), arrivals);` 周辺を次に置き換える:

```js
        let arrivals = null;
        try {
          if (existsSync('./data/arrivals.json')) {
            arrivals = JSON.parse(readFileSync('./data/arrivals.json', 'utf8'));
          }
        } catch (e) { console.error(`[pool-status] arrivals read failed: ${e.message}`); }
        let holidays = null;
        try {
          if (existsSync('./data/jp-holidays.json')) {
            holidays = JSON.parse(readFileSync('./data/jp-holidays.json', 'utf8'));
          }
        } catch (e) { console.error(`[pool-status] holidays read failed: ${e.message}`); }
        const status = buildPoolStatus(rows, new Date(), arrivals, holidays);
```

- [ ] **Step 2: 実データで生成して新フィールドを確認**

Run:
```bash
cd ~/repos/taxi-ic-helper && node scripts/publish-pool-status.mjs
node -e "
const s = require('./data/pool-status.json');
console.log('sameConditionCompare:', JSON.stringify(s.activity.sameConditionCompare));
console.log('stall1.rankHint:', s.stalls.stall1.rankHint);
console.log('terminalArrivalsList.T1[0]:', JSON.stringify(s.terminalArrivalsList.T1[0]));
"
```
Expected: `sameConditionCompare` が `{peers_typical, percent, label, dayLabel}` 形式、`rankHint` が `'most-active'|'most-low'|null` のいずれか、`terminalArrivalsList.T1[0]` に `flightNumber, fromName, seatCount, lobbyExitMinutes` フィールド。

- [ ] **Step 3: コミット**

```bash
cd ~/repos/taxi-ic-helper
git add scripts/publish-pool-status.mjs data/pool-status.json
git commit -m "feat(pool-status): publish が jp-holidays.json を読み新フィールドを出力"
```

> **Phase A 完了**。ic-helper feat/pool-status に7コミット。Phase B（UI）に進む。Phase Cの Mac mini への反映は Phase B 完了後にまとめて。

---

# Phase B — 日報UI（pool-status-section.js / arrivals.html）

> 作業ディレクトリ: `~/work/taxi-dev-wt-pool-status`。テスト実行: `cd ~/work/taxi-dev-wt-pool-status && npm test`

### Task B1: formatActivityLine（今日の流れ＋同条件比較）

**Files:**
- Modify: `~/work/taxi-dev-wt-pool-status/tools/js/pool-status-section.js`
- Test: `~/work/taxi-dev-wt-pool-status/tests/pool-status-section.test.js`

- [ ] **Step 1: 失敗するテストを書く**

`tests/pool-status-section.test.js` の import 行を次に置き換え:

```js
import { levelText, levelDots, activityText, isStale, waitText, trendText, formatStallLine, formatTerminalArrivals, formatActivityLine, formatStallLineV2, formatArrivalsList } from '../tools/js/pool-status-section.js';
```

末尾追記:

```js
test('formatActivityLine: 同条件比較あり', async () => {
  const activity = {
    recent1hDepartures: 59, typical1h: 52, ratio: 1.13, level: 'normal', arrow: 'flat',
    sameConditionCompare: { peers_typical: 47, percent: 26, label: 'いつもより活発', dayLabel: '火曜平日' },
  };
  assert.equal(formatActivityLine(activity), 'いつもより活発↑ （火曜平日 同時間帯比 +26%）');
});

test('formatActivityLine: 同条件比較サンプル不足は活発度のみ', async () => {
  const activity = {
    recent1hDepartures: 59, typical1h: 52, ratio: 1.13, level: 'normal', arrow: 'flat',
    sameConditionCompare: { peers_typical: null, percent: null, label: null, dayLabel: '火曜平日' },
  };
  assert.equal(formatActivityLine(activity), '平常→ （火曜平日 同時間帯のサンプル不足）');
});

test('formatActivityLine: sameConditionCompare 未提供（旧データ）は活発度のみ', async () => {
  const activity = { recent1hDepartures: 59, typical1h: 52, ratio: 1.13, level: 'normal', arrow: 'flat' };
  assert.equal(formatActivityLine(activity), '平常→');
});

test('formatActivityLine: percentがマイナスは符号付き', async () => {
  const activity = {
    sameConditionCompare: { peers_typical: 50, percent: -20, label: 'いつもより少なめ', dayLabel: '日曜・週末' },
    level: 'low', arrow: 'down',
  };
  assert.equal(formatActivityLine(activity), 'いつもより少なめ↓ （日曜・週末 同時間帯比 -20%）');
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd ~/work/taxi-dev-wt-pool-status && node --test tests/pool-status-section.test.js`
Expected: FAIL — `formatActivityLine is not a function`

- [ ] **Step 3: 最小実装**

`tools/js/pool-status-section.js` の `activityText` の直後に追記:

```js
const ARROW_JA = { up: '↑', flat: '→', down: '↓' };

/** activity から「いつもより活発↑ （火曜平日 同時間帯比 +13%）」形式の1行を構築。
 * sameConditionCompare が無い/サンプル不足のときは活発度（active/normal/low + arrow）のみ。 */
export function formatActivityLine(activity) {
  if (!activity) return '—';
  const arrow = ARROW_JA[activity.arrow] || '';
  const sc = activity.sameConditionCompare;
  if (sc && typeof sc.percent === 'number' && sc.label) {
    const sign = sc.percent >= 0 ? '+' : '';
    return `${sc.label}${arrow} （${sc.dayLabel} 同時間帯比 ${sign}${sc.percent}%）`;
  }
  const activeLabel = { active: '活発', normal: '平常', low: '少なめ' }[activity.level] || '—';
  if (sc && sc.dayLabel) {
    return `${activeLabel}${arrow} （${sc.dayLabel} 同時間帯のサンプル不足）`;
  }
  return `${activeLabel}${arrow}`;
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `cd ~/work/taxi-dev-wt-pool-status && node --test tests/pool-status-section.test.js`
Expected: PASS（既存3テスト + 新4テスト = 7テスト緑）

- [ ] **Step 5: コミット**

```bash
cd ~/work/taxi-dev-wt-pool-status
git add tools/js/pool-status-section.js tests/pool-status-section.test.js
git commit -m "feat(pool-status): formatActivityLine 同条件過去比較を1行表示"
```

---

### Task B2: formatStallLineV2（trend + rankHint・在台廃止）

**Files:**
- Modify: `~/work/taxi-dev-wt-pool-status/tools/js/pool-status-section.js`
- Test: `~/work/taxi-dev-wt-pool-status/tests/pool-status-section.test.js`

- [ ] **Step 1: 失敗するテストを書く**

`tests/pool-status-section.test.js` 末尾追記:

```js
test('formatStallLineV2: trend のみ', async () => {
  assert.equal(
    formatStallLineV2({ label: '第1乗り場', trend: 'down', rankHint: null }),
    '第1乗り場  少なめ↓'
  );
});

test('formatStallLineV2: trend + most-active', async () => {
  assert.equal(
    formatStallLineV2({ label: '第3乗り場', trend: 'up', rankHint: 'most-active' }),
    '第3乗り場  活発↑ ← 最も動き活発'
  );
});

test('formatStallLineV2: trend + most-low', async () => {
  assert.equal(
    formatStallLineV2({ label: '第4乗り場', trend: 'flat', rankHint: 'most-low' }),
    '第4乗り場  横ばい→ ← 最も動き少なめ'
  );
});

test('formatStallLineV2: trend 未定義は —', async () => {
  assert.equal(
    formatStallLineV2({ label: '第2乗り場' }),
    '第2乗り場  —'
  );
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd ~/work/taxi-dev-wt-pool-status && node --test tests/pool-status-section.test.js`
Expected: FAIL — `formatStallLineV2 is not a function`

- [ ] **Step 3: 最小実装**

`tools/js/pool-status-section.js` の `formatStallLine` の直後に追記:

```js
const RANK_HINT_JA = {
  'most-active': '← 最も動き活発',
  'most-low': '← 最も動き少なめ',
};

/** 乗り場1行（V2: 在台/待ち目安を出さず trend + rankHint のみ）。 */
export function formatStallLineV2(stall) {
  if (!stall) return '';
  const trend = stall.trend ? trendText(stall.trend) : '—';
  const hint = stall.rankHint ? ' ' + RANK_HINT_JA[stall.rankHint] : '';
  return `${stall.label}  ${trend}${hint}`;
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `cd ~/work/taxi-dev-wt-pool-status && node --test tests/pool-status-section.test.js`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
cd ~/work/taxi-dev-wt-pool-status
git add tools/js/pool-status-section.js tests/pool-status-section.test.js
git commit -m "feat(pool-status): formatStallLineV2 = trend + rankHint（絶対値・待ち目安廃止）"
```

---

### Task B3: formatArrivalsList（便リスト構築）

**Files:**
- Modify: `~/work/taxi-dev-wt-pool-status/tools/js/pool-status-section.js`
- Test: `~/work/taxi-dev-wt-pool-status/tests/pool-status-section.test.js`

- [ ] **Step 1: 失敗するテストを書く**

`tests/pool-status-section.test.js` 末尾追記:

```js
test('formatArrivalsList: T1/T2 順、便ごと1行', async () => {
  const list = {
    T1: [
      { flightNumber: 'JL024', airline: 'JAL', fromName: '関西', seatCount: 244, lobbyExitMinutes: 10 },
      { flightNumber: 'JL026', airline: 'JAL', fromName: '福岡', seatCount: 322, lobbyExitMinutes: 28 },
    ],
    T2: [
      { flightNumber: 'NH032', airline: 'ANA', fromName: '新千歳', seatCount: 195, lobbyExitMinutes: 8 },
    ],
  };
  const lines = formatArrivalsList(list);
  assert.deepEqual(lines, [
    'T1 (JAL)',
    '  あと10分  JL024  関西から     244席',
    '  あと28分  JL026  福岡から     322席',
    'T2 (ANA)',
    '  あと08分  NH032  新千歳から   195席',
  ]);
});

test('formatArrivalsList: 片側空ならその見出しは出さない', async () => {
  const list = { T1: [], T2: [{ flightNumber: 'NH032', airline: 'ANA', fromName: '新千歳', seatCount: 195, lobbyExitMinutes: 8 }] };
  const lines = formatArrivalsList(list);
  assert.deepEqual(lines, ['T2 (ANA)', '  あと08分  NH032  新千歳から   195席']);
});

test('formatArrivalsList: null/未提供は空配列', async () => {
  assert.deepEqual(formatArrivalsList(null), []);
  assert.deepEqual(formatArrivalsList({ T1: [], T2: [] }), []);
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd ~/work/taxi-dev-wt-pool-status && node --test tests/pool-status-section.test.js`
Expected: FAIL — `formatArrivalsList is not a function`

- [ ] **Step 3: 最小実装**

`tools/js/pool-status-section.js` の `formatTerminalArrivals` の直後（または直前）に追記:

```js
const TERMINAL_HEAD = { T1: 'T1 (JAL)', T2: 'T2 (ANA)' };

/** 「分」を2桁ゼロ埋めの文字列に。負値は0扱い。 */
function minutesText(min) {
  const m = Math.max(0, min | 0);
  return `あと${String(m).padStart(2, '0')}分`;
}
/** 「N席」を6文字幅相当に。少数席数も右寄せ感を出す。 */
function seatsText(n) {
  return `${n | 0}席`;
}
/** 出発地名を右側に整える（全角文字混在のため厳密幅でなく区切りスペース2つ）。 */
function fromText(name) {
  return `${name}から`;
}

/** terminalArrivalsList を「T1 (JAL) / あとN分 便名 fromから N席」の行配列に。 */
export function formatArrivalsList(list) {
  if (!list) return [];
  const lines = [];
  for (const t of ['T1', 'T2']) {
    const arr = list[t] || [];
    if (arr.length === 0) continue;
    lines.push(TERMINAL_HEAD[t]);
    for (const f of arr) {
      lines.push(`  ${minutesText(f.lobbyExitMinutes)}  ${f.flightNumber}  ${fromText(f.fromName)}  ${seatsText(f.seatCount).padStart(5, ' ')}`);
    }
  }
  return lines;
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `cd ~/work/taxi-dev-wt-pool-status && node --test tests/pool-status-section.test.js`
Expected: PASS（出力フォーマットがテストと完全一致するよう padStart 等を調整。テストが失敗した場合は出力を実際の値に合わせてテスト側を `assert.deepEqual` で確認した期待値に合わせる、ではなく**実装の文字列構築を確認**し、padStart幅 5 を実値に合うよう調整）

> 注：テスト期待値内の「244席」「322席」「195席」のスペース幅は実装側 `padStart(5)` で生成される。テストと実装で揃わなければ、実装側の padStart 数を期待値に合わせて調整する（5 → 出力 "  244席" → 全体行整形）。

- [ ] **Step 5: コミット**

```bash
cd ~/work/taxi-dev-wt-pool-status
git add tools/js/pool-status-section.js tests/pool-status-section.test.js
git commit -m "feat(pool-status): formatArrivalsList 便リスト構築（運航データ直送）"
```

---

### Task B4: arrivals.html 説明文＋撤去

**Files:**
- Modify: `~/work/taxi-dev-wt-pool-status/tools/arrivals.html`

- [ ] **Step 1: `#pool-status-occ` を削除し、説明文を刷新**

`tools/arrivals.html` の `<div id="pool-status-meta">` の行と `<div id="pool-status-activity">` の間にある `<div id="pool-status-occ"...>混み具合: —</div>` の **1行を削除**。

その上で、`<p class="fc-scope">` から `</details>` までを次に置き換える:

```html
    <p class="fc-scope">※絶対値（在台N台・待ち目安N分）は誤差が大きいため表示しません。比率・差分・運航データだけを使った誠実な目安です。</p>
    <details class="fc-about" style="margin:0 0 8px; color:var(--sub); font-size:11px; line-height:1.6;">
      <summary style="cursor:pointer; color:var(--accent);">ⓘ 仕組みと注意</summary>
      <div style="margin-top:6px;">
        <p style="margin:0 0 4px;"><strong>今日の流れ</strong>：直近1時間の出庫を、過去同曜日（祝日・連休も区別）と同時間帯で割り算。同じバイアスで割るので偏りに強い。</p>
        <p style="margin:0 0 4px;"><strong>乗り場の動き</strong>：直近30分÷前30分の出庫比でトレンド判定。乗り場間の相対比較も合わせて表示。</p>
        <p style="margin:0 0 4px;"><strong>これからお客がロビーに出る便</strong>：航空会社の運航データ（時刻表ベース）。タクシー利用人数の予測は<strong>出さない</strong>（予測の上の予測になるため）。</p>
        <p style="margin:0 0 4px;"><strong>予測</strong>：過去の出庫記録から、その日の条件に合わせて出す予測システムを構築中（学習中）。</p>
        <p style="margin:0;">※カメラ検出の絶対値（在台N台）には大きなバイアスがあり、実数の半分程度しか拾えないことが目視確認済みです。だから絶対値はUIに出しません。</p>
      </div>
    </details>
```

- [ ] **Step 2: タグ対応確認**

Run: `cd ~/work/taxi-dev-wt-pool-status && node -e "const h=require('fs').readFileSync('tools/arrivals.html','utf8'); const o=(h.match(/<div/g)||[]).length, c=(h.match(/<\/div>/g)||[]).length; console.log('div open',o,'close',c);"`
Expected: open と close の差が編集前と同じ（`<div id="pool-status-occ">` を1つ削除しただけ）

- [ ] **Step 3: コミット**

```bash
cd ~/work/taxi-dev-wt-pool-status
git add tools/arrivals.html
git commit -m "feat(pool-status): arrivals.html 説明文を誠実化・在台行を撤去"
```

---

### Task B5: render() 大幅改修

**Files:**
- Modify: `~/work/taxi-dev-wt-pool-status/tools/js/pool-status-section.js`

- [ ] **Step 1: 取得要素を整理し、render を書き換える**

`tools/js/pool-status-section.js` の `initPoolStatusSection` を全文書き換える。`const metaEl ...` から関数末尾までを次に置き換え:

```js
export async function initPoolStatusSection() {
  const metaEl = document.getElementById('pool-status-meta');
  const actEl = document.getElementById('pool-status-activity');
  const img1 = document.getElementById('pool-cam-real01');
  const img2 = document.getElementById('pool-cam-real02');
  const stallsEl = document.getElementById('pool-status-stalls');
  const arrivalsEl = document.getElementById('pool-status-arrivals');
  if (!metaEl) return;

  async function render() {
    const cb = Date.now();
    if (img1) img1.src = `data/pool-cam-real01.jpg?t=${cb}`;
    if (img2) img2.src = `data/pool-cam-real02.jpg?t=${cb}`;
    const { data, error } = await loadPoolStatus();
    if (error || !data) { metaEl.textContent = '現況データを取得できていません'; return; }
    const ts = String(data.generatedAt).slice(11, 16);
    if (isStale(data.generatedAt, Date.now())) {
      metaEl.textContent = `📷 配信停止中の可能性（写真・データは ${ts} が最終）`;
    } else {
      metaEl.textContent = `📷 ${ts}時点（カメラ推定で実数とズレあり）`;
    }
    if (actEl) {
      actEl.innerHTML = `<strong>今日の流れ</strong> ${formatActivityLine(data.activity || {})}`;
    }
    if (stallsEl) {
      const stalls = data.stalls;
      if (stalls) {
        const order = ['stall1', 'stall2', 'stall3', 'stall4'];
        const head = '<div style="color:var(--sub); font-size:11px; margin-bottom:4px;">乗り場の動き</div>';
        stallsEl.innerHTML = head + order
          .filter(k => stalls[k])
          .map(k => `<div>${formatStallLineV2(stalls[k])}</div>`)
          .join('');
      } else {
        stallsEl.innerHTML = '';
      }
    }
    if (arrivalsEl) {
      const lines = formatArrivalsList(data.terminalArrivalsList);
      if (lines.length) {
        const head = '<div style="color:var(--sub); font-size:12px; margin-top:8px; margin-bottom:4px;">✈ これからお客がロビーに出る便（運航データ・予測ではない）</div>';
        arrivalsEl.innerHTML = head + lines
          .map(l => l.startsWith('  ') ? `<div style="padding-left:8px;">${l.trimStart()}</div>` : `<div style="font-weight:600; margin-top:4px;">${l}</div>`)
          .join('');
      } else {
        arrivalsEl.innerHTML = '';
      }
    }
  }
  await render();
  return render;
}
```

- [ ] **Step 2: 既存テスト全件確認（render 側は DOM 依存のため形が変わっても export 関数は不変）**

Run: `cd ~/work/taxi-dev-wt-pool-status && npm test`
Expected: PASS（全テスト緑。pool-status-section.test.js の純関数テストが render の変化に影響されない）

- [ ] **Step 3: コミット**

```bash
cd ~/work/taxi-dev-wt-pool-status
git add tools/js/pool-status-section.js
git commit -m "feat(pool-status): render を3ブロック（流れ／乗り場の動き／便リスト）に再構成"
```

---

### Task B6: SW CACHE_NAME bump

**Files:**
- Modify: `~/work/taxi-dev-wt-pool-status/sw.js`

- [ ] **Step 1: dev最新の CACHE_NAME を確認し、それ+1 に bump**

Run:
```bash
cd ~/work/taxi-dev-wt-pool-status && git fetch -q origin main && echo "現状: $(grep '^const CACHE_NAME' sw.js)" && echo "dev最新: $(git show origin/main:sw.js | grep '^const CACHE_NAME')"
```

例: 現状 v228、dev最新 v228 → 次は v229。dev最新が v229 以上に進んでいればその+1 に。

- [ ] **Step 2: sw.js を編集**

`sw.js` 2行目を `const CACHE_NAME = CACHE_PREFIX + 'v229';`（または dev 最新+1）に書き換える。

- [ ] **Step 3: 全テスト最終確認**

Run: `cd ~/work/taxi-dev-wt-pool-status && npm test`
Expected: PASS

- [ ] **Step 4: コミット**

```bash
cd ~/work/taxi-dev-wt-pool-status
git add sw.js
git commit -m "chore(sw): CACHE_NAME bump（誠実再設計）"
```

- [ ] **Step 5: dev反映（ユーザー作業）**

Claude は push しない。ユーザーに次を案内する:

```
! bash ~/work/taxi-dev-wt-pool-status/PUSH-genkyo.sh
```

> rebase で `sw.js` 衝突が起きたら、ic-helper のときと同様 `git checkout --ours sw.js` で dev最新版を採用し、その上で sed で CACHE_NAME を最大+1 にして add → continue。

---

# Phase C — Mac mini への反映＆動作確認

> **Phase A の jp-holidays.json と pool-status.mjs 拡張を Mac mini で稼働させる**ためには、Mac miniの ic-helper repo を pull する必要がある。Phase B のUIだけ反映でも壊れない（グレースフル縮退）が、新フィールドが見えるためには Mac mini 反映必須。

- [ ] **Step 1: ic-helper を origin に push（Claudeが実行可）**

```bash
cd ~/repos/taxi-ic-helper
git fetch -q origin main
git rebase origin/main || { echo "衝突あり"; exit 1; }
# 衝突は data/pool-status.json が ours採用 (origin/mainのobserve-tick最新)
# ↓実行: git checkout --ours -- data/pool-status.json && git add data/pool-status.json && GIT_EDITOR=true git rebase --continue
git checkout main
git reset --hard feat/pool-status
git push origin main
```

- [ ] **Step 2: Mac mini で pull（ユーザー作業）**

ユーザーに案内:

```
Mac mini で実行:
cd ~/repos/taxi-ic-helper && git pull --ff-only origin main
```

- [ ] **Step 3: 次のobserve-tick（5分以内）で新 `pool-status.json` 生成を確認**

Run:
```bash
cd ~/repos/taxi-ic-helper && git fetch -q origin main
git show origin/main:data/pool-status.json | python3 -c "
import json, sys
d = json.load(sys.stdin)
print('generatedAt:', d['generatedAt'])
print('sameConditionCompare:', d['activity'].get('sameConditionCompare'))
print('stall1.rankHint:', d['stalls']['stall1'].get('rankHint'))
print('terminalArrivalsList.T1 (先頭):', d['terminalArrivalsList']['T1'][:1] if d.get('terminalArrivalsList') else None)
"
```
Expected: `sameConditionCompare` に `{peers_typical, percent, label, dayLabel}` が入り、`rankHint` と `terminalArrivalsList` も出力される。

- [ ] **Step 4: relayの確認**

Run:
```bash
cd ~/work/taxi-dev-wt-pool-status && git fetch -q origin main
git show origin/main:tools/data/pool-status.json | python3 -c "import json,sys; d=json.load(sys.stdin); print('generatedAt:',d['generatedAt']); print('sameConditionCompare:',d['activity'].get('sameConditionCompare'))"
```
Expected: 数分以内に relay経由で日報側にも新フィールド入り pool-status.json が届く。

- [ ] **Step 5: 本番反映**

ユーザー判断で v1.36.0 タグを打つ:

```
! cd ~/work/taxi-dev && git tag v1.36.0 origin/main && git push origin v1.36.0
```

deploy.yml が走り、本番 prod/main に rsync される。

---

## Self-Review

**1. Spec coverage**
- ✅ 在台・待ち目安・タクシー予想人数の廃止 → Task B5（render 改修）
- ✅ 同条件比較 → Task A2（getDayContext）+ A3（sameConditionCompare）+ B1（formatActivityLine）
- ✅ 乗り場間相対順位 → A4（buildStallRankHint）+ B2（formatStallLineV2）
- ✅ 便リスト → A5（buildTerminalArrivalsList）+ B3（formatArrivalsList）
- ✅ 後方互換 → A6（buildPoolStatus 第3/第4引数 optional）
- ✅ 説明文刷新 → B4
- ✅ SW bump → B6

**2. Placeholder scan**: TBD/TODO 無し、各ステップに実コード・実コマンド・期待出力あり。

**3. Type consistency**
- `dayKind`: A2 の 6種類（weekday/weekend/holiday/consecutive-first/middle/last）→ A3 で同じ値を使う → B1 では `dayLabel` 文字列のみ消費 ✓
- `rankHint`: A4 で `'most-active'|'most-low'|null` → A6 で stalls に付与 → B2 で `RANK_HINT_JA` キーが一致 ✓
- `sameConditionCompare`: A3 で `{peers_typical, percent, label, dayLabel}` → A6 で activity に入れる → B1 で読む ✓
- `terminalArrivalsList`: A5 で `{T1:[...], T2:[...]}` → A6 で出力 → B3 で読む ✓
- `lobbyExitMinutes`/`fromName`/`seatCount`/`flightNumber`/`airline` フィールド名は A5 と B3 で完全一致 ✓

---

## 実行方法

`superpowers:subagent-driven-development`（タスクごと新サブエージェント＋段階レビュー、推奨）で Phase A→B の順。Phase C は本人作業含むため Phase B 完了後に通常実行。

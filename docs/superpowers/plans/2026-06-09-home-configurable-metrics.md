# ホーム「あなたの数値」設定可能ダッシュボード Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ホームに「あなたの数値」カードを追加し、乗務員が見たい数値（責任出番1〜11／公出12〜／月度全体に分離）を選んで並べられるようにする。設定済み目標に連動して対比表示に格上げ（未設定は素の数値=案A）。

**Architecture:** 算出は純関数モジュール `js/home-metrics.js` に集約し payroll.js を再利用（TDD）。`predictMonthly` を index.html から payroll.js へ抽出して共有・テスト可能化。描画とピッカーUIは index.html に追加し、既存の散在した目標対比を集約。選択は config.homeMetrics に保存（localStorage＋既存同期でFirestore）。

**Tech Stack:** Vanilla ESM JS, node:test (`tests/run.js` の test/assert), 既存 payroll.js / storage.js / default-config.js。

参照spec: `docs/superpowers/specs/2026-06-08-home-configurable-metrics-design.md`

---

## File Structure

- Create: `js/home-metrics.js` — メトリクス算出の純関数＋`METRIC_CATALOG`定義。責任(1〜11)/公出(12〜)/月度全体の分離、税込/税抜、均等、着地、目標連動データを返す。
- Create: `tests/home-metrics.test.js` — 上記の単体テスト。
- Modify: `js/payroll.js` — `predictMonthly` を追加（index.html から抽出・exportして共有）。
- Modify: `js/default-config.js` — `homeMetrics` 既定選択を追加。
- Modify: `index.html` — `predictMonthly`インライン削除＋import、`render()`に「あなたの数値」カード描画とピッカー、既存の重複目標対比の整理。
- Modify: `sw.js` — CACHE_NAME bump。

---

## Task 1: predictMonthly を payroll.js へ抽出（共有・テスト可能化）

**Files:**
- Modify: `js/payroll.js`
- Modify: `index.html:1254-1269`（インライン定義を削除）, `index.html:349`（import利用）
- Test: `tests/payroll.test.js`

- [ ] **Step 1: 失敗するテストを書く**

`tests/payroll.test.js` 末尾に追加:

```javascript
import { predictMonthly } from '../js/payroll.js';

test('predictMonthly: 残り出番を平均で補完し12出番目以降は固定率で着地を出す', () => {
  const cfg = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  cfg.responsibilityShifts = 11;
  // 9出番・各税込100,000(税抜90,909)で計算しやすく
  const drives = Array.from({ length: 9 }, (_, i) => ({
    date: `2026-06-0${i + 1}`, vehicleType: 'japantaxi',
    trips: [{ amount: 100000, isCancel: false }]
  }));
  // 予定12出番(=責任11+公出1)へ着地
  const p = predictMonthly(drives, cfg, '2026-05-16', '2026-06-15', 12);
  // 12出番に到達 → breakdown は12出番以上モード
  assert.equal(p.breakdown.mode, 'tiered_12_or_more');
  // 着地総支給は11出番ぶん(段階) + 12出番目(固定率) + インセン + 有給
  assert.ok(p.total > 0);
  // 予定11出番なら公出ゼロ(12出番以上モードにならない)
  const p11 = predictMonthly(drives, cfg, '2026-05-16', '2026-06-15', 11);
  assert.equal(p11.breakdown.mode, 'tiered_11_or_less');
});
```

- [ ] **Step 2: テスト失敗を確認**

Run: `node --test tests/payroll.test.js`
Expected: FAIL（`predictMonthly` is not exported / not a function）

- [ ] **Step 3: payroll.js に predictMonthly を追加**

`js/payroll.js` 末尾に、index.html のインライン版と同一ロジックで追加:

```javascript
// 残り出番を「これまでの1出番平均(税込)」で補完し、責任出番(段階歩率)＋
// 公出(12出番目以降・固定率)を含めた月度着地を calcTotalPay で求める。
// targetShifts = 予定出番数(plannedShifts)。残出番の車種は現状のプレミアム比率を踏襲。
export function predictMonthly(drives, config, periodStart, periodEnd, targetShifts) {
  const monthly = calcMonthlySales(drives);
  const avgDailyInclTax = monthly.inclTax / drives.length;
  const target = targetShifts ?? config.responsibilityShifts;
  const remaining = target - drives.length;
  if (remaining <= 0) return calcTotalPay(drives, config, periodStart, periodEnd);
  const premiumCount = drives.filter(d => d.vehicleType === 'premium').length;
  const premiumRemaining = Math.round(remaining * (premiumCount / drives.length));
  const simulated = [...drives];
  for (let i = 0; i < remaining; i++) {
    const vt = i < premiumRemaining ? 'premium' : 'japantaxi';
    simulated.push({ trips: [{ amount: avgDailyInclTax, isCancel: false }], vehicleType: vt, date: '_p_' + i });
  }
  return calcTotalPay(simulated, config, periodStart, periodEnd);
}
```

- [ ] **Step 4: テスト成功を確認**

Run: `node --test tests/payroll.test.js`
Expected: PASS（全既存テスト＋新規）

- [ ] **Step 5: index.html のインライン定義を削除し import に切替**

`index.html:1254-1269` の `function predictMonthly(...) {...}` ブロックを削除。
`index.html:154` 付近の payroll import 行に `predictMonthly` を追加:

```javascript
import { calcDailySales, calcMonthlySales, calcTotalPay, calcBasePay, findRate, findTierIdx, findNextHigherRateTier, findNextLowerRateTier, requiredUniformSales, predictMonthly } from './js/payroll.js';
```
（既存の import 行に存在する識別子はそのまま残し、`predictMonthly` を追記。重複importは作らない。）

- [ ] **Step 6: 全テスト通過を確認**

Run: `npm test`
Expected: PASS（既存846＋新規、fail 0）

- [ ] **Step 7: コミット**

```bash
git add js/payroll.js index.html tests/payroll.test.js
git commit -m "refactor(payroll): predictMonthly を payroll.js へ抽出し共有・テスト可能化"
```

---

## Task 2: home-metrics.js — drives分割と売上集計（責任/公出, 税込/税抜, 合計/平均）

**Files:**
- Create: `js/home-metrics.js`
- Test: `tests/home-metrics.test.js`

- [ ] **Step 1: 失敗するテストを書く**

`tests/home-metrics.test.js`:

```javascript
import { test, assert } from './run.js';
import { RESP_CAP, splitDrives, salesAggregate } from '../js/home-metrics.js';

const mk = (n, amount) => Array.from({ length: n }, (_, i) => ({
  date: `2026-06-${String(i + 1).padStart(2, '0')}`, vehicleType: 'japantaxi',
  trips: [{ amount, isCancel: false }]
}));

test('RESP_CAP は 11（責任出番上限）', () => {
  assert.equal(RESP_CAP, 11);
});

test('splitDrives: 1〜11=責任, 12以降=公出', () => {
  const d = mk(13, 100000);
  const { resp, kosyutsu } = splitDrives(d);
  assert.equal(resp.length, 11);
  assert.equal(kosyutsu.length, 2);
});

test('splitDrives: 9出番なら責任9・公出0', () => {
  const { resp, kosyutsu } = splitDrives(mk(9, 100000));
  assert.equal(resp.length, 9);
  assert.equal(kosyutsu.length, 0);
});

test('salesAggregate: 合計税込/税抜と平均（出番数で割る）', () => {
  const agg = salesAggregate(mk(4, 100000)); // 税込40万
  assert.equal(agg.count, 4);
  assert.equal(agg.totalIncl, 400000);
  assert.equal(Math.round(agg.totalExcl), Math.round(400000 / 1.1));
  assert.equal(agg.avgIncl, 100000);
  assert.equal(Math.round(agg.avgExcl), Math.round((400000 / 1.1) / 4));
});

test('salesAggregate: 空配列は全て0（ゼロ除算しない）', () => {
  const agg = salesAggregate([]);
  assert.equal(agg.count, 0);
  assert.equal(agg.totalIncl, 0);
  assert.equal(agg.avgIncl, 0);
  assert.equal(agg.avgExcl, 0);
});
```

- [ ] **Step 2: テスト失敗を確認**

Run: `node --test tests/home-metrics.test.js`
Expected: FAIL（module not found）

- [ ] **Step 3: home-metrics.js を作成（分割・集計）**

```javascript
// js/home-metrics.js
// ホーム「あなたの数値」カードの算出。責任出番(1〜11)と公出(12〜)を必ず分離する。
// 算出は payroll.js の純関数を再利用し、表示用の値のみを返す（DOM非依存）。
import { calcDailySales } from './payroll.js';

// 責任出番の上限（法律上11。12以降は公出＝固定歩率）
export const RESP_CAP = 11;

// drives(日付昇順前提)を 責任(1〜11) と 公出(12〜) に分割
export function splitDrives(drives) {
  const arr = Array.isArray(drives) ? drives : [];
  return { resp: arr.slice(0, RESP_CAP), kosyutsu: arr.slice(RESP_CAP) };
}

// 売上集計: 合計(税込/税抜)・平均(税込/税抜)・出番数
export function salesAggregate(subset) {
  const arr = Array.isArray(subset) ? subset : [];
  const totalIncl = arr.reduce((s, d) => s + calcDailySales(d).inclTax, 0);
  const totalExcl = totalIncl / 1.1;
  const count = arr.length;
  return {
    count,
    totalIncl,
    totalExcl,
    avgIncl: count ? totalIncl / count : 0,
    avgExcl: count ? totalExcl / count : 0,
  };
}
```

- [ ] **Step 4: テスト成功を確認**

Run: `node --test tests/home-metrics.test.js`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add js/home-metrics.js tests/home-metrics.test.js
git commit -m "feat(home-metrics): drives分割(責任/公出)と売上集計(合計/平均・税込/税抜)"
```

---

## Task 3: home-metrics.js — 残り必要売上（責任11基準・均等）

**Files:**
- Modify: `js/home-metrics.js`
- Test: `tests/home-metrics.test.js`

- [ ] **Step 1: 失敗するテストを書く**

`tests/home-metrics.test.js` に追加:

```javascript
import { requiredToRespCap } from '../js/home-metrics.js';

test('requiredToRespCap: 責任11まで残りで必要な均等売上(税込/税抜)と総額', () => {
  const cfg = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  cfg.responsibilityShifts = 11;
  cfg.takeHomeTarget = 500000;
  const drives = mk(9, 100000); // 9出番済
  const r = requiredToRespCap(drives, cfg, '2026-05-16', '2026-06-15');
  assert.equal(r.remaining, 2);           // 11-9
  assert.ok(r.perShiftIncl > 0);
  assert.equal(Math.round(r.perShiftExcl), Math.round(r.perShiftIncl / 1.1));
  assert.equal(Math.round(r.totalIncl), Math.round(r.perShiftIncl * 2));
});

test('requiredToRespCap: 11出番以上なら remaining=0・達成扱い', () => {
  const cfg = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  cfg.responsibilityShifts = 11;
  const r = requiredToRespCap(mk(11, 100000), cfg, '2026-05-16', '2026-06-15');
  assert.equal(r.remaining, 0);
  assert.equal(r.perShiftIncl, 0);
  assert.equal(r.totalIncl, 0);
});
```

（テスト冒頭の import に `DEFAULT_CONFIG` が無ければ追加: `import { DEFAULT_CONFIG } from '../js/default-config.js';`）

- [ ] **Step 2: テスト失敗を確認**

Run: `node --test tests/home-metrics.test.js`
Expected: FAIL（requiredToRespCap not exported）

- [ ] **Step 3: 実装を追加**

`js/home-metrics.js` の import に `requiredUniformSales` を追加し、関数を追加:

```javascript
import { calcDailySales, requiredUniformSales } from './payroll.js';

// 責任出番(11)まで残りで、目標到達に必要な「1出番あたり均等(税込/税抜)」と総額。
// 目標は takeHomeAt11Target があればそれ、無ければ takeHomeTarget(手取り月度)。
// 残出番の車種は現状のプレミアム比率を踏襲(予測と前提統一)。
export function requiredToRespCap(drives, config, periodStart, periodEnd) {
  const arr = Array.isArray(drives) ? drives : [];
  const remaining = Math.max(0, RESP_CAP - arr.length);
  const target = (config.takeHomeAt11Target > 0)
    ? config.takeHomeAt11Target
    : (config.takeHomeTarget || 0);
  const takeHomeRate = config.takeHomeRate || 0.75;
  if (remaining <= 0 || !(target > 0) || !(takeHomeRate > 0) || arr.length === 0) {
    return { remaining, perShiftIncl: 0, perShiftExcl: 0, totalIncl: 0, totalExcl: 0, target };
  }
  const premiumCount = arr.filter(d => d.vehicleType === 'premium').length;
  const premiumRemaining = Math.round(remaining * (premiumCount / arr.length));
  const remainingShiftList = Array.from({ length: remaining }, (_, i) => ({
    vehicleType: i < premiumRemaining ? 'premium' : 'japantaxi'
  }));
  const perShiftIncl = requiredUniformSales(
    arr, remainingShiftList, config, periodStart, periodEnd, target, takeHomeRate, 'takehome'
  );
  const perShiftExcl = perShiftIncl / 1.1;
  return {
    remaining, target,
    perShiftIncl, perShiftExcl,
    totalIncl: perShiftIncl * remaining,
    totalExcl: perShiftExcl * remaining,
  };
}
```

- [ ] **Step 4: テスト成功を確認**

Run: `node --test tests/home-metrics.test.js`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add js/home-metrics.js tests/home-metrics.test.js
git commit -m "feat(home-metrics): 責任11まで残りの必要均等売上(税込/税抜)・総額"
```

---

## Task 4: home-metrics.js — 着地値と目標連動データ（責任/公出/月度）

**Files:**
- Modify: `js/home-metrics.js`
- Test: `tests/home-metrics.test.js`

- [ ] **Step 1: 失敗するテストを書く**

```javascript
import { computeLandings } from '../js/home-metrics.js';

test('computeLandings: 月度/責任/公出の着地と目標連動(案A: 目標なしは素の数値)', () => {
  const cfg = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  cfg.responsibilityShifts = 11;
  cfg.takeHomeRate = 0.75;
  cfg.grossTarget = 0;            // 未設定
  cfg.takeHomeTarget = 500000;    // 設定あり
  const drives = mk(9, 100000);
  const L = computeLandings(drives, cfg, '2026-05-16', '2026-06-15', 12);
  // 月度総支給(着地)は数値あり、grossTarget=0 なので hasTarget=false
  assert.ok(L.month.gross.value > 0);
  assert.equal(L.month.gross.hasTarget, false);
  // 月度手取りは takeHomeTarget 設定済 → hasTarget=true・対比データ
  assert.equal(L.month.takehome.hasTarget, true);
  assert.equal(L.month.takehome.target, 500000);
  assert.ok('willHit' in L.month.takehome);
  assert.ok('diff' in L.month.takehome);
  // 公出(12出番目)に着地が到達 → kosyutsu.takehome.value >= 0
  assert.ok(L.kosyutsu.takehome.value >= 0);
  // 着地歩率
  assert.ok(L.month.rate > 0 && L.month.rate < 1);
});
```

- [ ] **Step 2: テスト失敗を確認**

Run: `node --test tests/home-metrics.test.js`
Expected: FAIL（computeLandings not exported）

- [ ] **Step 3: 実装を追加**

`js/home-metrics.js` の import を拡張し関数追加:

```javascript
import { calcDailySales, requiredUniformSales, calcTotalPay, predictMonthly } from './payroll.js';

// breakdown から責任出番ぶん(11まで)の基本給を取り出す
function base11Pay(bd) {
  if (!bd) return 0;
  return bd.mode === 'tiered_12_or_more' ? (bd.basePay11 || 0) : (bd.basePay || 0);
}

// 目標連動データを組む(案A: 目標未設定なら hasTarget=false・素の数値)
function withTarget(landing, current, targetVal) {
  if (targetVal > 0) {
    const diff = landing - targetVal;
    return { value: landing, current, hasTarget: true, target: targetVal, diff, willHit: diff >= 0 };
  }
  return { value: landing, current, hasTarget: false };
}

// 月度/責任/公出の着地値＋目標連動データ
export function computeLandings(drives, config, periodStart, periodEnd, plannedShifts) {
  const takeHomeRate = config.takeHomeRate || 0.75;
  const actual = calcTotalPay(drives, config, periodStart, periodEnd, { useResponsibilityTier: true });
  const predicted = (drives.length > 0 && drives.length < plannedShifts)
    ? predictMonthly(drives, config, periodStart, periodEnd, plannedShifts)
    : actual;

  const aBd = actual.breakdown, pBd = predicted.breakdown;
  const respLandTH = base11Pay(pBd) * takeHomeRate;
  const respCurTH = base11Pay(aBd) * takeHomeRate;
  const kosyuLandTH = ((pBd && pBd.extraTotal) || 0) * takeHomeRate;
  const kosyuCurTH = ((aBd && aBd.extraTotal) || 0) * takeHomeRate;

  return {
    month: {
      gross: withTarget(predicted.total, actual.total, config.grossTarget || 0),
      takehome: withTarget(predicted.total * takeHomeRate, actual.total * takeHomeRate, config.takeHomeTarget || 0),
      rate: predicted.rate || actual.rate || 0,
    },
    resp: {
      takehome: withTarget(respLandTH, respCurTH, config.takeHomeAt11Target || 0),
    },
    kosyutsu: {
      // 12出番以上に到達する月のみ意味を持つ
      reaches: !!(pBd && pBd.mode === 'tiered_12_or_more'),
      takehome: withTarget(kosyuLandTH, kosyuCurTH, config.takeHomeAfter11Target || 0),
    },
  };
}
```

- [ ] **Step 4: テスト成功を確認**

Run: `node --test tests/home-metrics.test.js`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add js/home-metrics.js tests/home-metrics.test.js
git commit -m "feat(home-metrics): 月度/責任/公出の着地値と目標連動(案A)データ"
```

---

## Task 5: METRIC_CATALOG 定義と既定選択

**Files:**
- Modify: `js/home-metrics.js`
- Modify: `js/default-config.js`
- Test: `tests/home-metrics.test.js`

- [ ] **Step 1: 失敗するテストを書く**

```javascript
import { METRIC_CATALOG } from '../js/home-metrics.js';
import { DEFAULT_CONFIG } from '../js/default-config.js';

test('METRIC_CATALOG: 全項目が group(resp/kosyutsu/month)・id・label を持つ', () => {
  assert.ok(METRIC_CATALOG.length >= 12);
  for (const m of METRIC_CATALOG) {
    assert.ok(['resp', 'kosyutsu', 'month'].includes(m.group), `bad group: ${m.id}`);
    assert.ok(typeof m.id === 'string' && m.id.length > 0);
    assert.ok(typeof m.label === 'string' && m.label.length > 0);
  }
});

test('METRIC_CATALOG: id は一意', () => {
  const ids = METRIC_CATALOG.map(m => m.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('default-config: homeMetrics.selected は既定でカタログ内のidのみ', () => {
  const ids = new Set(METRIC_CATALOG.map(m => m.id));
  assert.ok(Array.isArray(DEFAULT_CONFIG.homeMetrics.selected));
  for (const id of DEFAULT_CONFIG.homeMetrics.selected) assert.ok(ids.has(id), `unknown id: ${id}`);
});
```

- [ ] **Step 2: テスト失敗を確認**

Run: `node --test tests/home-metrics.test.js`
Expected: FAIL（METRIC_CATALOG / homeMetrics 未定義）

- [ ] **Step 3: METRIC_CATALOG を追加**

`js/home-metrics.js` に追加（id・group・label・税種・目標連動フラグ）:

```javascript
// 選べる数値のカタログ。group: resp(1〜11責任) / kosyutsu(12〜公出) / month(月度全体)
// tax: 'incl' | 'excl' | null(税種なし)。pair: 税込/税抜が対になるなら基底キー。
// targetField: 設定の目標フィールド名(あれば目標連動の対象)。
export const METRIC_CATALOG = [
  // ① 責任出番(1〜11)
  { id: 'resp.total.incl',  group: 'resp', label: '11出番までの合計売上', tax: 'incl', pair: 'resp.total' },
  { id: 'resp.total.excl',  group: 'resp', label: '11出番までの合計売上', tax: 'excl', pair: 'resp.total' },
  { id: 'resp.avg.incl',    group: 'resp', label: '11出番までの平均売上', tax: 'incl', pair: 'resp.avg' },
  { id: 'resp.avg.excl',    group: 'resp', label: '11出番までの平均売上', tax: 'excl', pair: 'resp.avg' },
  { id: 'resp.needTotal.incl', group: 'resp', label: '残り(11まで)で必要な総売上', tax: 'incl', pair: 'resp.needTotal' },
  { id: 'resp.needTotal.excl', group: 'resp', label: '残り(11まで)で必要な総売上', tax: 'excl', pair: 'resp.needTotal' },
  { id: 'resp.needPer.incl', group: 'resp', label: '残り・1出番あたり均等', tax: 'incl', pair: 'resp.needPer' },
  { id: 'resp.needPer.excl', group: 'resp', label: '残り・1出番あたり均等', tax: 'excl', pair: 'resp.needPer' },
  { id: 'resp.takehome',    group: 'resp', label: '11出番までの手取り', tax: null, targetField: 'takeHomeAt11Target' },
  // ② 公出(12〜)
  { id: 'kosyutsu.total.incl', group: 'kosyutsu', label: '公出ぶんの合計売上', tax: 'incl', pair: 'kosyutsu.total' },
  { id: 'kosyutsu.total.excl', group: 'kosyutsu', label: '公出ぶんの合計売上', tax: 'excl', pair: 'kosyutsu.total' },
  { id: 'kosyutsu.avg.incl',   group: 'kosyutsu', label: '公出ぶんの平均売上', tax: 'incl', pair: 'kosyutsu.avg' },
  { id: 'kosyutsu.avg.excl',   group: 'kosyutsu', label: '公出ぶんの平均売上', tax: 'excl', pair: 'kosyutsu.avg' },
  { id: 'kosyutsu.takehome',   group: 'kosyutsu', label: '公出ぶんの手取り', tax: null, targetField: 'takeHomeAfter11Target' },
  // ③ 月度全体
  { id: 'month.gross',     group: 'month', label: '月度予想 総支給(着地)', tax: null, targetField: 'grossTarget' },
  { id: 'month.takehome',  group: 'month', label: '月度予想 手取り(着地)', tax: null, targetField: 'takeHomeTarget' },
  { id: 'month.total.incl',group: 'month', label: '月度合計 営収', tax: 'incl', pair: 'month.total' },
  { id: 'month.total.excl',group: 'month', label: '月度合計 営収', tax: 'excl', pair: 'month.total' },
  { id: 'month.rate',      group: 'month', label: '着地歩率', tax: null },
];

export const METRIC_GROUPS = [
  { key: 'resp', label: '責任出番（1〜11）', accent: '#1565c0', bg: '#e3f2fd' },
  { key: 'kosyutsu', label: '公出（12出番目〜）', accent: '#8b5cf6', bg: '#f5f3ff' },
  { key: 'month', label: '月度全体', accent: '#2e7d32', bg: '#ecfdf5' },
];
```

- [ ] **Step 4: default-config.js に既定選択を追加**

`js/default-config.js` の `DEFAULT_CONFIG` に追加（`paidLeaveAmount` 等の隣、責任出番=11 の文脈）:

```javascript
  // ホーム「あなたの数値」カードで表示する数値のid配列(個人設定)
  homeMetrics: {
    selected: [
      'resp.total.incl',
      'resp.avg.incl',
      'resp.needPer.incl', 'resp.needPer.excl',
      'month.gross', 'month.takehome'
    ]
  },
```

- [ ] **Step 5: テスト成功を確認**

Run: `node --test tests/home-metrics.test.js`
Expected: PASS

- [ ] **Step 6: コミット**

```bash
git add js/home-metrics.js js/default-config.js tests/home-metrics.test.js
git commit -m "feat(home-metrics): METRIC_CATALOG/グループ定義と既定選択(default-config)"
```

---

## Task 6: 全メトリクス値の解決関数 resolveMetrics

**Files:**
- Modify: `js/home-metrics.js`
- Test: `tests/home-metrics.test.js`

- [ ] **Step 1: 失敗するテストを書く**

```javascript
import { resolveMetrics } from '../js/home-metrics.js';

test('resolveMetrics: id→表示データ(値/税種/目標連動)を返す', () => {
  const cfg = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  cfg.responsibilityShifts = 11; cfg.takeHomeRate = 0.75; cfg.takeHomeTarget = 500000;
  const drives = mk(9, 100000);
  const r = resolveMetrics(drives, cfg, '2026-05-16', '2026-06-15', 12);
  // 責任合計税込 = 9*100000
  assert.equal(r['resp.total.incl'].value, 900000);
  // 平均税込 = 100000
  assert.equal(r['resp.avg.incl'].value, 100000);
  // 月度手取りは目標連動
  assert.equal(r['month.takehome'].hasTarget, true);
  // 着地歩率は0〜1
  assert.ok(r['month.rate'].value > 0 && r['month.rate'].value < 1);
});
```

- [ ] **Step 2: テスト失敗を確認**

Run: `node --test tests/home-metrics.test.js`
Expected: FAIL（resolveMetrics not exported）

- [ ] **Step 3: 実装を追加**

`js/home-metrics.js` に追加（Task2〜4の関数を束ねて id→{value, tax, ...targetData} を返す）:

```javascript
// 全カタログidの表示データを一括算出して返す。
// 返り値: { [id]: { value:number, tax:'incl'|'excl'|null, hasTarget?, target?, diff?, willHit?, current? } }
export function resolveMetrics(drives, config, periodStart, periodEnd, plannedShifts) {
  const { resp, kosyutsu } = splitDrives(drives);
  const ra = salesAggregate(resp);
  const ka = salesAggregate(kosyutsu);
  const ma = salesAggregate(drives);
  const need = requiredToRespCap(drives, config, periodStart, periodEnd);
  const L = computeLandings(drives, config, periodStart, periodEnd, plannedShifts);

  const out = {};
  const set = (id, value, tax) => { out[id] = { value, tax: tax ?? null }; };

  set('resp.total.incl', ra.totalIncl, 'incl');
  set('resp.total.excl', ra.totalExcl, 'excl');
  set('resp.avg.incl', ra.avgIncl, 'incl');
  set('resp.avg.excl', ra.avgExcl, 'excl');
  set('resp.needTotal.incl', need.totalIncl, 'incl');
  set('resp.needTotal.excl', need.totalExcl, 'excl');
  set('resp.needPer.incl', need.perShiftIncl, 'incl');
  set('resp.needPer.excl', need.perShiftExcl, 'excl');
  out['resp.takehome'] = { tax: null, ...L.resp.takehome };

  set('kosyutsu.total.incl', ka.totalIncl, 'incl');
  set('kosyutsu.total.excl', ka.totalExcl, 'excl');
  set('kosyutsu.avg.incl', ka.avgIncl, 'incl');
  set('kosyutsu.avg.excl', ka.avgExcl, 'excl');
  out['kosyutsu.takehome'] = { tax: null, reaches: L.kosyutsu.reaches, ...L.kosyutsu.takehome };

  out['month.gross'] = { tax: null, ...L.month.gross };
  out['month.takehome'] = { tax: null, ...L.month.takehome };
  set('month.total.incl', ma.totalIncl, 'incl');
  set('month.total.excl', ma.totalExcl, 'excl');
  out['month.rate'] = { tax: null, value: L.month.rate };

  return out;
}
```

- [ ] **Step 4: テスト成功を確認**

Run: `node --test tests/home-metrics.test.js`
Expected: PASS

- [ ] **Step 5: 全テスト通過＆コミット**

Run: `npm test`（fail 0）

```bash
git add js/home-metrics.js tests/home-metrics.test.js
git commit -m "feat(home-metrics): resolveMetrics で全id→表示データを一括算出"
```

---

## Task 7: 「あなたの数値」カードの描画（index.html）

**Files:**
- Modify: `index.html`（import追加、`render()`内にカード生成、HTML要素追加）
- Test: 手動スモーク（dev・kimi-webbridge）

- [ ] **Step 1: home-metrics を import**

`index.html` の module script 冒頭の import 群に追加:

```javascript
import { METRIC_CATALOG, METRIC_GROUPS, resolveMetrics } from './js/home-metrics.js';
```

- [ ] **Step 2: カードの土台要素を追加**

`index.html` のヒーロー直下（`summaryHtml` を差し込む領域の近く、目標カードより上）に空要素を用意。既存の `<div id="targetCard">` の直前に:

```html
<div id="myMetricsCard" class="card" style="display:none;"></div>
```

- [ ] **Step 3: 描画関数を追加**

`index.html` の関数定義領域（`renderSubTargetCards` の近く）に追加。`formatYen` は既存ユーティリティを使用:

```javascript
// 「あなたの数値」カード: 選択された数値をグループ見出し付きで並べる。
// values = resolveMetrics(...) の返り値。selected = config.homeMetrics.selected。
function renderMyMetricsCard(values, selectedIds) {
  const selected = new Set(selectedIds || []);
  // 同じ基底(pair)で税込/税抜が両方選択なら1行に並記するため pair でまとめる
  const byId = Object.fromEntries(METRIC_CATALOG.map(m => [m.id, m]));
  let body = '';
  for (const g of METRIC_GROUPS) {
    const inGroup = METRIC_CATALOG.filter(m => m.group === g.key && selected.has(m.id));
    if (inGroup.length === 0) continue;
    // pair をまとめる(税込を主、税抜を併記)。pairなし(tax=null)は単独。
    const rendered = new Set();
    let rows = '';
    for (const m of inGroup) {
      if (rendered.has(m.id)) continue;
      const v = values[m.id];
      if (!v) continue;
      // 目標連動(対比)
      if (m.targetField && v.hasTarget) {
        const sign = v.diff >= 0 ? '+' : '−';
        rows += `<div style="margin:6px 0;">
          <div style="font-size:11px;color:#666;">${m.label}
            <span style="color:${v.willHit ? g.accent : '#ff9800'};font-weight:700;">${v.willHit ? '✓達成見込' : '未達見込'}</span></div>
          <div style="font-size:12px;color:#666;">目標 ${formatYen(v.target)} / 着地 ${formatYen(v.value)} /
            <strong style="color:${v.willHit ? g.accent : '#ff9800'};">${sign}${formatYen(Math.abs(v.diff))}</strong></div>
        </div>`;
        rendered.add(m.id);
        continue;
      }
      // 税込/税抜 並記
      if (m.pair) {
        const incl = inGroup.find(x => x.pair === m.pair && x.tax === 'incl');
        const excl = inGroup.find(x => x.pair === m.pair && x.tax === 'excl');
        const inclV = incl && values[incl.id]; const exclV = excl && values[excl.id];
        let num = '';
        if (inclV && exclV) num = `${formatYen(inclV.value)} <span style="color:#888;font-size:12px;">/ ${formatYen(exclV.value)}(税抜)</span>`;
        else if (inclV) num = formatYen(inclV.value);
        else if (exclV) num = `${formatYen(exclV.value)}(税抜)`;
        rows += `<div style="margin:6px 0;"><div style="font-size:11px;color:#666;">${m.label}</div>
          <div style="font-size:18px;font-weight:800;">${num}</div></div>`;
        if (incl) rendered.add(incl.id);
        if (excl) rendered.add(excl.id);
        continue;
      }
      // 単独(tax=null・目標なし or 未設定=案A素の数値)
      rows += `<div style="margin:6px 0;"><div style="font-size:11px;color:#666;">${m.label}</div>
        <div style="font-size:18px;font-weight:800;">${m.id === 'month.rate' ? (v.value * 100).toFixed(1) + '%' : formatYen(v.value)}</div></div>`;
      rendered.add(m.id);
    }
    if (rows) {
      body += `<div style="margin-top:8px;padding:8px 10px;background:${g.bg};border-radius:6px;">
        <div style="font-size:10px;font-weight:700;color:${g.accent};">${g.label}</div>${rows}</div>`;
    }
  }
  return `<div style="display:flex;justify-content:space-between;align-items:center;">
      <strong>📌 あなたの数値</strong>
      <button id="editMetricsBtn" class="btn-link" style="font-size:12px;color:#1565c0;background:none;border:none;cursor:pointer;">⚙ 数値を選ぶ</button>
    </div>${body || '<p class="muted" style="font-size:12px;">「⚙ 数値を選ぶ」から表示する数値を選んでください</p>'}`;
}
```

- [ ] **Step 4: render() でカードを描画**

`index.html` の `render()` 内、`rawDrives` と `predicted` 算出済みの箇所の後に追加:

```javascript
  // 「あなたの数値」カード
  const myCard = document.getElementById('myMetricsCard');
  if (myCard && config.payrollMode !== 'fixed_rate') {
    const mvals = resolveMetrics(rawDrives, config, range.start, range.end, respShifts);
    myCard.style.display = '';
    myCard.innerHTML = renderMyMetricsCard(mvals, (config.homeMetrics && config.homeMetrics.selected) || []);
    const editBtn = document.getElementById('editMetricsBtn');
    if (editBtn) editBtn.addEventListener('click', openMetricsPicker);
  } else if (myCard) {
    myCard.style.display = 'none';
  }
```

（`openMetricsPicker` は Task 8 で定義。Task 7 時点では空関数 `function openMetricsPicker(){}` を仮置きしてエラーを防ぐ。）

- [ ] **Step 5: dev反映してスモーク**

`!~/work/taxi-dev/dpush.sh ~/work/taxi-metrics` をユーザーに依頼 → dev URL を kimi-webbridge（実アカウント）で開き、「あなたの数値」カードが既定6項目で表示され、責任/公出/月度のグループ見出しが出ることを確認。数値が現時点の実データと整合するか目視。

- [ ] **Step 6: コミット**

```bash
git add index.html
git commit -m "feat(home): あなたの数値カードを描画(責任/公出/月度・目標連動・税込税抜並記)"
```

---

## Task 8: 数値ピッカー（⚙ 選択UI）と保存

**Files:**
- Modify: `index.html`（ピッカーのモーダルHTML＋開閉＋保存）
- Test: 手動スモーク

- [ ] **Step 1: ピッカーのモーダル要素を追加**

`index.html` の body 末尾付近に:

```html
<div id="metricsPicker" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:50;">
  <div style="background:#fff;max-width:520px;margin:5vh auto;max-height:88vh;overflow:auto;border-radius:12px;padding:16px;">
    <div style="display:flex;justify-content:space-between;align-items:center;">
      <strong>数値を選ぶ</strong>
      <button id="metricsPickerClose" class="btn-link" style="border:none;background:none;font-size:18px;cursor:pointer;">×</button>
    </div>
    <div id="metricsPickerBody" style="margin-top:10px;"></div>
    <button id="metricsPickerSave" class="btn" style="width:100%;margin-top:12px;">保存</button>
  </div>
</div>
```

- [ ] **Step 2: ピッカーの中身生成・開閉・保存を実装**

`index.html` に `saveConfig` を import に追加（既存の storage import 行へ）:

```javascript
import { getConfig, getDrivesForMonth, flushPendingQueue, saveConfig } from './js/storage.js';
```

仮置きした `openMetricsPicker` を実装に置き換え:

```javascript
function openMetricsPicker() {
  const selected = new Set((config.homeMetrics && config.homeMetrics.selected) || []);
  const bodyEl = document.getElementById('metricsPickerBody');
  let html = '';
  for (const g of METRIC_GROUPS) {
    const items = METRIC_CATALOG.filter(m => m.group === g.key);
    html += `<div style="margin-top:10px;"><div style="font-size:11px;font-weight:700;color:${g.accent};">${g.label}</div>`;
    for (const m of items) {
      const taxLabel = m.tax === 'incl' ? '（税込）' : m.tax === 'excl' ? '（税抜）' : '';
      html += `<label style="display:block;font-size:13px;margin:3px 0;">
        <input type="checkbox" data-mid="${m.id}" ${selected.has(m.id) ? 'checked' : ''}> ${m.label}${taxLabel}</label>`;
    }
    html += `</div>`;
  }
  bodyEl.innerHTML = html;
  document.getElementById('metricsPicker').style.display = '';
}

function closeMetricsPicker() { document.getElementById('metricsPicker').style.display = 'none'; }

async function saveMetricsSelection() {
  const checks = document.querySelectorAll('#metricsPickerBody input[data-mid]:checked');
  const ids = Array.from(checks).map(c => c.getAttribute('data-mid'));
  config.homeMetrics = { selected: ids };
  await saveConfig(config);
  closeMetricsPicker();
  render();
}
```

- [ ] **Step 3: 開閉・保存ボタンを配線**

`index.html` の初期化（`load()` 後 or DOMContentLoaded相当の箇所）に1回だけ:

```javascript
document.getElementById('metricsPickerClose').addEventListener('click', closeMetricsPicker);
document.getElementById('metricsPickerSave').addEventListener('click', saveMetricsSelection);
```

- [ ] **Step 4: dev反映してスモーク**

dev（kimi-webbridge・実アカウント）で「⚙ 数値を選ぶ」→チェックON/OFF→保存→カードに反映、再読込後も維持（localStorage＋同期保存）を確認。公出項目を選んでも、責任出番が11以下の月では公出グループが空になり混ざらないことを確認。

- [ ] **Step 5: コミット**

```bash
git add index.html
git commit -m "feat(home): 数値ピッカー(⚙)でON/OFF選択しconfig.homeMetricsに保存"
```

---

## Task 9: 既存の重複目標対比の整理

**Files:**
- Modify: `index.html`（`targetCard` の目標対比と `renderTargetCard` の対比を新カードへ集約）
- Test: 手動スモーク

- [ ] **Step 1: 重複の除去方針を確認**

新「あなたの数値」カードに目標対比(月度手取り/総支給/11出番まで/公出)が集約されたため:
- スタンドアロン `targetCard`（L700+）の **目標対比本体**（手取り目標の達成見込バー）は新カードに置換済 → `targetCard` は「あと必要な売上(残り)」の詳細折りたたみのみ残すか、新カードへ完全集約して非表示化。
- 「歩率と着地予測」内 `renderTargetCard` の **目標対比カード**部分（`renderTargetComparison` 相当）は削除。歩率マップ・着地フローは残す。

- [ ] **Step 2: targetCard の目標対比を新カードに委譲**

`render()` 内、`targetCard.innerHTML = ...`（L708-719 の手取り目標ヘッドライン＋バー）を削除し、`targetCard` は「あと必要な売上」と「目標の細目」の折りたたみのみ残す。または重複完全排除のため `targetCard.style.display='none'` とし、必要情報は新カードに集約。実装時に dev で見比べ、情報欠落がないことを確認してから片方を消す。

- [ ] **Step 3: 歩率セクションの目標対比を削除**

`renderTargetCard`（L560-650）から目標対比カード生成部分を削除し、歩率マップ・着地フロー・次段情報のみ残す。`targets`/`renderTargetCard` の対比専用コードを除去。

- [ ] **Step 4: dev反映してスモーク**

dev（実アカウント）で、目標対比が「あなたの数値」カード1か所のみになり、ヒーロー/給与の内訳/営収/歩率マップは残っていることを確認。情報の欠落・二重表示が無いこと。

- [ ] **Step 5: コミット**

```bash
git add index.html
git commit -m "refactor(home): 目標対比をあなたの数値カードへ集約し重複表示を除去"
```

---

## Task 10: SWキャッシュbumpと最終確認

**Files:**
- Modify: `sw.js`
- Test: 全テスト＋dev最終スモーク

- [ ] **Step 1: CACHE_NAME を bump**

`sw.js:2` の `const CACHE_NAME = CACHE_PREFIX + 'vNNN';` を次の番号へ（現行を確認して+1）。新規JSファイル `js/home-metrics.js` を追加したため、プリキャッシュ対象に含まれているか（同一オリジンの動的import）も確認。

- [ ] **Step 2: 全テスト**

Run: `npm test`
Expected: fail 0（既存＋home-metrics＋payroll新規）

- [ ] **Step 3: dev最終スモーク**

dev（kimi-webbridge・実アカウント）で一連を確認:
- 既定表示 → ⚙で数値追加/削除 → 保存 → 反映 → 再読込維持
- 責任(1〜11)と公出(12〜)が別グループで混ざらない
- 目標設定あり→対比格上げ、なし→素の数値(案A)
- 11出番までの合計・平均（税込/税抜）が出る

- [ ] **Step 4: コミット**

```bash
git add sw.js
git commit -m "chore(sw): CACHE_NAME bump（あなたの数値カード配信）"
```

---

## Self-Review メモ（spec整合）

- 責任/公出分離: Task2 splitDrives(RESP_CAP=11) で担保、全描画でグループ固定。✓
- 11出番までの合計・平均（税込/税抜）: Task2 salesAggregate + Task5 catalog。✓
- 残り(11まで)必要・均等（税込/税抜）: Task3 requiredToRespCap。✓
- 目標連動(案A): Task4 withTarget（hasTarget=false で素の数値）。✓
- 設定済み目標→対比: Task4 + Task7 描画分岐。✓
- 永続化: Task5 default + Task8 saveConfig（config丸ごと保存＝Firestore同期も既存経路）。✓
- 重複解消: Task9。✓
- 着地は v1.76.0 の predicted.total を踏襲: Task1/Task4。✓

# AI営業相談コーチ v2 — Step 1: レジーム判定スパイン 実装プラン

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 「今は“量(回転)”の時間か“単価”の時間か」を期待乗車数からデータで判定し、**レジームに応じて回答の中身（出す事実）を変える**。コーチが"考える"骨を立てる。

**Architecture:** 純関数 `expectedRideDensity` / `classifyRegime`（regime.js, TDD）。それを `buildFactPack` に統合して FactPack に `regime` を追加。`composeAnswer`/`formatAnswer` がレジームで助言を出し分ける（量→次の一手＋時間効率／単価→高単価エリア＋位置取り）。数字は全て実データ由来。LLM不使用。

**Tech Stack:** 素のESM、`node:test`。

v2 spec: `docs/superpowers/specs/2026-06-05-ai-sales-coach-v2-efficiency-design.md`。v2 の Step 1/4。既存 `js/coach/*`（fact-engine/answer-composer/answer-format 等）と `chart-helpers`（dowOf 等）を再利用。

---

## File Structure

| ファイル | 責務 | テスト |
|---|---|---|
| `js/coach/regime.js`（新規） | `expectedRideDensity(drives,dow,hour)` ＋ `classifyRegime(density,opts)`。純関数 | あり |
| `js/coach/fact-engine.js`（変更） | FactPack に `regime:{kind,density}` を追加 | 既存testに追加 |
| `js/coach/answer-composer.js`（変更） | AnswerPlan に `regime` を載せる | 既存testに追加 |
| `js/coach/answer-format.js`（変更） | レジームで助言を出し分け（見出し＋強調する事実） | 既存testに追加 |

---

## Task 1: レジーム判定 `regime.js`

**Files:** Create `js/coach/regime.js` / Test `tests/coach-regime.test.js`

**型/ルール:**
- `expectedRideDensity(drives, dow, hour)`: 指定 dow に一致する日（`dowOf(drive.date)===dow`）について、`boardTime` の時が `hour` の非キャンセル乗車件数を数え、**一致日数で割った1日平均件数**を返す。一致日が無ければ `null`。
- `classifyRegime(density, opts={threshold:1.5})`: `density==null`→`'unknown'` / `density>=threshold`→`'volume'` / それ未満→`'value'`。

- [ ] **Step 1: 失敗テスト** — `tests/coach-regime.test.js`

```javascript
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { expectedRideDensity, classifyRegime } from '../js/coach/regime.js';

// 2026-05-01 と 2026-05-08 は金曜(dow=5)。
function t(amount, bt) { return { amount, boardTime: bt, alightTime: bt, isCancel: false }; }
const drives = [
  { date: '2026-05-01', trips: [ t(2000,'19:10'), t(2200,'19:40'), t(1800,'19:50'), t(3000,'23:30') ] }, // 19時台3件, 23時台1件
  { date: '2026-05-08', trips: [ t(2400,'19:15'), t(2600,'19:55'), { amount:0, boardTime:'19:05', isCancel:true } ] }, // 19時台2件(+キャンセル除外)
];

describe('expectedRideDensity', () => {
  it('dow×hourの1日平均乗車数（キャンセル除外）', () => {
    // 金曜19時台: 1日目3件 + 2日目2件 = 5件 / 2日 = 2.5
    assert.strictEqual(expectedRideDensity(drives, 5, 19), 2.5);
  });
  it('深夜23時台は薄い: 5件中1件/2日 = 0.5', () => {
    assert.strictEqual(expectedRideDensity(drives, 5, 23), 0.5);
  });
  it('一致する曜日が無ければ null', () => {
    assert.strictEqual(expectedRideDensity(drives, 1, 19), null); // 月曜の履歴なし
  });
});

describe('classifyRegime', () => {
  it('densityがしきい値以上なら volume', () => {
    assert.strictEqual(classifyRegime(2.5), 'volume');
  });
  it('しきい値未満なら value', () => {
    assert.strictEqual(classifyRegime(0.5), 'value');
  });
  it('null は unknown', () => {
    assert.strictEqual(classifyRegime(null), 'unknown');
  });
  it('しきい値は opts で変更可', () => {
    assert.strictEqual(classifyRegime(2.5, { threshold: 3 }), 'value');
  });
});
```

- [ ] **Step 2: 失敗確認** — `npm test -- tests/coach-regime.test.js`（モジュール未存在）

- [ ] **Step 3: 実装** — `js/coach/regime.js`

```javascript
import { dowOf } from '../chart-helpers.js';

function hourOf(timeStr) {
  const h = parseInt(String(timeStr || '').split(':')[0], 10);
  return Number.isFinite(h) ? h : null;
}

// dow×hour の1日平均乗車数（非キャンセル）。一致日なしは null。
export function expectedRideDensity(drives, dow, hour) {
  const days = (drives || []).filter((d) => d && d.date && dowOf(d.date) === dow);
  if (days.length === 0) return null;
  let total = 0;
  for (const d of days) {
    for (const tr of (d.trips || [])) {
      if (tr.isCancel) continue;
      if (hourOf(tr.boardTime) === hour) total += 1;
    }
  }
  return total / days.length;
}

// 期待乗車数 → レジーム。density null は unknown。
export function classifyRegime(density, opts = {}) {
  const { threshold = 1.5 } = opts;
  if (density == null) return 'unknown';
  return density >= threshold ? 'volume' : 'value';
}
```

- [ ] **Step 4: 合格確認** — `npm test -- tests/coach-regime.test.js`（7件 PASS）

- [ ] **Step 5: コミット**

```bash
git add js/coach/regime.js tests/coach-regime.test.js
git commit -m "feat(coach): レジーム判定(expectedRideDensity/classifyRegime)"
```

---

## Task 2: レジームを FactPack・回答に統合

**Files:**
- Modify: `js/coach/fact-engine.js`
- Modify: `js/coach/answer-composer.js`
- Modify: `js/coach/answer-format.js`
- Test: 既存 `tests/coach-fact-engine.test.js` / `tests/coach-answer-composer.test.js` / `tests/coach-answer-format.test.js` に追記

**設計:**
- `buildFactPack` の戻り値に `regime: { kind:'volume'|'value'|'unknown', density:number|null }` を追加（ctx.dow, ctx.hour, drives から算出）。
- `composeAnswer` の AnswerPlan に `regime`（FactPack の regime をそのまま）を追加。
- `formatAnswer` をレジームで出し分け（後方互換: regime 無し/unknown は従来通り）:
  - 見出し行に続けて、`regime.kind==='volume'` → **回転の時間**: 次の一手(moves)＋根拠(hourlyA)を出す（高単価spotsは出さない＝高単価狙いノイズを抑制）。
  - `regime.kind==='value'` → **単価の時間**: 高単価エリア(spots)＋根拠を出す（movesは控える）。
  - `regime.kind==='unknown'` or 未指定 → 従来通り（moves＋spots＋根拠）。
  - レジーム見出し: volume=`'🔁 今は回転の時間（数で稼ぐ）'` / value=`'💎 今は単価の時間（1組を大きく）'` を、目標見出しの次に1行。

### 2-1. fact-engine.js

- [ ] **Step 1: 失敗テスト**（`tests/coach-fact-engine.test.js` に追記）

```javascript
it('regime: dow×hourの期待乗車数からvolume/valueを判定して載せる', () => {
  const busy = [
    { date: '2026-05-01', departureTime: '07:00', returnTime: '23:00', trips: [
      { amount: 2000, boardTime: '19:10', alightTime: '19:25', boardPlace: '港区六本木6', alightPlace: '渋谷区恵比寿1', isCancel: false },
      { amount: 2200, boardTime: '19:40', alightTime: '19:55', boardPlace: '港区西麻布2', alightPlace: '目黒区中目黒1', isCancel: false },
    ] },
    { date: '2026-05-08', departureTime: '07:00', returnTime: '23:00', trips: [
      { amount: 2400, boardTime: '19:15', alightTime: '19:30', boardPlace: '港区六本木6', alightPlace: '渋谷区渋谷2', isCancel: false },
    ] },
  ];
  // 金曜19時台: (2+1)/2 = 1.5 → threshold1.5以上 → volume
  const fp = buildFactPack({ drives: busy, ctx: { area: '港区六本木', dow: 5, hour: 19, nowMin: 1140, vehicleType: 'premium' }, goal: null, todaySales: 0 });
  assert.strictEqual(fp.regime.kind, 'volume');
  assert.strictEqual(fp.regime.density, 1.5);

  // 履歴のない月曜 → unknown
  const fp2 = buildFactPack({ drives: busy, ctx: { area: '港区六本木', dow: 1, hour: 19, nowMin: 1140, vehicleType: 'premium' }, goal: null, todaySales: 0 });
  assert.strictEqual(fp2.regime.kind, 'unknown');
});
```

- [ ] **Step 2: 失敗確認** — `npm test -- tests/coach-fact-engine.test.js`

- [ ] **Step 3: 実装** — `js/coach/fact-engine.js`

import 行に regime を追加:
```javascript
import { expectedRideDensity, classifyRegime } from './regime.js';
```
`buildFactPack` の return 直前に追加し、return に `regime` を足す:
```javascript
  const density = expectedRideDensity(drives, dow, hour);
  const regime = { kind: classifyRegime(density), density };

  return {
    now: { area, dow, hour, vehicleType },
    you: { hourlyA },
    nextMoves,
    highValue: hv,
    goal: goalProgress,
    regime,
  };
```

- [ ] **Step 4: 合格＋既存緑** — `npm test -- tests/coach-fact-engine.test.js`

### 2-2. answer-composer.js

- [ ] **Step 5: 失敗テスト**（`tests/coach-answer-composer.test.js` に追記）

```javascript
it('regime を AnswerPlan に載せる', () => {
  const fp = { ...baseFactPack, regime: { kind: 'value', density: 0.5 } };
  const a = composeAnswer(fp, 'assess-here');
  assert.deepStrictEqual(a.regime, { kind: 'value', density: 0.5 });
});
it('regime 未指定なら kind unknown を既定にする', () => {
  const a = composeAnswer(baseFactPack, 'assess-here'); // baseFactPack に regime なし
  assert.strictEqual(a.regime.kind, 'unknown');
});
```
（注: baseFactPack に regime が無い前提。既存の baseFactPack 定義は変更しない。）

- [ ] **Step 6: 実装** — `composeAnswer` の return に追加:
```javascript
  const regime = factPack.regime || { kind: 'unknown', density: null };
  return { intent, status, facts, moves, spots, basis, regime };
```

- [ ] **Step 7: 合格** — `npm test -- tests/coach-answer-composer.test.js`

### 2-3. answer-format.js

- [ ] **Step 8: 失敗テスト**（`tests/coach-answer-format.test.js` に追記）

```javascript
it('volumeレジーム: 回転見出し＋次の一手を出し、高単価エリアは出さない', () => {
  const plan = {
    intent: 'assess-here', status: 'in-progress',
    facts: { remainingYen: null, neededTrips: null, remainingMin: null, hourlyA: 3900 },
    moves: [ { area: '港区西麻布', count: 3 } ],
    spots: [ { area: '港区六本木', period: '夜', avgSales: 2600 } ],
    basis: [], regime: { kind: 'volume', density: 2.5 },
  };
  const t = formatAnswer(plan).join('\n');
  assert.ok(t.includes('回転'));
  assert.ok(t.includes('港区西麻布'));        // moves は出す
  assert.ok(!t.includes('高期待値'));         // 高単価spotsは出さない
});
it('valueレジーム: 単価見出し＋高単価エリアを出す', () => {
  const plan = {
    intent: 'assess-here', status: 'in-progress',
    facts: { remainingYen: null, neededTrips: null, remainingMin: null, hourlyA: 3900 },
    moves: [ { area: '港区西麻布', count: 3 } ],
    spots: [ { area: '港区六本木', period: '夜', avgSales: 2600 } ],
    basis: [], regime: { kind: 'value', density: 0.5 },
  };
  const t = formatAnswer(plan).join('\n');
  assert.ok(t.includes('単価'));
  assert.ok(t.includes('高期待値'));          // 高単価spotsを出す
  assert.ok(t.includes('港区六本木'));
});
it('regime未指定は従来通り（moves も spots も出す）', () => {
  const plan = {
    intent: 'reach-goal', status: 'in-progress',
    facts: { remainingYen: 8600, neededTrips: 4, remainingMin: null, hourlyA: 3900 },
    moves: [ { area: '港区西麻布', count: 3 } ],
    spots: [ { area: '港区六本木', period: '夜', avgSales: 2600 } ],
    basis: [],
  };
  const t = formatAnswer(plan).join('\n');
  assert.ok(t.includes('港区西麻布') && t.includes('高期待値'));
});
```

- [ ] **Step 9: 失敗確認** — `npm test -- tests/coach-answer-format.test.js`

- [ ] **Step 10: 実装** — `js/coach/answer-format.js`

見出し（status/intent）行の後に、レジーム見出しと出し分けを追加。既存の「次の一手」「高期待値」「根拠」ブロックを、regime で条件分岐する形に変更（後方互換: regime 無し/unknown は両方出す）:

```javascript
  const regime = plan.regime || { kind: 'unknown' };

  // レジーム見出し
  if (regime.kind === 'volume') lines.push('🔁 今は回転の時間（数で稼ぐ）');
  else if (regime.kind === 'value') lines.push('💎 今は単価の時間（1組を大きく）');

  // 次の一手（volume と unknown で出す。value では控える）
  if (regime.kind !== 'value' && Array.isArray(plan.moves) && plan.moves.length) {
    lines.push(`次の一手：${plan.moves.map((m) => m.area).join(' → ')}`);
  }

  // 高期待値エリア（value と unknown で出す。volume では出さない＝高単価ノイズ抑制）
  if (regime.kind !== 'volume' && Array.isArray(plan.spots) && plan.spots.length) {
    lines.push(`高期待値：${plan.spots.map((s) => `${s.area}(${s.period}) ¥${yen(s.avgSales)}`).join('、')}`);
  }

  if (f.hourlyA != null) {
    lines.push(`根拠：この時間のあなたの時給 ¥${yen(f.hourlyA)}/時`);
  }
```
（既存の「次の一手」「高期待値」ブロックを上記の条件付き版に置き換える。見出し・根拠・数値整形(yen)はそのまま。）

- [ ] **Step 11: 合格＋全件回帰** — `npm test`
Expected: 既存（regime無しのテスト含む）全 PASS ＋ 新規 PASS

- [ ] **Step 12: コミット**

```bash
git add js/coach/fact-engine.js js/coach/answer-composer.js js/coach/answer-format.js tests/coach-fact-engine.test.js tests/coach-answer-composer.test.js tests/coach-answer-format.test.js
git commit -m "feat(coach): レジームで助言を出し分け(量=回転/単価=高単価)"
```

---

## 完了の定義（Step 1）

- `expectedRideDensity`/`classifyRegime` が TDD で実装され `npm test` 全緑。
- 同じ場所でも**dow×hour のレジームで回答が変わる**（量＝次の一手中心／単価＝高単価エリア中心）。高単価ノイズはvolume時に抑制。
- 全数値が実データ由来。後方互換（regime 無しは従来挙動）。

## 後続（v2 Step 2-4）

- Step 2: 流れレイヤー（effectiveSpeedByAreaTime＝km/乗車分）で渋滞回避を移動助言に統合。
- Step 3: 移動しながら稼ぐ（repositionChain で得意エリアへ稼ぎながら）。
- Step 4: 羽田・外乱（既存空港データ接続）。
- しきい値(threshold=1.5)は dev 実データで較正。

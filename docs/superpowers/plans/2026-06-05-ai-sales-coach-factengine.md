# AI営業相談コーチ — Plan 1: FactEngine（事実エンジン）＋目標ロジック 実装プラン

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** AI相談コーチの心臓部＝「目標進捗の逆算」と「相談時の事実パック生成」を、DOM非依存の純関数として作りTDDで固める。

**Architecture:** 既存 `chart-helpers.js` の分析純関数（hourlyDowEfficiency / nextBoardBreakdown / highValueAreas / stabilityTier / extractArea）を組み替え、現在地・時刻・目標・進捗から構造化「事実パック」を返す `buildFactPack()` を作る。数字はここで全部確定し、後続のLLMはこの事実パックを語るだけになる（数字の捏造防止）。UI・LLM・全体プールは後続プラン。

**Tech Stack:** 素のESM（`"type":"module"`）、テストは Node.js native `node:test` + `node:assert`。バンドラ無し。

このプランは全体ロードマップの Plan 1/4。
- **Plan 1（本書）**: FactEngine ＋ 目標ロジック（純関数・own-history）
- Plan 2: LLMAdapter（モデル非依存）＋ worker 中継エンドポイント
- Plan 3: CoachUI（チャット画面・目標設定・プリセット・フルプランゲート）
- Plan 4: GlobalPoolBatch（全体匿名プールを車種セグメントで FactEngine に統合）

---

## File Structure

| ファイル | 責務 |
|---|---|
| `js/coach/daily-goal.js`（新規） | 今日の目標(¥/帰宅時刻)と進捗スナップショットから残¥/残時間/必要本数/到達を計算する純関数 |
| `js/coach/fact-engine.js`（新規） | 現在地・時刻・目標・履歴から構造化「事実パック」を生成。chart-helpers の集計を組み替え |
| `tests/coach-daily-goal.test.js`（新規） | daily-goal の単体テスト |
| `tests/coach-fact-engine.test.js`（新規） | fact-engine の単体テスト |

`js/coach/` という新ディレクトリにコーチ関連を集約（責務でまとめる）。既存 `chart-helpers.js` は変更しない（読み取り専用で利用）。

---

## Task 1: 目標ロジック `daily-goal.js`

「今日の目標」と当日進捗から、AIが語る逆算事実を返す純関数。最も決定論的な核なのでここを厳密にTDDする。

**Files:**
- Create: `js/coach/daily-goal.js`
- Test: `tests/coach-daily-goal.test.js`

**型の定義（このタスクで確定。後続タスク・プランはこの名前に従う）:**

```
Goal =
  | { type: 'money', targetYen: number }
  | { type: 'time',  targetReturnMin: number, targetYen?: number | null }

ProgressSnapshot = { todaySales: number, nowMin: number, avgTripYen: number | null }

GoalProgress = {
  type: 'money' | 'time',
  remainingYen: number | null,   // 目標額 - 当日売上（下限0）。額目標が無ければ null
  remainingMin: number | null,   // 帰宅時刻 - 現在（下限0）。時刻目標で無ければ null
  neededTrips: number | null,    // remainingYen / avgTripYen の切り上げ。算出不能なら null
  reached: boolean               // 目標到達済みか
}
```

- `nowMin` / `targetReturnMin` は「0時からの経過分」（例 19:00 = 1140）。

- [ ] **Step 1: 失敗するテストを書く**

`tests/coach-daily-goal.test.js` を新規作成:

```javascript
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { computeGoalProgress } from '../js/coach/daily-goal.js';

describe('computeGoalProgress', () => {
  it('額目標: 残額と必要本数を切り上げで返す', () => {
    const goal = { type: 'money', targetYen: 30000 };
    const snap = { todaySales: 21400, nowMin: 1307, avgTripYen: 2300 };
    const r = computeGoalProgress(goal, snap);
    assert.strictEqual(r.type, 'money');
    assert.strictEqual(r.remainingYen, 8600);
    assert.strictEqual(r.neededTrips, 4);   // ceil(8600/2300)=ceil(3.73)=4
    assert.strictEqual(r.remainingMin, null);
    assert.strictEqual(r.reached, false);
  });

  it('額目標: 到達済みは remainingYen=0 / neededTrips=0 / reached=true', () => {
    const goal = { type: 'money', targetYen: 30000 };
    const snap = { todaySales: 31000, nowMin: 1200, avgTripYen: 2300 };
    const r = computeGoalProgress(goal, snap);
    assert.strictEqual(r.remainingYen, 0);
    assert.strictEqual(r.neededTrips, 0);
    assert.strictEqual(r.reached, true);
  });

  it('時刻目標: 残時間を返す。額目標が無ければ remainingYen/neededTrips は null', () => {
    const goal = { type: 'time', targetReturnMin: 1140 }; // 19:00
    const snap = { todaySales: 18000, nowMin: 1080, avgTripYen: 2300 }; // 18:00
    const r = computeGoalProgress(goal, snap);
    assert.strictEqual(r.type, 'time');
    assert.strictEqual(r.remainingMin, 60);
    assert.strictEqual(r.remainingYen, null);
    assert.strictEqual(r.neededTrips, null);
    assert.strictEqual(r.reached, false);
  });

  it('時刻目標＋額目標併記: 残時間と残額の両方を返す', () => {
    const goal = { type: 'time', targetReturnMin: 1140, targetYen: 30000 };
    const snap = { todaySales: 26000, nowMin: 1100, avgTripYen: 2000 };
    const r = computeGoalProgress(goal, snap);
    assert.strictEqual(r.remainingMin, 40);
    assert.strictEqual(r.remainingYen, 4000);
    assert.strictEqual(r.neededTrips, 2); // ceil(4000/2000)
  });

  it('avgTripYen が null/0 のとき neededTrips は null（ゼロ割を防ぐ）', () => {
    const goal = { type: 'money', targetYen: 30000 };
    const r = computeGoalProgress(goal, { todaySales: 10000, nowMin: 1000, avgTripYen: null });
    assert.strictEqual(r.neededTrips, null);
    assert.strictEqual(r.remainingYen, 20000);
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `npm test -- tests/coach-daily-goal.test.js`
Expected: FAIL（`Cannot find module '../js/coach/daily-goal.js'`）

- [ ] **Step 3: 最小実装を書く**

`js/coach/daily-goal.js` を新規作成:

```javascript
// 今日の目標と当日進捗から、相談で語る逆算事実を計算する純関数。
// nowMin / targetReturnMin は0時からの経過分（例 19:00 = 1140）。

export function computeGoalProgress(goal, snapshot) {
  const todaySales = Number(snapshot?.todaySales) || 0;
  const nowMin = Number(snapshot?.nowMin) || 0;
  const avgTripYen = Number(snapshot?.avgTripYen);

  const type = goal?.type === 'time' ? 'time' : 'money';

  // 額目標は money の targetYen、または time に併記された targetYen
  const targetYen = (goal && goal.targetYen != null) ? Number(goal.targetYen) : null;
  const remainingYen = targetYen != null ? Math.max(0, targetYen - todaySales) : null;

  const remainingMin = (type === 'time' && goal.targetReturnMin != null)
    ? Math.max(0, Number(goal.targetReturnMin) - nowMin)
    : null;

  const neededTrips = (remainingYen != null && Number.isFinite(avgTripYen) && avgTripYen > 0)
    ? Math.ceil(remainingYen / avgTripYen)
    : null;

  const reached = type === 'time'
    ? (remainingMin === 0)
    : (remainingYen === 0);

  return { type, remainingYen, remainingMin, neededTrips, reached };
}
```

- [ ] **Step 4: テストを実行して合格を確認**

Run: `npm test -- tests/coach-daily-goal.test.js`
Expected: PASS（5 it 全て）

- [ ] **Step 5: コミット**

```bash
git add js/coach/daily-goal.js tests/coach-daily-goal.test.js
git commit -m "feat(coach): 目標進捗の逆算ロジック(daily-goal)"
```

---

## Task 2: 事実エンジン `fact-engine.js`

現在地・時刻・目標・履歴から構造化「事実パック」を生成。既存 chart-helpers の純関数を組み替える。

**Files:**
- Create: `js/coach/fact-engine.js`
- Test: `tests/coach-fact-engine.test.js`

**型の定義（このタスクで確定）:**

```
Ctx = { area: string, dow: number(0-6), hour: number(0-23), nowMin: number, vehicleType: string }

FactPack = {
  now: { area, dow, hour, vehicleType },
  you: { hourlyA: number | null },          // 自分のこの曜日×時間の時給(円/時)。実績無ければ null
  nextMoves: Array<{ area: string, count: number }>,  // 現在エリアから次に取れた乗車先 上位3
  highValue: Array<{ area: string, period: string, avgSales: number }>, // 高期待値エリア 上位3
  goal: GoalProgress | null                 // goal 未指定なら null
}
```

`avgTripYen`（必要本数の算出に使う）は drives の非キャンセル trip 金額の平均から内部で計算する。

- [ ] **Step 1: 失敗するテストを書く**

`tests/coach-fact-engine.test.js` を新規作成:

```javascript
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { buildFactPack, avgTripYen } from '../js/coach/fact-engine.js';

// 最小フィクスチャ: 2日分。trips は amount/boardPlace/alightPlace/boardTime を持つ。
const drives = [
  {
    date: '2026-05-01', departureTime: '07:00',
    trips: [
      { amount: 2000, km: 5, boardTime: '19:10', boardPlace: '港区六本木6', alightPlace: '渋谷区恵比寿1', isPickup: false, isCancel: false },
      { amount: 2600, km: 7, boardTime: '19:40', boardPlace: '港区西麻布2', alightPlace: '目黒区中目黒1', isPickup: false, isCancel: false },
      { amount: 0,    km: 0, boardTime: '20:00', boardPlace: '港区六本木6', alightPlace: '港区六本木6', isPickup: true,  isCancel: true },
    ],
  },
  {
    date: '2026-05-08', departureTime: '07:00',
    trips: [
      { amount: 2400, km: 6, boardTime: '19:15', boardPlace: '港区六本木6', alightPlace: '渋谷区渋谷2', isPickup: false, isCancel: false },
    ],
  },
];

describe('avgTripYen', () => {
  it('キャンセル(amount0)を除いた平均を返す', () => {
    // (2000+2600+2400)/3 = 2333.33...
    assert.strictEqual(Math.round(avgTripYen(drives)), 2333);
  });
  it('trip 無しは null', () => {
    assert.strictEqual(avgTripYen([]), null);
  });
});

describe('buildFactPack', () => {
  const ctx = { area: '港区六本木', dow: 4, hour: 19, nowMin: 1170, vehicleType: 'premium' };

  it('now と you と配列キーを返す', () => {
    const fp = buildFactPack({ drives, ctx, goal: null, todaySales: 0 });
    assert.deepStrictEqual(fp.now, { area: '港区六本木', dow: 4, hour: 19, vehicleType: 'premium' });
    assert.ok('hourlyA' in fp.you);
    assert.ok(Array.isArray(fp.nextMoves));
    assert.ok(Array.isArray(fp.highValue));
    assert.strictEqual(fp.goal, null);
  });

  it('goal を渡すと逆算が事実パックに入る', () => {
    const goal = { type: 'money', targetYen: 30000 };
    const fp = buildFactPack({ drives, ctx, goal, todaySales: 21400 });
    assert.strictEqual(fp.goal.remainingYen, 8600);
    // avgTripYen≈2333 → ceil(8600/2333)=4
    assert.strictEqual(fp.goal.neededTrips, 4);
  });

  it('nextMoves は現在エリアから取れた次乗車先で、最大3件', () => {
    const fp = buildFactPack({ drives, ctx, goal: null, todaySales: 0 });
    assert.ok(fp.nextMoves.length <= 3);
    // 六本木で降りた後の次乗車先（西麻布等）が候補に含まれ得る。配列であることを保証。
    for (const m of fp.nextMoves) {
      assert.ok(typeof m.area === 'string');
      assert.ok(typeof m.count === 'number');
    }
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `npm test -- tests/coach-fact-engine.test.js`
Expected: FAIL（`Cannot find module '../js/coach/fact-engine.js'`）

※ この実行で `chart-helpers.js` が node 環境で import できることも同時に検証される（DOM参照があるとここでエラーになる。その場合は Step 3 の対処メモ参照）。

- [ ] **Step 3: 最小実装を書く**

`js/coach/fact-engine.js` を新規作成:

```javascript
import {
  hourlyDowEfficiency,
  nextBoardBreakdown,
  highValueAreas,
} from '../chart-helpers.js';
import { computeGoalProgress } from './daily-goal.js';

// 非キャンセル trip の平均運賃。trip が無ければ null。
export function avgTripYen(drives) {
  let sum = 0, n = 0;
  for (const d of (drives || [])) {
    for (const t of (d.trips || [])) {
      if (t.isCancel) continue;
      const a = Number(t.amount);
      if (Number.isFinite(a) && a > 0) { sum += a; n += 1; }
    }
  }
  return n > 0 ? sum / n : null;
}

// 現在地・時刻・目標・履歴 → 事実パック（数字はここで確定）
export function buildFactPack(input) {
  const { drives = [], ctx, goal = null, todaySales = 0 } = input;
  const { area, dow, hour, nowMin, vehicleType } = ctx;

  // 自分のこの曜日×時間の時給
  const eff = hourlyDowEfficiency(drives);
  const cell = (eff[dow] && eff[dow][hour]) ? eff[dow][hour] : null;
  const hourlyA = (cell && cell.days > 0 && Number.isFinite(cell.hourlyA))
    ? Math.round(cell.hourlyA) : null;

  // 現在エリアから次に取れた乗車先（上位3）
  const nb = nextBoardBreakdown(drives, area, hour, 1, null);
  const nextMoves = (nb.rows || []).slice(0, 3).map((r) => ({
    area: r.area,
    count: Number(r.count) || 0,
  }));

  // 高期待値エリア（上位3）
  const hv = highValueAreas(drives, { minSamples: 1 }).slice(0, 3).map((h) => ({
    area: h.area,
    period: h.period,
    avgSales: Math.round(h.avgSales),
  }));

  // 目標逆算
  const goalProgress = goal
    ? computeGoalProgress(goal, { todaySales, nowMin, avgTripYen: avgTripYen(drives) })
    : null;

  return {
    now: { area, dow, hour, vehicleType },
    you: { hourlyA },
    nextMoves,
    highValue: hv,
    goal: goalProgress,
  };
}
```

**対処メモ（Step 2 で chart-helpers の import が DOM 参照で落ちた場合のみ）:** 落ちた関数のDOM依存箇所を確認し、純関数部分が別ファイルに分離可能なら最小限の抽出を別タスク化する。まずは落ちるか実測してから判断（推測で先回りしない）。

- [ ] **Step 4: テストを実行して合格を確認**

Run: `npm test -- tests/coach-fact-engine.test.js`
Expected: PASS

※ `nextBoardBreakdown` / `highValueAreas` の rows 内部キー（`area`/`count`/`period`/`avgSales`）が実装と異なっていた場合、テストの該当 assert が落ちる。その場合は実関数の戻り値を `console.log` で1度確認し、マッピングを実物に合わせて修正（数字の意味は変えない）。

- [ ] **Step 5: 全テストを実行（回帰確認）**

Run: `npm test`
Expected: 既存テスト含め全 PASS（新規2ファイルも緑）

- [ ] **Step 6: コミット**

```bash
git add js/coach/fact-engine.js tests/coach-fact-engine.test.js
git commit -m "feat(coach): 事実エンジン(fact-engine)で事実パック生成"
```

---

## 完了の定義（Plan 1）

- `computeGoalProgress` と `buildFactPack` が純関数として実装され、`npm test` が全緑。
- 事実パックの全数値（残¥/必要本数/時給/次乗車先/高期待値）が実データ由来で確定する。
- DOM・ネットワーク・LLM・UI は一切含まない（後続プランの土台）。

## 後続プラン（別途、各自フル詳細化する）

- **Plan 2 — LLMAdapter ＋ worker中継**: 事実パック＋質問→自然言語応答。`worker/src/index.js` に `/coach/ask` を追加（既存エンドポイント追加流儀に従う）。モデルは env binding 経由で差し替え可能なadapter。応答後に「事実パックに無い数値を出していないか」の検証を入れる。
- **Plan 3 — CoachUI**: `coach.html` 新規＋ `js/coach/coach-ui.js`。出庫時の目標設定、現在地取得（既存GPS→町名・非保存）、プリセットチップ、チャット表示。`enforceAccess('analysis')` でフルプラン限定。`sw.js` の STATIC_FILES 追加＋CACHE_NAME bump。
- **Plan 4 — GlobalPoolBatch**: 既存 group-anon / group-pool-core を全体匿名プールへ拡張（車種×エリア×時間、k匿名≥2）。worker に日次集計、FactPack に `pool` セグメントを統合。

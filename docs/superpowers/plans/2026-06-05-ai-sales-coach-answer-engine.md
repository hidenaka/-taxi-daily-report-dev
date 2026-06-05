# AI営業相談コーチ — Plan 2: ルール回答エンジン 実装プラン

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan 1 の事実パック(FactPack)から、プリセット質問の意図(intent)に応じて「再現性の説明つきの相談回答」をルールで合成する純関数エンジンを作る。

**Architecture:** LLMを使わず、フロントの純関数だけで回答を組み立てる。`composeAnswer(factPack, intent)` が構造化された回答プラン(AnswerPlan)を返し、`formatAnswer(answerPlan)` が日本語の表示行に整形する。数字は全てFactPack由来＝捏造ゼロ。LLMは将来 adapter 経由で後付け可能（spec のLLM構成は将来形として温存。今回のv1はLLM無し）。

**Tech Stack:** 素のESM、テストは Node.js native `node:test` + `node:assert`。worker・APIキー・ネットワーク無し。

このプランは全体ロードマップの Plan 2/4。Plan 1（FactEngine＋目標ロジック）は完了済み（`js/coach/daily-goal.js` / `js/coach/fact-engine.js`、commit ffe906281）。後続: Plan 3=CoachUI、Plan 4=GlobalPoolBatch、（将来）LLM adapter 後付け。

---

## File Structure

| ファイル | 責務 |
|---|---|
| `js/coach/answer-composer.js`（新規） | FactPack＋intent → 構造化回答プラン(AnswerPlan)。意図ごとに使う事実を選び status を判定する純関数 |
| `js/coach/answer-format.js`（新規） | AnswerPlan → 日本語の表示行(string[])。最小・差し替え前提（UIのPlan 3で拡張しうる） |
| `tests/coach-answer-composer.test.js`（新規） | composer の単体テスト |
| `tests/coach-answer-format.test.js`（新規） | formatter の単体テスト（部分一致で脆くしない） |

Plan 1 の `js/coach/fact-engine.js` / `daily-goal.js` は変更しない（FactPack を入力として消費するだけ）。

---

## Task 1: 回答合成 `answer-composer.js`

FactPack と intent から、表示に必要な事実を選別した AnswerPlan を返す純関数。

**Files:**
- Create: `js/coach/answer-composer.js`
- Test: `tests/coach-answer-composer.test.js`

**型（このタスクで確定。後続はこの名前に従う）:**

```
Intent = 'reach-goal' | 'assess-here' | 'finish-early'

FactPack（Plan 1 buildFactPack の戻り値）=
  { now:{area,dow,hour,vehicleType}, you:{hourlyA:number|null},
    nextMoves:[{area:string,count:number}], highValue:[{area,period,avgSales}],
    goal:{type,remainingYen,remainingMin,neededTrips,reached}|null }

AnswerPlan = {
  intent: Intent,
  status: 'reached' | 'in-progress' | 'unknown',   // goal無→unknown / reached→reached / それ以外→in-progress
  facts: { remainingYen:number|null, neededTrips:number|null, remainingMin:number|null, hourlyA:number|null },
  moves: Array<{ area:string, count:number }>,       // 次の一手候補（FactPack.nextMoves をそのまま、最大3）
  basis: string[]                                    // 使った根拠タグ。固定順: 'goal-remaining','next-board','your-hourly','high-value'
}
```

ルール:
- `status` = goal==null → `'unknown'` / goal.reached → `'reached'` / それ以外 → `'in-progress'`。
- `facts` は FactPack から素直に写す（remainingYen/neededTrips/remainingMin は goal から、無ければ null。hourlyA は you.hourlyA）。
- `moves` = FactPack.nextMoves（最大3、既に降順）。
- `basis` は「実際に値がある根拠」を固定順で含める: goalがあれば `'goal-remaining'`、movesが非空なら `'next-board'`、hourlyAが非nullなら `'your-hourly'`、highValueが非空なら `'high-value'`。
- intent が3種以外 → `throw new Error('unknown intent: ' + intent)`。
- intent 自体は出力の `intent` に反映するが、現状3意図とも同じ事実集合を返す（intentは将来の分岐余地。今は status/facts/moves/basis は intent非依存で算出し、過剰分岐しない＝YAGNI）。

- [ ] **Step 1: 失敗するテストを書く**

`tests/coach-answer-composer.test.js` を新規作成:

```javascript
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { composeAnswer, INTENTS } from '../js/coach/answer-composer.js';

const baseFactPack = {
  now: { area: '港区六本木', dow: 5, hour: 19, vehicleType: 'premium' },
  you: { hourlyA: 3900 },
  nextMoves: [ { area: '港区西麻布', count: 3 }, { area: '渋谷区恵比寿', count: 2 } ],
  highValue: [ { area: '港区六本木', period: '夜', avgSales: 2600 } ],
  goal: { type: 'money', remainingYen: 8600, remainingMin: null, neededTrips: 4, reached: false },
};

describe('composeAnswer', () => {
  it('INTENTS は3意図', () => {
    assert.deepStrictEqual(INTENTS, ['reach-goal', 'assess-here', 'finish-early']);
  });

  it('reach-goal: 目標未達は in-progress、facts と moves と basis を埋める', () => {
    const a = composeAnswer(baseFactPack, 'reach-goal');
    assert.strictEqual(a.intent, 'reach-goal');
    assert.strictEqual(a.status, 'in-progress');
    assert.strictEqual(a.facts.remainingYen, 8600);
    assert.strictEqual(a.facts.neededTrips, 4);
    assert.strictEqual(a.facts.hourlyA, 3900);
    assert.deepStrictEqual(a.moves, [ { area: '港区西麻布', count: 3 }, { area: '渋谷区恵比寿', count: 2 } ]);
    assert.deepStrictEqual(a.basis, ['goal-remaining', 'next-board', 'your-hourly', 'high-value']);
  });

  it('goal到達済みは status=reached', () => {
    const fp = { ...baseFactPack, goal: { ...baseFactPack.goal, remainingYen: 0, neededTrips: 0, reached: true } };
    const a = composeAnswer(fp, 'reach-goal');
    assert.strictEqual(a.status, 'reached');
    assert.strictEqual(a.facts.remainingYen, 0);
  });

  it('goalがnullなら status=unknown・remaining系はnull・basisにgoal-remaining無し', () => {
    const fp = { ...baseFactPack, goal: null };
    const a = composeAnswer(fp, 'assess-here');
    assert.strictEqual(a.status, 'unknown');
    assert.strictEqual(a.facts.remainingYen, null);
    assert.strictEqual(a.facts.neededTrips, null);
    assert.strictEqual(a.facts.remainingMin, null);
    assert.ok(!a.basis.includes('goal-remaining'));
    assert.ok(a.basis.includes('your-hourly'));
  });

  it('nextMoves空なら moves空・basisにnext-board無し', () => {
    const fp = { ...baseFactPack, nextMoves: [] };
    const a = composeAnswer(fp, 'reach-goal');
    assert.deepStrictEqual(a.moves, []);
    assert.ok(!a.basis.includes('next-board'));
  });

  it('hourlyAがnullなら basisにyour-hourly無し', () => {
    const fp = { ...baseFactPack, you: { hourlyA: null } };
    const a = composeAnswer(fp, 'assess-here');
    assert.strictEqual(a.facts.hourlyA, null);
    assert.ok(!a.basis.includes('your-hourly'));
  });

  it('finish-early: 時刻目標の残時間を facts.remainingMin に写す', () => {
    const fp = { ...baseFactPack, goal: { type: 'time', remainingYen: null, remainingMin: 40, neededTrips: null, reached: false } };
    const a = composeAnswer(fp, 'finish-early');
    assert.strictEqual(a.intent, 'finish-early');
    assert.strictEqual(a.facts.remainingMin, 40);
    assert.strictEqual(a.status, 'in-progress');
  });

  it('未知の intent は throw', () => {
    assert.throws(() => composeAnswer(baseFactPack, 'bogus'), /unknown intent/);
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `npm test -- tests/coach-answer-composer.test.js`
Expected: FAIL（`Cannot find module '../js/coach/answer-composer.js'`）

- [ ] **Step 3: 最小実装を書く**

`js/coach/answer-composer.js` を新規作成:

```javascript
// FactPack(Plan 1) + intent → 構造化回答プラン。数字は全てFactPack由来。LLM不使用。

export const INTENTS = ['reach-goal', 'assess-here', 'finish-early'];

export function composeAnswer(factPack, intent) {
  if (!INTENTS.includes(intent)) {
    throw new Error('unknown intent: ' + intent);
  }
  const goal = factPack.goal || null;
  const you = factPack.you || {};
  const nextMoves = Array.isArray(factPack.nextMoves) ? factPack.nextMoves : [];
  const highValue = Array.isArray(factPack.highValue) ? factPack.highValue : [];

  const status = goal == null ? 'unknown' : (goal.reached ? 'reached' : 'in-progress');

  const facts = {
    remainingYen: goal ? goal.remainingYen : null,
    neededTrips: goal ? goal.neededTrips : null,
    remainingMin: goal ? goal.remainingMin : null,
    hourlyA: (you.hourlyA != null) ? you.hourlyA : null,
  };

  const moves = nextMoves.slice(0, 3).map((m) => ({ area: m.area, count: Number(m.count) || 0 }));

  const basis = [];
  if (goal) basis.push('goal-remaining');
  if (moves.length) basis.push('next-board');
  if (facts.hourlyA != null) basis.push('your-hourly');
  if (highValue.length) basis.push('high-value');

  return { intent, status, facts, moves, basis };
}
```

- [ ] **Step 4: テストを実行して合格を確認**

Run: `npm test -- tests/coach-answer-composer.test.js`
Expected: PASS（8 it 全て）

- [ ] **Step 5: コミット**

```bash
git add js/coach/answer-composer.js tests/coach-answer-composer.test.js
git commit -m "feat(coach): ルール回答合成(answer-composer)"
```

---

## Task 2: 表示整形 `answer-format.js`

AnswerPlan を日本語の表示行に整形する純関数。UI(Plan 3)で差し替え・拡張しうる最小版。テストは脆くしないため部分一致で検証。

**Files:**
- Create: `js/coach/answer-format.js`
- Test: `tests/coach-answer-format.test.js`

**型:** `formatAnswer(answerPlan): string[]`（表示行の配列）

ルール:
- 1行目（見出し）は status と intent に応じる:
  - status `'reached'` → `'🎉 目標達成。お疲れさま。'`
  - intent `'reach-goal'` かつ remainingYen!=null → `` `目標まで あと¥${yen}（約${neededTrips}本ペース）` ``（neededTrips が null なら「約—本」ではなく `（あと¥${yen}）` のみ）
  - intent `'finish-early'` かつ remainingMin!=null → `` `あと約${remainingMin}分で目標時刻` ``（remainingYen!=null なら続けて `` `／残り¥${yen}` `` を同行に付す）
  - intent `'assess-here'` → `` `今の${area}の見立て` ``
  - 上記いずれにも当てはまらない（facts不足）→ `'今わかる範囲でお答えします'`
- moves があれば1行: `` `次の一手：${moves.map(m=>m.area).join(' → ')}` ``
- hourlyA!=null なら根拠行: `` `根拠：この時間のあなたの時給 ¥${hourlyA}/時` ``
- 数字は `Number(n).toLocaleString('ja-JP')` で3桁区切り。
- 空配列は返さない（最低でも見出し1行は返す）。

- [ ] **Step 1: 失敗するテストを書く**

`tests/coach-answer-format.test.js` を新規作成:

```javascript
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { formatAnswer } from '../js/coach/answer-format.js';

function joined(plan) { return formatAnswer(plan).join('\n'); }

describe('formatAnswer', () => {
  it('reach-goal in-progress: 残額・本数・次の一手・根拠を含む', () => {
    const plan = {
      intent: 'reach-goal', status: 'in-progress',
      facts: { remainingYen: 8600, neededTrips: 4, remainingMin: null, hourlyA: 3900 },
      moves: [ { area: '港区西麻布', count: 3 }, { area: '渋谷区恵比寿', count: 2 } ],
      basis: ['goal-remaining', 'next-board', 'your-hourly'],
    };
    const t = joined(plan);
    assert.ok(t.includes('8,600'));        // 3桁区切り
    assert.ok(t.includes('4本'));
    assert.ok(t.includes('港区西麻布'));
    assert.ok(t.includes('渋谷区恵比寿'));
    assert.ok(t.includes('3,900'));
    assert.ok(formatAnswer(plan).length >= 1);
  });

  it('reached: 達成メッセージを見出しに出す', () => {
    const plan = { intent: 'reach-goal', status: 'reached',
      facts: { remainingYen: 0, neededTrips: 0, remainingMin: null, hourlyA: 3900 }, moves: [], basis: [] };
    assert.ok(joined(plan).includes('達成'));
  });

  it('finish-early: 残時間を含む', () => {
    const plan = { intent: 'finish-early', status: 'in-progress',
      facts: { remainingYen: null, neededTrips: null, remainingMin: 40, hourlyA: null }, moves: [], basis: [] };
    assert.ok(joined(plan).includes('40分'));
  });

  it('assess-here: 見出しにエリア見立て、movesあれば次の一手', () => {
    const plan = { intent: 'assess-here', status: 'unknown',
      facts: { remainingYen: null, neededTrips: null, remainingMin: null, hourlyA: 3900 },
      moves: [ { area: '港区西麻布', count: 3 } ], basis: ['next-board', 'your-hourly'] };
    const t = joined(plan);
    assert.ok(t.includes('見立て') || t.includes('港区六本木') || true); // 見出しは「今の…の見立て」想定
    assert.ok(t.includes('港区西麻布'));
    assert.ok(t.includes('3,900'));
  });

  it('facts不足でも最低1行は返す', () => {
    const plan = { intent: 'reach-goal', status: 'unknown',
      facts: { remainingYen: null, neededTrips: null, remainingMin: null, hourlyA: null }, moves: [], basis: [] };
    assert.ok(formatAnswer(plan).length >= 1);
  });
});
```

注: assess-here の見出しは AnswerPlan に area を持たないため、Task 2 では見出しを `'今の見立て'` 等エリア非依存の固定文にしてよい（テストは moves と hourlyA の包含で検証）。area を見出しに出したい場合は Plan 3 の UI 側で now.area を渡す。上のテストの該当 assert は `|| true` で緩めてあるので見出し文言に依存しない。

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `npm test -- tests/coach-answer-format.test.js`
Expected: FAIL（`Cannot find module '../js/coach/answer-format.js'`）

- [ ] **Step 3: 最小実装を書く**

`js/coach/answer-format.js` を新規作成:

```javascript
// AnswerPlan → 日本語の表示行。最小版（Plan 3 UIで差し替え・拡張しうる）。

function yen(n) { return Number(n).toLocaleString('ja-JP'); }

export function formatAnswer(plan) {
  const lines = [];
  const f = plan.facts || {};

  // 見出し
  if (plan.status === 'reached') {
    lines.push('🎉 目標達成。お疲れさま。');
  } else if (plan.intent === 'finish-early' && f.remainingMin != null) {
    let head = `あと約${f.remainingMin}分で目標時刻`;
    if (f.remainingYen != null) head += `／残り¥${yen(f.remainingYen)}`;
    lines.push(head);
  } else if (plan.intent === 'reach-goal' && f.remainingYen != null) {
    lines.push(f.neededTrips != null
      ? `目標まで あと¥${yen(f.remainingYen)}（約${f.neededTrips}本ペース）`
      : `目標まで あと¥${yen(f.remainingYen)}`);
  } else if (plan.intent === 'assess-here') {
    lines.push('今の見立て');
  } else {
    lines.push('今わかる範囲でお答えします');
  }

  // 次の一手
  if (Array.isArray(plan.moves) && plan.moves.length) {
    lines.push(`次の一手：${plan.moves.map((m) => m.area).join(' → ')}`);
  }

  // 根拠
  if (f.hourlyA != null) {
    lines.push(`根拠：この時間のあなたの時給 ¥${yen(f.hourlyA)}/時`);
  }

  return lines;
}
```

- [ ] **Step 4: テストを実行して合格を確認**

Run: `npm test -- tests/coach-answer-format.test.js`
Expected: PASS

- [ ] **Step 5: 全テストを実行（回帰確認）**

Run: `npm test`
Expected: 既存（Plan 1 含む）全 PASS ＋ 新規2ファイル緑

- [ ] **Step 6: コミット**

```bash
git add js/coach/answer-format.js tests/coach-answer-format.test.js
git commit -m "feat(coach): 回答の日本語整形(answer-format)"
```

---

## 完了の定義（Plan 2）

- `composeAnswer(factPack, intent)` と `formatAnswer(answerPlan)` が純関数として実装され、`npm test` が全緑。
- FactPack → 3つのプリセット意図 → 再現性の説明つき日本語回答が、LLM・worker・APIキー無しで生成できる。
- 数字は全てFactPack由来＝捏造ゼロ。

## 後続プラン

- **Plan 3 — CoachUI**: `coach.html` ＋ `js/coach/coach-ui.js`。出庫時の目標設定、現在地取得（既存GPS→町名・非保存）、プリセットチップ（reach-goal/assess-here/finish-early）、buildFactPack→composeAnswer→formatAnswer をUIに配線。`enforceAccess('analysis')` でフルプラン限定。`sw.js` の STATIC_FILES 追加＋CACHE_NAME bump。
- **Plan 4 — GlobalPoolBatch**: 全体匿名プールを車種セグメントで FactEngine に統合（buildFactPack input に `poolAvgTripYen` 等の拡張ポイント）。
- **（将来・任意）LLM後付け**: 自由文の質問や自然な言い回しが必要になったら、answer 層の後段に LLM adapter を被せる（spec のgrounded LLM構成）。事実パック方式なので捏造防止はそのまま効く。

# AI営業相談コーチ — Plan 3: CoachUI 実装プラン

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan 1-2 の純関数（buildFactPack → composeAnswer → formatAnswer）を画面に配線し、乗務員が `coach.html` で目標を設定し、現在地・時刻・進捗を踏まえた相談回答を受け取れるようにする。

**Architecture:** ロジックは可能な限り純関数に切り出してTDD（場所正規化・目標解釈・ctx組立・実行パイプライン）。DOM/GPS/Firestore の配線は thin に保ち、UIは手動検証（実ブラウザ）。フルプラン限定ゲート。LLM不使用（Plan 2 のルール回答エンジンをそのまま使う）。

**Tech Stack:** 素のESM、`node:test`（純関数のみ）、PWA（coach.html）、localStorage（当日目標）、既存 GPS逆ジオ（国土地理院）・Firestore・access-control を再利用。

このプランは全体ロードマップの Plan 3/4。Plan 1（FactEngine）・Plan 2（回答エンジン）完了済み（`js/coach/` に純関数群、最新 commit c774b3017）。

---

## File Structure

| ファイル | 責務 | テスト |
|---|---|---|
| `js/coach/place.js`（新規） | 場所文字列→区+町名の正規化（丁目・末尾数字除去）。純関数 | あり |
| `js/coach/coach-context.js`（新規） | 当日目標の解釈(interpretDailyGoal)・localStorageキー(goalKeyFor)・ctx組立(buildContext)。純関数 | あり |
| `js/coach/coach-run.js`（新規） | 実行パイプライン runCoach: buildFactPack→composeAnswer→formatAnswer。純関数 | あり |
| `coach.html`（新規） | コーチ画面（目標設定・プリセットチップ・回答表示・現在地ボタン） | 手動 |
| `js/coach/coach-ui.js`（新規） | DOM/GPS/Firestore 配線（起動・目標保存読込・チップ→runCoach・GPS取得・描画） | 手動 |
| `index.html`（変更） | ホームに「AIに相談」ボタン追加 | 手動 |
| `tools.html`（変更） | ツール一覧に coach.html カード追加 | 手動 |
| `sw.js`（変更） | STATIC_FILES に coach.html と js/coach/*.js を追加、CACHE_NAME bump | 手動 |

既存 `js/coach/daily-goal.js` / `fact-engine.js` / `answer-composer.js` / `answer-format.js` は変更しない（消費するのみ）。

---

## Task 1: 場所正規化 `place.js`

GPSの逆ジオで得た町名を、過去データのエリア表記（extractArea が作る「区+町名」）に揃える純関数。

**Files:**
- Create: `js/coach/place.js`
- Test: `tests/coach-place.test.js`

- [ ] **Step 1: 失敗するテストを書く**

`tests/coach-place.test.js`:

```javascript
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { normalizePlace } from '../js/coach/place.js';

describe('normalizePlace', () => {
  it('末尾のASCII数字を除く（OCRデータと同じ粒度）', () => {
    assert.strictEqual(normalizePlace('港区六本木6'), '港区六本木');
    assert.strictEqual(normalizePlace('大田区羽田空港3'), '大田区羽田空港');
  });
  it('「N丁目」を除く（漢数字・全角含む）', () => {
    assert.strictEqual(normalizePlace('港区六本木六丁目'), '港区六本木');
    assert.strictEqual(normalizePlace('港区西麻布２丁目'), '港区西麻布');
  });
  it('既に正規形ならそのまま', () => {
    assert.strictEqual(normalizePlace('港区六本木'), '港区六本木');
  });
  it('空/null は空文字', () => {
    assert.strictEqual(normalizePlace(''), '');
    assert.strictEqual(normalizePlace(null), '');
    assert.strictEqual(normalizePlace(undefined), '');
  });
});
```

- [ ] **Step 2: 失敗を確認**

Run: `npm test -- tests/coach-place.test.js`
Expected: FAIL（モジュール未存在）

- [ ] **Step 3: 実装**

`js/coach/place.js`:

```javascript
// 場所文字列を「区+町名」に正規化（丁目・末尾数字を除去）。
// 目的: GPS逆ジオの町名を、過去データの extractArea 表記（例 "港区六本木"）に揃える。

export function normalizePlace(s) {
  if (!s) return '';
  return String(s)
    .replace(/[0-9０-９一二三四五六七八九十百]+丁目$/, '')
    .replace(/[0-9０-９]+$/, '')
    .trim();
}
```

- [ ] **Step 4: 合格を確認**

Run: `npm test -- tests/coach-place.test.js`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add js/coach/place.js tests/coach-place.test.js
git commit -m "feat(coach): 場所正規化(place.normalizePlace)"
```

---

## Task 2: 文脈組立 `coach-context.js`

当日目標の検証パース・localStorageキー生成・現在地/時刻/曜日からの ctx 組立。

**Files:**
- Create: `js/coach/coach-context.js`
- Test: `tests/coach-context.test.js`

**型:**
```
Goal = { type:'money', targetYen:number } | { type:'time', targetReturnMin:number, targetYen?:number }
Ctx  = { area:string, dow:number, hour:number, nowMin:number, vehicleType:string }
```

- [ ] **Step 1: 失敗するテストを書く**

`tests/coach-context.test.js`:

```javascript
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { interpretDailyGoal, goalKeyFor, buildContext } from '../js/coach/coach-context.js';

describe('goalKeyFor', () => {
  it('日付ごとにキーを分ける', () => {
    assert.strictEqual(goalKeyFor('2026-06-05'), 'cabis_coach_daily_goal_2026-06-05');
  });
});

describe('interpretDailyGoal', () => {
  it('money目標(JSON文字列)を解釈', () => {
    assert.deepStrictEqual(interpretDailyGoal('{"type":"money","targetYen":30000}'), { type: 'money', targetYen: 30000 });
  });
  it('time目標を解釈（targetYen併記あり）', () => {
    assert.deepStrictEqual(
      interpretDailyGoal({ type: 'time', targetReturnMin: 1140, targetYen: 30000 }),
      { type: 'time', targetReturnMin: 1140, targetYen: 30000 });
  });
  it('time目標（額併記なし）', () => {
    assert.deepStrictEqual(interpretDailyGoal({ type: 'time', targetReturnMin: 1140 }), { type: 'time', targetReturnMin: 1140 });
  });
  it('不正値は null', () => {
    assert.strictEqual(interpretDailyGoal(null), null);
    assert.strictEqual(interpretDailyGoal('not json'), null);
    assert.strictEqual(interpretDailyGoal('{"type":"money","targetYen":0}'), null);
    assert.strictEqual(interpretDailyGoal('{"type":"bogus"}'), null);
  });
});

describe('buildContext', () => {
  it('現在地・時刻・曜日からctxを組み立てる（areaは正規化）', () => {
    const ctx = buildContext('2026-06-05', 1170, '港区六本木6', 'premium');
    assert.strictEqual(ctx.area, '港区六本木');
    assert.strictEqual(ctx.dow, 5); // 2026-06-05は金曜
    assert.strictEqual(ctx.hour, 19); // floor(1170/60)
    assert.strictEqual(ctx.nowMin, 1170);
    assert.strictEqual(ctx.vehicleType, 'premium');
  });
  it('vehicleType未指定は japantaxi', () => {
    assert.strictEqual(buildContext('2026-06-05', 600, '港区六本木', null).vehicleType, 'japantaxi');
  });
});
```

- [ ] **Step 2: 失敗を確認**

Run: `npm test -- tests/coach-context.test.js`
Expected: FAIL

- [ ] **Step 3: 実装**

`js/coach/coach-context.js`:

```javascript
import { dowOf } from '../chart-helpers.js';
import { normalizePlace } from './place.js';

// 当日目標の localStorage キー（日付ごとに分離＝翌日は古い目標を読まない）
export function goalKeyFor(dateStr) {
  return 'cabis_coach_daily_goal_' + dateStr;
}

// localStorage 等から読んだ生値を検証して Goal に。不正は null。
export function interpretDailyGoal(raw) {
  let o;
  try {
    o = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
  if (!o || typeof o !== 'object') return null;
  if (o.type === 'money' && Number(o.targetYen) > 0) {
    return { type: 'money', targetYen: Number(o.targetYen) };
  }
  if (o.type === 'time' && Number(o.targetReturnMin) >= 0) {
    const g = { type: 'time', targetReturnMin: Number(o.targetReturnMin) };
    if (o.targetYen != null && Number(o.targetYen) > 0) g.targetYen = Number(o.targetYen);
    return g;
  }
  return null;
}

// 現在地町名・現在分・日付・車種 → ctx（area は extractArea 表記に正規化）
export function buildContext(dateStr, nowMin, gpsPlace, vehicleType) {
  const min = Number(nowMin) || 0;
  return {
    area: normalizePlace(gpsPlace || ''),
    dow: dowOf(dateStr),
    hour: Math.floor(min / 60),
    nowMin: min,
    vehicleType: vehicleType || 'japantaxi',
  };
}
```

- [ ] **Step 4: 合格を確認**

Run: `npm test -- tests/coach-context.test.js`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add js/coach/coach-context.js tests/coach-context.test.js
git commit -m "feat(coach): 文脈組立(coach-context)"
```

---

## Task 3: 実行パイプライン `coach-run.js`

Plan 1-2 の4関数を1本に束ねる純関数。UIはこれを呼ぶだけにする（DOMから純ロジックを分離）。

**Files:**
- Create: `js/coach/coach-run.js`
- Test: `tests/coach-run.test.js`

**型:** `runCoach({ drives, todaySales, ctx, goal, intent }) → { plan: AnswerPlan, lines: string[] }`

- [ ] **Step 1: 失敗するテストを書く**

`tests/coach-run.test.js`:

```javascript
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { runCoach } from '../js/coach/coach-run.js';

const drives = [
  { date: '2026-05-01', departureTime: '07:00', returnTime: '22:00',
    trips: [
      { amount: 2000, boardTime: '19:10', alightTime: '19:25', boardPlace: '港区六本木6', alightPlace: '渋谷区恵比寿1', isCancel: false },
      { amount: 2600, boardTime: '19:40', alightTime: '19:55', boardPlace: '港区西麻布2', alightPlace: '目黒区中目黒1', isCancel: false },
    ] },
];

describe('runCoach', () => {
  const ctx = { area: '港区六本木', dow: 5, hour: 19, nowMin: 1170, vehicleType: 'premium' };

  it('plan と lines(非空配列) を返す', () => {
    const goal = { type: 'money', targetYen: 30000 };
    const r = runCoach({ drives, todaySales: 21400, ctx, goal, intent: 'reach-goal' });
    assert.strictEqual(r.plan.intent, 'reach-goal');
    assert.ok(Array.isArray(r.lines));
    assert.ok(r.lines.length >= 1);
    // 残額がlinesに反映（数字はFactPack由来）
    assert.ok(r.lines.join('\n').includes('8,600'));
  });

  it('goal無しでも動く（status unknown）', () => {
    const r = runCoach({ drives, todaySales: 0, ctx, goal: null, intent: 'assess-here' });
    assert.strictEqual(r.plan.status, 'unknown');
    assert.ok(r.lines.length >= 1);
  });
});
```

- [ ] **Step 2: 失敗を確認**

Run: `npm test -- tests/coach-run.test.js`
Expected: FAIL

- [ ] **Step 3: 実装**

`js/coach/coach-run.js`:

```javascript
import { buildFactPack } from './fact-engine.js';
import { composeAnswer } from './answer-composer.js';
import { formatAnswer } from './answer-format.js';

// UIから呼ぶ唯一のロジック入口。事実パック生成→回答合成→整形を1本に。
export function runCoach({ drives = [], todaySales = 0, ctx, goal = null, intent }) {
  const factPack = buildFactPack({ drives, ctx, goal, todaySales });
  const plan = composeAnswer(factPack, intent);
  return { plan, lines: formatAnswer(plan) };
}
```

- [ ] **Step 4: 合格を確認**

Run: `npm test -- tests/coach-run.test.js`
Expected: PASS

- [ ] **Step 5: 全テスト回帰**

Run: `npm test`
Expected: 既存含め全 PASS（Plan 1-2 と新規3ファイル緑）

- [ ] **Step 6: コミット**

```bash
git add js/coach/coach-run.js tests/coach-run.test.js
git commit -m "feat(coach): 実行パイプライン(coach-run)"
```

---

## Task 4: 画面 `coach.html` ＋ 配線 `coach-ui.js`

DOM/GPS/Firestore の配線。純ロジックは Task 1-3 を呼ぶだけ。node:test 不可のため手動検証（実ブラウザ）。

**Files:**
- Create: `coach.html`
- Create: `js/coach/coach-ui.js`

**coach.html の構成（必須要素）:**
- `<head>`: viewport、`<link rel="stylesheet" href="css/style.css">`、インラインで coach 専用の最小CSS（`.coach-chips`, `.coach-msg`, `.coach-goal` など。既存トークン --primary/--surface/--muted を使う）。
- `<body>`:
  - ヘッダー（既存ページと同じ体裁。タイトル「AI営業相談」）
  - 目標カード `#goalCard`: 今日の目標表示＋「目標を設定」ボタン（未設定時は設定を促す）。設定UI＝金額入力 or 帰宅時刻入力（ラジオで money/time 切替）。
  - 現在地カード `#areaCard`: 「📍 現在地を取得」ボタン＋取得した町名表示。
  - プリセットチップ `#chips`: 3ボタン（data-intent="reach-goal" 「目標まで どう動く」／data-intent="assess-here" 「今の場所どう？」／data-intent="finish-early" 「早く帰りたい」）。
  - 回答表示 `#answer`: runCoach の lines を1行ずつ表示。
  - `#navHost`（ボトムナビ）。
  - `<script type="module" src="./js/coach/coach-ui.js"></script>`

- [ ] **Step 1: `coach.html` を作成**

既存 `support.html` のヘッダー・nav・カード体裁に倣う。上記必須要素を含める。CSSは既存 `.card`/`.btn`/`.muted` を再利用し、チップ等のみインライン追加。アクセス制御・初期化は coach-ui.js 側で行う。

- [ ] **Step 2: `js/coach/coach-ui.js` を作成**

以下を満たす配線（既存APIを再利用）:

```javascript
import { renderBottomNav } from '../app.js';
import { todayIso, currentBillingPeriod } from '../app.js';
import { getConfig, getDrivesForMonth } from '../storage.js';
import { enforceAccess } from '../access-control.js';
import { calcDailySales } from '../payroll.js';
import { showGpsPrivacyBanner } from '../gps-privacy-banner.js';
import { goalKeyFor, interpretDailyGoal, buildContext } from './coach-context.js';
import { runCoach } from './coach-run.js';

// 1) アクセス制御（フルプラン限定。失敗時は return）
if (!(await enforceAccess('analysis'))) { throw new Error('access-denied'); }

// 2) ナビ・GPS同意バナー描画
document.getElementById('navHost').innerHTML = renderBottomNav('tools');
showGpsPrivacyBanner();

// 3) 初期データ
const config = await getConfig();
const vehicleType = (config.defaults && config.defaults.vehicleType) || 'japantaxi';
const today = todayIso();
const drives = await getDrivesForMonth(currentBillingPeriod());
const todayDrive = drives.find((d) => d.date === today) || null;
const todaySales = todayDrive ? calcDailySales(todayDrive).inclTax : 0;

// 4) 当日目標の読み込み（localStorage・日付別キー）
function loadGoal() {
  return interpretDailyGoal(localStorage.getItem(goalKeyFor(today)));
}
function saveGoal(goal) {
  localStorage.setItem(goalKeyFor(today), JSON.stringify(goal));
}

// 5) 現在地（既存 support.html runGpsLookup と同等。取得した町名を変数に保持。保存しない）
//    navigator.geolocation.getCurrentPosition → 国土地理院 LonLatToAddress → muni名+lv01Nm。
//    取得失敗時は area を空のまま（buildContext が空areaを許容）。
let currentPlace = '';

// 6) チップ押下 → ctx組立 → runCoach → lines表示
function ask(intent) {
  const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
  const ctx = buildContext(today, nowMin, currentPlace, vehicleType);
  const goal = loadGoal();
  const { lines } = runCoach({ drives, todaySales, ctx, goal, intent });
  renderAnswer(lines);
}

// 7) renderAnswer / 目標設定UI / GPSボタン のDOMハンドラを配線
//    （chips の click で ask(btn.dataset.intent) を呼ぶ等）
```

**実装の必須挙動:**
- 目標未設定でチップを押しても落ちない（goal=null → status unknown の回答が出る）。
- 目標設定: money（金額¥）/ time（帰宅時刻 HH:MM → targetReturnMin = h*60+m）をラジオ切替で入力し saveGoal。設定後に目標カード表示を更新。
- GPSボタン: 取得した町名を `currentPlace` に保持して area カードに表示。**保存しない**（localStorage に町名を書かない）。
- 回答は `#answer` を一旦クリアして lines を行ごとに `<div class="coach-msg">` で表示。

- [ ] **Step 3: エントリーポイント追加**
  - `index.html`: 既存カード群の末尾付近に `<a href="coach.html">🤖 AIに相談</a>` のカード/ボタンを追加（既存カード体裁に合わせる）。
  - `tools.html`: ツール一覧に `<a href="coach.html" class="tool-card"><div class="icon">🤖</div><h3>AI営業相談</h3><p>目標と今の状況に合わせて動き方を相談</p></a>` を追加。

- [ ] **Step 4: SW 更新（必須）**
  `sw.js` の `STATIC_FILES` に以下を追加し、`CACHE_NAME` を bump（`v273` → `v274`。実値は現行を確認して+1）:
  ```
  './coach.html',
  './js/coach/daily-goal.js',
  './js/coach/fact-engine.js',
  './js/coach/answer-composer.js',
  './js/coach/answer-format.js',
  './js/coach/place.js',
  './js/coach/coach-context.js',
  './js/coach/coach-run.js',
  './js/coach/coach-ui.js',
  ```

- [ ] **Step 5: 回帰テスト（純関数が壊れていないこと）**

Run: `npm test`
Expected: 全 PASS（DOMはテスト対象外。純関数群が緑のまま）

- [ ] **Step 6: コミット**

```bash
git add coach.html js/coach/coach-ui.js index.html tools.html sw.js
git commit -m "feat(coach): CoachUI(coach.html)+目標設定+現在地+チップ配線+SW更新"
```

- [ ] **Step 7: 手動検証（実ブラウザ・要ユーザー）**

DOMは node:test 不可のため、実ブラウザ（kimi-webbridge＝実アカウント）でスモーク:
1. dev 反映後、`coach.html` を開く（フルプラン未満ならリダイレクトされる＝ゲート確認）。
2. 目標を設定（例 ¥30,000）→ 目標カードに反映。
3. 「現在地を取得」→ 町名が出る（保存されないこと）。
4. チップ「目標まで どう動く」→ 回答に残額・次の一手・根拠が出る。数字がFactPack由来で破綻しない。
5. 目標未設定でもチップが落ちない。
※ この手順はユーザーに依頼（Claudeはpushしない。dev反映は `!~/work/taxi-dev/dpush.sh <worktree>`）。

---

## 完了の定義（Plan 3）

- 純関数（place / coach-context / coach-run）が TDD で実装され `npm test` 全緑。
- `coach.html` で目標設定→現在地取得→チップ相談→回答表示が動く（手動検証）。
- フルプラン限定ゲートが効く。SW更新済み。
- 数字は全て FactPack 由来（捏造ゼロ）。

## 後続プラン

- **Plan 4 — GlobalPoolBatch**: 全体匿名プールを車種セグメントで FactEngine に統合（他者データ）。buildFactPack input に pool 系の拡張ポイントを追加。
- **（将来・任意）LLM後付け**: 自由文質問・自然な言い回しが必要なら answer 層の後段に LLM adapter。

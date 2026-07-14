# 合計金額のみ入力（summary-only 日報）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** OCR が失敗した日でも「売上合計（税込）だけ」を入力して日報を保存できるようにし、`input.html` の Gemini テキスト貼付 UI をその合計入力に置き換える。

**Architecture:** Firestore の drive に `_summaryOnly: boolean` と `totalSales: number` を追加する。`input.html` を「明細あり / 合計のみ」の 2 モードに分け、モードに応じて保存するオブジェクトを切り替える。下流は既存の `isSummaryOnly()`（`js/chart-helpers.js:96`）に `_summaryOnly` を足すだけで、時間帯・エリア系の集計は自動的に除外される。給与計算のみ `calcDailySales` に `totalSales` を読む分岐を足す。

**Tech Stack:** 素の ES modules + Firebase (Firestore) + Node 標準テストランナー（`npm test` = `node --test tests/*.test.js`）。ビルドなし、TypeScript なし、jsdom なし。

**Spec:** `docs/superpowers/specs/2026-07-15-summary-only-input-design.md`

## Global Constraints

- リポジトリは `/Users/hideakimacbookair/work/taxi-dev`。ブランチは `dev/main` 基点で切る。**Claude は push しない**（`dpush.sh` / `tagpush.sh` はユーザーが実行）。
- テストは `node --test tests/*.test.js`。UI（HTML）を対象にした自動テストの基盤は存在しないので、HTML の変更は手動確認手順で検証する。
- `js/parser.js` は削除しない（`admin.html:367` / `bulk-input.html:171` / `tests/parser.test.js` / `tests/parsefmt.test.js` が使用）。`input.html` からの import を外すだけ。
- summary-only レコードは `trips: []` / `rests: []` を**明示的な空配列**で保存する（undefined にしない）。
- 明細ありレコードには `_summaryOnly` を付けない（フィールドごと存在させない）。`totalSales` も付けない。
- 税率は `js/payroll.js:1` の `TAX_RATE = 1.1`。
- 新規 summary-only レコードの `rawText` は空文字。既存レコード編集時は既存の `rawText` を引き継ぐ（過去の Gemini 貼付テキストを消さない）。

---

## File Structure

| ファイル | 役割 | 変更 |
|---|---|---|
| `js/chart-helpers.js` | `isSummaryOnly()` に `_summaryOnly` 判定を追加 | Modify (1行) |
| `js/payroll.js` | `calcDailySales()` に summary-only 分岐 | Modify |
| `tests/summary-only.test.js` | 新設フラグまわりの単体テスト | Create |
| `input.html` | モード切替 UI / 合計入力 / Gemini 撤去 / 保存分岐 / 上書き確認 | Modify（最大の変更） |
| `js/ocr-import.js` | 失敗時に「合計金額だけ入力する」CTA | Modify |
| `detail.html` | 「合計のみ」バッジ | Modify |
| `index.html` | — | **変更不要**（`:1029-1041` が既に summary-only 行を「概」バッジ＋ダッシュで描画済み。Task 1 で自動的に効く） |

---

### Task 1: `isSummaryOnly` に `_summaryOnly` を追加

**Files:**
- Modify: `js/chart-helpers.js:95-99`
- Test: `tests/summary-only.test.js`（新規作成）

**Interfaces:**
- Consumes: なし
- Produces: `isSummaryOnly(drive) -> boolean`。`drive._summaryOnly === true` のとき true を返す。既存の 2 条件（`_importedFrom === 'spreadsheet'` / `trips.some(t => t._periodCount)`）は後方互換のため残す。

- [ ] **Step 1: 失敗するテストを書く**

`tests/summary-only.test.js` を新規作成:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSummaryOnly } from '../js/chart-helpers.js';

test('isSummaryOnly: _summaryOnly フラグ付きの drive は true', () => {
  assert.equal(isSummaryOnly({ _summaryOnly: true, totalSales: 52300, trips: [], rests: [] }), true);
});

test('isSummaryOnly: 明細ありの drive は false', () => {
  assert.equal(isSummaryOnly({ trips: [{ amount: 1000, boardTime: '09:00' }], rests: [] }), false);
});

test('isSummaryOnly: 後方互換 _importedFrom=spreadsheet は true', () => {
  assert.equal(isSummaryOnly({ _importedFrom: 'spreadsheet', trips: [] }), true);
});

test('isSummaryOnly: trips 空の通常 drive（フラグなし）は false', () => {
  assert.equal(isSummaryOnly({ trips: [], rests: [] }), false);
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `cd ~/work/taxi-dev && node --test tests/summary-only.test.js`
Expected: FAIL — 1本目のテストで `expected true, got false`（`_summaryOnly` をまだ見ていない）。他の 3 本は PASS。

- [ ] **Step 3: 最小の実装**

`js/chart-helpers.js` の `isSummaryOnly` を書き換える:

```js
// summary-only な drive: 詳細trip単位のデータがなく合計のみ
export function isSummaryOnly(drive) {
  if (drive._summaryOnly === true) return true;
  if (drive._importedFrom === 'spreadsheet') return true;
  return (drive.trips || []).some(t => t._periodCount);
}
```

- [ ] **Step 4: テストを実行して成功を確認**

Run: `cd ~/work/taxi-dev && node --test tests/summary-only.test.js`
Expected: PASS 4/4

- [ ] **Step 5: 既存テストの回帰確認**

Run: `cd ~/work/taxi-dev && npm test 2>&1 | tail -5`
Expected: 既存テストが全て pass（fail 0）

- [ ] **Step 6: コミット**

```bash
cd ~/work/taxi-dev
git add js/chart-helpers.js tests/summary-only.test.js
git commit -m "feat(charts): isSummaryOnly に _summaryOnly フラグを追加"
```

---

### Task 2: `calcDailySales` の summary-only 分岐

**Files:**
- Modify: `js/payroll.js:3-11`
- Test: `tests/summary-only.test.js`（Task 1 で作成済み・追記）

**Interfaces:**
- Consumes: なし（`payroll.js` は `chart-helpers.js` を import しない。循環 import を避けるため、`_summaryOnly` を payroll 側で直接見る）
- Produces: `calcDailySales(drive) -> { inclTax: number, exclTax: number }`。`drive._summaryOnly === true` なら `inclTax = Number(drive.totalSales) || 0`。それ以外は従来どおり `trips` の合計。`calcMonthlySales` / `calcBasePay` / `calcIncentive` / `calcTotalPay` は `calcDailySales` 経由なので改修不要。

- [ ] **Step 1: 失敗するテストを追記**

`tests/summary-only.test.js` の先頭 import に追加:

```js
import { calcDailySales, calcMonthlySales } from '../js/payroll.js';
```

ファイル末尾に追記:

```js
test('calcDailySales: summary-only は totalSales を売上として使う', () => {
  const r = calcDailySales({ _summaryOnly: true, totalSales: 52300, trips: [], rests: [] });
  assert.equal(r.inclTax, 52300);
  assert.equal(r.exclTax, 52300 / 1.1);
});

test('calcDailySales: summary-only で totalSales が無ければ 0', () => {
  const r = calcDailySales({ _summaryOnly: true, trips: [] });
  assert.equal(r.inclTax, 0);
  assert.equal(r.exclTax, 0);
});

test('calcDailySales: 明細ありは従来どおり trips 合計（回帰）', () => {
  const r = calcDailySales({
    trips: [{ amount: 1000 }, { amount: 2000 }, { amount: 500, isCancel: true }]
  });
  assert.equal(r.inclTax, 3000);
});

test('calcMonthlySales: summary-only と明細ありが混在しても合算される', () => {
  const r = calcMonthlySales([
    { _summaryOnly: true, totalSales: 50000, trips: [] },
    { trips: [{ amount: 1000 }, { amount: 2000 }] }
  ]);
  assert.equal(r.inclTax, 53000);
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `cd ~/work/taxi-dev && node --test tests/summary-only.test.js`
Expected: FAIL — summary-only のテストで `expected 52300, got 0`（trips が空なので 0 になる）

- [ ] **Step 3: 最小の実装**

`js/payroll.js` の `calcDailySales` を書き換える:

```js
export function calcDailySales(drive) {
  // 合計のみ日報（OCR失敗時のフォールバック入力）: 明細が無いので totalSales をそのまま売上とする。
  const inclTax = drive._summaryOnly === true
    ? (Number(drive.totalSales) || 0)
    : (drive.trips || [])
        .filter(t => !t.isCancel)
        .reduce((sum, t) => sum + (t.amount || 0), 0);
  return {
    inclTax,
    exclTax: inclTax / TAX_RATE
  };
}
```

- [ ] **Step 4: テストを実行して成功を確認**

Run: `cd ~/work/taxi-dev && node --test tests/summary-only.test.js`
Expected: PASS 8/8

- [ ] **Step 5: 既存テストの回帰確認**

Run: `cd ~/work/taxi-dev && npm test 2>&1 | tail -5`
Expected: fail 0

- [ ] **Step 6: コミット**

```bash
cd ~/work/taxi-dev
git add js/payroll.js tests/summary-only.test.js
git commit -m "feat(payroll): 合計のみ日報の売上を totalSales から計算"
```

---

### Task 3: 下流の非汚染を回帰テストで固定する

**Files:**
- Test: `tests/summary-only.test.js`（追記のみ。プロダクトコードの変更は無い想定）

**Interfaces:**
- Consumes: `isSummaryOnly`（Task 1）、`buildGroupPool`（`js/group-pool-core.js:56`）、`avgTripSales`（`js/chart-helpers.js:913`）
- Produces: なし（回帰の固定）

**背景:** 調査済みの事実 — `buildGroupPool` は heatmap（`peerMedianHourlyDow`）と areas しか出力せず、`peerMedianHourlyDow` は `workingMin > 0 && hourlyA > 0` のセルしか積まないため、明細ゼロの drive はプールに 1 セルも足さない。`avgTripSales` は既に `isSummaryOnly` でスキップしている。このタスクは「今後の変更でこれが壊れないように」テストで固定するのが目的。**プロダクトコードを変更せずにテストが通れば、それが期待どおり**（レッド→グリーンではなく、既存挙動の固定）。

- [ ] **Step 1: 回帰テストを追記**

`tests/summary-only.test.js` の import に追加:

```js
import { avgTripSales } from '../js/chart-helpers.js';
import { buildGroupPool } from '../js/group-pool-core.js';
```

ファイル末尾に追記:

```js
const NOW_ISO = '2026-07-15T00:00:00.000Z';

// 明細あり drive を 1 本作る（09:00-09:30 に 3000円の乗車 1 件）
function detailedDrive(userId, date) {
  return {
    _userId: userId,
    date,
    departureTime: '08:00',
    trips: [{ boardTime: '09:00', alightTime: '09:30', boardPlace: '駅', alightPlace: '空港', km: 10, amount: 3000 }],
    rests: []
  };
}

test('buildGroupPool: summary-only 日を混ぜても heatmap セルが増えない', () => {
  const base = [detailedDrive('u1', '2026-07-10'), detailedDrive('u2', '2026-07-10')];
  const withSummary = [
    ...base,
    { _userId: 'u1', date: '2026-07-11', _summaryOnly: true, totalSales: 50000, trips: [], rests: [] },
    { _userId: 'u2', date: '2026-07-11', _summaryOnly: true, totalSales: 90000, trips: [], rests: [] }
  ];
  const poolA = buildGroupPool(base, 2, { nowIso: NOW_ISO, months: 6 });
  const poolB = buildGroupPool(withSummary, 2, { nowIso: NOW_ISO, months: 6 });
  assert.equal(poolB.heatmap.length, poolA.heatmap.length);
  assert.deepEqual(poolB.heatmap, poolA.heatmap);
});

test('buildGroupPool: 出力に totalSales / _summaryOnly が漏れない', () => {
  const pool = buildGroupPool(
    [detailedDrive('u1', '2026-07-10'), { _userId: 'u2', date: '2026-07-11', _summaryOnly: true, totalSales: 90000, trips: [], rests: [] }],
    2, { nowIso: NOW_ISO, months: 6 }
  );
  const json = JSON.stringify(pool);
  assert.equal(json.includes('totalSales'), false);
  assert.equal(json.includes('_summaryOnly'), false);
  assert.equal(json.includes('90000'), false);
});

test('avgTripSales: summary-only 日を分母に入れず NaN にならない', () => {
  const v = avgTripSales([
    { trips: [{ amount: 1000 }, { amount: 3000 }] },
    { _summaryOnly: true, totalSales: 50000, trips: [] }
  ]);
  assert.equal(v, 2000);
  assert.equal(Number.isNaN(v), false);
});

test('avgTripSales: summary-only 日しか無ければ 0（NaN でない）', () => {
  const v = avgTripSales([{ _summaryOnly: true, totalSales: 50000, trips: [] }]);
  assert.equal(v, 0);
});
```

- [ ] **Step 2: テストを実行**

Run: `cd ~/work/taxi-dev && node --test tests/summary-only.test.js`
Expected: PASS 12/12。**プロダクトコードの変更なしで通るはず。**

もし落ちた場合は、調査の前提が間違っていたということなので、**勝手に修正せず落ちた内容を報告して止まる**こと（設計の見直しが要る）。

- [ ] **Step 3: 全体テスト**

Run: `cd ~/work/taxi-dev && npm test 2>&1 | tail -5`
Expected: fail 0

- [ ] **Step 4: コミット**

```bash
cd ~/work/taxi-dev
git add tests/summary-only.test.js
git commit -m "test: 合計のみ日報がグループプール・平均単価を汚さないことを固定"
```

---

### Task 4: input.html — Gemini 貼付を撤去し「合計のみ」入力に置き換える（UI のみ）

**Files:**
- Modify: `input.html:82-108`（貼付 section 丸ごと差し替え）
- Modify: `input.html:163`（parser の import 削除）
- Modify: `input.html:355-432`（`GEMINI_PROMPT` / `copyToClipboard` / `copyPromptBtn` / `parseBtn` ハンドラの削除）

**Interfaces:**
- Consumes: なし
- Produces:
  - DOM 要素 `#modeDetailed`（radio, value=`detailed`）/ `#modeSummary`（radio, value=`summary`）— name は `inputMode`
  - DOM 要素 `#summarySection`（`<section>`）/ `#totalSalesInput`（`<input type="number">`）
  - `getMode() -> 'detailed' | 'summary'` — 現在選択中のモード
  - `setMode(mode)` — モードを設定し、`#summarySection` と `#previewSection` の表示を切り替える
  - Task 5 がこの `getMode()` / `#totalSalesInput` を保存処理で使う

- [ ] **Step 1: 貼付 section を差し替える**

`input.html:82` の `<section class="card">`（「日報テキストを貼付」）から `:108` の `</section>` までを、以下で置き換える:

```html
  <section class="card">
    <label class="muted">入力方法</label>
    <div style="display:flex;gap:8px;margin-top:6px;">
      <label style="flex:1;display:flex;align-items:center;justify-content:center;gap:6px;padding:10px;border:2px solid var(--line,#ddd);border-radius:6px;cursor:pointer;font-size:13px;font-weight:600;" id="modeDetailedLabel">
        <input type="radio" name="inputMode" id="modeDetailed" value="detailed" checked> 📋 明細あり
      </label>
      <label style="flex:1;display:flex;align-items:center;justify-content:center;gap:6px;padding:10px;border:2px solid var(--line,#ddd);border-radius:6px;cursor:pointer;font-size:13px;font-weight:600;" id="modeSummaryLabel">
        <input type="radio" name="inputMode" id="modeSummary" value="summary"> 💴 合計のみ
      </label>
    </div>
    <p class="muted" id="modeHint" style="margin:8px 0 0;font-size:11px;line-height:1.5;"></p>
  </section>

  <section class="card" id="summarySection" style="display:none;">
    <label class="muted">売上合計（税込）</label>
    <input class="input" id="totalSalesInput" type="number" inputmode="numeric" step="1" min="1" placeholder="例: 52300" style="font-size:18px;">
    <p class="muted" style="margin:8px 0 0;font-size:11px;line-height:1.6;">
      写真が読み取れないときの簡易入力です。売上と給与計算には反映されますが、
      <strong>時間帯・エリア別の分析グラフには反映されません</strong>（明細が無いため）。
      後から写真で取り込み直せば、明細ありの日報に上書きできます。
    </p>
  </section>
```

- [ ] **Step 2: parser の import を削除**

`input.html:163` の行を削除する:

```js
import { parseReport, parseFormattedReport } from './js/parser.js';
```

（`js/parser.js` のファイル自体は削除しない）

- [ ] **Step 3: GEMINI_PROMPT / copyToClipboard / 各ハンドラを削除**

`input.html` から以下を削除する:
- `const GEMINI_PROMPT = \`...\`;`（:359 から始まるテンプレートリテラル全体）
- `async function copyToClipboard(text) { ... }`（:409 から始まる関数全体）
- `document.getElementById('copyPromptBtn').onclick = async () => { ... };`（:426-432）
- `document.getElementById('parseBtn').onclick = () => { ... };`（:434-454）

- [ ] **Step 4: モード切替ロジックを追加**

`input.html` の script 内（`let editMode = false;` の直後）に追加:

```js
const MODE_HINTS = {
  detailed: '📷 写真から取り込むと、乗車明細ごとの分析グラフが使えます（推奨）。',
  summary: '💴 売上合計だけを記録します。写真が読み取れないときに使ってください。'
};

function getMode() {
  return document.getElementById('modeSummary').checked ? 'summary' : 'detailed';
}

function setMode(mode) {
  const isSummary = mode === 'summary';
  document.getElementById('modeSummary').checked = isSummary;
  document.getElementById('modeDetailed').checked = !isSummary;
  document.getElementById('summarySection').style.display = isSummary ? '' : 'none';
  document.getElementById('previewSection').style.display = (!isSummary && parsed) ? '' : 'none';
  document.getElementById('modeHint').textContent = MODE_HINTS[isSummary ? 'summary' : 'detailed'];
  const sel = '2px solid #2e7d32';
  const off = '2px solid #ddd';
  document.getElementById('modeSummaryLabel').style.border = isSummary ? sel : off;
  document.getElementById('modeDetailedLabel').style.border = isSummary ? off : sel;
}

document.getElementById('modeDetailed').addEventListener('change', () => setMode('detailed'));
document.getElementById('modeSummary').addEventListener('change', () => setMode('summary'));
```

- [ ] **Step 5: URL パラメータと既存レコードでモードを初期化**

`input.html` の初期化関数（`applyOcrImport()` を呼んでいる箇所）を修正する。

(a) 既存レコード読み込み（現 `:246` 付近、`rawTextInput` に値を入れている行）を書き換える:

```js
      // rawText は UI から消えたので、保存時に引き継ぐため変数に退避する
      existingRawText = existing.rawText || '';
      document.getElementById('vehicleTypeSel').value = existing.vehicleType;
```

（`document.getElementById('rawTextInput').value = existing.rawText || '';` の行を上記に置換）

script のトップレベル（`let parsed = null;` の近く）に追加:

```js
let existingRawText = '';
```

(b) 既存レコードが summary-only なら合計タブを開いて値を入れる。現 `:255-258` の
```js
      parsed = { trips: existing.trips, rests: existing.rests, returnTime: existing.returnTime, format: 'edit' };
      renderPreview();
      return;
```
を以下に置換:

```js
      if (existing._summaryOnly) {
        document.getElementById('totalSalesInput').value = existing.totalSales != null ? existing.totalSales : '';
        setMode('summary');
        return;
      }
      parsed = { trips: existing.trips, rests: existing.rests, returnTime: existing.returnTime, format: 'edit' };
      setMode('detailed');
      renderPreview();
      return;
```

(c) 新規入力の末尾（`applyOcrImport();` を呼んでいる箇所）を以下に置換:

```js
  // ?mode=summary で開かれたら合計のみタブを初期選択（ocr-import.html の失敗時CTA）
  const params = new URLSearchParams(location.search);
  setMode(params.get('mode') === 'summary' ? 'summary' : 'detailed');

  // 写真から取り込み（ocr-import.html）由来のデータがあれば取り込む。
  applyOcrImport();
```

(d) `applyOcrImport()` は OCR データがあれば必ず明細モードにする。`renderPreview();` の直前に 1 行足す:

```js
  setMode('detailed');
  renderPreview();
```

- [ ] **Step 6: 手動確認（ローカルサーバ）**

Run: `cd ~/work/taxi-dev && python3 -m http.server 8765`（別ターミナル）
ブラウザで `http://localhost:8765/input.html` を開く。

確認項目:
1. 「日報テキストを貼付」「テキストを読み込む」「🤖 外部AI（Gemini）で取り込む」「📋 プロンプトをコピー」が**すべて消えている**
2. 「入力方法」の2タブが出ていて、初期は「📋 明細あり」が選択（緑枠）
3. 「💴 合計のみ」をタップ → 「売上合計（税込）」の入力欄が出る。「明細あり」に戻すと消える
4. `http://localhost:8765/input.html?mode=summary` を開くと最初から合計タブが選択されている
5. ブラウザのコンソールに **エラーが 1 件も出ていない**（parser.js の import を消し忘れると即エラーになる）

- [ ] **Step 7: コミット**

```bash
cd ~/work/taxi-dev
git add input.html
git commit -m "feat(input): Gemini貼付を撤去し「明細あり/合計のみ」の2モードUIを追加"
```

---

### Task 5: input.html — 保存処理のモード分岐と上書き確認

**Files:**
- Modify: `input.html:564-600`（`saveBtn.onclick`）

**Interfaces:**
- Consumes: `getMode()` / `#totalSalesInput` / `existingRawText`（Task 4）、`getDrive(date)`（`js/storage.js` から既に import 済み）
- Produces: なし（最終形）

**保存されるオブジェクト:**
- 合計のみ: 既存の共通フィールド + `_summaryOnly: true`, `totalSales: <number>`, `trips: []`, `rests: []`, `rawText: existingRawText`
- 明細あり: 現状のまま（`_summaryOnly` / `totalSales` は**付けない**）+ `rawText: existingRawText`

**上書き確認の条件:** 保存前に `getDrive(date)` で既存レコードを読み、`Boolean(existing._summaryOnly) !== (mode === 'summary')` のときだけ `confirm()` を出す。

- [ ] **Step 1: saveBtn.onclick を書き換える**

`input.html:564` の `document.getElementById('saveBtn').onclick = async () => {` から、`drive` オブジェクトを組み立てて `saveDriveSafe(drive)` する部分までを、以下で置き換える（`catch` 節と `finally` 節は既存のものをそのまま残す）:

```js
document.getElementById('saveBtn').onclick = async () => {
  const mode = getMode();
  const date = document.getElementById('dateInput').value;
  if (!date) return alert('乗務日を入力してください');

  let totalSales = null;
  if (mode === 'summary') {
    const raw = document.getElementById('totalSalesInput').value;
    totalSales = raw.trim() !== '' ? Number(raw) : NaN;
    if (!Number.isFinite(totalSales) || totalSales <= 0) {
      return alert('売上合計（税込）を入力してください');
    }
  } else {
    if (!parsed) return alert('先に「📷 写真から取り込む」で日報を読み取ってください');
  }

  // モードが変わる上書きだけ確認する（明細を誤って消す事故を防ぐ）
  try {
    const existing = await getDrive(date);
    if (existing) {
      const wasSummary = Boolean(existing._summaryOnly);
      const isSummary = mode === 'summary';
      if (wasSummary !== isSummary) {
        const msg = isSummary
          ? 'この日は明細付きで登録済みです。合計のみで上書きすると明細が消えます。続けますか？'
          : 'この日は合計のみで登録済みです。明細で上書きしますか？';
        if (!window.confirm(msg)) return;
      }
    }
  } catch (e) {
    console.warn('既存日報の確認に失敗:', e);
  }

  const btn = document.getElementById('saveBtn');
  btn.disabled = true;
  document.getElementById('saveStatus').textContent = '天候取得中…';

  let weather = null;
  try { weather = await fetchWeatherForDate(date, config.weatherLocation); }
  catch (e) { console.warn('天候取得失敗:', e); }

  const totalKmRaw = document.getElementById('totalKmInput').value;
  const totalDistanceKm = totalKmRaw.trim() !== '' ? parseInt(totalKmRaw, 10) : null;
  const drive = {
    date,
    vehicleType: document.getElementById('vehicleTypeSel').value,
    departureTime: document.getElementById('departTimeInput').value || config.defaults.departureTime,
    returnTime: document.getElementById('returnTimeInput').value || null,
    totalDistanceKm: Number.isFinite(totalDistanceKm) ? totalDistanceKm : null,
    memo: document.getElementById('memoInput').value,
    rawText: existingRawText,
    weather,
    violations: readViolations(),
    shareOptOut: document.getElementById('shareOptOutInput')?.checked || false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  if (mode === 'summary') {
    drive._summaryOnly = true;
    drive.totalSales = totalSales;
    drive.trips = [];
    drive.rests = [];
  } else {
    drive.trips = parsed.trips.map(stripOcrMeta);
    drive.rests = (parsed.rests || []).map(stripOcrMeta);
  }

  document.getElementById('saveStatus').textContent = '保存中…';
  try {
    await saveDriveSafe(drive);
    document.getElementById('saveStatus').textContent = '保存完了';
    setTimeout(() => location.href = 'index.html', 800);
  } catch (e) {
    document.getElementById('saveStatus').textContent = 'エラー: ' + e.message;
```

（以降の `catch` 末尾・`btn.disabled = false;` などの既存行はそのまま残すこと）

- [ ] **Step 2: 手動確認（実データ・dev 環境）**

`python3 -m http.server 8765` でログインした状態で、以下を順に確認する:

1. **合計のみ保存**: `input.html` → 「合計のみ」→ 売上に `52300` → 保存 → index.html に戻り、その日の売上が ¥52,300 で表示される
2. **バリデーション**: 合計のみで空欄のまま保存 → 「売上合計（税込）を入力してください」の alert が出て保存されない
3. **モード跨ぎの上書き確認（本命）**: 明細ありで保存済みの日を開き、「合計のみ」に切り替えて保存 → 「明細が消えます。続けますか？」の confirm が出る。キャンセルすると保存されない
4. **逆方向**: 合計のみで保存した日を `ocr-import.html` から写真で取り込んで保存 → 「合計のみで登録済みです。明細で上書きしますか？」の confirm が出る。OK すると明細ありに置き換わる
5. **同種別の上書きは無言**: 明細ありの日を編集して保存 → confirm は出ない
6. **編集モード**: 合計のみで保存した日を編集で開く → 合計タブが選択され、売上額が入っている

- [ ] **Step 3: コミット**

```bash
cd ~/work/taxi-dev
git add input.html
git commit -m "feat(input): 合計のみ保存とモード跨ぎ上書きの確認ダイアログ"
```

---

### Task 6: ocr-import.html の失敗時フォールバック導線

**Files:**
- Modify: `js/ocr-import.js:129-134`, `:140-143`, `:152-154`（失敗パス 3 箇所）

**Interfaces:**
- Consumes: `input.html?mode=summary`（Task 4 で実装済み）
- Produces: なし

- [ ] **Step 1: フォールバック HTML を出すヘルパーを追加**

`js/ocr-import.js` のトップレベル（`postOcr` 関数の定義の直前）に追加:

```js
// 読み取り失敗時に「合計だけ入力する」逃げ道を出す。
// 日報が1件も残らないより、売上合計だけでも残った方がいい（給与計算はそれで足りる）。
const FALLBACK_LINK = '<div style="margin-top:10px;"><a href="input.html?mode=summary" style="display:inline-block;text-decoration:none;background:#555;color:#fff;padding:8px 14px;border-radius:6px;font-size:13px;font-weight:600;">💴 合計金額だけ入力する</a></div>';

function showOcrError(statusEl, msg) {
  const esc = String(msg).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  statusEl.innerHTML = '<div>' + esc + '</div>' + FALLBACK_LINK;
}
```

- [ ] **Step 2: 失敗パス 3 箇所を showOcrError に差し替える**

`js/ocr-import.js` の以下 3 箇所を、それぞれ完全に置き換える。

(a) HTTP エラー（`:128-133`）:
```js
    if (!res.ok) {
      let msg = `サーバーエラー (${res.status})`;
      try { msg = (await res.json()).error || msg; } catch (_) {}
      showOcrError(statusEl, "エラー: " + msg);
      return;
    }
```

(b) 明細 0 件（`:140-143`）:
```js
    if (trips.length === 0 && rests.length === 0) {
      showOcrError(statusEl, "明細を読み取れませんでした。明るい場所で、営業明細の全体が入るように撮り直してください。");
      return;
    }
```

(c) 例外（`:153`、`catch (err)` の中）:
```js
  } catch (err) {
    showOcrError(statusEl, '読み取りに失敗しました。通信状況を確認して、もう一度お試しください。');
  }
```

成功パス（`:151` の `statusEl.innerHTML = ...読み取り完了...`）と進捗表示（`:120` の `statusEl.textContent = "解析中…"`）は**変更しない**。毎回フォールバックリンクが出ると邪魔になるため。

- [ ] **Step 3: 手動確認**

`http://localhost:8765/ocr-import.html` を開き、**画像ではないファイル**（例: 適当な .txt を .jpg にリネームしたもの、または極端に小さい画像）をアップロードしてエラーを発生させる。

確認項目:
1. エラーメッセージの下に「💴 合計金額だけ入力する」ボタンが出る
2. そのボタンを押すと `input.html?mode=summary` に飛び、合計タブが選択された状態で開く

- [ ] **Step 4: コミット**

```bash
cd ~/work/taxi-dev
git add js/ocr-import.js
git commit -m "feat(ocr): 読み取り失敗時に「合計だけ入力」への導線を出す"
```

---

### Task 7: 「合計のみ」バッジの表示（detail.html のみ）

**Files:**
- Modify: `detail.html:99`（import 行）, `detail.html:132`（タイトル設定の直後）
- **index.html は変更不要**（下記参照）

**Interfaces:**
- Consumes: `isSummaryOnly(drive)`（Task 1）
- Produces: なし

**index.html が変更不要な理由（コード確認済み）:** `index.html:1029-1041` の日別テーブルは `summary` が true の日に対して既に「概」バッジ（`:1032`）を出し、件数・実車km・乗務時間・時間単価をダッシュ表示（`:1033-1041`）にし、行の背景をグレーにし、`maxIncl`/`maxHourly` の計算からも除外（`:982-983`）している。税込・税抜の売上だけは表示される。Task 1 で `_summaryOnly` が `isSummaryOnly` に入った時点で、この表示が自動的に効く。**手動確認だけ行い、コードは触らない。**

- [ ] **Step 1: detail.html の import に isSummaryOnly を足す**

`detail.html:99` を以下に置き換える:

```js
import { calcTimeBreakdown, hourlyActivity, calcPeriodBreakdown, calcZoneBreakdown, getShiftZones, PERIOD_LABELS, formatMin, timeToMinutes, isSummaryOnly } from './js/chart-helpers.js';
```

- [ ] **Step 2: detail.html にバッジを出す**

`detail.html:132` の

```js
  document.getElementById('title').textContent = `${formatDate(drive.date)} 詳細`;
```

の直後（`renderDateNav(date);` の前）に追加:

```js
  if (isSummaryOnly(drive)) {
    const b = document.createElement('div');
    b.style.cssText = 'background:#fdf3e3;border:1px solid #f0d9a8;color:#7c4a03;border-radius:6px;padding:8px 10px;margin:8px 0;font-size:12px;line-height:1.6;';
    b.innerHTML = '💴 <strong>合計のみの日報</strong>です。売上と給与には反映されますが、明細が無いため時間帯・エリア別のグラフは表示されません。';
    document.getElementById('title').insertAdjacentElement('afterend', b);
  }
```

- [ ] **Step 3: 手動確認**

1. 合計のみで保存した日の `detail.html?date=<日付>` を開く → オレンジのバッジが出る。KPI の売上（税込）は入力した金額どおり。乗車回数 0、客単価 0、時間帯グラフは空（**エラーやNaNが出ないこと**を確認）
2. `index.html` の「営業実績 一覧（日別）」で、その日の行がグレー背景 ＋ 日付の横に「概」バッジ ＋ 件数・km・時間がダッシュ ＋ 税込/税抜だけ金額が出る
3. 明細ありの日には何も変化がない（回帰）

- [ ] **Step 4: 全体テストとコミット**

```bash
cd ~/work/taxi-dev
npm test 2>&1 | tail -5    # fail 0 を確認
git add detail.html
git commit -m "feat(ui): 合計のみ日報に識別バッジを表示"
```

---

## 完了条件

- [ ] `npm test` が fail 0
- [ ] `input.html` に Gemini / テキスト貼付の痕跡が残っていない（`grep -n "Gemini\|rawTextInput\|parseBtn\|copyPromptBtn" input.html` が空）
- [ ] `js/parser.js` は残っており、`admin.html` / `bulk-input.html` が動く
- [ ] 合計のみ日報を保存 → index の月間売上・給与に反映される
- [ ] 明細ありの日を合計のみで上書きしようとすると confirm が出る
- [ ] OCR 失敗時に「合計金額だけ入力する」ボタンが出る

## 検証（デプロイ前）

dev へ反映するのはユーザーが `!~/work/taxi-dev/dpush.sh` を実行する。**Claude は push しない。**

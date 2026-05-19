# 会社管理UI 給与モード別フィールド対応 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 会社管理UIを給与モード（変動部立／固定部立）に応じて入力項目を出し分け、`buildCompanyDoc` の検証をモード別にする。

**Architecture:** `buildCompanyDoc`（純関数）を `payrollMode` で分岐し、変動部立は `rateTable` 必須・固定部立は `fixedRate` 必須にして不要キーを doc から省く。`admin.html` は給与モードラベルを変更し、固定率入力と歩率テーブルを `<div>` ラッパで囲んで `payrollMode` セレクトの `onchange` で表示切替する。`payroll.js` の計算ロジックは変更しない。

**Tech Stack:** バニラJS（ESモジュール）、`node --test`。

設計書: `docs/superpowers/specs/2026-05-19-company-payroll-mode-fields-design.md`

---

### Task 1: `buildCompanyDoc` をモード別検証にする

**Files:**
- Modify: `js/admin-companies.js`
- Modify: `tests/admin-companies.test.js`（全面書き換え）

- [ ] **Step 1: テストを書き換える（失敗する状態にする）**

`tests/admin-companies.test.js` の内容を以下で**完全に置き換える**:

```js
import { test } from 'node:test';
import assert from 'node:assert';
import { buildCompanyDoc } from '../js/admin-companies.js';

function stepForm(over = {}) {
  return {
    slug: 'keiho', name: '恵豊', plan: 'partner', active: true,
    payrollMode: 'step_rate',
    takeHomeRate: '0.75', responsibilityShifts: '11', paidLeaveAmount: '39340',
    fixedRate: '0.55', premiumThreshold: '80000', premiumAmount: '2000',
    rateTable: { '4': [], '12_13rate': 0.5 },
    ...over,
  };
}

function fixedForm(over = {}) {
  return { ...stepForm(), payrollMode: 'fixed_rate', ...over };
}

test('buildCompanyDoc: step_rate 正常系 — number 化と premiumIncentive ネスト', () => {
  const { doc, error } = buildCompanyDoc(stepForm());
  assert.strictEqual(error, undefined);
  assert.strictEqual(doc.takeHomeRate, 0.75);
  assert.strictEqual(doc.responsibilityShifts, 11);
  assert.deepStrictEqual(doc.premiumIncentive,
    { thresholdSalesExclTax: 80000, amountPerShift: 2000 });
  assert.strictEqual(doc.active, true);
  assert.strictEqual(doc.slug, 'keiho');
});

test('buildCompanyDoc: step_rate の doc は rateTable を含み fixedRate を含まない', () => {
  const { doc } = buildCompanyDoc(stepForm());
  assert.notStrictEqual(doc.rateTable, undefined);
  assert.strictEqual(doc.fixedRate, undefined);
});

test('buildCompanyDoc: fixed_rate の doc は fixedRate を含み rateTable を含まない', () => {
  const { doc, error } = buildCompanyDoc(fixedForm());
  assert.strictEqual(error, undefined);
  assert.strictEqual(doc.fixedRate, 0.55);
  assert.strictEqual(doc.rateTable, undefined);
});

test('buildCompanyDoc: fixed_rate で fixedRate 未入力／非数値ならエラー', () => {
  assert.ok(buildCompanyDoc(fixedForm({ fixedRate: '' })).error);
  assert.ok(buildCompanyDoc(fixedForm({ fixedRate: 'abc' })).error);
});

test('buildCompanyDoc: fixed_rate は rateTable 不正でもエラーにならない', () => {
  assert.strictEqual(buildCompanyDoc(fixedForm({ rateTable: null })).error, undefined);
});

test('buildCompanyDoc: step_rate で rateTable が非オブジェクトならエラー', () => {
  assert.ok(buildCompanyDoc(stepForm({ rateTable: null })).error);
  assert.ok(buildCompanyDoc(stepForm({ rateTable: 'x' })).error);
});

test('buildCompanyDoc: 不正な slug でエラー', () => {
  assert.ok(buildCompanyDoc(stepForm({ slug: 'Keiho' })).error);  // 大文字
  assert.ok(buildCompanyDoc(stepForm({ slug: '1abc' })).error);   // 数字始まり
  assert.ok(buildCompanyDoc(stepForm({ slug: 'a-b' })).error);    // 記号
  assert.ok(buildCompanyDoc(stepForm({ slug: 'a' })).error);      // 短すぎ
});

test('buildCompanyDoc: 会社名欠落でエラー', () => {
  assert.ok(buildCompanyDoc(stepForm({ name: '  ' })).error);
});

test('buildCompanyDoc: plan が不正でエラー', () => {
  assert.ok(buildCompanyDoc(stepForm({ plan: 'gold' })).error);
});

test('buildCompanyDoc: payrollMode が空ならエラー', () => {
  assert.ok(buildCompanyDoc(stepForm({ payrollMode: '' })).error);
});

test('buildCompanyDoc: 共通数値項目が非数値なら両モードでエラー', () => {
  assert.ok(buildCompanyDoc(stepForm({ takeHomeRate: '' })).error);
  assert.ok(buildCompanyDoc(stepForm({ paidLeaveAmount: 'abc' })).error);
  assert.ok(buildCompanyDoc(fixedForm({ takeHomeRate: '' })).error);
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `node --test tests/admin-companies.test.js`
Expected: FAIL（現 `buildCompanyDoc` は `fixedRate` を常に必須・doc に常に両方含むため、
「fixedRate を含まない」「fixed_rate は rateTable 不正でもエラーにならない」等が落ちる）

- [ ] **Step 3: `buildCompanyDoc` をモード別検証に書き換える**

`js/admin-companies.js` の `buildCompanyDoc` 関数（現 22-69 行）を以下で**完全に置き換える**。
`SLUG_RE`・`NUMBER_LABELS`・`num` の定義（1-18 行）はそのまま残す:

```js
// フォーム値オブジェクト → companies ドキュメント。
// 成功時は { doc }、検証エラー時は { error } を返す。
// 会社レベル項目のうち rateTable / fixedRate は payrollMode に応じて取捨選択する。
export function buildCompanyDoc(form) {
  const slug = String(form.slug || '').trim();
  if (!SLUG_RE.test(slug) || slug.length < 2 || slug.length > 40) {
    return { error: '会社ID(slug)は半角英小文字で始まり、英小文字・数字・_ のみ・2〜40文字です' };
  }
  const name = String(form.name || '').trim();
  if (!name) return { error: '会社名を入力してください' };
  if (form.plan !== 'partner' && form.plan !== 'normal') {
    return { error: 'プランは partner / normal のいずれかです' };
  }
  const payrollMode = String(form.payrollMode || '').trim();
  if (!payrollMode) return { error: '給与モードを選択してください' };

  // モードに依らず必須の数値項目
  const numbers = {
    takeHomeRate: num(form.takeHomeRate),
    responsibilityShifts: num(form.responsibilityShifts),
    paidLeaveAmount: num(form.paidLeaveAmount),
    thresholdSalesExclTax: num(form.premiumThreshold),
    amountPerShift: num(form.premiumAmount),
  };
  for (const [k, v] of Object.entries(numbers)) {
    if (!Number.isFinite(v)) {
      return { error: `数値項目「${NUMBER_LABELS[k]}」が未入力または不正です` };
    }
  }

  const doc = {
    name,
    slug,
    plan: form.plan,
    active: form.active === true,
    takeHomeRate: numbers.takeHomeRate,
    responsibilityShifts: numbers.responsibilityShifts,
    premiumIncentive: {
      thresholdSalesExclTax: numbers.thresholdSalesExclTax,
      amountPerShift: numbers.amountPerShift,
    },
    paidLeaveAmount: numbers.paidLeaveAmount,
    payrollMode,
  };

  // 固定部立は fixedRate 必須・rateTable 不要。変動部立は逆。
  if (payrollMode === 'fixed_rate') {
    const fixedRate = num(form.fixedRate);
    if (!Number.isFinite(fixedRate)) {
      return { error: `数値項目「${NUMBER_LABELS.fixedRate}」が未入力または不正です` };
    }
    doc.fixedRate = fixedRate;
  } else {
    if (!form.rateTable || typeof form.rateTable !== 'object') {
      return { error: '歩率テーブルが不正です' };
    }
    doc.rateTable = form.rateTable;
  }
  return { doc };
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `node --test tests/admin-companies.test.js`
Expected: PASS（11件）

- [ ] **Step 5: 全テスト回帰確認**

Run: `node --test tests/*.test.js`
Expected: `# fail 0`（admin-companies のテストは 6件→11件に増える。他テストに影響なし）

- [ ] **Step 6: コミット**

```bash
git add js/admin-companies.js tests/admin-companies.test.js
git commit -m "feat(company): buildCompanyDoc を給与モード別検証に（固定部立は rateTable 不要）"
```

---

### Task 2: 会社管理UIの給与モード別 出し分け

**Files:**
- Modify: `admin.html`

- [ ] **Step 1: 給与モードのラベルを変更**

`admin.html` の以下のブロック（現 176-179 行付近）:

```html
      <select class="select" id="companyPayrollMode">
        <option value="step_rate">段階歩率（step_rate）</option>
        <option value="fixed_rate">固定率（fixed_rate）</option>
      </select>
```

を次に置き換える（value は不変）:

```html
      <select class="select" id="companyPayrollMode">
        <option value="step_rate">変動部立</option>
        <option value="fixed_rate">固定部立</option>
      </select>
```

- [ ] **Step 2: 固定率入力を `<div id="companyFixedRateField">` で囲む**

`admin.html` の以下のブロック（現 181-182 行付近）:

```html
      <label class="muted" style="margin-top:8px;display:block;">固定率</label>
      <input class="input" id="companyFixedRate" type="number" step="0.01" value="0.55">
```

を次に置き換える:

```html
      <div id="companyFixedRateField">
        <label class="muted" style="margin-top:8px;display:block;">固定率</label>
        <input class="input" id="companyFixedRate" type="number" step="0.01" value="0.55">
      </div>
```

- [ ] **Step 3: 歩率テーブル一式を `<div id="companyRateTableField">` で囲む**

`admin.html` の以下のブロック（現 199-203 行付近。`歩率テーブル` 見出しを含むため
この5行はファイル内で一意に特定できる）:

```html
      <hr style="border:none;border-top:1px solid var(--border);margin:14px 0;">
      <h4 style="margin:0 0 8px;font-size:13px;">歩率テーブル</h4>
      <p class="muted" style="font-size:11px;margin-bottom:8px;">新規会社では恵豊のひな型値が入っています。その会社の実値に直してください。</p>
      <div id="companyRateTableEditor"></div>
      <hr style="border:none;border-top:1px solid var(--border);margin:14px 0;">
```

を次に置き換える:

```html
      <div id="companyRateTableField">
        <hr style="border:none;border-top:1px solid var(--border);margin:14px 0;">
        <h4 style="margin:0 0 8px;font-size:13px;">歩率テーブル</h4>
        <p class="muted" style="font-size:11px;margin-bottom:8px;">新規会社では恵豊のひな型値が入っています。その会社の実値に直してください。</p>
        <div id="companyRateTableEditor"></div>
        <hr style="border:none;border-top:1px solid var(--border);margin:14px 0;">
      </div>
```

- [ ] **Step 4: 表示切替関数 `applyCompanyPayrollModeUI` を追加**

`admin.html` の module script 内、`function fillCompanyForm(c, isNew) {` の行
（現 1125 行付近）の**直前**に次を挿入する:

```js
// 給与モードに応じて固定率／歩率テーブルの入力欄を出し分ける
function applyCompanyPayrollModeUI() {
  const isFixed = document.getElementById('companyPayrollMode').value === 'fixed_rate';
  document.getElementById('companyFixedRateField').style.display = isFixed ? '' : 'none';
  document.getElementById('companyRateTableField').style.display = isFixed ? 'none' : '';
}

```

- [ ] **Step 5: `fillCompanyForm` の末尾で `applyCompanyPayrollModeUI` を呼ぶ**

`admin.html` の `fillCompanyForm` 末尾の以下（現 1142-1144 行付近）:

```js
  renderRateTable(c.rateTable || DEFAULT_CONFIG.rateTable,
    'companyRateTableEditor', 'companyRate1213');
}
```

を次に置き換える:

```js
  renderRateTable(c.rateTable || DEFAULT_CONFIG.rateTable,
    'companyRateTableEditor', 'companyRate1213');
  applyCompanyPayrollModeUI();
}
```

- [ ] **Step 6: 給与モードセレクトの `onchange` を配線**

`admin.html` の以下の行（現 1166 行付近）:

```js
document.getElementById('loadCompanyListBtn').onclick = loadCompanyList;
```

を次に置き換える:

```js
document.getElementById('loadCompanyListBtn').onclick = loadCompanyList;
document.getElementById('companyPayrollMode').onchange = applyCompanyPayrollModeUI;
```

- [ ] **Step 7: 構造チェック**

Run: `grep -c 'id="companyFixedRateField"\|id="companyRateTableField"\|applyCompanyPayrollModeUI' admin.html`
Expected: `6`（`companyFixedRateField` 定義1＋参照1、`companyRateTableField` 定義1＋参照1、
`applyCompanyPayrollModeUI` 定義1＋呼び出し2 のうち各行に出る行数。最低 6 行）

Run: `grep -c "段階歩率（step_rate）\|固定率（fixed_rate）" admin.html`
Expected: `0`（旧ラベルが残っていない）

- [ ] **Step 8: 全テスト回帰確認**

Run: `node --test tests/*.test.js`
Expected: `# fail 0`（admin.html はテスト対象外。回帰が無いことの確認）

- [ ] **Step 9: コミット**

```bash
git add admin.html
git commit -m "feat(company): 会社管理UIを給与モード別に項目出し分け（変動部立／固定部立）"
```

---

### Task 3: dev デプロイ

**Files:** なし（デプロイ・検証のみ）

- [ ] **Step 1: 全テスト最終確認**

Run: `node --test tests/*.test.js`
Expected: `# fail 0`

- [ ] **Step 2: dev へ反映**

`feat/stripe-billing` を最新 `dev/main` へ rebase してから push:

```bash
git fetch dev
git rebase dev/main
node --test tests/*.test.js   # rebase 後も # fail 0 を確認
git push dev feat/stripe-billing:main
```

衝突した場合は停止してユーザーに報告する（段階3関連ファイル `admin.html` /
`js/admin-companies.js` / `tests/admin-companies.test.js` は他セッションと領域が
分かれているため通常は衝突しない）。

- [ ] **Step 3: dev 実機確認をユーザーに依頼**

dev の `admin.html` でユーザーに以下を確認してもらう:
1. 「🏢 会社管理」→「会社リストを読み込み」→ `keiho` を選択 → 給与モードが
   「変動部立」、歩率テーブルが表示され固定率欄が隠れている。
2. 給与モードを「固定部立」に切り替え → 歩率テーブルが消え固定率欄が出る。
3. 「＋ 新規会社を作成」→「固定部立」を選んで固定率と共通項目だけ入力 →
   「会社を保存」が成功する（歩率テーブル未入力でもエラーにならない）。
4. 「変動部立」のまま歩率テーブルを空にして保存 → エラー表示になる。

- [ ] **Step 4: active-sessions.md を更新**

`.company/secretary/active-sessions.md` の `stripe-billing` 行に本対応の完了を追記する。

---

## 完了確認

- [ ] 全テスト `# fail 0`（`tests/admin-companies.test.js` は 11 件）。
- [ ] 会社管理UIで給与モードを切り替えると、固定率欄と歩率テーブルが出し分けされる。
- [ ] 固定部立の会社は歩率テーブル未入力でも保存できる。
- [ ] dev へ push 済み。

## 自己レビュー結果

- スペック整合: 設計書の5要素（①ラベル変更 ②項目ラッパ＋表示切替 ③モード別検証
  ④テスト更新 ⑤データフロー）を Task 1（③④）・Task 2（①②⑤）・Task 3（dev反映）で
  網羅。`payroll.js`・ホーム画面・段階1コードは未変更（設計のスコープ通り）。
- プレースホルダ: なし（全コード掲載）。
- 型整合: `buildCompanyDoc` の戻り値 `{ doc }` / `{ error }`、`applyCompanyPayrollModeUI`
  の名称、ラッパID `companyFixedRateField` / `companyRateTableField` は Task 1・2 で
  一貫。`payrollMode` の判定値 `'fixed_rate'` は `buildCompanyDoc`・`applyCompanyPayrollModeUI`
  ともに同一文字列。

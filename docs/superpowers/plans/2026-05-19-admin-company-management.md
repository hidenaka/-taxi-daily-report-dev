# admin 会社管理UI（マルチカンパニー段階3）実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `admin.html` に「会社管理」セクションを追加し、会社プロファイル（`companies/{companyId}`）を管理画面で作成・編集できるようにする。

**Architecture:** 検証ロジックは純関数 `buildCompanyDoc`（`js/admin-companies.js`）に切り出してテスト。Firestore I/O は既存パターンに合わせ `js/firebase-storage.js` の `admin*` 関数群に追加。DOM・フォーム配線は `admin.html` のインライン module script に置く。歩率テーブル編集UIは既存 `renderAdminRateTable` をコンテナ引数化して会社管理でも再利用する。

**Tech Stack:** バニラJS（ESモジュール）、Firebase Firestore、`node --test`。

設計書: `docs/superpowers/specs/2026-05-19-admin-company-management-design.md`

---

## 会社プロファイルのフィールド

`companies/{companyId}`（companyId == slug）。会社レベル7項目は `js/company-config.js`
の `COMPANY_LEVEL_KEYS` と一致する:
`rateTable`, `takeHomeRate`, `responsibilityShifts`, `premiumIncentive`,
`paidLeaveAmount`, `payrollMode`, `fixedRate`。
メタ項目: `name`, `slug`, `plan`（'partner'|'normal'）, `active`。
`payrollMode` は `'fixed_rate'`＝固定率モード、それ以外（慣習値 `'step_rate'`）＝段階歩率。

---

### Task 1: フォーム値検証の純関数 `buildCompanyDoc`

**Files:**
- Create: `js/admin-companies.js`
- Test: `tests/admin-companies.test.js`

- [ ] **Step 1: 失敗するテストを書く**

```js
// tests/admin-companies.test.js
import { test } from 'node:test';
import assert from 'node:assert';
import { buildCompanyDoc } from '../js/admin-companies.js';
import { COMPANY_LEVEL_KEYS } from '../js/company-config.js';

function validForm(over = {}) {
  return {
    slug: 'keiho', name: '恵豊', plan: 'partner', active: true,
    payrollMode: 'step_rate',
    takeHomeRate: '0.75', responsibilityShifts: '11', paidLeaveAmount: '39340',
    fixedRate: '0.55', premiumThreshold: '80000', premiumAmount: '2000',
    rateTable: { '4': [], '12_13rate': 0.5 },
    ...over,
  };
}

test('buildCompanyDoc: 正常系 — number 化と premiumIncentive ネスト', () => {
  const { doc, error } = buildCompanyDoc(validForm());
  assert.strictEqual(error, undefined);
  assert.strictEqual(doc.takeHomeRate, 0.75);
  assert.strictEqual(doc.responsibilityShifts, 11);
  assert.deepStrictEqual(doc.premiumIncentive,
    { thresholdSalesExclTax: 80000, amountPerShift: 2000 });
  assert.strictEqual(doc.active, true);
  assert.strictEqual(doc.slug, 'keiho');
});

test('buildCompanyDoc: COMPANY_LEVEL_KEYS を全て含む', () => {
  const { doc } = buildCompanyDoc(validForm());
  for (const k of COMPANY_LEVEL_KEYS) {
    assert.ok(doc[k] !== undefined, `${k} が欠落`);
  }
});

test('buildCompanyDoc: 不正な slug でエラー', () => {
  assert.ok(buildCompanyDoc(validForm({ slug: 'Keiho' })).error);  // 大文字
  assert.ok(buildCompanyDoc(validForm({ slug: '1abc' })).error);   // 数字始まり
  assert.ok(buildCompanyDoc(validForm({ slug: 'a-b' })).error);    // 記号
  assert.ok(buildCompanyDoc(validForm({ slug: 'a' })).error);      // 短すぎ
});

test('buildCompanyDoc: 会社名欠落でエラー', () => {
  assert.ok(buildCompanyDoc(validForm({ name: '  ' })).error);
});

test('buildCompanyDoc: plan が不正でエラー', () => {
  assert.ok(buildCompanyDoc(validForm({ plan: 'gold' })).error);
});

test('buildCompanyDoc: 数値項目が非数値でエラー', () => {
  assert.ok(buildCompanyDoc(validForm({ takeHomeRate: '' })).error);
  assert.ok(buildCompanyDoc(validForm({ paidLeaveAmount: 'abc' })).error);
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `node --test tests/admin-companies.test.js`
Expected: FAIL（`js/admin-companies.js` が存在しない）

- [ ] **Step 3: 最小実装**

```js
// js/admin-companies.js — admin 会社管理: フォーム値の検証とドキュメント化（純関数）

const SLUG_RE = /^[a-z][a-z0-9_]*$/;

// 数値フォーム値を number 化。空文字・非数値は NaN を返す。
function num(v) {
  if (v === '' || v === null || v === undefined) return NaN;
  return Number(v);
}

// フォーム値オブジェクト → companies ドキュメント。
// 成功時は { doc }、検証エラー時は { error } を返す。
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

  const numbers = {
    takeHomeRate: num(form.takeHomeRate),
    responsibilityShifts: num(form.responsibilityShifts),
    paidLeaveAmount: num(form.paidLeaveAmount),
    fixedRate: num(form.fixedRate),
    thresholdSalesExclTax: num(form.premiumThreshold),
    amountPerShift: num(form.premiumAmount),
  };
  for (const [k, v] of Object.entries(numbers)) {
    if (!Number.isFinite(v)) {
      return { error: `数値項目「${k}」が未入力または不正です` };
    }
  }
  if (!form.rateTable || typeof form.rateTable !== 'object') {
    return { error: '歩率テーブルが不正です' };
  }

  const doc = {
    name,
    slug,
    plan: form.plan,
    active: form.active === true,
    rateTable: form.rateTable,
    takeHomeRate: numbers.takeHomeRate,
    responsibilityShifts: numbers.responsibilityShifts,
    premiumIncentive: {
      thresholdSalesExclTax: numbers.thresholdSalesExclTax,
      amountPerShift: numbers.amountPerShift,
    },
    paidLeaveAmount: numbers.paidLeaveAmount,
    payrollMode,
    fixedRate: numbers.fixedRate,
  };
  return { doc };
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `node --test tests/admin-companies.test.js`
Expected: PASS（7件）

- [ ] **Step 5: 全テスト回帰確認**

Run: `node --test tests/*.test.js`
Expected: 既存241件＋新7件＝248件 PASS

- [ ] **Step 6: コミット**

```bash
git add js/admin-companies.js tests/admin-companies.test.js
git commit -m "feat(company): 会社フォーム値検証の純関数 buildCompanyDoc を追加"
```

---

### Task 2: firebase-storage.js に会社 CRUD 関数を追加

**Files:**
- Modify: `js/firebase-storage.js`（CONFIG セクションの後ろに追記）

- [ ] **Step 1: admin 会社関数を追加**

`js/firebase-storage.js` の `getConfigForUser` などがある CONFIG セクションの
直後（`saveConfig`/`getConfigForUser` 群の後）に以下を追記する。
`doc, getDoc, setDoc, collection, getDocs` はファイル冒頭で import 済みのため
追加の import は不要:

```js
// ========== COMPANIES (admin) ==========

// Admin: 全会社プロファイルを取得（id 付き配列）
export async function adminListCompanies() {
  await waitForAuth();
  const snap = await getDocs(collection(db, 'companies'));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// Admin: 会社プロファイルを保存（新規・更新どちらも）
export async function adminSaveCompany(companyId, data) {
  await waitForAuth();
  await setDoc(doc(db, 'companies', companyId), {
    ...data,
    updatedAt: new Date().toISOString()
  });
  return true;
}
```

- [ ] **Step 2: 構文チェック**

Run: `node --check js/firebase-storage.js`
Expected: エラーなし

- [ ] **Step 3: 全テスト回帰確認**

Run: `node --test tests/*.test.js`
Expected: 全248件 PASS（firebase-storage.js はテスト対象外だが破壊が無いこと）

- [ ] **Step 4: コミット**

```bash
git add js/firebase-storage.js
git commit -m "feat(company): firebase-storage に会社プロファイル CRUD 関数を追加"
```

---

### Task 3: 歩率テーブル編集UIをコンテナ引数化

既存 `renderAdminRateTable` はコンテナ `#adminRateTableEditor` と 12-13率 input
`#adminRate1213` を固定参照している。会社管理でも使えるよう、コンテナID と
12-13率 input ID を引数で受け取る `renderRateTable` に置き換え、保存時の
読み戻しを `collectRateTable` に切り出す。挙動は不変。

**Files:**
- Modify: `admin.html`（インライン module script）

- [ ] **Step 1: `renderAdminRateTable` を `renderRateTable` ＋ `collectRateTable` に置き換える**

`admin.html` の以下の関数定義（現 826-847 行付近）:

```js
function renderAdminRateTable(rt) {
  const host = document.getElementById('adminRateTableEditor');
  if (!rt) { host.innerHTML = '<p class="muted">レートテーブルデータがありません</p>'; return; }
  host.innerHTML = '';
  for (const shifts of ['11','10','9','8','7','6','5','4']) {
    const tiers = rt[shifts] || [];
    const div = document.createElement('div');
    div.style.marginBottom = '12px';
    div.innerHTML = `<strong>${shifts}乗務</strong>` +
      tiers.map((t, i) =>
        `<div style="display:flex;gap:4px;margin-top:4px;">
          <input class="input" style="flex:1;" type="number" data-shifts="${shifts}" data-idx="${i}" data-key="salesMin" value="${t.salesMin}">
          <input class="input" style="flex:1;" type="number" data-shifts="${shifts}" data-idx="${i}" data-key="salesMax" value="${t.salesMax}">
          <input class="input" style="flex:1;" type="number" step="0.001" data-shifts="${shifts}" data-idx="${i}" data-key="rate" value="${t.rate}">
        </div>`
      ).join('');
    host.appendChild(div);
  }
  const rateDiv = document.createElement('div');
  rateDiv.innerHTML = `<strong>12-13乗務率</strong> <input class="input" id="adminRate1213" type="number" step="0.01" value="${rt['12_13rate']}" style="width:100px;">`;
  host.appendChild(rateDiv);
}
```

を、次の2関数に置き換える:

```js
function renderRateTable(rt, hostId, rate1213Id) {
  const host = document.getElementById(hostId);
  if (!rt) { host.innerHTML = '<p class="muted">レートテーブルデータがありません</p>'; return; }
  host.innerHTML = '';
  for (const shifts of ['11','10','9','8','7','6','5','4']) {
    const tiers = rt[shifts] || [];
    const div = document.createElement('div');
    div.style.marginBottom = '12px';
    div.innerHTML = `<strong>${shifts}乗務</strong>` +
      tiers.map((t, i) =>
        `<div style="display:flex;gap:4px;margin-top:4px;">
          <input class="input" style="flex:1;" type="number" data-shifts="${shifts}" data-idx="${i}" data-key="salesMin" value="${t.salesMin}">
          <input class="input" style="flex:1;" type="number" data-shifts="${shifts}" data-idx="${i}" data-key="salesMax" value="${t.salesMax}">
          <input class="input" style="flex:1;" type="number" step="0.001" data-shifts="${shifts}" data-idx="${i}" data-key="rate" value="${t.rate}">
        </div>`
      ).join('');
    host.appendChild(div);
  }
  const rateDiv = document.createElement('div');
  rateDiv.innerHTML = `<strong>12-13乗務率</strong> <input class="input" id="${rate1213Id}" type="number" step="0.01" value="${rt['12_13rate']}" style="width:100px;">`;
  host.appendChild(rateDiv);
}

// レートテーブル編集UIから rateTable オブジェクトを組み立てる
function collectRateTable(hostId, rate1213Id) {
  const rt = {};
  document.querySelectorAll(`#${hostId} input[data-shifts]`).forEach(inp => {
    const s = inp.dataset.shifts; const i = parseInt(inp.dataset.idx); const k = inp.dataset.key;
    if (!rt[s]) rt[s] = [];
    if (!rt[s][i]) rt[s][i] = {};
    rt[s][i][k] = parseFloat(inp.value);
  });
  rt['12_13rate'] = parseFloat(document.getElementById(rate1213Id).value);
  return rt;
}
```

- [ ] **Step 2: 既存の呼び出し箇所を更新**

`admin.html` 内の呼び出し（現 819 行付近）:

```js
    renderAdminRateTable(adminCurrentConfig.rateTable);
```

を:

```js
    renderRateTable(adminCurrentConfig.rateTable, 'adminRateTableEditor', 'adminRate1213');
```

に変更する。

- [ ] **Step 3: 保存時の歩率テーブル読み戻しを `collectRateTable` に置き換える**

`saveAdminConfigBtn` の onclick 内の以下のブロック（現 866-873 行付近）:

```js
    if (!adminCurrentConfig.rateTable) adminCurrentConfig.rateTable = {};
    document.querySelectorAll('#adminRateTableEditor input[data-shifts]').forEach(inp => {
      const s = inp.dataset.shifts; const i = parseInt(inp.dataset.idx); const k = inp.dataset.key;
      if (!adminCurrentConfig.rateTable[s]) adminCurrentConfig.rateTable[s] = [];
      if (!adminCurrentConfig.rateTable[s][i]) adminCurrentConfig.rateTable[s][i] = {};
      adminCurrentConfig.rateTable[s][i][k] = parseFloat(inp.value);
    });
    adminCurrentConfig.rateTable['12_13rate'] = parseFloat(document.getElementById('adminRate1213').value);
```

を、次の1行に置き換える:

```js
    adminCurrentConfig.rateTable = collectRateTable('adminRateTableEditor', 'adminRate1213');
```

- [ ] **Step 4: 構造チェック**

Run: `grep -c "renderAdminRateTable" admin.html`
Expected: `0`（旧名が残っていない）

Run: `grep -c "renderRateTable\|collectRateTable" admin.html`
Expected: `4` 以上（定義2＋呼び出し2）

- [ ] **Step 5: 全テスト回帰確認**

Run: `node --test tests/*.test.js`
Expected: 全248件 PASS

- [ ] **Step 6: コミット**

```bash
git add admin.html
git commit -m "refactor(admin): 歩率テーブル編集UIをコンテナ引数化（renderRateTable/collectRateTable）"
```

---

### Task 4: admin.html に「会社管理」セクションの HTML を追加

**Files:**
- Modify: `admin.html`

- [ ] **Step 1: 「ユーザー設定編集」セクションの前にセクションを挿入**

`admin.html` の `<section class="admin-card">` で始まる「⚙️ ユーザー設定編集」
セクション（`<h3>⚙️ ユーザー設定編集</h3>` を含む section）の直前に、以下の
section を挿入する:

```html
    <section class="admin-card">
      <h3>🏢 会社管理</h3>
      <p class="muted" style="font-size:11px;margin-bottom:8px;">会社プロファイル（歩率テーブル・給与ルール等）を作成・編集します。会社レベル設定の正しい編集口です。</p>

      <button class="btn" id="loadCompanyListBtn" style="width:100%;">会社リストを読み込み</button>
      <label class="muted" style="margin-top:12px;display:block;">会社を選択</label>
      <select class="select" id="companySelect">
        <option value="__new__">＋ 新規会社を作成</option>
      </select>
      <div id="companyStatus" style="font-size:12px;margin:8px 0;"></div>

      <label class="muted" style="margin-top:8px;display:block;">会社ID（slug）</label>
      <input class="input" id="companySlug" placeholder="keiho" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false">

      <label class="muted" style="margin-top:8px;display:block;">会社名</label>
      <input class="input" id="companyName" placeholder="恵豊">

      <label class="muted" style="margin-top:8px;display:block;">プラン</label>
      <select class="select" id="companyPlan">
        <option value="partner">提携（partner）</option>
        <option value="normal">通常（normal）</option>
      </select>

      <label class="muted" style="margin-top:8px;display:block;">
        <input type="checkbox" id="companyActive" checked> 有効
      </label>

      <label class="muted" style="margin-top:8px;display:block;">給与モード</label>
      <select class="select" id="companyPayrollMode">
        <option value="step_rate">段階歩率（step_rate）</option>
        <option value="fixed_rate">固定率（fixed_rate）</option>
      </select>

      <label class="muted" style="margin-top:8px;display:block;">固定率</label>
      <input class="input" id="companyFixedRate" type="number" step="0.01" value="0.55">

      <label class="muted" style="margin-top:8px;display:block;">手取り率</label>
      <input class="input" id="companyTakeHomeRate" type="number" step="0.01" value="0.75">

      <label class="muted" style="margin-top:8px;display:block;">責任出番数</label>
      <input class="input" id="companyResponsibilityShifts" type="number" step="1" value="11">

      <label class="muted" style="margin-top:8px;display:block;">有給休暇 1日あたり金額</label>
      <input class="input" id="companyPaidLeaveAmount" type="number" step="100" value="39340">

      <label class="muted" style="margin-top:8px;display:block;">インセンティブ 閾値売上（税抜）</label>
      <input class="input" id="companyPremiumThreshold" type="number" step="1000" value="80000">

      <label class="muted" style="margin-top:8px;display:block;">インセンティブ 額（出番あたり）</label>
      <input class="input" id="companyPremiumAmount" type="number" step="100" value="2000">

      <hr style="border:none;border-top:1px solid var(--border);margin:14px 0;">
      <h4 style="margin:0 0 8px;font-size:13px;">歩率テーブル</h4>
      <p class="muted" style="font-size:11px;margin-bottom:8px;">新規会社では恵豊のひな型値が入っています。その会社の実値に直してください。</p>
      <div id="companyRateTableEditor"></div>
      <hr style="border:none;border-top:1px solid var(--border);margin:14px 0;">

      <button class="btn" id="saveCompanyBtn" style="width:100%;background:var(--primary);color:#fff;">💾 会社を保存</button>
    </section>
```

- [ ] **Step 2: 構造チェック**

Run: `grep -c 'id="saveCompanyBtn"\|id="companySelect"\|id="companyRateTableEditor"' admin.html`
Expected: `3`

- [ ] **Step 3: コミット**

```bash
git add admin.html
git commit -m "feat(company): admin.html に会社管理セクションのUIを追加"
```

---

### Task 5: admin.html に会社管理の配線スクリプトを追加

**Files:**
- Modify: `admin.html`（インライン module script）

- [ ] **Step 1: import を追加**

`admin.html` の module script 冒頭、`firebase-storage.js` からの import 行
（`import { adminBatchSaveDrives, ... } from './js/firebase-storage.js?v=2';`）の
`}` の前に `adminListCompanies, adminSaveCompany` を追加する。
さらに新しい import 行を1行足す:

```js
import { buildCompanyDoc } from './js/admin-companies.js';
```

- [ ] **Step 2: 配線スクリプトを追加**

`admin.html` の module script 末尾（`renderLegalFooter()` 等の最後の行の前後、
スクリプトの一番下）に以下を追加する。`renderRateTable` / `collectRateTable`
（Task 3）と `DEFAULT_CONFIG`（import 済み）を利用する:

```js
// ========== 会社管理 ==========
let companyCache = [];
let companyIsNew = true;

// 新規会社のひな型（DEFAULT_CONFIG＝恵豊相当をベースにする）
function newCompanyTemplate() {
  return {
    name: '', slug: '', plan: 'partner', active: true,
    payrollMode: 'step_rate', fixedRate: 0.55,
    takeHomeRate: DEFAULT_CONFIG.takeHomeRate,
    responsibilityShifts: DEFAULT_CONFIG.responsibilityShifts,
    paidLeaveAmount: DEFAULT_CONFIG.paidLeaveAmount,
    premiumIncentive: DEFAULT_CONFIG.premiumIncentive,
    rateTable: DEFAULT_CONFIG.rateTable,
  };
}

function fillCompanyForm(c, isNew) {
  companyIsNew = isNew;
  const slugInput = document.getElementById('companySlug');
  slugInput.value = isNew ? '' : (c.slug || '');
  slugInput.readOnly = !isNew;
  document.getElementById('companyName').value = c.name || '';
  document.getElementById('companyPlan').value = c.plan || 'partner';
  document.getElementById('companyActive').checked = c.active !== false;
  document.getElementById('companyPayrollMode').value = c.payrollMode || 'step_rate';
  document.getElementById('companyFixedRate').value = c.fixedRate ?? 0.55;
  document.getElementById('companyTakeHomeRate').value = c.takeHomeRate ?? 0.75;
  document.getElementById('companyResponsibilityShifts').value = c.responsibilityShifts ?? 11;
  document.getElementById('companyPaidLeaveAmount').value = c.paidLeaveAmount ?? 39340;
  document.getElementById('companyPremiumThreshold').value =
    c.premiumIncentive?.thresholdSalesExclTax ?? 80000;
  document.getElementById('companyPremiumAmount').value =
    c.premiumIncentive?.amountPerShift ?? 2000;
  renderRateTable(c.rateTable || DEFAULT_CONFIG.rateTable,
    'companyRateTableEditor', 'companyRate1213');
}

async function loadCompanyList() {
  const status = document.getElementById('companyStatus');
  try {
    companyCache = await adminListCompanies();
    const sel = document.getElementById('companySelect');
    sel.innerHTML = '<option value="__new__">＋ 新規会社を作成</option>';
    for (const c of companyCache) {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = `${c.name || c.id}（${c.id}）`;
      sel.appendChild(opt);
    }
    status.textContent = `✓ ${companyCache.length} 社を読み込みました`;
    status.style.color = 'green';
  } catch (e) {
    status.textContent = '✗ 読み込み失敗: ' + e.message;
    status.style.color = '#d32f2f';
  }
}

document.getElementById('loadCompanyListBtn').onclick = loadCompanyList;

document.getElementById('companySelect').onchange = (e) => {
  const v = e.target.value;
  if (v === '__new__') {
    fillCompanyForm(newCompanyTemplate(), true);
  } else {
    const c = companyCache.find(x => x.id === v);
    if (c) fillCompanyForm(c, false);
  }
};

document.getElementById('saveCompanyBtn').onclick = async () => {
  const status = document.getElementById('companyStatus');
  const form = {
    slug: document.getElementById('companySlug').value.trim(),
    name: document.getElementById('companyName').value,
    plan: document.getElementById('companyPlan').value,
    active: document.getElementById('companyActive').checked,
    payrollMode: document.getElementById('companyPayrollMode').value,
    fixedRate: document.getElementById('companyFixedRate').value,
    takeHomeRate: document.getElementById('companyTakeHomeRate').value,
    responsibilityShifts: document.getElementById('companyResponsibilityShifts').value,
    paidLeaveAmount: document.getElementById('companyPaidLeaveAmount').value,
    premiumThreshold: document.getElementById('companyPremiumThreshold').value,
    premiumAmount: document.getElementById('companyPremiumAmount').value,
    rateTable: collectRateTable('companyRateTableEditor', 'companyRate1213'),
  };
  const { doc: companyDoc, error } = buildCompanyDoc(form);
  if (error) {
    status.textContent = '✗ ' + error;
    status.style.color = '#d32f2f';
    return;
  }
  if (companyIsNew && companyCache.some(c => c.id === companyDoc.slug)) {
    status.textContent = `✗ 会社ID「${companyDoc.slug}」は既に存在します`;
    status.style.color = '#d32f2f';
    return;
  }
  try {
    await adminSaveCompany(companyDoc.slug, companyDoc);
    status.textContent = `✓ 会社「${companyDoc.name}」を保存しました`;
    status.style.color = 'green';
    await loadCompanyList();
    document.getElementById('companySelect').value = companyDoc.slug;
    companyIsNew = false;
    document.getElementById('companySlug').readOnly = true;
  } catch (e) {
    status.textContent = '✗ 保存失敗: ' + e.message;
    status.style.color = '#d32f2f';
  }
};

// 初期表示は新規会社フォーム
fillCompanyForm(newCompanyTemplate(), true);
```

- [ ] **Step 2.5: 構造チェック**

Run: `grep -c "buildCompanyDoc\|adminListCompanies\|adminSaveCompany" admin.html`
Expected: `4` 以上（import 2＋使用箇所）

- [ ] **Step 3: 全テスト回帰確認**

Run: `node --test tests/*.test.js`
Expected: 全248件 PASS

- [ ] **Step 4: コミット**

```bash
git add admin.html
git commit -m "feat(company): admin.html に会社管理の読み込み・保存配線を追加"
```

---

### Task 6: 「ユーザー設定編集」セクションに注意書きを追加

段階1で会社レベル項目はマージ時に会社優先になったため、ユーザー設定編集で
会社所属ユーザーの会社レベル項目を編集しても無効になる。注意書きで明示する。

**Files:**
- Modify: `admin.html`

- [ ] **Step 1: 注意書きを追加**

`admin.html` の「⚙️ ユーザー設定編集」セクション内、現在の説明文:

```html
      <p class="muted" style="font-size:11px;margin-bottom:8px;">特定ユーザーの設定を編集。レートテーブル、デフォルト値など。</p>
```

の直後に次の1行を追加する:

```html
      <p style="font-size:11px;margin-bottom:8px;color:#d32f2f;">※歩率・手取り率など会社レベル項目は「🏢 会社管理」で設定します。会社に所属するユーザーには会社プロファイルが優先され、ここでの編集は反映されません。</p>
```

- [ ] **Step 2: 構造チェック**

Run: `grep -c "会社レベル項目は「🏢 会社管理」で設定" admin.html`
Expected: `1`

- [ ] **Step 3: コミット**

```bash
git add admin.html
git commit -m "docs(admin): ユーザー設定編集に会社レベル項目の注意書きを追加"
```

---

### Task 7: dev デプロイと実機確認

**Files:** なし（デプロイ・検証のみ）

- [ ] **Step 1: 全テスト最終確認**

Run: `node --test tests/*.test.js`
Expected: 全248件 PASS

- [ ] **Step 2: dev へ反映**

`feat/stripe-billing` を最新 `dev/main` へ rebase してから push:

```bash
git fetch dev
git rebase dev/main
node --test tests/*.test.js   # rebase 後も 248件 PASS を確認
git push dev feat/stripe-billing:main
```

衝突した場合は停止してユーザーに報告する。

- [ ] **Step 3: dev 実機確認をユーザーに依頼**

dev の `admin.html` でユーザーに以下を確認してもらう:
1. admin ログイン → 「🏢 会社管理」セクションが表示される。
2. 「会社リストを読み込み」→ `keiho`（恵豊）が選択肢に出る。
3. `keiho` を選択 → 歩率テーブル・手取り率等が現在値で表示される。
4. 手取り率など1項目を変更 → 「会社を保存」→ 成功表示。再読み込みで反映確認。
5. 「＋ 新規会社を作成」→ ひな型が入る → slug/会社名を入れて保存できる
   （テスト用に作った場合は Firebase Console で後で削除）。

- [ ] **Step 4: active-sessions.md を更新**

`.company/secretary/active-sessions.md` の `stripe-billing` 行に段階3完了を追記する。

---

## 完了確認（段階3）

- [ ] 全248テスト PASS。
- [ ] `admin.html` に「🏢 会社管理」セクションが表示され、`keiho` の読み込み・
      編集・保存ができる。
- [ ] 新規会社の作成ができる。
- [ ] 「ユーザー設定編集」に会社レベル項目の注意書きが表示される。
- [ ] dev へ push 済み。

段階3完了後、段階2（会社別申込リンク）または段階4（会社別価格）の計画を作成する。

## 自己レビュー結果

- スペック整合: 設計書「段階3」のスコープ（既存会社編集＋新規作成）を Task 1-6 で
  網羅。データモデル・UI構成・データフロー・関連改善・エラーハンドリング・テストの
  各セクションに対応タスクあり。申込リンク発行は段階2スコープのため対象外（設計通り）。
- プレースホルダ: なし（全コード掲載）。
- 型整合: `buildCompanyDoc` の戻り値 `{ doc }` / `{ error }`、`renderRateTable` /
  `collectRateTable` の引数（hostId, rate1213Id）、`adminListCompanies` /
  `adminSaveCompany` の名称は Task 1-5 で一貫。`companyRate1213` という 12-13率
  input ID は Task 4 の HTML には現れず Task 3 の `renderRateTable` が動的生成
  （`rate1213Id` 引数）するため整合。

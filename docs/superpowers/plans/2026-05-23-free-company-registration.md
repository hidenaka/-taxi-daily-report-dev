# 会社単位の無償フラグで課金不要登録 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 会社に `freeForInvited` フラグを持たせ、その会社の招待で登録した人を Stripe を通さず無償(active)で利用開始させる。

**Architecture:** 会社プロファイルに無償フラグ → subscribe.html がフラグを読み無償なら「無償で利用を開始」UIに分岐 → worker `/start-free` が `users` を userId で検索して本当の companyId を求め、その会社の `freeForInvited` をサーバー検証してから active 付与（なりすまし防止）。

**Tech Stack:** Vanilla JS ESM、Cloudflare Workers（Firestore REST + SA JWT）、`node --test`+`tests/run.js`。

**作業基点:** `~/work/taxi-dev` branch `feat/free-company-registration`。spec: `docs/superpowers/specs/2026-05-23-free-company-registration-design.md`。

---

### Task 1: 会社プロファイルに freeForInvited（純関数）

**Files:** Modify `js/admin-companies.js`, `js/company-config.js` / Test `tests/admin-companies.test.js`

- [ ] **Step 1: Write the failing test** （`tests/admin-companies.test.js` 末尾に追記）
```js
test('buildCompanyDoc: freeForInvited=true を doc に格納', () => {
  const base = { slug: 'co-aaa111', plan: 'partner', active: true, payrollMode: 'fixed_rate',
    takeHomeRate: '0.75', responsibilityShifts: '11', paidLeaveAmount: '39340',
    premiumThreshold: '500000', premiumAmount: '1000', fixedRate: '0.55', freeForInvited: true };
  const { doc, error } = buildCompanyDoc(base);
  assert.equal(error, undefined);
  assert.equal(doc.freeForInvited, true);
});
test('buildCompanyDoc: freeForInvited 未指定なら doc に含めない', () => {
  const base = { slug: 'co-aaa111', plan: 'partner', active: true, payrollMode: 'fixed_rate',
    takeHomeRate: '0.75', responsibilityShifts: '11', paidLeaveAmount: '39340',
    premiumThreshold: '500000', premiumAmount: '1000', fixedRate: '0.55' };
  const { doc } = buildCompanyDoc(base);
  assert.equal('freeForInvited' in doc, false);
});
```

- [ ] **Step 2: Run → fail**　Run: `cd ~/work/taxi-dev && node --test tests/admin-companies.test.js`　Expected: FAIL

- [ ] **Step 3: 実装** `js/admin-companies.js` の `if (defaultRecArea) doc.defaultRecArea = defaultRecArea;` の直後に追加:
```js
  // 無償フラグ: true の会社の招待者は課金不要(worker /start-free で付与)。未指定は省略。
  if (form.freeForInvited === true) doc.freeForInvited = true;
```
`js/company-config.js` の `COMPANY_LEVEL_KEYS` 配列の `'defaultRecArea',` の次の行に追加:
```js
  'freeForInvited',
```

- [ ] **Step 4: Run → pass**　Run: `cd ~/work/taxi-dev && node --test tests/admin-companies.test.js`　Expected: PASS

- [ ] **Step 5: Commit**
```bash
cd ~/work/taxi-dev && git add js/admin-companies.js js/company-config.js tests/admin-companies.test.js
git commit -m "feat(company): 会社プロファイルに freeForInvited フラグ"
```

---

### Task 2: admin.html 会社管理フォームに無償チェックボックス

**Files:** Modify `admin.html`

- [ ] **Step 1: チェックボックスUI追加**　会社管理フォームの「有効」チェックボックス行
```html
        <input type="checkbox" id="companyActive" checked> 有効
```
を探し、その行を含む `<label>...</label>` の直後に次を追加:
```html
      <label style="display:flex;align-items:center;gap:6px;margin-top:6px;">
        <input type="checkbox" id="companyFreeForInvited"> 無償（この会社の招待者は課金なしで利用開始）
      </label>
```

- [ ] **Step 2: 保存時にフォーム値へ含める**　admin.html 内で `buildCompanyDoc(` を呼ぶフォーム組み立て箇所を探し、渡しているフォームオブジェクトに次のキーを追加（`active: document.getElementById('companyActive').checked,` の近くに）:
```js
      freeForInvited: document.getElementById('companyFreeForInvited').checked,
```

- [ ] **Step 3: 読込時にチェック状態を反映**　会社を選択してフォームへ流し込む箇所（`document.getElementById('companyActive').checked = ` を設定している行付近）に追加:
```js
    document.getElementById('companyFreeForInvited').checked = (c && c.freeForInvited === true);
```

- [ ] **Step 4: 静的確認**
```bash
cd ~/work/taxi-dev && node -e "const s=require('fs').readFileSync('admin.html','utf8'); ['id=\"companyFreeForInvited\"','freeForInvited: document.getElementById'].forEach(k=>{if(!s.includes(k))throw new Error('missing '+k)}); console.log('admin ok')"
```
Expected: `admin ok`

- [ ] **Step 5: Commit**
```bash
cd ~/work/taxi-dev && git add admin.html && git commit -m "feat(admin): 会社管理に無償フラグのチェックボックス"
```

---

### Task 3: クライアント — 会社プロファイル取得 + startFree

**Files:** Modify `js/invite-url.js`, `js/subscription-state.js`

- [ ] **Step 1: invite-url.js に会社プロファイル取得を追加**　`fetchCompanyExists` 関数の直後に追加:
```js
// 会社プロファイルを取得（無償フラグ判定用）。存在しなければ null。
export async function fetchCompanyProfile(slug) {
  if (!slug) return null;
  const { db } = await import('./firebase-init.js');
  const { doc, getDoc } = await import('https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js');
  const snap = await getDoc(doc(db, 'companies', slug));
  return snap.exists() ? snap.data() : null;
}
```

- [ ] **Step 2: subscription-state.js に startFree を追加**　`startCheckout` 関数の直後に追加:
```js
// 無償会社の利用開始。Worker が会社フラグをサーバー検証して active(無償) を付与する。
// 成功時は true。クライアントは companyId を渡さない（Worker が userId から検証する）。
export async function startFree(versions) {
  const { userId } = await loadFirebase();
  const res = await fetch(billingApiBase() + '/start-free', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId,
      agreement: {
        termsVersion: (versions && versions.terms) || null,
        privacyVersion: (versions && versions.privacy) || null,
        tokuteishouVersion: (versions && versions.tokuteishou) || null,
      },
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) {
    const err = new Error(data.error || ('http_' + res.status));
    err.code = data.error || ('http_' + res.status);
    throw err;
  }
  clearSubCache();
  return true;
}
```

- [ ] **Step 3: 全テスト（既存を壊していない）**　Run: `cd ~/work/taxi-dev && npm test`　Expected: 全 PASS

- [ ] **Step 4: Commit**
```bash
cd ~/work/taxi-dev && git add js/invite-url.js js/subscription-state.js
git commit -m "feat(client): fetchCompanyProfile と startFree(無償開始)"
```

---

### Task 4: subscribe.html を無償会社で分岐

**Files:** Modify `subscribe.html`

- [ ] **Step 1: import を追加**　subscribe.html の `<script type="module">` 内、`startCheckout` を import している行に `startFree` を追加し、invite-url から `fetchCompanyProfile` を import:
```js
import { startCheckout, startFree } from './js/subscription-state.js';
import { fetchCompanyProfile } from './js/invite-url.js';
```
（既存の subscription-state import 行に startFree を足す。invite-url import が無ければ新規追加）

- [ ] **Step 2: 無償会社なら無償UIへ分岐**　申込ボタンの click ハンドラ（`startCheckout(` を呼んでいる箇所）を探し、そのハンドラ関数の冒頭で会社フラグを見て分岐する。具体的には、ページ初期化で会社フラグを判定して `window.__freeCompany` に保持し、申込ボタン押下時に分岐:

ページ初期化（DOMContentLoaded 相当の初期化ブロック末尾）に追加:
```js
  // 招待会社が無償なら、申込ボタンの文言を「無償で利用を開始」に変え Stripe を出さない
  (async () => {
    try {
      const slug = localStorage.getItem('taxi_pending_company')
        || new URLSearchParams(location.search).get('company');
      if (!slug) return;
      const profile = await fetchCompanyProfile(slug);
      if (profile && profile.freeForInvited === true) {
        window.__freeCompany = true;
        const btn = document.getElementById('submitBtn');
        if (btn) btn.textContent = '無償で利用を開始';
        const couponRow = document.getElementById('couponRow');
        if (couponRow) couponRow.style.display = 'none';
      }
    } catch (e) { /* 失敗時は通常(Stripe)フロー */ }
  })();
```
（`submitBtn` / `couponRow` の実IDは subscribe.html を確認して合わせる。クーポン行のIDが異なる場合はその要素を非表示にする）

- [ ] **Step 3: 申込ハンドラを分岐**　`const url = await startCheckout(...)` を呼んでいる箇所を次のように分岐:
```js
    if (window.__freeCompany === true) {
      await startFree(AGREEMENT_VERSIONS);
      location.href = 'index.html';
      return;
    }
    const url = await startCheckout(AGREEMENT_VERSIONS, appliedCoupon);
    location.href = url;
```
（既存の `AGREEMENT_VERSIONS` / `appliedCoupon` 変数名は subscribe.html の実装に合わせる）

- [ ] **Step 4: 静的確認**
```bash
cd ~/work/taxi-dev && node -e "const s=require('fs').readFileSync('subscribe.html','utf8'); ['startFree','fetchCompanyProfile','freeForInvited','無償で利用を開始'].forEach(k=>{if(!s.includes(k))throw new Error('missing '+k)}); console.log('subscribe ok')"
```
Expected: `subscribe ok`

- [ ] **Step 5: Commit**
```bash
cd ~/work/taxi-dev && git add subscribe.html && git commit -m "feat(subscribe): 無償会社はStripe非経由の無償開始に分岐"
```

---

### Task 5: worker /start-free（サーバー検証で無償付与）

**Files:** Modify `worker/src/index.js`

- [ ] **Step 1: USER_ID_RE を数字始まり許可に**　`const USER_ID_RE = /^[a-z][a-z0-9_]*$/;` を次に変更（社員番号系の数字IDを許可）:
```js
const USER_ID_RE = /^[a-z0-9_]+$/;
```

- [ ] **Step 2: ルート追加**　`if (request.method === 'POST' && path === '/create-checkout-session') {` ブロックの直後に追加:
```js
      if (request.method === 'POST' && path === '/start-free') {
        return await handleStartFree(request, env);
      }
```

- [ ] **Step 3: ハンドラ + runQuery ヘルパ追加**　`recordAgreement` 関数の直後に追加:
```js
// 無償会社の登録: users を userId で検索して本当の companyId を取得し、
// その会社の freeForInvited をサーバー検証してから active(無償) を付与する。
async function handleStartFree(request, env) {
  const body = await request.json().catch(() => ({}));
  const userId = String(body.userId || '').trim();
  const agreement = body.agreement || {};
  if (!USER_ID_RE.test(userId)) return json(env, { error: 'invalid_user' }, 400);

  const token = await getAccessToken(env);
  const companyId = await findCompanyIdByUserId(env, token, userId);
  if (!companyId) return json(env, { error: 'no_company' }, 403);

  const company = await firestoreGet(env, token, 'companies/' + companyId);
  const free = company && company.fields && company.fields.freeForInvited
    && company.fields.freeForInvited.booleanValue === true;
  if (!free) return json(env, { error: 'not_free_company' }, 403);

  const existing = await firestoreGet(env, token, 'subscriptions/' + userId);
  const createdAt = (existing && existing.fields && existing.fields.createdAt
    && existing.fields.createdAt.stringValue) || new Date().toISOString();
  const now = new Date().toISOString();
  await firestorePatch(env, token, 'subscriptions/' + userId, {
    status: 'active',
    planId: 'comp_company',
    companyId,
    agreedTermsAt: now,
    agreedTermsVersion: (agreement && agreement.termsVersion) || null,
    agreedPrivacyAt: now,
    agreedPrivacyVersion: (agreement && agreement.privacyVersion) || null,
    agreedTokuteishouAt: now,
    createdAt,
    updatedAt: now,
  });
  return json(env, { ok: true });
}

// users コレクションを userId フィールドで検索し companyId を返す。0件/複数件は null。
async function findCompanyIdByUserId(env, token, userId) {
  const url = `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents:runQuery`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ structuredQuery: {
      from: [{ collectionId: 'users' }],
      where: { fieldFilter: { field: { fieldPath: 'userId' }, op: 'EQUAL', value: { stringValue: userId } } },
      limit: 2,
    } }),
  });
  if (!res.ok) return null;
  const rows = await res.json();
  const docs = (Array.isArray(rows) ? rows : []).filter(r => r.document);
  if (docs.length !== 1) return null; // 0件 or 複数件は安全側で拒否
  const f = docs[0].document.fields || {};
  return (f.companyId && f.companyId.stringValue) || null;
}
```

- [ ] **Step 4: 構文チェック**
```bash
cd ~/work/taxi-dev && node --check worker/src/index.js && echo "syntax ok"
```
Expected: `syntax ok`

- [ ] **Step 5: 全テスト（worker はテスト対象外だがアプリ側回帰確認）**　Run: `cd ~/work/taxi-dev && npm test`　Expected: 全 PASS

- [ ] **Step 6: Commit**
```bash
cd ~/work/taxi-dev && git add worker/src/index.js
git commit -m "feat(worker): /start-free 無償会社の active 付与(userId→company id検証)+USER_ID_RE数字許可"
```

---

### Task 6: dev デプロイ + 検証 →（本人OK後）本番

- [ ] **Step 1: 全テスト最終**　Run: `cd ~/work/taxi-dev && npm test`　Expected: 全 PASS

- [ ] **Step 2: worker を dev にデプロイ**（本人 or 権限承認下で）
```bash
cd ~/work/taxi-dev/worker && npx wrangler deploy --env dev
```
Expected: `cabis-billing-dev` の新バージョンが出る

- [ ] **Step 3: アプリを dev 反映**（本人が `!` 実行）
```
! bash ~/work/taxi-dev/dpush.sh
```

- [ ] **Step 4: dev 実機検証（本人）**
  - admin で恵豊(dev: co-7q7ros)の会社設定 → 「無償」ON で保存
  - 無償会社の招待 `?company=co-7q7ros` で新規ID登録 → subscribe が「無償で利用を開始」になる → 押すと Stripe を通らず利用開始 → 設定の課金状況が active
  - 無償OFFの会社/直接は従来どおり Stripe が出る

- [ ] **Step 5: 本番（本人OK後）**　worker: `cd ~/work/taxi-dev/worker && npx wrangler deploy --env production` ／ アプリ: `v*` タグ（次番 v1.31.0）。恵豊本番(co-swyg3o)の会社設定で「無償」ON。

---

## Self-Review
- **Spec coverage:** 会社フラグ(T1/T2)・client startFree/会社取得(T3)・subscribe分岐(T4)・worker検証付与+USER_ID_RE(T5)・2系統デプロイ(T6)=spec全項目に対応。
- **Placeholder scan:** 実IDの突合（submitBtn/couponRow/AGREEMENT_VERSIONS/appliedCoupon, admin保存・読込箇所）は「subscribe.html/admin.html の実装に合わせる」と明示し、静的確認ステップで担保。コードは実体記載。
- **Type consistency:** `freeForInvited`(boolean) を admin-companies/company-config/admin.html/worker(booleanValue)/subscribe(=== true) で一貫。`startFree(versions)`・`fetchCompanyProfile(slug)`・`findCompanyIdByUserId` 名称一貫。
- **セキュリティ:** 無償付与は worker が runQuery で本当の companyId を取得→会社フラグ検証してから。クライアントの companyId 自己申告に依存しない。

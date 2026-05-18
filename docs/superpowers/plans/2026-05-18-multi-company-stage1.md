# マルチカンパニー 段階1（データモデル＋恵豊パッケージ化）実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans でタスク順に実装。

**Goal:** 「会社プロファイル」のデータモデルを導入し、恵豊を最初の会社プロファイルとしてパッケージ化する。既存挙動は一切変えない。

**Architecture:** `companies/{companyId}` を Firestore に新設。`getConfig()` は「会社プロファイル＋userConfig」を実行時マージして返す（会社レベル項目は会社プロファイル優先＝参照モデル）。恵豊プロファイルの値は現 `DEFAULT_CONFIG` の会社レベル項目と等価にし、無変更を保証する。

**Tech Stack:** バニラJS（ESモジュール）、Firebase Firestore、`node --test`。

設計書: `docs/superpowers/specs/2026-05-18-multi-company-profiles-design.md`
段階2〜5（申込リンク・admin会社管理・会社別価格・通常プラン自己設定）は段階1完了後に別計画化。

---

## 会社レベル項目の定義

`DEFAULT_CONFIG`（`js/default-config.js`）のうち会社レベル＝
`rateTable`, `takeHomeRate`, `responsibilityShifts`, `premiumIncentive`,
`paidLeaveAmount`, `payrollMode`, `fixedRate`。
それ以外（`shifts`, `weatherLocation`, `takeHomeTarget`, `grossTarget`,
`takeHomeAt11Target`, `takeHomeAfter11Target`, `displayName`, `defaults`,
`privacy`）は個人レベル＝`userConfigs/{userId}` に残す。
※休憩時間・会社負担の高速代・車両種類リストは新規項目のため段階1では扱わない（段階4以降）。

---

### Task 1: 会社設定マージの純関数

**Files:**
- Create: `js/company-config.js`
- Test: `tests/company-config.test.js`

- [ ] **Step 1: 失敗するテストを書く**

```js
// tests/company-config.test.js
import { test } from 'node:test';
import assert from 'node:assert';
import { COMPANY_LEVEL_KEYS, mergeCompanyConfig } from '../js/company-config.js';

test('COMPANY_LEVEL_KEYS に rateTable と takeHomeRate を含む', () => {
  assert.ok(COMPANY_LEVEL_KEYS.includes('rateTable'));
  assert.ok(COMPANY_LEVEL_KEYS.includes('takeHomeRate'));
});

test('mergeCompanyConfig: 会社レベル項目は会社プロファイルが優先', () => {
  const company = { takeHomeRate: 0.70, rateTable: { '11': [] } };
  const user = { takeHomeRate: 0.99, displayName: '田中', takeHomeTarget: 500000 };
  const merged = mergeCompanyConfig(company, user);
  assert.strictEqual(merged.takeHomeRate, 0.70);          // 会社優先
  assert.deepStrictEqual(merged.rateTable, { '11': [] });  // 会社優先
  assert.strictEqual(merged.displayName, '田中');          // 個人は保持
  assert.strictEqual(merged.takeHomeTarget, 500000);       // 個人は保持
});

test('mergeCompanyConfig: 会社プロファイルが null なら userConfig をそのまま返す', () => {
  const user = { takeHomeRate: 0.99, displayName: '田中' };
  assert.deepStrictEqual(mergeCompanyConfig(null, user), user);
});

test('mergeCompanyConfig: 会社プロファイルに無い会社レベル項目は個人値を維持', () => {
  const company = { takeHomeRate: 0.70 }; // rateTable 無し
  const user = { takeHomeRate: 0.99, rateTable: { '11': [1] } };
  const merged = mergeCompanyConfig(company, user);
  assert.strictEqual(merged.takeHomeRate, 0.70);
  assert.deepStrictEqual(merged.rateTable, { '11': [1] }); // 会社に無いので個人値
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `node --test tests/company-config.test.js`
Expected: FAIL（`js/company-config.js` が存在しない）

- [ ] **Step 3: 最小実装**

```js
// js/company-config.js — 会社プロファイルと個人設定のマージ（純関数）

// 会社レベル設定の項目。これらは会社プロファイルが優先される。
export const COMPANY_LEVEL_KEYS = [
  'rateTable',
  'takeHomeRate',
  'responsibilityShifts',
  'premiumIncentive',
  'paidLeaveAmount',
  'payrollMode',
  'fixedRate',
];

// 会社プロファイル＋個人設定 → 実効設定。
// 会社レベル項目は companyProfile に値があれば優先。それ以外は userConfig。
export function mergeCompanyConfig(companyProfile, userConfig) {
  const merged = { ...userConfig };
  if (companyProfile) {
    for (const key of COMPANY_LEVEL_KEYS) {
      if (companyProfile[key] !== undefined) {
        merged[key] = companyProfile[key];
      }
    }
  }
  return merged;
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `node --test tests/company-config.test.js`
Expected: PASS（4件）

- [ ] **Step 5: 全テスト回帰確認**

Run: `node --test tests/*.test.js`
Expected: 既存235件＋新4件＝239件 PASS

- [ ] **Step 6: コミット**

```bash
git add js/company-config.js tests/company-config.test.js
git commit -m "feat(company): 会社プロファイルと個人設定のマージ純関数を追加"
```

---

### Task 2: 恵豊 会社プロファイルの seed 定義

**Files:**
- Create: `js/company-profiles.js`
- Test: `tests/company-profiles.test.js`

- [ ] **Step 1: 失敗するテストを書く**

```js
// tests/company-profiles.test.js
import { test } from 'node:test';
import assert from 'node:assert';
import { buildKeihoProfile } from '../js/company-profiles.js';
import { DEFAULT_CONFIG } from '../js/default-config.js';
import { COMPANY_LEVEL_KEYS, mergeCompanyConfig } from '../js/company-config.js';

test('buildKeihoProfile: 会社レベル項目を DEFAULT_CONFIG と等価に持つ', () => {
  const p = buildKeihoProfile();
  assert.strictEqual(p.takeHomeRate, DEFAULT_CONFIG.takeHomeRate);
  assert.strictEqual(p.responsibilityShifts, DEFAULT_CONFIG.responsibilityShifts);
  assert.deepStrictEqual(p.rateTable, DEFAULT_CONFIG.rateTable);
  assert.deepStrictEqual(p.premiumIncentive, DEFAULT_CONFIG.premiumIncentive);
  assert.strictEqual(p.paidLeaveAmount, DEFAULT_CONFIG.paidLeaveAmount);
});

test('恵豊プロファイルでマージしても DEFAULT_CONFIG 由来の個人設定は不変', () => {
  // 既存ユーザーの userConfig（DEFAULT_CONFIG のコピー）に恵豊プロファイルを
  // マージしても会社レベル値が一致するため実効設定は変わらない
  const userConfig = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  userConfig.payrollMode = 'step_rate';
  userConfig.fixedRate = 0.55;
  const merged = mergeCompanyConfig(buildKeihoProfile(), userConfig);
  for (const k of COMPANY_LEVEL_KEYS) {
    assert.deepStrictEqual(merged[k], userConfig[k], `${k} が変化した`);
  }
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `node --test tests/company-profiles.test.js`
Expected: FAIL（`js/company-profiles.js` が無い）

- [ ] **Step 3: 最小実装**

```js
// js/company-profiles.js — 会社プロファイルの seed 定義
import { DEFAULT_CONFIG } from './default-config.js';
import { COMPANY_LEVEL_KEYS } from './company-config.js';

// 恵豊プロファイル: 現 DEFAULT_CONFIG の会社レベル項目を抜き出したもの。
// payrollMode / fixedRate は getConfig 初期化時に付与される既定値に合わせる。
export function buildKeihoProfile() {
  const base = { ...DEFAULT_CONFIG, payrollMode: 'step_rate', fixedRate: 0.55 };
  const profile = {
    name: '恵豊',
    slug: 'keiho',
    plan: 'partner',
    active: true,
  };
  for (const key of COMPANY_LEVEL_KEYS) {
    if (base[key] !== undefined) {
      profile[key] = JSON.parse(JSON.stringify(base[key]));
    }
  }
  return profile;
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `node --test tests/company-profiles.test.js`
Expected: PASS（2件）

- [ ] **Step 5: コミット**

```bash
git add js/company-profiles.js tests/company-profiles.test.js
git commit -m "feat(company): 恵豊会社プロファイルの seed 定義を追加"
```

---

### Task 3: firestore.rules に companies コレクションを追加

**Files:**
- Modify: `firestore.rules`

- [ ] **Step 1: ルールを追加**

`firestore.rules` の `subscriptions/{userId}` ブロックの直後に追加:

```
    // --- companies/{companyId} ---
    // 全ログインユーザーが読める（自分の会社プロファイル参照のため）。
    // 書き込みは管理者のみ。
    match /companies/{companyId} {
      allow read: if isSignedIn();
      allow write: if isAdmin();
    }
```

- [ ] **Step 2: users ドキュメントに companyId を許容**

`users/{uid}` の write ルールを確認し、`companyId` フィールドの書き込みが
所有者本人に許可されていることを確認（既存ルールが `users/{uid}` を本人書込可なら追加変更不要）。
不可なら本人が `companyId` を含めて書けるよう調整する。

- [ ] **Step 3: ルールをデプロイ**

Run: `firebase deploy --only firestore:rules --project taxi-dailydata-dev`
Expected: デプロイ成功。失敗時（firebase CLI 未認証等）はユーザーに
`firebase login` を依頼。

- [ ] **Step 4: コミット**

```bash
git add firestore.rules
git commit -m "feat(company): firestore.rules に companies コレクションを追加"
```

---

### Task 4: companies/keiho ドキュメントを dev Firestore に作成

**Files:**
- Create: `scripts/seed-keiho-company.mjs`

- [ ] **Step 1: seed スクリプトを書く**

```js
// scripts/seed-keiho-company.mjs
// 使い方: SA=<service account json path> node scripts/seed-keiho-company.mjs
// companies/keiho ドキュメントを Firestore に作成する。
import crypto from 'node:crypto';
import fs from 'node:fs';
import { buildKeihoProfile } from '../js/company-profiles.js';

const sa = JSON.parse(fs.readFileSync(process.env.SA, 'utf8'));
const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

function toFirestoreValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') {
    return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  }
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) {
    return { arrayValue: { values: v.map(toFirestoreValue) } };
  }
  const fields = {};
  for (const k of Object.keys(v)) fields[k] = toFirestoreValue(v[k]);
  return { mapValue: { fields } };
}

const now = Math.floor(Date.now() / 1000);
const claim = b({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/datastore',
  aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 });
const unsigned = b({ alg: 'RS256', typ: 'JWT' }) + '.' + claim;
const sig = crypto.sign('RSA-SHA256', Buffer.from(unsigned), sa.private_key).toString('base64url');
const tr = await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: 'grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=' + unsigned + '.' + sig });
const token = (await tr.json()).access_token;

const profile = buildKeihoProfile();
const fields = {};
for (const k of Object.keys(profile)) fields[k] = toFirestoreValue(profile[k]);

const url = `https://firestore.googleapis.com/v1/projects/${sa.project_id}`
  + `/databases/(default)/documents/companies?documentId=keiho`;
const res = await fetch(url, {
  method: 'POST',
  headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
  body: JSON.stringify({ fields }) });
console.log('HTTP', res.status, res.status === 200 ? 'companies/keiho 作成OK' : await res.text());
```

- [ ] **Step 2: 実行**

Run: `SA="/Users/hideakimacbookair/Downloads/taxi-dailydata-dev-firebase-adminsdk-fbsvc-68fe3f675f.json" node scripts/seed-keiho-company.mjs`
Expected: `HTTP 200 companies/keiho 作成OK`
（既存なら 409。その場合は PATCH 版に切替えるか手動削除後に再実行）

- [ ] **Step 3: コミット**

```bash
git add scripts/seed-keiho-company.mjs
git commit -m "chore(company): companies/keiho seed スクリプトを追加"
```

---

### Task 5: getConfig を会社プロファイルとのマージに対応

**Files:**
- Modify: `js/firebase-storage.js`（`getConfig`、108-125行付近）

- [ ] **Step 1: getConfig を改修**

`js/firebase-storage.js` の `getConfig` を以下に置き換える:

```js
export async function getConfig() {
  await waitForAuth();
  const userId = getUserId();
  const ref = doc(db, 'userConfigs', userId);
  const snap = await getDoc(ref);
  let userConfig;
  if (!snap.exists()) {
    // 初回: DEFAULT_CONFIG をコピーして保存
    userConfig = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    userConfig.payrollMode = 'step_rate';
    userConfig.fixedRate = 0.55;
    userConfig.privacy = { shareDataWithOthers: true };
    await setDoc(ref, userConfig);
  } else {
    userConfig = snap.data();
  }
  // 会社プロファイルがあればマージ（会社レベル項目は会社優先）
  const companyProfile = await loadCompanyProfile();
  const { mergeCompanyConfig } = await import('./company-config.js');
  return mergeCompanyConfig(companyProfile, userConfig);
}

// 現ユーザーの companyId から会社プロファイルを読む。無ければ null。
async function loadCompanyProfile() {
  try {
    const uid = (typeof getCurrentUser === 'function' && getCurrentUser())
      ? getCurrentUser().uid : null;
    if (!uid) return null;
    const userDoc = await getDoc(doc(db, 'users', uid));
    const companyId = userDoc.exists() ? userDoc.data().companyId : null;
    if (!companyId) return null;
    const cSnap = await getDoc(doc(db, 'companies', companyId));
    return cSnap.exists() ? cSnap.data() : null;
  } catch (e) {
    console.warn('loadCompanyProfile failed:', e);
    return null; // 失敗時は会社マージ無し＝従来挙動
  }
}
```

`getCurrentUser` を `js/firebase-auth.js` から import 済みか確認し、未importなら
ファイル冒頭の import に追加する。

- [ ] **Step 2: 全テスト回帰確認**

Run: `node --test tests/*.test.js`
Expected: 全239件 PASS（getConfig はテスト対象外だが純関数群に影響が無いこと）

- [ ] **Step 3: 構文チェック**

Run: `node --check js/firebase-storage.js`
Expected: エラーなし

- [ ] **Step 4: コミット**

```bash
git add js/firebase-storage.js
git commit -m "feat(company): getConfig を会社プロファイルとのマージに対応"
```

---

### Task 6: 新規登録で companyId を付与＋既存2ユーザーを移行

**Files:**
- Modify: `js/firebase-auth.js`（`signUp` / `createUserWithCredentials`）
- Create: `scripts/migrate-existing-users-companyid.mjs`

- [ ] **Step 1: signUp に companyId 付与**

`js/firebase-auth.js` の `createUserWithCredentials` で `users/{uid}` 作成時、
`companyId` を含める。値は localStorage `taxi_pending_company`（段階2で設定）が
あればそれ、無ければ `null`（段階2で会社リンク機構が入るまでは null でよい）:

```js
    await setDoc(doc(db, 'users', result.user.uid), {
      userId,
      companyId: localStorage.getItem('taxi_pending_company') || null,
      createdAt: new Date().toISOString(),
      isAnonymous: false
    });
```

- [ ] **Step 2: 既存ユーザー移行スクリプト**

```js
// scripts/migrate-existing-users-companyid.mjs
// 使い方: SA=<path> node scripts/migrate-existing-users-companyid.mjs
// user_self / mm の users ドキュメントに companyId=keiho を付与する。
// （userId ではなく Firebase Auth uid キーのため、users 全件から該当 userId を探す）
import crypto from 'node:crypto';
import fs from 'node:fs';

const sa = JSON.parse(fs.readFileSync(process.env.SA, 'utf8'));
const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const unsigned = b({ alg: 'RS256', typ: 'JWT' }) + '.' + b({ iss: sa.client_email,
  scope: 'https://www.googleapis.com/auth/datastore', aud: 'https://oauth2.googleapis.com/token',
  iat: now, exp: now + 3600 });
const sig = crypto.sign('RSA-SHA256', Buffer.from(unsigned), sa.private_key).toString('base64url');
const tr = await fetch('https://oauth2.googleapis.com/token', { method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: 'grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=' + unsigned + '.' + sig });
const token = (await tr.json()).access_token;
const base = `https://firestore.googleapis.com/v1/projects/${sa.project_id}/databases/(default)/documents`;

// users 全件取得 → userId が user_self / mm の uid に companyId=keiho を PATCH
const list = await (await fetch(base + '/users?pageSize=300',
  { headers: { Authorization: 'Bearer ' + token } })).json();
for (const doc of (list.documents || [])) {
  const uid = doc.name.split('/').pop();
  const userId = doc.fields?.userId?.stringValue;
  if (userId === 'user_self' || userId === 'mm') {
    const r = await fetch(`${base}/users/${uid}?updateMask.fieldPaths=companyId`, {
      method: 'PATCH',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { companyId: { stringValue: 'keiho' } } }) });
    console.log(userId, '(' + uid + ') ->', r.status);
  }
}
```

- [ ] **Step 3: 移行スクリプトを実行**

Run: `SA="/Users/hideakimacbookair/Downloads/taxi-dailydata-dev-firebase-adminsdk-fbsvc-68fe3f675f.json" node scripts/migrate-existing-users-companyid.mjs`
Expected: `user_self (...) -> 200` / `mm (...) -> 200`

- [ ] **Step 4: 構文チェック＋全テスト**

Run: `node --check js/firebase-auth.js && node --test tests/*.test.js`
Expected: 構文OK、全239件 PASS

- [ ] **Step 5: コミット**

```bash
git add js/firebase-auth.js scripts/migrate-existing-users-companyid.mjs
git commit -m "feat(company): 登録時 companyId 付与＋既存ユーザーを恵豊に移行"
```

---

## 完了確認（段階1）

- [ ] 全239テスト PASS。
- [ ] dev で恵豊ユーザー（user_self 等）の手取り・歩率の数値が段階1前と一致
      （会社マージ後も値が変わらないこと＝無変更の保証）。
- [ ] `companies/keiho` ドキュメントが dev Firestore に存在。
- [ ] dev へ push（`feat/stripe-billing` → dev/main、rebase 要）。

段階1完了後、段階2（会社別申込リンク）の計画を作成する。

## 自己レビュー結果

- スペック整合: 設計書「段階1」＝データモデル＋恵豊パッケージ化を全タスクで網羅。
- プレースホルダ: なし（全コード掲載）。
- 型整合: `mergeCompanyConfig`/`COMPANY_LEVEL_KEYS`/`buildKeihoProfile` の名称は
  Task 1・2・5・4 で一貫。

# 招待登録時 admin メール通知（DB非保存）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 招待URL登録時に氏名・電話（必須・同意付き）を入力させ、アカウント作成成功後に billing worker の `/notify-signup` 経由で Resend により admin にメール通知する。**Firestore・ログにPIIを残さない**。

**Architecture:** 純関数（クライアント検証/ペイロード、worker本文生成）を分離テスト。worker は既存 Resend基盤＋IDトークン検証を再利用し新エンドポイント `/notify-signup` を追加。クライアントは `signUp()` 成功後に best-effort でPOST（失敗しても登録は成功）。

**Tech Stack:** Vanilla ESM、Cloudflare Worker（既存 cabis-billing）、Resend、Firebase ID トークン検証、`node --test`（tests/run.js）。

**基準:** dev/main @ `a85e77865`。ブランチ `feat/signup-notify-email`。spec: `docs/superpowers/specs/2026-05-30-signup-notify-email-design.md`。

**前提（調査済み）:**
- worker `worker/src/index.js`: ルートは `if (method==='POST' && path==='/x') return await handler(...)` 形式。`corsHeaders(env)`/`json(env,obj,status)`/`getAccessToken(env)`/`findCompanyIdByUserId(env,token,userId)`(206行) あり。OPTIONS は204処理済み。
- Resend: `worker/src/setup-request/mail.js` の `sendMail({apiKey,from,to,subject,text})`。`env.RESEND_API_KEY`/`MAIL_FROM`/`MAIL_TO` は既設。
- 認証: `worker/src/auth/verify-id-token.js` の `verifyFirebaseIdToken(idToken, projectId)` → `{uid}`。
- worker は独立テスト未設定 → **worker純関数は app側 `tests/` から相対importでテスト**（body.js は Cloudflare依存ゼロの純文字列生成）。
- `login.html`: `signupForm`(85行) に suId/suPw/suPw2/turnstile/signupBtn。ハンドラ(365行)は `const r = await signUp(id, pw); if (r.success) showSignupSuccessScreen(id, pw);`。`signUp` は `{success, user}` を返す（`r.user.getIdToken()` でトークン取得）。
- `billingApiBase()` は `js/subscription-state.js`(184行) のローカル関数 → **exportして再利用**。
- `legal/privacy.html`: 第2条(取得する情報)/第3条(利用目的)/第5条(業務委託先) あり。

---

## File Structure

- Create: `js/signup-notify.js` — `validateSignupFields` / `buildNotifyPayload`（純関数）＋ `postSignupNotify`（best-effort送信）。
- Create: `tests/signup-notify.test.js` — 上記純関数テスト。
- Create: `worker/src/signup-notify/body.js` — `buildSignupNotificationBody`（純関数）。
- Create: `tests/signup-notify-body.test.js` — worker純関数を相対importでテスト。
- Create: `worker/src/signup-notify/handler.js` — `handleNotifySignup`。
- Modify: `worker/src/index.js` — `POST /notify-signup` ルート追加。
- Modify: `js/subscription-state.js` — `billingApiBase` を export。
- Modify: `login.html` — 氏名・電話・同意フィールド＋ハンドラ配線。
- Modify: `legal/privacy.html` — 利用目的・委託先（Resend）追記。
- Modify: `sw.js` — `./js/signup-notify.js` を STATIC_FILES に追加＋ CACHE_NAME bump。

---

## Task 1: クライアント純関数 `js/signup-notify.js`

**Files:**
- Create: `js/signup-notify.js`
- Test: `tests/signup-notify.test.js`

- [ ] **Step 1: Write the failing test**

`tests/signup-notify.test.js`:

```js
import { test, assert } from './run.js';
import { validateSignupFields, buildNotifyPayload } from '../js/signup-notify.js';

test('validateSignupFields: 同意なしは不可', () => {
  const r = validateSignupFields({ name: '山田太郎', phone: '09012345678', consent: false });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => e.includes('同意')));
});

test('validateSignupFields: 氏名/電話 空は不可', () => {
  assert.equal(validateSignupFields({ name: '', phone: '090', consent: true }).ok, false);
  assert.equal(validateSignupFields({ name: '山田', phone: '', consent: true }).ok, false);
});

test('validateSignupFields: 長すぎは不可', () => {
  assert.equal(validateSignupFields({ name: 'あ'.repeat(51), phone: '090', consent: true }).ok, false);
  assert.equal(validateSignupFields({ name: '山田', phone: '0'.repeat(31), consent: true }).ok, false);
});

test('validateSignupFields: 正常はok', () => {
  assert.deepEqual(validateSignupFields({ name: '山田太郎', phone: '090-1234-5678', consent: true }),
    { ok: true, errors: [] });
});

test('buildNotifyPayload: 必要キーのみ（会社名/consentは含めない）', () => {
  const p = buildNotifyPayload({ idToken: 'tok', userId: 'driver_a', name: ' 山田 ', phone: ' 090 ' });
  assert.deepEqual(p, { idToken: 'tok', userId: 'driver_a', name: '山田', phone: '090' });
  assert.equal('companyName' in p, false);
  assert.equal('consent' in p, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/work/taxi-dev && node --test tests/signup-notify.test.js`
Expected: FAIL（モジュール未作成）

- [ ] **Step 3: Write minimal implementation**

`js/signup-notify.js`:

```js
// 招待登録時の admin メール通知（DB非保存）クライアント側ロジック。
// 純関数はテスト可能。postSignupNotify は best-effort（登録をブロックしない・PIIをログしない）。

// 入力検証。consent 未チェック・空・長さ超過を不可にする。
export function validateSignupFields({ name, phone, consent }) {
  const errors = [];
  if (!consent) errors.push('利用目的への同意が必要です');
  const n = (name || '').trim();
  const p = (phone || '').trim();
  if (!n) errors.push('氏名を入力してください');
  else if (n.length > 50) errors.push('氏名が長すぎます');
  if (!p) errors.push('電話番号を入力してください');
  else if (p.length > 30) errors.push('電話番号が長すぎます');
  return { ok: errors.length === 0, errors };
}

// 送信ペイロード。会社名・consent は含めない（consent は送信可否のゲートのみ）。
export function buildNotifyPayload({ idToken, userId, name, phone }) {
  return {
    idToken,
    userId,
    name: String(name || '').trim(),
    phone: String(phone || '').trim(),
  };
}

// worker へ best-effort 送信。失敗しても呼び出し側で登録はブロックしない。PII本文はログしない。
export async function postSignupNotify(base, payload) {
  try {
    const res = await fetch(base + '/notify-signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return res.ok;
  } catch (e) {
    console.warn('signup notify failed (registration still OK)');
    return false;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ~/work/taxi-dev && node --test tests/signup-notify.test.js`
Expected: PASS（5 tests）

- [ ] **Step 5: Commit**

```bash
cd ~/work/taxi-dev
git add js/signup-notify.js tests/signup-notify.test.js
git commit -m "feat(signup-notify): client validate/payload/postNotify + tests"
```

---

## Task 2: worker 純関数 `body.js`（メール本文）

**Files:**
- Create: `worker/src/signup-notify/body.js`
- Test: `tests/signup-notify-body.test.js`

- [ ] **Step 1: Write the failing test**

`tests/signup-notify-body.test.js`:

```js
import { test, assert } from './run.js';
import { buildSignupNotificationBody } from '../worker/src/signup-notify/body.js';

test('buildSignupNotificationBody: 氏名/電話/キーが本文に出る・DB非保存注記入り', () => {
  const t = buildSignupNotificationBody({
    userId: 'driver_a', companyId: 'co-swyg3o',
    name: '山田太郎', phone: '090-1234-5678', submittedAt: '2026-05-30T12:00:00Z',
  });
  assert.ok(t.includes('driver_a'));
  assert.ok(t.includes('co-swyg3o'));
  assert.ok(t.includes('山田太郎'));
  assert.ok(t.includes('090-1234-5678'));
  assert.ok(t.includes('Firestoreには保存していません'));
  assert.ok(t.includes('削除してください'));
});

test('buildSignupNotificationBody: companyId 無しは代替表記', () => {
  const t = buildSignupNotificationBody({
    userId: 'driver_b', companyId: null, name: '佐藤', phone: '080', submittedAt: 'x',
  });
  assert.ok(t.includes('取得できず') || t.includes('(なし)'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/work/taxi-dev && node --test tests/signup-notify-body.test.js`
Expected: FAIL（モジュール未作成）

- [ ] **Step 3: Write minimal implementation**

`worker/src/signup-notify/body.js`:

```js
// 招待登録通知メールの本文を生成する純関数（Cloudflare/Firestore 非依存・テスト可能）。
export function buildSignupNotificationBody({ userId, companyId, name, phone, submittedAt }) {
  const lines = [];
  lines.push('中野様');
  lines.push('');
  lines.push('招待URLから新規ドライバー登録がありました。');
  lines.push('');
  lines.push('──────────────────────────────────');
  lines.push('■ 登録キー（サーバー側・匿名）');
  lines.push(`   userId:    ${userId}`);
  lines.push(`   companyId: ${companyId || '(取得できず)'}`);
  lines.push(`   受付時刻:  ${submittedAt}`);
  lines.push('');
  lines.push('■ 本人記入（Firestoreには保存していません）');
  lines.push(`   氏名: ${name}`);
  lines.push(`   電話: ${phone}`);
  lines.push('');
  lines.push('──────────────────────────────────');
  lines.push('お手元の照合表（パスワード付きファイル/Notes）に転記後、本メールは削除してください。');
  lines.push('slug以外の会社特定情報・氏名・電話はサーバーに保存されません。');
  return lines.join('\n');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ~/work/taxi-dev && node --test tests/signup-notify-body.test.js`
Expected: PASS（2 tests）

- [ ] **Step 5: Commit**

```bash
cd ~/work/taxi-dev
git add worker/src/signup-notify/body.js tests/signup-notify-body.test.js
git commit -m "feat(signup-notify): worker mail body builder + test"
```

---

## Task 3: worker ハンドラ＋ルート

**Files:**
- Create: `worker/src/signup-notify/handler.js`
- Modify: `worker/src/index.js`

- [ ] **Step 1: ハンドラを作成**

`worker/src/signup-notify/handler.js`:

```js
// POST /notify-signup — 招待登録の通知メールを admin に送る。
// Firestore には書かない。PII（氏名・電話）をログに出さない。
import { verifyFirebaseIdToken } from '../auth/verify-id-token.js';
import { sendMail } from '../setup-request/mail.js';
import { buildSignupNotificationBody } from './body.js';

export async function handleNotifySignup(request, env, helpers) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    return helpers.json({ error: 'bad_json' }, 400);
  }
  const { idToken, userId, name, phone } = payload || {};

  // 認証（登録直後の本人。スパム防止）
  let uid = null;
  try {
    ({ uid } = await verifyFirebaseIdToken(idToken, env.FIREBASE_PROJECT_ID));
  } catch {
    return helpers.json({ error: 'auth' }, 401);
  }
  if (!uid) return helpers.json({ error: 'auth' }, 401);

  // 検証（PIIはログしない）
  const n = String(name || '').trim();
  const p = String(phone || '').trim();
  if (!/^[a-z][a-z0-9_]*$/.test(String(userId || ''))) return helpers.json({ error: 'bad_userid' }, 400);
  if (!n || n.length > 50 || !p || p.length > 30) return helpers.json({ error: 'bad_fields' }, 400);

  // companyId 併記（best-effort）
  let companyId = null;
  try {
    companyId = await helpers.findCompanyIdByUserId(userId);
  } catch {
    companyId = null;
  }

  const text = buildSignupNotificationBody({
    userId, companyId, name: n, phone: p, submittedAt: new Date().toISOString(),
  });
  const r = await sendMail({
    apiKey: env.RESEND_API_KEY, from: env.MAIL_FROM, to: env.MAIL_TO,
    subject: '【Cabis】新規ドライバー登録通知', text,
  });
  if (!r.ok) return helpers.json({ ok: false, error: 'mail_failed' }, 502);
  return helpers.json({ ok: true });
}
```

- [ ] **Step 2: index.js にルート追加**

`worker/src/index.js` の import 群（`handleIssueUrl, ... } from './setup-request/handler.js';` の付近）に追加:

```js
import { handleNotifySignup } from './signup-notify/handler.js';
```

ルート（`/setup-request/archive` の `if` ブロックの直後、`return json(env, { error: 'not_found' }, 404);` の前）に追加:

```js
      if (request.method === 'POST' && path === '/notify-signup') {
        return await handleNotifySignup(request, env, {
          json: (obj, status = 200) => json(env, obj, status),
          findCompanyIdByUserId: async (userId) => {
            try {
              const token = await getAccessToken(env);
              return await findCompanyIdByUserId(env, token, userId);
            } catch {
              return null;
            }
          },
        });
      }
```

（`getAccessToken` と `findCompanyIdByUserId` は index.js 内に既存。スコープで参照可能。）

- [ ] **Step 3: 構文確認＋既存テスト（回帰なし）**

Run: `cd ~/work/taxi-dev && node --check worker/src/signup-notify/handler.js && node --check worker/src/index.js && echo OK`
Expected: 構文OK（`node --check` は import 解決をしないため import 名の打ち間違いは検出されない点に留意。デプロイ前の wrangler dev で実起動確認する）。
Run: `node --test tests/*.test.js 2>&1 | grep -E "^# (tests|pass|fail)"`
Expected: 全テスト pass（fail 0）。

- [ ] **Step 4: Commit**

```bash
cd ~/work/taxi-dev
git add worker/src/signup-notify/handler.js worker/src/index.js
git commit -m "feat(signup-notify): worker /notify-signup endpoint"
```

---

## Task 4: billingApiBase export ＋ login.html フォーム/配線

**Files:**
- Modify: `js/subscription-state.js`（`billingApiBase` を export）
- Modify: `login.html`

- [ ] **Step 1: billingApiBase を export**

`js/subscription-state.js` の `function billingApiBase() {` を `export function billingApiBase() {` に変更（中身は変えない）。

- [ ] **Step 2: login.html のフォームに 氏名・電話・同意 を追加**

`login.html` の `signupForm` 内、`<div class="turnstile-row">` の**直前**に追加:

```html
      <div class="field">
        <label for="suName">氏名</label>
        <input type="text" id="suName" autocomplete="name" maxlength="50" placeholder="例: 山田太郎">
        <div class="hint">本人確認・連絡のため運営に通知します（後述）。</div>
      </div>
      <div class="field">
        <label for="suPhone">電話番号</label>
        <input type="tel" id="suPhone" autocomplete="tel" maxlength="30" placeholder="例: 090-1234-5678">
      </div>
      <div class="field" style="background:#f7f9fc;border:1px solid #d8d2bf;border-radius:8px;padding:10px 12px;">
        <label style="display:flex;gap:8px;align-items:flex-start;cursor:pointer;font-size:13px;">
          <input type="checkbox" id="suConsent" style="margin-top:3px;">
          <span>氏名・電話を、本人確認・連絡・会社照合のために運営へ<strong>メール通知</strong>することに同意します。これらは<strong>サービスのデータベースには保存しません</strong>（メール送信に Resend〈米国〉を利用）。詳細は<a href="./legal/privacy.html" target="_blank" rel="noopener">プライバシーポリシー</a>。</span>
        </label>
      </div>
```

- [ ] **Step 3: import に signup-notify と billingApiBase を追加**

`login.html` の `import { ... } from './js/firebase-auth.js';` 付近（159行〜）に追加:

```js
import { validateSignupFields, buildNotifyPayload, postSignupNotify } from './js/signup-notify.js';
import { billingApiBase } from './js/subscription-state.js';
```

- [ ] **Step 4: 登録ハンドラに検証＋通知を配線**

`login.html` の `signupBtn` ハンドラ内を編集。
(a) パスワード一致チェックの直後に、氏名/電話/同意の検証を追加:

```js
  const name = document.getElementById('suName').value;
  const phone = document.getElementById('suPhone').value;
  const consent = document.getElementById('suConsent').checked;
  const v = validateSignupFields({ name, phone, consent });
  if (!v.ok) {
    showMsg('signupMsg', v.errors.join(' / '), 'error');
    return;
  }
```

(b) `const r = await signUp(id, pw);` の `if (r.success) {` ブロック内、`showSignupSuccessScreen(id, pw);` の**直前**に通知を追加（best-effort・登録はブロックしない）:

```js
    try {
      const idToken = await r.user.getIdToken();
      await postSignupNotify(billingApiBase(), buildNotifyPayload({ idToken, userId: id, name, phone }));
    } catch (e) {
      console.warn('signup notify skipped (registration still OK)');
    }
```

- [ ] **Step 5: 構文/回帰確認**

Run: `cd ~/work/taxi-dev && node --check js/signup-notify.js && node --test tests/*.test.js 2>&1 | grep -E "^# (tests|pass|fail)"`
Expected: 全テスト pass（login.html はDOM・テスト対象外。回帰なし）。
手動スモークは Task 6 後。

- [ ] **Step 6: Commit**

```bash
cd ~/work/taxi-dev
git add js/subscription-state.js login.html
git commit -m "feat(signup-notify): collect name/phone/consent at signup, post to worker (best-effort)"
```

---

## Task 5: privacy.html 追記 ＋ SW

**Files:**
- Modify: `legal/privacy.html`
- Modify: `sw.js`

- [ ] **Step 1: privacy.html に利用目的・委託先を追記**

`legal/privacy.html` の「第3条(利用目的)」のリスト内（`<h2>第3条(利用目的)</h2>` の直後の `<ul>`）に項目追加:

```html
    <li>会社（組合）招待URLからの新規登録時に、本人確認・連絡・会社照合のため<strong>氏名・電話番号</strong>を取得し、運営へメールで通知します。これらはサービスのデータベースには保存せず、メール送信には Resend（米国）を利用します。お手元での照合後は速やかに削除します。削除のご希望は <a href="mailto:cabis@taxicabis.com">cabis@taxicabis.com</a> へ。</li>
```

（「第5条(業務委託先・外部サービス)」の表に Resend 行が無ければ、`<tr><td>Resend（米国）</td><td>登録通知メールの送信</td><td>氏名・電話・メール本文</td></tr>` を追加。既にあれば変更不要。）

- [ ] **Step 2: sw.js に precache 追加＋ CACHE_NAME bump**

`sw.js` の STATIC_FILES、`'./js/subscription-state.js',` の付近に追加:

```js
  './js/signup-notify.js',
```

CACHE_NAME を bump。**現行 dev/main の版数を確認して +1**:

Run: `cd ~/work/taxi-dev && git fetch origin main >/dev/null 2>&1; git show origin/main:sw.js | grep -m1 CACHE_NAME`
→ 表示版より大きい番号に `sw.js:2` を更新（並行bup回避のため決め打ちしない）。

- [ ] **Step 3: 構文＋全テスト**

Run: `cd ~/work/taxi-dev && node --check sw.js && node --test tests/*.test.js 2>&1 | grep -E "^# (tests|pass|fail)"`
Expected: 構文OK・全テスト pass（fail 0）。`sw-precache-imports.test` も pass（login.html の signup-notify import は `./js/signup-notify.js` だが、本Task で STATIC_FILES に追加済みのため整合）。

- [ ] **Step 4: Commit**

```bash
cd ~/work/taxi-dev
git add legal/privacy.html sw.js
git commit -m "chore(signup-notify): privacy notice + precache signup-notify.js, bump cache"
```

---

## Task 6: デプロイ（worker ＋ app、ユーザー操作）

- [ ] **Step 1: worker を dev デプロイ（ユーザー操作）**

```
!cd ~/work/taxi-dev/worker && npx wrangler deploy
```
（`cabis-billing-dev` に反映。`RESEND_API_KEY`/`MAIL_FROM`/`MAIL_TO` は既設。新規secret不要。）

- [ ] **Step 2: app を dev 反映（ユーザー操作）**

```
!~/work/taxi-dev/dpush.sh
```

- [ ] **Step 3: dev スモーク**

dev 招待URLで新規登録（氏名・電話・同意）→ 完了 → admin（MAIL_TO=haqei64384@gmail.com）にメール着信を確認。あわせて：
- Firestore に氏名・電話が**保存されていない**こと（users/userConfigs/drives を確認）。
- `npx wrangler tail cabis-billing-dev` で /notify-signup 実行時に**PII（氏名・電話）がログに出ていない**こと。

- [ ] **Step 4: 本番デプロイ（dev確認後・ユーザー操作）**

```
!cd ~/work/taxi-dev/worker && npx wrangler deploy --env production
```
そのうえで app を本番タグ（最新+1）で出荷。worker と app の両方が本番に出て初めて機能する点に注意（順序: worker→app どちらが先でも、両方揃うまではメール通知のみ無効/登録は正常）。

---

## Self-Review

**Spec coverage:**
- 氏名・電話（必須）＋同意 → Task 1（validate）/Task 4（フォーム＋consent）✔
- 会社名を集めない → 全タスクで companyName 不在 ✔
- /notify-signup（IDトークン検証・PII非ログ・DB非保存） → Task 3 ✔
- Resend再利用・新secret不要 → Task 3（既存 sendMail/env）✔
- 利用目的明示＋同意＋privacy追記 → Task 4 Step2 / Task 5 Step1 ✔
- Workerログ禁止 → Task 3（検証時/エラー時にPIIを出さない実装）✔
- 保持/削除運用の注記（メール本文・privacy） → Task 2 本文＋Task 5 ✔
- best-effort（登録ブロックしない） → Task 1 postSignupNotify / Task 4 try-catch ✔
- テスト → Task 1/2 ✔　SW → Task 5 ✔　2系統デプロイ → Task 6 ✔

**Placeholder scan:** CACHE_NAME 版数のみ Task 5 で実行時確認（並行bup回避の意図）。コードのプレースホルダなし。

**Type consistency:** `validateSignupFields({name,phone,consent})→{ok,errors}`、`buildNotifyPayload({idToken,userId,name,phone})→{idToken,userId,name,phone}`、`postSignupNotify(base,payload)`、`buildSignupNotificationBody({userId,companyId,name,phone,submittedAt})`、worker `handleNotifySignup(request,env,{json,findCompanyIdByUserId})`、`billingApiBase()` のシグネチャは全タスク一致。`r.user.getIdToken()` は signUp の `{success,user}` 返却と一致。

**確度の低い点（実装中に検証）:** `verifyFirebaseIdToken` の throw 時の戻り（try/catchで401化済み）。`findCompanyIdByUserId` の admin token 取得失敗時（try/catch→null済み）。`sw-precache-imports.test` が login.html の `./js/subscription-state.js` import（`?v` 無し）を既に許容しているか（既存importなので現状passのはず。新規 `./js/signup-notify.js` は STATIC_FILES 追加で整合）。

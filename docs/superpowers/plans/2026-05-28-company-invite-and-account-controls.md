# 会社招待URL+アカウント制御 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ①一般ユーザーが settings から招待URL発行（コピー＆ネイティブ共有）／②signup 入力欄で大文字・ひらがな・本名IDを入力欄レベルで防止／③個人特定回避（placeholder変更＋ランダムID自動生成）／④signup直後にID/PW控え画面（iOSパスワード保存促進＋コピー一発）／⑤退職者対応を3層（90日自動失効＋自己退会＋admin手動）で実装する。

**Architecture:** 純関数を `js/invite-url.js` / `js/access-control.js` に追加してテスト可能性を確保。UIロジックは既存ファイルに最小限追記、SW で配信。退職者対応は新フィールド `users/{uid}.lastActivityAt` を Firestore に追加し、`onAuthStateChanged` フックで全画面共通の活動記録ロジックを発火。

**Tech Stack:** vanilla JS module + Firebase Auth/Firestore + localStorage + `navigator.share` API + `navigator.clipboard` API。Node.js `node --test`。

**設計書**: `~/work/taxi-dev-wt-pool-status/docs/superpowers/specs/2026-05-28-company-invite-and-account-controls-design.md`

**作業環境:**
- `~/work/taxi-dev-wt-pool-status` branch `feat/pool-status`
- テスト: `cd ~/work/taxi-dev-wt-pool-status && npm test`
- pushしない、dev反映は `PUSH-genkyo.sh`、本番は `v1.42.0` タグ

---

## File Structure

| ファイル | 変更内容 |
|---|---|
| `js/invite-url.js` | `buildCompanyInviteUrl(slug, baseUrl, refUserId)` 追加 |
| `js/access-control.js` | `isAccountActive(user, now)` 追加、`INACTIVE_DAYS` 定数 |
| `js/firebase-auth.js` | `recordActivityThrottled(uid)` 追加、`onAuthStateChanged` 拡張、ログイン後の失効チェック |
| `js/firebase-storage.js` | `selfWithdraw(uid)` 追加（active=false 更新） |
| `settings.html` | 招待URLセクション、自己退会ボタン |
| `login.html` | signup 入力検証＋自動生成ボタン＋成功後のアカウント控え画面 |
| `admin.html` | ユーザー一覧に有効/無効トグル |
| `tests/invite-url.test.js` | `buildCompanyInviteUrl` の3テスト |
| `tests/access-control.test.js` | `isAccountActive` の4テスト（既存・新規） |
| `sw.js` | CACHE_NAME bump |

---

# Phase A — 招待URL発行（settings）

### Task A1: buildCompanyInviteUrl 純関数追加

**Files:**
- Modify: `~/work/taxi-dev-wt-pool-status/js/invite-url.js`
- Test: `~/work/taxi-dev-wt-pool-status/tests/invite-url.test.js`

- [ ] **Step 1: 失敗するテストを書く**

`tests/invite-url.test.js` 末尾に追記:

```js
import { buildCompanyInviteUrl } from '../js/invite-url.js';

test('buildCompanyInviteUrl: ref ありで &ref=<id> 付与', () => {
  assert.equal(
    buildCompanyInviteUrl('co-7q7ros', 'https://app.taxicabis.com', 'driver_a1b2'),
    'https://app.taxicabis.com/?company=co-7q7ros&ref=driver_a1b2'
  );
});

test('buildCompanyInviteUrl: ref なし(null/undefined/空文字)で &ref なし', () => {
  const expected = 'https://app.taxicabis.com/?company=co-7q7ros';
  assert.equal(buildCompanyInviteUrl('co-7q7ros', 'https://app.taxicabis.com'), expected);
  assert.equal(buildCompanyInviteUrl('co-7q7ros', 'https://app.taxicabis.com', null), expected);
  assert.equal(buildCompanyInviteUrl('co-7q7ros', 'https://app.taxicabis.com', ''), expected);
});

test('buildCompanyInviteUrl: 特殊文字を encodeURIComponent', () => {
  assert.equal(
    buildCompanyInviteUrl('co-7q7ros', 'https://app.taxicabis.com', 'a&b'),
    'https://app.taxicabis.com/?company=co-7q7ros&ref=a%26b'
  );
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd ~/work/taxi-dev-wt-pool-status && node --test tests/invite-url.test.js`
Expected: FAIL — `buildCompanyInviteUrl is not a function`

- [ ] **Step 3: 最小実装**

`js/invite-url.js` の末尾に追記:

```js
/** 会社slug + 紹介者userId(任意) で招待URLを組み立てる純関数。
 *  refUserId が truthy なら &ref=<id> 付与、falsy(null/undefined/空文字) なら付与しない。 */
export function buildCompanyInviteUrl(slug, baseUrl, refUserId = null) {
  const base = `${baseUrl}/?company=${encodeURIComponent(slug)}`;
  return refUserId ? `${base}&ref=${encodeURIComponent(refUserId)}` : base;
}
```

- [ ] **Step 4: テスト緑確認**

Run: `cd ~/work/taxi-dev-wt-pool-status && npm test`
Expected: PASS（既存全件＋新3件）

- [ ] **Step 5: コミット**

```bash
cd ~/work/taxi-dev-wt-pool-status
git add js/invite-url.js tests/invite-url.test.js
git commit -m "feat(invite): buildCompanyInviteUrl 純関数追加（会社slug+ref付き）"
```

---

### Task A2: settings.html に招待URLセクション追加

**Files:**
- Modify: `~/work/taxi-dev-wt-pool-status/settings.html`

> このタスクはDOM操作なのでユニットテスト対象外。

- [ ] **Step 1: 招待URLセクションHTMLを挿入**

`settings.html` の `</body>` の前、最終セクションの直後に追加:

```html
<section id="companyInviteSection" hidden style="margin:24px 0; padding:16px; background:#f7f9fc; border-radius:10px;">
  <h3 style="margin:0 0 8px;">🔗 同じ会社の人を招待</h3>
  <p class="hint" style="margin:0 0 12px;">このURLを送ると、同じ会社の同僚が登録できます。</p>
  <input id="companyInviteUrl" class="input" readonly style="width:100%; font-family:monospace; font-size:12px; margin-bottom:8px;">
  <div style="display:flex; gap:8px; flex-wrap:wrap;">
    <button id="copyInviteUrlBtn" class="btn" style="flex:1; min-width:120px;">📋 コピー</button>
    <button id="shareInviteUrlBtn" class="btn" hidden style="flex:1; min-width:120px;">📲 LINEやメールで送る</button>
  </div>
  <p class="hint" style="margin:12px 0 0; color:var(--sub); font-size:11px;">※ あなたの会社の人だけが登録できます</p>
</section>
```

- [ ] **Step 2: 初期化JSを追加**

`settings.html` 内の `<script type="module">` ブロックに追記:

```js
import { buildCompanyInviteUrl } from './js/invite-url.js';
import { loadCompanyProfile } from './js/firebase-storage.js';
import { getCurrentUserId } from './js/userid.js';

async function initCompanyInviteSection() {
  const section = document.getElementById('companyInviteSection');
  const urlEl = document.getElementById('companyInviteUrl');
  const copyBtn = document.getElementById('copyInviteUrlBtn');
  const shareBtn = document.getElementById('shareInviteUrlBtn');
  if (!section || !urlEl) return;

  const userId = getCurrentUserId();
  const companyProfile = await loadCompanyProfile().catch(() => null);
  const slug = companyProfile?.slug;
  if (!slug || !userId) return; // 会社所属でないユーザーは非表示

  const baseUrl = `${location.protocol}//${location.host}`;
  const url = buildCompanyInviteUrl(slug, baseUrl, userId);
  urlEl.value = url;
  section.hidden = false;

  copyBtn.addEventListener('click', async () => {
    await navigator.clipboard.writeText(url);
    const orig = copyBtn.textContent;
    copyBtn.textContent = 'コピーしました ✓';
    setTimeout(() => { copyBtn.textContent = orig; }, 1500);
  });

  if (navigator.share) {
    shareBtn.hidden = false;
    shareBtn.addEventListener('click', async () => {
      try {
        await navigator.share({
          title: 'Cabis（タクシー日報）',
          text: '同じ会社の同僚向け、登録URLです',
          url
        });
      } catch (e) { /* ユーザーキャンセル等は無視 */ }
    });
  }
}
initCompanyInviteSection();
```

- [ ] **Step 3: HTMLタグ対応確認**

Run:
```bash
cd ~/work/taxi-dev-wt-pool-status && node -e "const h=require('fs').readFileSync('settings.html','utf8'); const o=(h.match(/<div/g)||[]).length+(h.match(/<section/g)||[]).length; const c=(h.match(/<\/div>/g)||[]).length+(h.match(/<\/section>/g)||[]).length; console.log('open',o,'close',c);"
```
Expected: open と close の差が変更前と同じ（section +1 / +1）

- [ ] **Step 4: コミット**

```bash
cd ~/work/taxi-dev-wt-pool-status
git add settings.html
git commit -m "feat(invite): settings.html に招待URLセクション追加（コピー＋共有ボタン）"
```

---

# Phase B — 入力リアルタイム検証

### Task B1: login.html signup 入力欄に pattern + リアルタイム検証

**Files:**
- Modify: `~/work/taxi-dev-wt-pool-status/login.html`

> DOM操作のためユニットテスト対象外。pattern 属性は HTML5 native。

- [ ] **Step 1: input 属性追加と error 表示要素**

`login.html` 内の `<input id="suId" ...>` 行を次に置き換え（既存 line 93 付近）:

```html
        <input type="text" id="suId" autocapitalize="none" autocomplete="username"
               pattern="[a-z][a-z0-9_]{2,29}" maxlength="30"
               placeholder="例: driver_a1b2">
        <div id="suIdError" class="suid-error" style="color:#d33; font-size:11px; margin-top:4px; min-height:1em;"></div>
```

CSS（既存 `<style>` 内に追加）:

```css
input.error { border-color: #d33; }
```

- [ ] **Step 2: oninput リアルタイム検証を追加**

`login.html` 内の signup form 周辺の `<script type="module">` 内に追記:

```js
const suIdEl = document.getElementById('suId');
const suIdErrorEl = document.getElementById('suIdError');
const signupBtn = document.getElementById('signupBtn'); // 既存の登録ボタンID
const SUID_RE = /^[a-z][a-z0-9_]{2,29}$/;

function validateSuId() {
  const v = suIdEl.value;
  if (!v) {
    suIdErrorEl.textContent = '';
    suIdEl.classList.remove('error');
    if (signupBtn) signupBtn.disabled = true;
    return false;
  }
  if (!SUID_RE.test(v)) {
    suIdErrorEl.textContent = '半角英小文字・数字・_ のみ使えます（3〜30文字、英小文字で始める）';
    suIdEl.classList.add('error');
    if (signupBtn) signupBtn.disabled = true;
    return false;
  }
  suIdErrorEl.textContent = '';
  suIdEl.classList.remove('error');
  if (signupBtn) signupBtn.disabled = false;
  return true;
}
suIdEl.addEventListener('input', validateSuId);
validateSuId();
```

- [ ] **Step 3: 手動smoke**

ローカル/dev で `login.html?mode=signup` を開き:
- `Taro` 入力 → 赤枠＋エラーメッセージ＋登録ボタン無効
- `たろう` 入力 → 同上
- `driver_a1b2` 入力 → 緑枠＋登録ボタン有効

- [ ] **Step 4: コミット**

```bash
cd ~/work/taxi-dev-wt-pool-status
git add login.html
git commit -m "feat(signup): 入力リアルタイム検証（pattern+oninput で大文字/ひらがな/記号拒否）"
```

---

# Phase C — 個人特定回避

### Task C1: placeholder/hint変更＋ランダムID自動生成ボタン

**Files:**
- Modify: `~/work/taxi-dev-wt-pool-status/login.html`

- [ ] **Step 1: hint 文言を変更**

`login.html` 内の signup form の hint 行を次に置き換え（既存 line 94 付近）:

```html
        <div class="hint">半角英小文字で始め、英小文字・数字・_ が使えます（3〜30文字）。本名は避け、任意のIDを決めてください。</div>
```

- [ ] **Step 2: 自動生成ボタンを suId input の隣に追加**

`<input id="suId" ...>` を次のラッパーで包む:

```html
        <div style="display:flex; gap:8px;">
          <input type="text" id="suId" autocapitalize="none" autocomplete="username"
                 pattern="[a-z][a-z0-9_]{2,29}" maxlength="30"
                 placeholder="例: driver_a1b2" style="flex:1;">
          <button type="button" id="genSuIdBtn" class="btn" style="white-space:nowrap;">🎲 自動生成</button>
        </div>
```

> Task B1 で `<input>` 単独だった部分を `<div>` ラッパー化。`#suIdError` は div の外側に置く。

- [ ] **Step 3: 自動生成ロジックを追加**

`login.html` 内の signup form の script に追記:

```js
import { generateSlug } from './js/slug-gen.js';
const genBtn = document.getElementById('genSuIdBtn');
genBtn?.addEventListener('click', () => {
  // 'driver_' + 6文字 = 'driver_a1b2c3'。約10億通り、衝突確率ほぼゼロ。
  suIdEl.value = generateSlug('driver_', 6);
  validateSuId();
});
```

- [ ] **Step 4: 手動smoke**

`login.html?mode=signup` で「🎲 自動生成」クリック → `driver_xxxxxx` 形式が入る → 緑枠

- [ ] **Step 5: コミット**

```bash
cd ~/work/taxi-dev-wt-pool-status
git add login.html
git commit -m "feat(signup): 個人特定回避（placeholder/hint変更+ランダムID自動生成ボタン）"
```

---

# Phase E — アカウント控え表示（signup直後）

### Task E1: signup成功後のアカウント控え画面

**Files:**
- Modify: `~/work/taxi-dev-wt-pool-status/login.html`

- [ ] **Step 1: 控え画面HTMLを追加**

`login.html` の signup form の直後（同じ container 内）に追加:

```html
<div id="signupSuccessScreen" hidden style="background:#fff; border:1px solid #ddd; border-radius:10px; padding:20px; margin-top:20px;">
  <h2 style="margin:0 0 12px;">🎉 アカウントを作成しました</h2>
  <div style="background:#fdebe8; border-left:4px solid #c83a2c; padding:12px; margin-bottom:16px; border-radius:0 6px 6px 0;">
    <p style="margin:0; color:#c83a2c; font-weight:600;">⚠ パスワードはこの画面でしか確認できません。</p>
    <p style="margin:4px 0 0; color:#c83a2c; font-size:14px;">必ずメモかパスワード管理アプリに保存してください。</p>
  </div>
  <div style="margin-bottom:12px;">
    <label class="hint">ログインID</label>
    <div style="display:flex; gap:6px; align-items:center; margin-top:4px;">
      <code id="successUserId" style="flex:1; padding:8px 10px; background:#f3eedf; border-radius:6px; font-family:monospace;"></code>
      <button id="copyUserIdBtn" class="btn">📋 コピー</button>
    </div>
  </div>
  <div style="margin-bottom:16px;">
    <label class="hint">パスワード</label>
    <div style="display:flex; gap:6px; align-items:center; margin-top:4px;">
      <code id="successPassword" style="flex:1; padding:8px 10px; background:#f3eedf; border-radius:6px; font-family:monospace;"></code>
      <button id="copyPasswordBtn" class="btn">📋 コピー</button>
    </div>
  </div>
  <button id="copyBothBtn" class="btn" style="width:100%; margin-bottom:12px;">📋 ID/パスワードをまとめてコピー</button>
  <button id="proceedBtn" class="btn btn-primary" style="width:100%;">✓ 控えました、次へ</button>
</div>
```

- [ ] **Step 2: 控え画面を表示するロジック**

signup 成功フックを次に置き換える（既存の `await firebase signup` 成功直後）:

```js
// 既存: signup 成功直後（疑似コード、実際の関数名は要確認）
try {
  const result = await firebaseSignUp(suId, suPassword);
  // ↓ 追加: 控え画面表示
  showSignupSuccessScreen(suId, suPassword);
} catch (err) {
  // 既存エラーハンドリング
}

function showSignupSuccessScreen(uid, password) {
  // 既存の signup form を hide
  document.getElementById('signupForm')?.setAttribute('hidden', '');
  // 控え画面 show
  const screen = document.getElementById('signupSuccessScreen');
  document.getElementById('successUserId').textContent = uid;
  document.getElementById('successPassword').textContent = password;
  screen.hidden = false;
  // sessionStorage に一時保持（誤って戻った場合の保護）
  sessionStorage.setItem('signup_pw_temp', password);
}
```

- [ ] **Step 3: 3つのコピーボタンと「次へ」**

`login.html` script に追加:

```js
function setupSuccessScreenActions(uid, password) {
  const feedback = (btn, msg) => {
    const orig = btn.textContent;
    btn.textContent = msg;
    setTimeout(() => { btn.textContent = orig; }, 1500);
  };
  document.getElementById('copyUserIdBtn')?.addEventListener('click', async (e) => {
    await navigator.clipboard.writeText(uid);
    feedback(e.target, 'コピーしました ✓');
  });
  document.getElementById('copyPasswordBtn')?.addEventListener('click', async (e) => {
    await navigator.clipboard.writeText(password);
    feedback(e.target, 'コピーしました ✓');
  });
  document.getElementById('copyBothBtn')?.addEventListener('click', async (e) => {
    await navigator.clipboard.writeText(
      `Cabis（タクシー日報）アカウント\nログインID: ${uid}\nパスワード: ${password}`
    );
    feedback(e.target, 'コピーしました ✓');
  });
  document.getElementById('proceedBtn')?.addEventListener('click', () => {
    sessionStorage.removeItem('signup_pw_temp');
    location.href = './';
  });
}
// showSignupSuccessScreen の末尾で呼ぶ
setupSuccessScreenActions(uid, password);
```

- [ ] **Step 4: パスワード input に new-password を確認**

`login.html` の signup form の password input が `autocomplete="new-password"` であることを確認、なければ追加:

```html
<input type="password" id="suPassword" autocomplete="new-password" ...>
```

これで iOS Safari が iCloud Keychain に「パスワードを保存しますか？」を自動表示。

- [ ] **Step 5: 手動smoke**

`login.html?mode=signup&company=co-7q7ros` で新規登録 → 控え画面が出る → 各コピーボタン動作確認 → 「✓ 控えました、次へ」で `./` に遷移

- [ ] **Step 6: コミット**

```bash
cd ~/work/taxi-dev-wt-pool-status
git add login.html
git commit -m "feat(signup): 成功後のアカウント控え画面（ID/PW表示+3コピーボタン+iOS保存促進）"
```

---

# Phase D — 退職者対応（3層）

### Task D1: isAccountActive 拡張（90日無活動判定）

**Files:**
- Modify: `~/work/taxi-dev-wt-pool-status/js/access-control.js`
- Test: `~/work/taxi-dev-wt-pool-status/tests/access-control.test.js`

- [ ] **Step 1: 失敗するテストを書く**

`tests/access-control.test.js` 末尾に追記:

```js
import { isAccountActive } from '../js/access-control.js';

test('isAccountActive: active=false で false', () => {
  assert.equal(isAccountActive({ active: false }), false);
});

test('isAccountActive: active=true で true (lastActivityAt 未指定 OK)', () => {
  assert.equal(isAccountActive({ active: true }), true);
});

test('isAccountActive: 空オブジェクト/null で true (後方互換、新規ユーザー)', () => {
  assert.equal(isAccountActive({}), true);
  assert.equal(isAccountActive(null), true);
});

test('isAccountActive: lastActivityAt が90日以内なら true', () => {
  const now = Date.parse('2026-05-28T12:00:00+09:00');
  const last89 = now - 89 * 86400 * 1000;
  assert.equal(isAccountActive({ active: true, lastActivityAt: last89 }, now), true);
});

test('isAccountActive: lastActivityAt が90日超過なら false', () => {
  const now = Date.parse('2026-05-28T12:00:00+09:00');
  const last91 = now - 91 * 86400 * 1000;
  assert.equal(isAccountActive({ active: true, lastActivityAt: last91 }, now), false);
});

test('isAccountActive: lastActivityAt が Firestore Timestamp 風オブジェクトでも判定可', () => {
  const now = Date.parse('2026-05-28T12:00:00+09:00');
  const last91Ms = now - 91 * 86400 * 1000;
  const ts = { toMillis: () => last91Ms };
  assert.equal(isAccountActive({ active: true, lastActivityAt: ts }, now), false);
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd ~/work/taxi-dev-wt-pool-status && node --test tests/access-control.test.js`
Expected: FAIL — `isAccountActive is not a function`

- [ ] **Step 3: 最小実装**

`js/access-control.js` の末尾に追記:

```js
const INACTIVE_DAYS = 90;
const DAY_MS = 86400 * 1000;

/** ユーザーアカウントが有効か判定。
 *  user: users/{uid} doc の値、または null。
 *  - active === false の時のみ無効。
 *  - lastActivityAt が INACTIVE_DAYS 日以上前なら無効。
 *  - その他（true/undefined/null user）は有効扱い（後方互換）。
 *  - now: 判定基準時刻（テスト用に依存注入可、デフォルト Date.now()）。 */
export function isAccountActive(user, now = Date.now()) {
  if (user && user.active === false) return false;
  if (user && user.lastActivityAt) {
    const last = user.lastActivityAt.toMillis ? user.lastActivityAt.toMillis() : user.lastActivityAt;
    if (now - last > INACTIVE_DAYS * DAY_MS) return false;
  }
  return true;
}
```

- [ ] **Step 4: テスト緑確認**

Run: `cd ~/work/taxi-dev-wt-pool-status && npm test`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
cd ~/work/taxi-dev-wt-pool-status
git add js/access-control.js tests/access-control.test.js
git commit -m "feat(account): isAccountActive 追加（active=false / 90日無活動で無効判定）"
```

---

### Task D2: recordActivityThrottled + onAuthStateChanged フック

**Files:**
- Modify: `~/work/taxi-dev-wt-pool-status/js/firebase-auth.js`

> Firestore I/O のためユニットテスト対象外（手動smokeで確認）。

- [ ] **Step 1: recordActivityThrottled 関数を firebase-auth.js に追加**

`js/firebase-auth.js` 末尾に追加:

```js
import { doc, updateDoc, serverTimestamp, getDoc } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js';
import { isAccountActive } from './access-control.js';

const ACTIVITY_LS_KEY = 'cabis_last_recorded_activity';

/** 1日1回だけ users/{uid}.lastActivityAt を更新。
 *  localStorage で 'YYYY-MM-DD' キーをチェックして重複書き込みを防ぐ。 */
export async function recordActivityThrottled(uid, db) {
  if (!uid || !db) return;
  const todayKey = new Date().toISOString().slice(0, 10);
  if (localStorage.getItem(ACTIVITY_LS_KEY) === todayKey) return;
  try {
    await updateDoc(doc(db, 'users', uid), {
      lastActivityAt: serverTimestamp()
    });
    localStorage.setItem(ACTIVITY_LS_KEY, todayKey);
  } catch (e) {
    console.warn('[activity] recordActivityThrottled failed:', e.message);
  }
}

/** users/{uid} doc を取得して isAccountActive 判定、false なら signOut + アラート。
 *  戻り値: アカウントが有効か（true/false）。 */
export async function enforceAccountActive(uid, db, auth) {
  if (!uid || !db) return true;
  try {
    const snap = await getDoc(doc(db, 'users', uid));
    const user = snap.exists() ? snap.data() : null;
    if (!isAccountActive(user)) {
      await auth.signOut();
      alert('このアカウントは現在使えなくなっています。会社の管理者にお問い合わせください。');
      return false;
    }
  } catch (e) {
    console.warn('[account] enforceAccountActive failed:', e.message);
  }
  return true;
}
```

- [ ] **Step 2: onAuthStateChanged フックで両関数を呼ぶ**

`js/firebase-auth.js` 内の既存 `onAuthStateChanged(auth, callback)` 呼び出しを次に拡張（既存ファイルで該当箇所を grep して特定）:

```js
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js';

onAuthStateChanged(auth, async (user) => {
  if (user) {
    // ログイン直後 / セッション復元時に活動記録＋失効チェック
    await recordActivityThrottled(user.uid, db);
    const ok = await enforceAccountActive(user.uid, db, auth);
    if (!ok) return; // signOut 済み
  }
  // 既存の onAuthStateChanged ロジック
});
```

> 注: 実装時、既存の `onAuthStateChanged` の callback 構造を維持しつつ、先頭に上記2行を追加するだけで済む。

- [ ] **Step 3: 手動smoke**

dev環境で:
- ログイン → Firestore コンソールで `users/{uid}.lastActivityAt` がサーバータイムスタンプで更新されることを確認
- 同じ日に再ログイン → 書き込まれない（localStorage で skip）
- 別日にアクセス → 再度更新される

- [ ] **Step 4: コミット**

```bash
cd ~/work/taxi-dev-wt-pool-status
git add js/firebase-auth.js
git commit -m "feat(account): recordActivityThrottled + enforceAccountActive を onAuthStateChanged フックに統合"
```

---

### Task D3: 自己退会ボタン（settings.html）

**Files:**
- Modify: `~/work/taxi-dev-wt-pool-status/settings.html`
- Modify: `~/work/taxi-dev-wt-pool-status/js/firebase-storage.js`

- [ ] **Step 1: firebase-storage.js に selfWithdraw 追加**

`js/firebase-storage.js` 末尾に追記:

```js
/** 自分のアカウントを無効化する（自己退会）。users/{uid}.active = false。 */
export async function selfWithdraw(uid) {
  if (!uid) throw new Error('selfWithdraw: uid required');
  const { doc, updateDoc } = await import('https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js');
  await updateDoc(doc(db, 'users', uid), { active: false });
}
```

> 注: `db` 参照は既存ファイル内の module-level 変数を流用。既存パターンに合わせる。

- [ ] **Step 2: settings.html に自己退会セクションを追加**

`settings.html` の末尾（招待URLセクションの後）に追加:

```html
<section id="selfWithdrawSection" style="margin:32px 0; padding:16px; border:1px solid #e0c4c0; background:#fff5f3; border-radius:10px;">
  <h3 style="margin:0 0 8px; color:#c83a2c;">⚠ アプリの利用を停止する</h3>
  <p class="hint" style="margin:0 0 12px;">退職した／このアプリを使わなくなる場合は、こちらから停止できます。</p>
  <button id="selfWithdrawBtn" class="btn" style="background:#c83a2c; color:#fff;">利用を停止する</button>
</section>
```

- [ ] **Step 3: 自己退会ロジック**

`settings.html` の script に追記:

```js
import { selfWithdraw } from './js/firebase-storage.js';
import { getAuth, signOut } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js';

document.getElementById('selfWithdrawBtn')?.addEventListener('click', async () => {
  const msg = 'アプリの利用を停止しますか？\n\n・ログインできなくなります\n・過去のデータは消えません\n・再開する場合は会社の管理者にお問い合わせください';
  if (!confirm(msg)) return;
  const userId = getCurrentUserId(); // 既存 helper
  try {
    await selfWithdraw(userId);
    await signOut(getAuth());
    alert('利用を停止しました。ご利用ありがとうございました。');
    location.href = './login.html';
  } catch (e) {
    alert('停止に失敗しました。もう一度お試しください。\n' + e.message);
  }
});
```

- [ ] **Step 4: コミット**

```bash
cd ~/work/taxi-dev-wt-pool-status
git add settings.html js/firebase-storage.js
git commit -m "feat(account): 自己退会ボタン（settings.html + selfWithdraw 関数）"
```

---

### Task D4: admin.html 手動無効化トグル

**Files:**
- Modify: `~/work/taxi-dev-wt-pool-status/admin.html`

- [ ] **Step 1: ユーザー一覧の各行に無効化ボタンを追加**

`admin.html` 内の既存「ユーザー一覧」表示ロジック（`loadUsersBtn` クリック時、line 123-125 周辺）を確認し、各ユーザー行の renderHTML に「有効/無効トグル」を追加:

```js
// 既存のユーザー行生成箇所（例）
function renderUserRow(user) {
  const isActive = user.active !== false; // default true
  const badge = isActive ? '' : '<span class="badge inactive">無効</span>';
  const btnLabel = isActive ? '無効化' : '有効化';
  return `
    <div class="user-row" data-uid="${user.uid}">
      <span>${user.uid}</span>
      ${badge}
      <button class="btn btn-toggle-active" data-uid="${user.uid}" data-active="${isActive}">
        ${btnLabel}
      </button>
    </div>
  `;
}
```

- [ ] **Step 2: トグルクリックロジック**

`admin.html` の script に追記:

```js
import { doc, updateDoc } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js';

document.addEventListener('click', async (e) => {
  if (!e.target.classList?.contains('btn-toggle-active')) return;
  const uid = e.target.dataset.uid;
  const currentlyActive = e.target.dataset.active === 'true';
  const action = currentlyActive ? '無効化' : '有効化';
  const msg = currentlyActive
    ? `${uid} を無効化しますか？\nこのユーザーはログインできなくなります。\nデータは保持されます。`
    : `${uid} を有効化しますか？\n再びログイン可能になります。`;
  if (!confirm(msg)) return;
  try {
    await updateDoc(doc(db, 'users', uid), { active: !currentlyActive });
    alert(`${uid} を${action}しました。`);
    document.getElementById('loadUsersBtn')?.click(); // 一覧再読み込み
  } catch (err) {
    alert('更新に失敗しました: ' + err.message);
  }
});
```

- [ ] **Step 3: 手動smoke**

admin.html で「ユーザーリストを読み込み」→ 任意ユーザーの「無効化」クリック → 確認ダイアログ → OK → 「無効化しました」アラート → 一覧再読み込みで `無効` バッジ表示

- [ ] **Step 4: コミット**

```bash
cd ~/work/taxi-dev-wt-pool-status
git add admin.html
git commit -m "feat(account): admin.html ユーザー一覧に有効/無効トグル追加"
```

---

# Phase X — SW bump

### Task X1: SW CACHE_NAME bump + 全テスト最終確認

**Files:**
- Modify: `~/work/taxi-dev-wt-pool-status/sw.js`

- [ ] **Step 1: dev最新 CACHE_NAME 確認**

Run:
```bash
cd ~/work/taxi-dev-wt-pool-status && git fetch -q origin main && echo "現状: $(grep '^const CACHE_NAME' sw.js)" && echo "dev最新: $(git show origin/main:sw.js | grep '^const CACHE_NAME')"
```

- [ ] **Step 2: sw.js bump（dev最新+1）**

`sw.js` 2行目を **dev最新+1** に書き換える（例: dev最新 v240 → v241）。

- [ ] **Step 3: 全テスト最終確認**

Run: `cd ~/work/taxi-dev-wt-pool-status && npm test`
Expected: PASS（全件緑、新規 invite-url 3件 + access-control 6件込み）

- [ ] **Step 4: コミット**

```bash
cd ~/work/taxi-dev-wt-pool-status
git add sw.js
git commit -m "chore(sw): CACHE_NAME bump（招待URL+アカウント制御）"
```

---

# Phase Z — 反映（Claude実行可）

- [ ] **Step 1: dev反映**

```bash
bash ~/work/taxi-dev-wt-pool-status/PUSH-genkyo.sh
```

衝突したら sw.js を dev最新+1 に統一して continue。

- [ ] **Step 2: dev確認URLで動作目視（ユーザー作業）**

- A: settings の招待URLセクション動作
- B: login signup の入力検証
- C: 自動生成ボタン
- E: signup 成功後のアカウント控え画面
- D-2: 自己退会ボタン
- D-3: admin ユーザー一覧の無効化トグル
- D-1: 動作テスト難（90日無活動は即時確認不可、コードレビューで確認）

- [ ] **Step 3: 本番タグ v1.42.0**

```bash
cd ~/work/taxi-dev && git fetch -q origin main && git tag v1.42.0 origin/main && git push origin v1.42.0
```

---

## Self-Review

**1. Spec coverage**
- ✅ A招待URL → Task A1+A2
- ✅ B入力検証 → Task B1
- ✅ C個人特定回避 → Task C1
- ✅ E控え表示 → Task E1
- ✅ D-1自動失効 → Task D1+D2
- ✅ D-2自己退会 → Task D3
- ✅ D-3admin手動 → Task D4
- ✅ SW bump → Task X1

**2. Placeholder scan**: TBD/TODO 無し、各ステップに実コード・実コマンド。

**3. Type consistency**
- `buildCompanyInviteUrl(slug, baseUrl, refUserId)` シグネチャは A1/A2 一致 ✓
- `isAccountActive(user, now=Date.now())` シグネチャは D1/D2 一致 ✓
- `recordActivityThrottled(uid, db)` シグネチャは D2 内で完結 ✓
- `enforceAccountActive(uid, db, auth)` シグネチャは D2 内で完結 ✓
- `selfWithdraw(uid)` シグネチャは D3 内で完結 ✓
- `INACTIVE_DAYS = 90` の判定基準は D1 のみで使用、D2 では呼び出しのみ ✓

---

## 実行方法

`superpowers:subagent-driven-development`（推奨）。Phase A→B→C→E→D-1→D-2→D-3→X→Z の順。Phase Z は Claude が直接実行。

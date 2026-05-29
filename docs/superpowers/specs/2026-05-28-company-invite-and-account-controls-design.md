# 会社招待URL+アカウント制御 Design

> 2026-05-28 設計。要望: ①一般ユーザーが同じ会社の人を招待できる、②入力フォームで大文字/ひらがな等を弾く、③登録時に個人特定を避ける、④退職者を無効化できる。

## 背景

現状の課題:
- 招待URLは管理者だけが発行できる（admin.html のみ）。乗務員が同僚を招待したい場面で手間がかかる
- signup 入力欄に `pattern` 属性や oninput 検証がなく、大文字・ひらがな等を入力できてしまう（サーバー側で弾かれるがUX悪い）
- placeholder `例: tanaka_taxi` が**本名っぽい**ため、個人特定可能なIDを設定する乗務員が出やすい
- 退職者が出てもアカウントを無効化する仕組みが無い（`users/{uid}.active` フィールドはあるがON/OFF UIなし）

## 目的（成功基準）

1. 一般乗務員が settings.html から招待URLを発行・共有できる
2. signup 入力時に大文字・ひらがな・記号を**入力欄レベル**で弾き、即フィードバック
3. 自動匿名ID生成ボタンで本名を避けるよう誘導
4. 管理者が admin.html から退職者を「無効化」でき、無効化されたユーザーは即ログイン不可（データは保持）

---

## Section A: 招待URL発行（一般ユーザー）

### URL構造
- 既存形式踏襲: `https://app.taxicabis.com/?company=<slug>&ref=<refUserId>`
- `?company` = 既存（会社識別、必須）
- `?ref` = 既存（紹介者識別、任意）。今回は本人の userId を入れる

### 純関数追加

`js/invite-url.js` に追加:

```js
/** 会社slug + 紹介者userId(任意) で招待URLを組み立てる純関数。
 *  refUserId が truthy なら &ref=<id> 付与、falsy なら付与しない。
 *  既存 captureInviteSlug の SLUG_PATTERN / REF_PATTERN と完全に整合。 */
export function buildCompanyInviteUrl(slug, baseUrl, refUserId = null) {
  const base = `${baseUrl}/?company=${encodeURIComponent(slug)}`;
  return refUserId ? `${base}&ref=${encodeURIComponent(refUserId)}` : base;
}
```

### UI（settings.html 新セクション）

```html
<section>
  <h3>🔗 同じ会社の人を招待</h3>
  <p class="hint">このURLを送ると、同じ会社の同僚が登録できます。</p>
  <div class="invite-url-row">
    <input id="companyInviteUrl" readonly>
    <button id="copyInviteUrlBtn" class="btn">📋 コピー</button>
    <button id="shareInviteUrlBtn" class="btn">📲 LINEやメールで送る</button>
  </div>
  <p class="hint">※ あなたの会社の人だけが登録できます</p>
</section>
```

ロード時に `currentUser.companySlug` + `currentUser.userId` を取得→ `buildCompanyInviteUrl` → input 反映。

### 共有ロジック

- **コピーボタン**: `navigator.clipboard.writeText(url)` → 1秒「コピーしました ✓」フィードバック
- **共有ボタン**: 
  - `navigator.share` 対応ブラウザ: `navigator.share({title:'Cabis（タクシー日報）', text:'同じ会社の同僚向け', url})`
  - 未対応: ボタン非表示

### 表示条件

- 会社所属ユーザー（`companySlug` あり）のみ表示
- 旧データユーザー（`companySlug` なし）は section ごと非表示

---

## Section B: 入力リアルタイム検証（login.html signup）

### HTML 変更

`<input id="suId">` に `pattern` 属性追加:

```html
<input type="text" id="suId" autocapitalize="none" autocomplete="username"
       pattern="[a-z][a-z0-9_]{2,29}" maxlength="30"
       placeholder="例: driver_a1b2">
```

### JS 検証

```js
const suIdEl = document.getElementById('suId');
const suIdErrorEl = document.getElementById('suIdError');
const signupBtn = document.getElementById('signupBtn');

function validateSuId() {
  const v = suIdEl.value;
  if (!v) {
    suIdErrorEl.textContent = '';
    suIdEl.classList.remove('error');
    signupBtn.disabled = true;
    return;
  }
  if (!/^[a-z][a-z0-9_]{2,29}$/.test(v)) {
    suIdErrorEl.textContent = '半角英小文字・数字・_ のみ使えます（3〜30文字、英小文字で始める）';
    suIdEl.classList.add('error');
    signupBtn.disabled = true;
    return;
  }
  suIdErrorEl.textContent = '';
  suIdEl.classList.remove('error');
  signupBtn.disabled = false;
}
suIdEl.addEventListener('input', validateSuId);
```

### CSS 追加

```css
input.error { border-color: #d33; }
.suid-error { color: #d33; font-size: 11px; margin-top:4px; }
```

### サーバー側

既存 `isValidUserId` チェックは保持（多層防御）。クライアント検証は UX 向上のみ。

---

## Section C: 個人特定回避（login.html signup）

### 文言変更

| 要素 | Before | After |
|---|---|---|
| placeholder | `例: tanaka_taxi` | `例: driver_a1b2` |
| hint | `半角英小文字で始め、英小文字・数字・_ が使えます（3〜30文字）。ログイン時に使うので、覚えやすいものにしてください。` | `半角英小文字で始め、英小文字・数字・_ が使えます（3〜30文字）。本名は避けて、任意のIDを決めてください。` |

### 自動生成ボタン

```html
<div class="suid-row">
  <input id="suId" ...>
  <button id="genSuIdBtn" type="button" class="btn-secondary">🎲 自動生成</button>
</div>
```

クリック時:

```js
import { generateSlug } from './slug-gen.js';
document.getElementById('genSuIdBtn').addEventListener('click', () => {
  // generateSlug は co- prefix だが、prefix 指定可能。driver_ + 6文字 = 'driver_a1b2c3' 形式
  // 末尾文字数は 6 で、衝突確率 32^6 ≈ 10億通り
  suIdEl.value = generateSlug('driver_', 6).replace(/-/g, '_'); // 念のため - を _ に
  validateSuId();
});
```

> `generateSlug` の prefix を `'driver_'` にすると `driver_xxxxxx` 形式（10文字+`_`、長さ ≤ 13）が生成される。`isValidUserId` の `/^[a-z][a-z0-9_]*$/` と整合。

---

## Section E: アカウント情報の控え表示（signup直後）

### 目的

signup 成功直後に「あなたのID/パスワードはこれです」を画面で見せて、忘れる前に**iOSパスワード保存**または**メモに控える**ように促す。パスワードは復元不能（ハッシュ保存）なので、初回しか平文表示できない。

### フロー

1. ユーザーが signup フォームで ID/パスワード入力＋会社確認
2. Firebase Auth でアカウント作成成功
3. **新画面「アカウントを作成しました」をモーダルまたは別画面で表示**
4. iOS Safari なら `autocomplete="new-password"` の効果で iCloud Keychain に「パスワードを保存しますか？」が出る
5. ユーザーが控えを取ったら「✓ 控えました、次へ」をタップ → メイン画面へ遷移

### UI（新画面）

```
🎉 アカウントを作成しました

⚠️ パスワードはこの画面でしか確認できません。
　 必ずメモかパスワード管理アプリに保存してください。

ログインID
┌──────────────────────┐
│ driver_a1b2c3        │  [📋 コピー]
└──────────────────────┘

パスワード
┌──────────────────────┐
│ abc12345             │  [📋 コピー]
└──────────────────────┘

[📋 ID/パスワードをまとめてコピー]

[✓ 控えました、次へ]
```

### コピーロジック

```js
// ID単体
copyIdBtn.addEventListener('click', () => {
  navigator.clipboard.writeText(userId);
  showFeedback(copyIdBtn, 'コピーしました ✓');
});
// パスワード単体
copyPwBtn.addEventListener('click', () => {
  navigator.clipboard.writeText(password);
  showFeedback(copyPwBtn, 'コピーしました ✓');
});
// まとめてコピー
copyBothBtn.addEventListener('click', () => {
  navigator.clipboard.writeText(
    `Cabis（タクシー日報）アカウント\nログインID: ${userId}\nパスワード: ${password}`
  );
  showFeedback(copyBothBtn, 'コピーしました ✓');
});
```

### iOS パスワード保存促進

既存の signup フォーム input に `autocomplete="new-password"` が設定されていれば、Firebase Auth でアカウント作成成功時に iOS Safari が自動的に「パスワードを保存しますか？」を出す。

確認・追加が必要な属性:
- `<input id="suId" autocomplete="username">`
- `<input id="suPassword" autocomplete="new-password">`

### セキュリティと注意点

- パスワードは sessionStorage に**signupフロー中だけ**保持。控え画面 dismiss 後に削除
- 「✓ 控えました、次へ」をタップしないと先に進めない（誤って戻るボタンで戻ってもID/PWは表示されない仕様）
- パスワード忘れた場合は既存のリセットフロー（管理者経由）を使う（本spec範囲外、既存機能）

---

## Section D: 退職者対応（自動失効+自己退会+緊急時admin）

「個別把握しない」を成り立たせるため、退職者対応は3層構成：

| 層 | 仕組み | 主用途 |
|---|---|---|
| **D-1** | 90日無活動で自動失効 | 退職後にスマホからアプリを削除した人が静かに inactive 化 |
| **D-2** | 自己退会ボタン（settings.html） | 退職時に乗務員自身が明示的に退会 |
| **D-3** | admin の手動無効化トグル | 荒らし・誤登録・緊急時の即時無効化 |

### Firestore データモデル

- 既存 `users/{uid}.active` (boolean, default true) 活用
- **新規追加 `users/{uid}.lastActivityAt`** (Firestore Timestamp): **アプリ起動時（任意の画面）に更新**。タイマー・IC判定・到着便・設定など、どの画面を開いても1日1回更新される

### lastActivityAt 更新の仕掛け

**全ページ共通**で「セッションが既に確立している＝Firebase Auth に既存ユーザーがいる」ことを検知したら `recordActivity()` を呼ぶ。スロットリング込み:

```js
// 共通 js (例: js/firebase-auth.js or 新規 js/activity-tracker.js)
const ACTIVITY_KEY = 'cabis_last_recorded_activity';

async function recordActivityThrottled(uid) {
  const todayKey = new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD'
  if (localStorage.getItem(ACTIVITY_KEY) === todayKey) return; // 今日もう更新済み
  await updateDoc(doc(db, 'users', uid), {
    lastActivityAt: serverTimestamp()
  });
  localStorage.setItem(ACTIVITY_KEY, todayKey);
}

// onAuthStateChanged フックで呼ぶ
onAuthStateChanged(auth, (user) => {
  if (user) recordActivityThrottled(user.uid);
});
```

これで:
- **日報入力ページ起動** → `lastActivityAt` 更新
- **タイマー画面起動** → 同上
- **IC判定ページ起動** → 同上
- **到着便ページ起動** → 同上
- **設定画面起動** → 同上

1日1回しか Firestore に書き込まないので無駄もない。「**タイマーだけ使ってる人**」も毎日アプリを開いていれば自動失効されない。

### D-1: 自動失効（90日無活動）

判定はオンデマンド（ログイン試行時に判定）:

```js
// js/access-control.js
const INACTIVE_DAYS = 90;

export function isAccountActive(user, now = Date.now()) {
  if (user && user.active === false) return false;
  if (user && user.lastActivityAt) {
    const last = user.lastActivityAt.toMillis ? user.lastActivityAt.toMillis() : user.lastActivityAt;
    if (now - last > INACTIVE_DAYS * 86400_000) return false;
  }
  return true;
}
```

ログイン成功直後に `isAccountActive(user)` が false なら即 `signOut()` + アラート「90日以上ご利用がないため、再開には会社の管理者にお問い合わせください」。

### D-2: 自己退会ボタン（settings.html）

```html
<section class="danger-zone">
  <h3>⚠ アプリの利用を停止する</h3>
  <p class="hint">退職した／このアプリを使わなくなる場合は、こちらから停止できます。</p>
  <button id="selfWithdrawBtn" class="btn-danger">利用を停止する</button>
</section>
```

クリック時の確認ダイアログ:
```
アプリの利用を停止しますか？

・ログインできなくなります
・過去のデータは消えません
・再開する場合は会社の管理者にお問い合わせください

[キャンセル] [停止する]
```

「停止する」 → `users/{uid}.active = false` + `signOut()`

### D-3: 緊急時 admin 手動無効化（既存案維持）

admin.html ユーザー一覧の各行に「有効/無効」トグル。動作は前の設計のまま：

- クリックで `users/{uid}.active` を反転
- 「無効」行は灰色＋ `inactive` バッジ表示（既存CSSあり）

### D-4: 失効判定のタイミング

判定タイミング:
1. **ログイン成功直後**（signin フック）→ 90日以上経過なら即 signOut + アラート
2. **アプリ起動時（onAuthStateChanged で既存セッション復元）**→ 同上

```js
// signin 成功後 / セッション復元後の共通フロー
await recordActivityThrottled(uid);     // 今日の活動を記録
const userDoc = await getUserDoc(uid);  // 最新の user doc 取得
if (!isAccountActive(userDoc)) {
  await signOut(auth);
  alert('このアカウントは現在使えなくなっています。会社の管理者にお問い合わせください。');
  return;
}
```

> **注**: lastActivityAt 更新 → isAccountActive 判定の順なので、今アプリを開いたユーザーは絶対に inactive 判定されない。判定が効くのは「90日以上アプリを起動しなかった人が久しぶりに開いた瞬間」のみ。

### データ保持

- Firestore データ（drives, settings 等）は削除しない
- 管理者は admin.html から無効化ユーザーのデータも引き続き閲覧可能
- 復活時は admin トグル or 管理者が `lastActivityAt` 更新で `active: true` に戻すだけ

### 「個別把握しない」が成り立つ理由

| ケース | 対応 | 管理者の手間 |
|---|---|---|
| 退職してアプリ放置（タイマー含め一切起動しない） | 90日で自動失効 | ゼロ |
| 退職したがアプリは時々開く | 自己退会ボタンを押してもらう（or 90日空けば自動失効） | ゼロ |
| タイマーだけ使う現役乗務員 | アプリ起動毎に lastActivityAt 更新 → **失効されない** | ゼロ |
| 退職時に明示的に退会したい | 自己退会ボタン | ゼロ |
| 荒らし・誤登録など緊急 | admin で手動無効化 | 1クリック |
| 長期休暇から復帰した | 管理者に連絡 → admin で有効化 | 1クリック |

---

## テスト

### 純関数（ユニットテスト）

```js
// tests/invite-url.test.js に追加
test('buildCompanyInviteUrl: ref あり', () => {
  assert.equal(
    buildCompanyInviteUrl('co-7q7ros', 'https://app.taxicabis.com', 'driver_a1b2'),
    'https://app.taxicabis.com/?company=co-7q7ros&ref=driver_a1b2'
  );
});

test('buildCompanyInviteUrl: ref なし(null/undefined/空文字)', () => {
  const expected = 'https://app.taxicabis.com/?company=co-7q7ros';
  assert.equal(buildCompanyInviteUrl('co-7q7ros', 'https://app.taxicabis.com'), expected);
  assert.equal(buildCompanyInviteUrl('co-7q7ros', 'https://app.taxicabis.com', null), expected);
  assert.equal(buildCompanyInviteUrl('co-7q7ros', 'https://app.taxicabis.com', ''), expected);
});

// tests/access-control.test.js に追加（既存ファイル）
test('isAccountActive: active=false で false', () => {
  assert.equal(isAccountActive({ active: false }), false);
});
test('isAccountActive: active=true/undefined/null user で true (後方互換)', () => {
  assert.equal(isAccountActive({ active: true }), true);
  assert.equal(isAccountActive({}), true);
  assert.equal(isAccountActive(null), true);
});
```

### DOM/Firestore統合（手動smoke）

- A: settings.html で URL生成・コピー・共有ボタンの動作確認
- B: signup フォームに大文字 `Taro` 入力→赤枠+エラー表示
- C: 「🎲 自動生成」クリック→`driver_xxxxxx` 形式が入る
- D: admin.htmlで無効化→該当ユーザーがログイン不可になる→有効化で復活

---

## 実装範囲（Phaseとコミット）

| Phase | 内容 | 主なファイル | コミット数 |
|---|---|---|---|
| A | 招待URL機能 | `js/invite-url.js`, `settings.html`, `tests/invite-url.test.js` | 2 |
| B | 入力リアルタイム検証 | `login.html`, `css/style.css` | 1 |
| C | 個人特定回避 | `login.html`（hint/placeholder変更 + 自動生成ボタン） | 1 |
| D-1 | 自動失効（90日） | `js/access-control.js`, `js/firebase-auth.js`, `tests/access-control.test.js` | 2 |
| D-2 | 自己退会ボタン | `settings.html`, `js/firebase-storage.js` | 1 |
| D-3 | admin 手動トグル | `admin.html`, `js/admin-companies.js` | 1 |
| E | アカウント控え表示 | `login.html`（signup成功後の画面追加） | 1 |
| 共通 | SW bump | `sw.js` | 1 |

合計 10コミット程度。

---

## 残課題（範囲外）

- **招待回数制限**: 無制限。荒らし対策が必要なら別途
- **無効化履歴**: 「いつ誰が無効化したか」のログは取らない。必要なら Audit log を別途
- **二段階認証**: 別タスク
- **退職者データの削除リクエスト**: GDPR的観点でユーザー自身がデータ削除を申請する仕組みは別タスク

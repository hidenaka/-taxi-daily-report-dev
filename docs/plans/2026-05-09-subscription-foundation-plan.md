# 課金システム基盤(B フェーズ1) 実装計画

**Goal:** Stripe 接続前の状態管理層 + 申込/退会 UI の実装
**Tech Stack:** HTML / JavaScript ES Modules / Firebase Firestore / 既存テストランナー(node --test)
**Design:** `docs/designs/2026-05-09-subscription-foundation-design.md`

---

## Task 1: 純関数モジュール `js/subscription-state.js`

**Files:**
- 作成: `js/subscription-state.js`(純関数 + Firestore アダプタ)
- 作成: `tests/subscription-state.test.js`

**手順:**
1. [ ] 純関数を実装(`isValidStatus`, `isPaying`, `isCanceledOrUnpaid`, `requiresOnboarding`, `computeAgreementSnapshot`)
2. [ ] Firestore アダプタを実装(`getSubscription`, `recordAgreementAndSubscribe`, `cancelSubscription`)
3. [ ] テスト作成 — 純関数のみ
4. [ ] `npm test` で全 pass 確認

**完了条件:**
- 既存 80 テスト + 新規テスト全 pass
- 純関数は副作用なし(Firestore 呼ばない)

---

## Task 2: アクセス制御 `js/access-control.js`

**Files:**
- 作成: `js/access-control.js`
- 作成: `tests/access-control.test.js`

**手順:**
1. [ ] `canAccess(feature, sub)` を純関数で実装
2. [ ] `getRestrictionReason(sub)` を純関数で実装
3. [ ] features 定数 `'core' | 'analysis' | 'export'` を export
4. [ ] テスト: 6 status × 3 feature = 18 ケース全網羅

**完了条件:**
- `canAccess` は純関数(Firestore 呼ばない、`subscription-state.js` の純関数のみ参照)
- 既存ページへの組み込みは行わない(フェーズ2)

---

## Task 3: `subscribe.html` 作成

**Files:**
- 作成: `subscribe.html`

**手順:**
1. [ ] 既存 HTML(例: `settings.html`)のヘッダー/フッター/CSS 取り込み構造をコピー
2. [ ] 同意 checkbox 4つ + 「同意して申し込む」ボタン実装
3. [ ] `js/subscription-state.js` を import → ページロードで現在状態取得
4. [ ] 申込済み状態の場合は別表示
5. [ ] 申込実行 → Firestore 書き込み → 完了表示
6. [ ] legal-footer を含める(既存ページと統一)

**完了条件:**
- 全 checkbox オン時のみボタン有効
- ブラウザで申込 → Firestore コンソールで `subscriptions/{userId}` 存在確認
- 再訪問で「申込済み」表示

---

## Task 4: `settings.html` 退会セクション追加

**Files:**
- 変更: `settings.html`

**手順:**
1. [ ] 退会セクションを追加(独立した `<section>`)
2. [ ] ページロード時に `getSubscription()` で状態取得
3. [ ] `requiresOnboarding(sub)` が true なら退会セクション非表示
4. [ ] 退会ボタン → 確認モーダル → 退会理由(任意)入力 → `cancelSubscription(reason)` 実行
5. [ ] 完了表示 + 申込画面への導線

**完了条件:**
- 既存の設定項目・ログアウト等の動作に影響なし
- 退会済みユーザーは「退会済み」状態を表示
- ブラウザで退会フロー一周

---

## Task 5: `sw.js` 更新

**Files:**
- 変更: `sw.js`

**手順:**
1. [ ] CACHE_VERSION を v80 → v81
2. [ ] CACHE_FILES に `subscribe.html` を追加

**完了条件:**
- ブラウザで開発者ツール → Application → Service Worker で v81 に更新確認

---

## Task 6: 検証 + コミット

**手順:**
1. [ ] `npm test` 全 pass(既存 80 + 新規)
2. [ ] ブラウザで `subscribe.html` フロー一周
3. [ ] ブラウザで `settings.html` 退会フロー一周
4. [ ] Firestore コンソールで書き込み内容確認
5. [ ] 細粒度コミット:
   - `docs: add subscription foundation design and plan (B phase 1)`
   - `feat: add subscription-state module with pure-function tests`
   - `feat: add access-control module with pure-function tests`
   - `feat: add subscribe.html with terms agreement checkboxes`
   - `feat: add cancellation section to settings.html`
   - `feat: update SW cache version v80 to v81 (add subscribe.html)`

**完了条件:**
- 既存機能(乗務記録、閲覧、編集、ログアウト)に影響なし
- 本番動作変更なし(導線未接続のため)
- フェーズ2 残課題は設計書 §8 に記載済み

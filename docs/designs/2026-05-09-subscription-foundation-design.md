# 課金システム基盤(B フェーズ1) 設計

## 最終更新: 2026-05-09

---

## 1. ゴール

外部課金サービス(Stripe)接続前の段階で、以下を実装する:

1. サブスクリプション状態の Firestore データモデル
2. 申込確認画面(利用規約同意 checkbox 付き)
3. 退会フロー UI(settings.html)
4. アクセス制御の純関数層(各ページへの適用は本フェーズ外)

このフェーズ完了時点で本番動作に影響を与えない(導線未接続)。

---

## 2. 非ゴール(本フェーズで扱わないもの)

| 項目 | 理由 |
|------|------|
| Stripe Webhook 受信処理 | フェーズ2(サーバー側 or Functions) |
| admin.html の課金状況確認 UI | フェーズ2(Stripe 接続後) |
| 各ページへのアクセス制御挿入 | フェーズ2(課金が動いてからじゃないとテスト不能) |
| インボイス対応 | TBD-OWNER + 適格請求書事業者登録番号確定後 |
| 既存ユーザー grandfathering ロジック | フェーズ2(アクセス制御有効化と同時) |
| 法務文書の TBD 置換 | TBD-OWNER / TBD-EMAIL / TBD-PRICE 確定後 |

---

## 3. アーキテクチャ

### 3.1 Firestore スキーマ

#### コレクション: `subscriptions/{userId}`

```javascript
{
  status: 'pending' | 'trial' | 'active' | 'past_due' | 'canceled' | 'unpaid',
  planId: string | null,                  // 'monthly_v1' 等(フェーズ2で確定)
  agreedTermsAt: string | null,           // ISO8601(利用規約同意日時)
  agreedTermsVersion: string | null,      // '2026-05-08' 等
  agreedPrivacyAt: string | null,         // ISO8601
  agreedPrivacyVersion: string | null,
  agreedTokuteishouAt: string | null,     // ISO8601
  currentPeriodStart: string | null,      // ISO8601
  currentPeriodEnd: string | null,
  trialEndsAt: string | null,
  canceledAt: string | null,
  cancelReason: string | null,
  stripeCustomerId: string | null,        // フェーズ2で書き込み
  stripeSubscriptionId: string | null,    // フェーズ2で書き込み
  createdAt: string,                      // ISO8601
  updatedAt: string                       // ISO8601
}
```

**設計判断**: Firestore Timestamp ではなく ISO8601 文字列を使う(既存コード `js/firebase-storage.js` の `updatedAt: new Date().toISOString()` と統一)。

### 3.2 状態遷移

```
                  (subscribe.html で同意・申込)
   存在しない  ──────────────────────────────>  pending
                                                  │
                              (フェーズ2: Stripe 決済成功)
                                                  ▼
                                   active ◄──────── trial
                                     │  ▲
                       (settings 退会)│  │(支払復旧)
                                     ▼  │
                                  canceled  past_due
                                              │
                                  (一定期間後)│
                                              ▼
                                           unpaid
```

本フェーズで実装するのは `存在しない → pending → canceled` の遷移のみ。
他の遷移はフェーズ2でテスト可能になり次第追加。

### 3.3 セキュリティルール(参考、本フェーズでは設定変更しない)

```
match /subscriptions/{userId} {
  allow read: if request.auth != null && request.auth.uid == userId;
  // 書き込みはサーバー(フェーズ2の Cloud Functions)経由を原則とするが、
  // フェーズ1では同意記録のためクライアント書き込みを許可する
  allow write: if request.auth != null && request.auth.uid == userId;
}
```

**注意**: フェーズ2で Stripe Webhook が `subscriptions/` を更新するようになったら、
クライアント書き込みを `agreedTermsAt` 等の同意フィールドのみに制限する。
本フェーズでは設定済みのデフォルトルール(認証済みユーザーは自分のドキュメントを読み書き可)を変更しない。

---

## 4. モジュール設計

### 4.1 `js/subscription-state.js`

**純関数(テスト対象)**:

| 関数 | 引数 | 戻り値 | 用途 |
|------|------|--------|------|
| `isValidStatus(status)` | string | boolean | status 値の妥当性チェック |
| `isPaying(sub)` | subscription | boolean | active or trial か |
| `isCanceledOrUnpaid(sub)` | subscription | boolean | 終了状態か |
| `requiresOnboarding(sub)` | subscription \| null | boolean | 未申込 or pending か(申込画面に出すべきか) |
| `computeAgreementSnapshot(versions)` | { terms, privacy, tokuteishou } | object | 同意フィールド一式を生成(now() を内部で呼ぶ) |

**アダプタ(テスト対象外)**:

| 関数 | 戻り値 | 用途 |
|------|--------|------|
| `getSubscription()` | Promise<subscription \| null> | Firestore `subscriptions/{userId}` 読み取り |
| `recordAgreementAndSubscribe(versions)` | Promise<void> | 同意記録 + status='pending' で書き込み |
| `cancelSubscription(reason)` | Promise<void> | status='canceled', canceledAt, cancelReason 書き込み |

### 4.2 `js/access-control.js`

**純関数(テスト対象)**:

| 関数 | 引数 | 戻り値 | 用途 |
|------|------|--------|------|
| `canAccess(feature, sub)` | string, subscription \| null | boolean | 機能アクセス可否 |
| `getRestrictionReason(sub)` | subscription \| null | string \| null | 制限理由(UI 表示用) |

**features 一覧**(本フェーズで定義のみ):
- `'core'` — 基本機能(乗務記録、閲覧、編集)
- `'analysis'` — 分析機能(review, support の集計)
- `'export'` — データエクスポート

**判定ルール(フェーズ1)**:
- `null`(未申込) → 全 false
- `pending` → 全 false
- `trial` / `active` → 全 true
- `past_due` → `core` のみ true(閲覧と既存データ編集は維持、分析・エクスポートは制限)
- `canceled` / `unpaid` → 全 false

**注意**: 本フェーズではゲート関数を作るだけで、各ページに挿入しない。フェーズ2で `index.html` 等にバナー/モーダルとして適用する。

### 4.3 法務同意のバージョン管理

`legal/terms.html` 等の最終更新日を「同意バージョン」として記録。
現行版: `2026-05-08`(legal-template-source.md の初版日)。

`subscribe.html` 内に直接ハードコードする(フェーズ1):
```js
const AGREEMENT_VERSIONS = {
  terms: '2026-05-08',
  privacy: '2026-05-08',
  tokuteishou: '2026-05-08'
};
```

法務改訂時はこの値を更新 → 既存ユーザーに再同意を求める(将来実装、本フェーズ外)。

---

## 5. UI 設計

### 5.1 `subscribe.html`(新規)

**レイアウト**:
- ヘッダー: 「タクシー日報のお申し込み」
- 概要: サービスの説明 1〜2文
- 料金表示: 月額 [TBD-PRICE] 円(プレースホルダーのまま)
- 同意 checkbox 4つ:
  1. [ ] 利用規約に同意します(`legal/terms.html` へのリンク)
  2. [ ] プライバシーポリシーに同意します(`legal/privacy.html` へのリンク)
  3. [ ] 特定商取引法に基づく表記を確認しました(`legal/tokuteishou.html` へのリンク)
  4. [ ] 上記すべての書面の内容を理解しました
- ボタン: 「同意して申し込む」(全 checkbox オン時のみ有効)
- 状態フィードバック: 申込済み時は「申込済み: 決済へ進む(準備中)」表示

**動作**:
1. ページロード → `getSubscription()` で現在状態取得
2. 既に `pending`/`active`/`trial` の場合 → 「申込済み」状態表示に切り替え
3. 「同意して申し込む」クリック → `recordAgreementAndSubscribe()` → 完了画面表示

### 5.2 `settings.html` 退会セクション(変更)

**追加位置**: ファイル末尾の「ログアウト」ボタンの直前 or 直後の独立セクション

**内容**:
- 見出し: 「退会する」(危険操作スタイル)
- 説明: 「退会すると次回更新日以降サービスを利用できなくなります。乗務データは退会後 30日間保持され、その後削除されます。」(現状の挙動を反映、将来確定)
- 退会理由(任意セレクト): 「使わなくなった」「料金が高い」「他サービス利用」「その他」
- 「退会する」ボタン → 確認モーダル「本当に退会しますか?」 → `cancelSubscription(reason)` 実行
- 完了後: 「退会処理が完了しました」表示 + 申込画面への導線

**前提**: 未申込ユーザーには退会セクションを表示しない(`requiresOnboarding(sub)` が true なら隠す)。

### 5.3 `sw.js` キャッシュ

- `CACHE_VERSION` を v80 → v81 に更新
- `subscribe.html` を CACHE_FILES に追加

---

## 6. テスト方針

### 6.1 純関数テスト

`tests/subscription-state.test.js`:
- `isValidStatus`: 全 status 値 + 不正値
- `isPaying`: trial/active で true、他で false
- `isCanceledOrUnpaid`: canceled/unpaid で true
- `requiresOnboarding`: null + pending で true
- `computeAgreementSnapshot`: 入力 versions が出力の正しいフィールドにマッピングされる

`tests/access-control.test.js`:
- `canAccess`: 各 status × 各 feature の組み合わせ全パターン
- `getRestrictionReason`: status 別の文言

### 6.2 ブラウザ動作確認

- `subscribe.html` を開く → 同意 checkbox の動作 → 「申し込む」ボタンの活性条件
- 申込実行 → Firestore コンソールで `subscriptions/{userId}` ドキュメント確認
- 再訪問 → 「申込済み」状態表示
- `settings.html` → 退会セクション表示 → モーダル → 退会実行 → ステータス更新確認
- 既存 80 テスト全 pass 継続

---

## 7. 影響範囲

| ファイル | 変更 |
|---------|------|
| (新規) `js/subscription-state.js` | 新規作成 |
| (新規) `js/access-control.js` | 新規作成 |
| (新規) `subscribe.html` | 新規作成 |
| (新規) `tests/subscription-state.test.js` | 新規作成 |
| (新規) `tests/access-control.test.js` | 新規作成 |
| `settings.html` | 退会セクション追加(既存セクションは変更しない) |
| `sw.js` | CACHE_VERSION + subscribe.html 追加 |

**変更しないもの**:
- 既存全機能ページ(index.html, input.html, detail.html, review.html, calendar.html, support.html, admin.html, etc.)
- legal/* (TBD 確定後にまとめて置換)
- firebase-* モジュール(subscription-state.js は firebase-init.js を import するのみ)

---

## 8. 残課題(フェーズ2 へ送る)

1. Stripe Checkout / Subscription 接続(Customer 作成、Webhook 受信)
2. admin.html: 課金状況一覧 + 開始日設定 UI
3. 各ページへのアクセス制御挿入(`canAccess()` の呼び出し)
4. 法務文書の TBD 置換(TBD-OWNER, TBD-EMAIL, TBD-PRICE)
5. インボイス対応(適格請求書発行、登録番号表示)
6. 既存匿名ユーザーの grandfathering(初回ログイン時に subscribe.html へ誘導 or 自動 trial)
7. Firestore セキュリティルール厳格化(Webhook 経由書き込みのみ許可)
8. 退会後 30 日のデータ保持/削除バッチ
9. 法務改訂時の再同意フロー

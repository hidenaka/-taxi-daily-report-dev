# cabis-billing — キャビス課金バックエンド（Cloudflare Worker）

Stripe Checkout・Webhook・解約を処理し、Firestore の `subscriptions/{userId}` を同期する Worker。
GitHub Pages（アプリ本体）とは**別デプロイ**。`wrangler deploy` で公開する。

## 構成

| 環境 | Worker 名 | Stripe | Firebase |
|---|---|---|---|
| dev（既定） | `cabis-billing-dev` | テストモード | `taxi-dailydata-dev` |
| production | `cabis-billing` | ライブモード | `taxi-dailydata` |

## エンドポイント

| メソッド・パス | 用途 |
|---|---|
| `GET /health` | 稼働確認 |
| `POST /create-checkout-session` | `{userId, couponCode?}` → `{url}`（Checkout へ） |
| `POST /cancel-subscription` | `{userId, reason?}` → 期間末解約をセット |
| `POST /webhook` | Stripe イベント受信（署名検証あり） |

## セットアップ（dev）

### 1. シークレット投入

```sh
cd worker
# Stripe テスト秘密鍵（タクシー日報/.env の STRIPE_SECRET_KEY）
wrangler secret put STRIPE_SECRET_KEY
# Firebase サービスアカウント JSON（taxi-dailydata-dev のもの）まるごと
wrangler secret put FIREBASE_SERVICE_ACCOUNT
# Webhook 署名シークレット（手順 3 で取得後）
wrangler secret put STRIPE_WEBHOOK_SECRET
```

### 2. デプロイ

```sh
wrangler deploy            # dev
wrangler deploy --env production   # 本番
```

### 3. Webhook エンドポイント登録

Worker の URL（例 `https://cabis-billing-dev.<account>.workers.dev/webhook`）を
Stripe ダッシュボード → 開発者 → Webhook で登録。受信イベント:

- `checkout.session.completed`
- `customer.subscription.created` / `updated` / `deleted`
- `invoice.payment_succeeded` / `invoice.payment_failed`

登録後に表示される署名シークレット（`whsec_…`）を手順 1 の
`STRIPE_WEBHOOK_SECRET` に投入する。

## Firestore への書き込み

サービスアカウント JWT → OAuth2 トークン → Firestore REST API（`datastore` スコープ）。
`updateMask` 付き PATCH なので、同意情報（`agreedTermsAt` 等）など Worker が
扱わない項目は上書きされない。

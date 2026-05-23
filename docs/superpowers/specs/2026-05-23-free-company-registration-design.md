# 設計: 会社単位の無償フラグで「課金不要登録」をStripeと分ける

- 日付: 2026-05-23
- 関連: 価格ピボット（自社無料・ドライバー無料／`2026-05-23-decisions.md`）、管理者「恒久無料で有効化」(v1.27.0・per-user手動版)

## 目的
会社（恵豊など）を「無償」に指定でき、その会社の招待URLで登録した人は **Stripeを通らず無償(active)で利用開始** できるようにする。無償でない会社／直接登録は従来どおりStripe課金。per-user手動(v1.27.0)の自動化版。

## 方針（案A: 会社単位の無償フラグ・自動・サーバー検証）

### データモデル
- `companies/{slug}` に **`freeForInvited: boolean`** を追加（true=その会社の招待者は課金不要）。恵豊=true。
- `subscriptions/{userId}` は従来どおり。無償付与時は `status:'active'` / `planId:'comp_company'` / `free:true` / `companyId` を記録（Stripe項目はnull）。

### セキュリティ（最重要）
無償付与は **worker（サーバー）が会社フラグを検証してから**行う。クライアントの自己申告 companyId は信用しない。
- worker は `users` を **`userId == <userId>` で Firestore runQuery** し、その人の**本当の companyId** を取得（users は uid キーのため逆引きが必要）。0件/複数件は拒否。
- 取得した companyId の `companies/{companyId}.freeForInvited === true` を確認 → 偽なら 403。

### フロー
**無償会社（freeForInvited=true）**:
1. `?company=<slug>` で招待 → signup（users/{uid} に companyId 記録・既存）
2. subscribe.html が `companies/{slug}.freeForInvited` を読む（クライアント・UI判定用）→ true なら **Stripe決済UIを隠し**、規約・プライバシー等の**法的同意チェックは従来どおり**求めた上で「**無償で利用を開始**」ボタンを表示
3. ボタン → `subscription-state.startFree(agreement)` → worker `POST /start-free { userId, agreement }`
4. worker: 上記セキュリティ検証 → OKなら `subscriptions/{userId}` に active(無償)＋同意記録を書く → `{ ok:true }`
5. 成功 → `index.html` へ。enforceAccess は active を見て通す（変更不要）

**無償でない会社／直接**: 従来の Stripe フロー（`/create-checkout-session`）のまま。

### クーポンとの関係
無償会社は課金ゼロなので個人クーポン(KEIHO等)は無関係（startFreeはクーポンを扱わない）。

## 変更点
| 層 | ファイル | 変更 |
|---|---|---|
| 会社フラグ | `js/admin-companies.js` (buildCompanyDoc) | `freeForInvited` を任意フィールドで受け入れ |
| 会社フラグ | `js/company-config.js` (COMPANY_LEVEL_KEYS) | `freeForInvited` 追加（実効設定にマージ） |
| admin UI | `admin.html` 会社管理フォーム | 「無償（招待者は課金なし）」チェックボックス＋保存/読込に反映 |
| worker | `worker/src/index.js` | `/start-free` 新設（runQueryで companyId 検証 → active付与）。Firestore runQuery ヘルパ追加 |
| クライアント | `js/subscription-state.js` | `startFree(agreement)` 追加（POST /start-free） |
| クライアント | `subscribe.html` | 会社の freeForInvited を読み、無償なら無償開始UIに分岐（同意チェックは維持） |
| クライアント | `js/invite-url.js` | 会社プロファイル取得に freeForInvited を含める（既存 fetchCompanyExists 拡張 or 新関数） |

## テスト
- 純関数: `buildCompanyDoc` が freeForInvited を正しく格納（admin-companies.test.js 拡張）
- worker: runQuery→検証ロジックは worker 内。最低限、subscribe.html 分岐の純粋判定（会社free→無償UI）をテスト可能な形に切り出す
- スモーク: dev で 無償会社(co-7q7ros)招待→signup→subscribe が無償UIになる／無償開始でactiveになる（本人実機・Turnstile/認証のためAIは静的検証＋worker dev検証）

## デプロイ（2系統）
1. **アプリ**（subscribe.html/admin.html/js/*）= dev→`v*`タグ本番
2. **worker** = dev: `wrangler deploy --env dev`（`cabis-billing-dev`）／本番: `wrangler deploy --env production`（`cabis-billing`）。secret変更なし。
- 順序: worker(dev)→アプリ(dev)で結合確認→本人OK→worker(prod)→アプリ(prod tag)

## スコープ外
- per-user手動「恒久無料で有効化」(v1.27.0)はそのまま併存（個別付与用）
- 連携(他人データ)機能は別途温存済み（本機能と無関係）

## リスク/留意
- worker の認証レベルは既存 `/create-checkout-session` に合わせる（無償付与は会社フラグ検証が主ゲート）。第三者が他人userIdで /start-free を叩いても「無償会社の人を無償化」するだけで実害小。
- runQuery で同一 userId が複数 users docに無いこと前提（Firebase Auth email一意で担保）。

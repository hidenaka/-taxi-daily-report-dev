# 会社設定ヒアリングフォーム設計

作成: 2026-05-20 ／ 状態: ドラフト（ユーザーレビュー待ち）

> **【2026-05-21 更新】メール送信は Mail Channels → Resend に変更。**
> 旧 Cloudflare Mail Channels の無料・無認証送信が 2024 に終了し API キー必須化したため、
> Resend Email API（`https://api.resend.com/emails`・`Authorization: Bearer <RESEND_API_KEY>`）に移行。
> 以降の本文で「Mail Channels」とあるのは Resend と読み替える。DNS は SPF + DKIM（Resend のドメイン検証）。

## 概要

新規導入会社（まだ `companies/{slug}` が作成されていない会社）の給与ルールを、
担当ドライバーがWebフォームから入力・送信し、中野氏が admin で確認・取込する
仕組みを構築する。これにより Pattern C/D オンボーディング（onboarding-playbook.md）の
「商談で確認すること」をフォームで体系化し、商談ヒアリングの転記作業をなくす。

## 背景・経緯

- マルチカンパニー段階3で `admin.html` の会社管理UIは完成済み（中野氏が手で入力）。
- 現状 Pattern C（他社・合意済 admin 未登録）では商談 → 中野氏が口頭/メモで給与ルールを
  聞き取り → admin にコピーで会社作成、という二度手間が発生していた（onboarding-playbook.md）。
- 2026-05-20 ユーザー要望: 「会社ごとに色々設定を変えるところがある、それらを作成して
  もらうためのシートやフォーム・新規ユーザーに情報を提供してもらう仕組みを作りたい」。
- 同日、設計セッションで以下を確定:
  - 媒体: Webフォーム一本（印刷ビューは admin 側のみ用意）
  - 認証: 招待URL方式（中野氏が個別発行・一回限りトークン）
  - 項目範囲: admin.html の会社管理項目をフル
  - 給与モード: 変動歩率/固定歩率の2モードのみ。月給制は「別途相談」表示
  - 記入想定者: タクシードライバー（現役/元）。組合事務局も同様。人事担当者は対象外
  - レイアウト: 単一ページ縦スクロール（スマホ最適化）
  - 個人特定情報: Firestore に保存しない。メール本文/添付のみ
  - 通知: 提出時に Worker → Cloudflare Mail Channels で中野氏にメール
  - 変動歩率の記入方法: 数値入力／自由テキスト／添付ファイルの3パターン、1つ以上必須

関連: `notes/2026-05-20-decisions.md` の slug 匿名識別子化（decisions 7）、
完全招待制 signup ガード（decisions 6）、`secretary/notes/onboarding-playbook.md`。

## スコープ

含む:
- ヒアリングフォーム本体 `setup-request.html`（新規）
- 招待URL発行UI（admin.html「📨 ヒアリングURL発行」セクション・新規）
- 申請レビューUI（admin.html「📥 申請レビュー」セクション・新規）
- Worker (`cabis-billing`) エンドポイント4本（issue-url / validate-token / submit / archive）
- Firestore コレクション `companySetupRequests`（新規）と Rules 追加
- メール送信（Cloudflare Mail Channels、SPF/DKIM 設定）
- 変動歩率の3パターン記入（数値/自由テキスト/添付ファイル）
- 取込フロー（既存「🏢 会社管理」フォームへの事前入力）

含まない:
- ドライバー自身による会社設定（招待制を維持。Pattern A/B/C/D の現行構造を変えない）
- 月給制対応（payroll.js 側の月給制サポート未実装のため、フォームで「別途相談」表示のみ）
- 商談前の問い合わせフォーム（LP の mailto を引き続き使用、本フォームは商談合意後）
- 自動取込（中野氏が必ず admin で内容確認・修正してから保存する設計）

## 設計・方針

### 採用アプローチ

cabis-billing Worker に新規エンドポイント4本を追加し、フォーム受付・トークン検証・
メール送信・アーカイブを Worker 側に集約する。Firestore は Service Account 経由で
Worker のみが write、admin は Firestore SDK 直接 read（Rules で admin 限定）。

却下案:
- **Firebase Cloud Functions に setupRequestFn 追加**: メール送信が外部依存（SendGrid等）
  になり実装複雑度↑。Mail Channels（Workers 標準）の方が依存ゼロで運用負荷低。
- **クライアント直接 Firestore 書込**: 未認証 write を許可すると Turnstile 必須、
  トークン検証もクライアントだけだとボット流入リスク。Worker 経由なら一貫制御可。
- **取込処理を Worker 経由**: 一貫性↑だが、admin は既に Service Account で Firestore
  に直接書ける（Rules: admin 限定）。実装コスト削減のため取込は admin 直接実行とする。

### 個人特定情報の取扱い（最重要原則）

「会社名をサーバに保存しない」原則（companies-no-name 設計／decisions 2026-05-20）と
完全に整合させる。Worker が受け取ったペイロードを以下に振り分ける:

| データ | 取扱い |
|---|---|
| 会社名・担当者名・メール・電話 | メール本文に組み込む。Firestore には **保存しない** |
| 自由記述（その他ご要望） | メール本文に組み込む。Firestore には **保存しない** |
| 変動歩率の自由テキスト | メール本文に組み込む。Firestore には **保存しない** |
| 変動歩率の添付ファイル | メール添付に乗せる。Firestore/R2 には **保存しない** |
| 給与ルール（数値・モード等） | Firestore `companySetupRequests/{id}.config` に保存 |
| トークン | SHA-256 で hash 化した値のみ Firestore 保存。生トークンは URL/メールにのみ存在 |

中野氏が後でメールと slug をマッチさせるため、メール本文には必ず `assignedSlug` と
`requestId` を含める。中野氏は Notes.app の暗号化ノート「キャビス slug マップ」で
slug → 会社名の対応を管理する（decisions 7）。

## アーキテクチャ

```
[商談成立]
   ↓
admin.html: 📨 ヒアリングURL発行
   ↓ POST /setup-request/issue-url
Worker: slug 生成・トークン生成・hash 化・Firestore に pending 書込
   ↓ 招待URL (https://app.taxicabis.com/setup-request.html?t=<token>)
中野氏: メールで担当ドライバーに送付
   ↓
ドライバー: URL を開く
   ↓ GET /setup-request/validate-token
Worker: トークン検証
   ↓ valid なら setup-request.html がフォーム表示
ドライバー: 記入・送信
   ↓ POST /setup-request/submit (multipart/form-data)
Worker:
  - トークン再検証
  - Firestore companySetupRequests/{id} を submitted に更新（config のみ・個人特定情報なし）
  - Cloudflare Mail Channels で中野氏宛にメール送信（連絡先・自由テキスト・添付込み）
   ↓
中野氏: メール受信「📨 申請届きました (co-XXXXXX)」
   ↓
admin.html: 📥 申請レビュー
   ↓ Firestore SDK 直接 read (Rules: admin 限定)
中野氏: 「📋 取込フォームに展開」
   ↓ 既存 🏢 会社管理 UI に値を事前入力
中野氏: メール本文/添付を見ながら rateTable 等を必要に応じて修正
   ↓ 「💾 会社を保存」
admin: companies/{co-XXXXXX} 作成 (active=true) + companySetupRequests/{id} を imported に
   ↓ config フィールド削除、importedConfigSummary だけ残す
中野氏: 既存 📋 申込URLコピー機能でドライバーに `?company=co-XXXXXX` を送付
   ↓
ドライバー: Cabis に signup 可能
```

## データモデル

### Firestore: `companySetupRequests/{requestId}`

```
状態1: pending（URL発行直後・記入待ち）
  status: 'pending'
  assignedSlug: 'co-a3f7b2'
  tokenHash: '<sha256-hex>'      # 64文字、生トークンは保存しない
  createdAt: serverTimestamp
  expiresAt: serverTimestamp + 14日
```

```
状態2: submitted（ドライバー送信済み・取込待ち）
  status: 'submitted'
  assignedSlug: 'co-a3f7b2'
  tokenHash: '<sha256-hex>'      # 監査用に残す
  submittedAt: serverTimestamp
  # expiresAt: 削除
  config:
    plan: 'partner' | 'normal'
    payrollMode: 'step_rate' | 'fixed_rate'
    takeHomeRate: number
    responsibilityShifts: number
    paidLeaveAmount: number
    premiumIncentive:
      thresholdSalesExclTax: number
      amountPerShift: number
    defaultRecArea: string?       # 任意・空文字は省略
    fixedRate: number?            # payrollMode='fixed_rate' のとき
    rateTable:                    # payrollMode='step_rate' のとき
      source: 'numeric' | 'text' | 'attachment' | 'mixed'
      numeric: { ... }?           # 数値入力がある場合のみ
      hasText: boolean
      hasAttachment: boolean
```

```
状態3: imported（取込完了）
  status: 'imported'
  assignedSlug: 'co-a3f7b2'
  submittedAt: serverTimestamp
  importedAt: serverTimestamp
  importedToSlug: 'co-a3f7b2'
  importedConfigSummary:          # 監査用ダイジェスト
    payrollMode: 'step_rate' | 'fixed_rate'
    plan: 'partner' | 'normal'
  # config / tokenHash: 削除
```

```
状態4: archived（中野氏アーカイブ・取下げ）
  status: 'archived'
  assignedSlug: 'co-a3f7b2'
  archivedAt: serverTimestamp
  archivedReason: string?         # 任意
  # config / tokenHash: 削除
```

### Firestore Rules 追加

```
match /companySetupRequests/{requestId} {
  allow read: if isAdmin();
  allow write: if false;          # 全て Worker 経由（Service Account）
}
```

`isAdmin()` の判定は既存ヘルパー（user_self / mm 等の admin ユーザー UID リスト）を再利用。

## Worker エンドポイント詳細

### 1. POST /setup-request/issue-url

**入力**: なし（admin 認証ヘッダのみ）
**処理**:
1. admin 認証チェック（Cloudflare Access ヘッダ + Service Account 検証）
2. `generateSlug()` で新規 `co-XXXXXX` を生成（Firestore に既存衝突なしを確認）
3. `crypto.randomUUID()` 系で 64 文字トークン生成
4. `crypto.subtle.digest('SHA-256', token)` で hash 化
5. `companySetupRequests/{requestId}` に pending 書込
6. 返却: `{ assignedSlug, url, expiresAt, requestId }`

### 2. GET /setup-request/validate-token?t=<token>

**入力**: クエリパラメータ `t`
**処理**:
1. token を SHA-256 hash 化
2. Firestore で `tokenHash == <hash>` のドキュメントを検索
3. 検証:
   - 見つからない → `{ status: 'invalid' }`
   - `status != 'pending'` → `{ status: 'already_used' or 'archived' }`
   - `expiresAt < now` → `{ status: 'expired' }`
   - OK → `{ status: 'valid', assignedSlug, expiresAt }`
4. **個人特定情報は返さない**（フォーム側で表示する slug 以外の会社特定情報は持たせない）

### 3. POST /setup-request/submit

**入力**: multipart/form-data
- `t`: 生トークン
- `config`: JSON 文字列（given/payroll 全項目）
- `contact`: JSON 文字列（会社名/氏名/メール/電話）
- `notes`: 文字列（任意）
- `rateTableText`: 文字列（変動歩率時の自由テキスト・任意）
- `attachments`: File[] （最大3枚、合計10MB、PDF/JPG/PNG のみ）

**処理**:
1. token 再検証（窓口2 と同じロジック）
2. `config` 検証（数値範囲、必須項目、給与モードと rateTable/fixedRate の整合性）
3. 添付ファイル検証（MIME・サイズ・枚数）
4. `companySetupRequests/{id}` を submitted に更新:
   - `status: 'submitted'`
   - `submittedAt: serverTimestamp`
   - `config: <validated>`
   - `expiresAt: 削除`
5. Mail Channels API で中野氏宛メール送信:
   - From: `noreply@taxicabis.com`
   - To: `haqei64384@gmail.com`
   - Subject: `[Cabis申請] 新規ヒアリング申請が届きました (co-XXXXXX)`
   - Body: requestId / assignedSlug / 受付時刻 / contact / config（数値分）/ 自由テキスト / 添付ファイル名一覧
   - Attachments: アップロードされたファイル（Worker メモリ上で base64 化）
6. メール送信失敗時:
   - Firestore 書込は **既に完了**
   - Cloudflare Workers Log にエラーログ
   - レスポンスは 200（ドライバーには成功表示）
   - 中野氏は admin 申請レビュー画面でも検知可
7. 返却: `{ ok: true, requestId }`

### 4. POST /setup-request/archive

**入力**: `{ requestId, reason? }`
**処理**:
1. admin 認証チェック
2. `companySetupRequests/{requestId}` を `status: 'archived'` に更新
3. `config / tokenHash / その他個人特定情報` を Firestore から削除（既に submitted のみ残っている想定）
4. 返却: `{ ok: true }`

## フロントエンド構成

### setup-request.html（新規）

- 単一ページ縦スクロール、PWAではない（招待URL の都度アクセス・SW登録なし）
- 構成:
  - ヘッダー（趣旨説明・所要時間・送信先）
  - 1. 連絡先（会社名・氏名・メール・電話）※サーバには保存しない旨を明記
  - 2. 給与の決まり方（変動歩率/固定歩率/月給制ラジオ）
  - 3. 歩率（モード切替で動的表示）
    - 変動歩率: 数値入力 / 自由テキスト / 添付ファイル の3パターン（1つ以上必須）
    - 固定歩率: 固定率 数値1つ
    - 月給制: 「このフォームでは未対応 → 別途ご相談」mailto 誘導
  - 4. その他の給与設定（手取り率・責任出番数・有給1日金額）
  - 5. 売上達成インセンティブ（閾値・額・「なし」チェック）
  - 6. 営業地デフォルト（任意）
  - 7. その他ご要望・補足（任意）
  - 送信前確認（アコーディオン）
  - 送信ボタン
- エラー画面: 無効URL / 期限切れ / 既使用 / ネットワークエラー / 送信完了
- 純関数化: フォーム値検証ロジックは `js/setup-request-validate.js`（新規）に切り出し、TDD で書く

### admin.html 追加セクション

1. **📨 ヒアリングURL発行**:
   - メモ欄（localStorage 保存、サーバ非送信）
   - 「新規ヒアリングURL発行」ボタン → Worker /setup-request/issue-url 呼出 → 結果表示
   - URLコピー / slugコピー
   - 「⚠️ slug を Notes.app の暗号化ノートに記録してください」案内

2. **📥 申請レビュー**:
   - タブ: 未取込 (submitted) / 取込済 (imported) / 期限切れ (pending かつ expiresAt 過ぎ) / アーカイブ (archived)
   - 申請カード表示（assignedSlug / 受付時刻 / plan / payrollMode / 自由テキスト・添付の有無）
   - 「📋 取込フォームに展開」→ 既存 🏢 会社管理 フォームに `config` を事前入力 + slug を編集不可で表示
   - 「🗑 アーカイブ」→ Worker /setup-request/archive 呼出
   - 期限切れタブから「URL再発行」も可（issue-url を再度呼ぶ、旧 requestId は archived 化）

3. **取込フォーム拡張**:
   - 既存 `🏢 会社管理` 内 `companyForm` を取込モードでロード可能に
   - 取込モード時、保存ボタンは「💾 会社を保存 + 申請を取込完了に」と表記変更
   - 保存時:
     1. 既存 `adminSaveCompany(slug, doc)` で companies/{slug} を upsert
     2. companySetupRequests/{id} を imported に更新（importedConfigSummary 生成、config 削除）

### Worker (cabis-billing) 追加コード

- `worker/index.js` のルータに 4 つの新規パスを追加
- 既存の `routeHandlers` パターンに沿う
- 純関数: `worker/setup-request/{validate.js, mail.js, slug.js, token.js}` に分離
- 既存依存ゼロを維持（fetch + Web Crypto + Mail Channels API）

## セキュリティ

| リスク | 対策 |
|---|---|
| トークン推測 | 64文字ランダム、Firestore には SHA-256 hash のみ保存 |
| トークン流出 | URL は admin と中野氏のメール送信履歴のみ。SW キャッシュ対象外 |
| 二重送信 | submit 成功で status を submitted に。再アクセスは「既送信」表示 |
| 期限切れ濫用 | expiresAt < now で expired 表示・送信不可 |
| 添付ファイルの悪意 | MIME・拡張子・サイズ制限。Worker メモリ上のみで処理、永続化なし |
| 個人特定情報の流出 | Firestore に書かない。中野氏のメール受信箱のみ |
| admin なりすまし | Cloudflare Access PIN + Service Account 認証（既存 admin.html と同じ） |
| ボット流入 | 招待URL方式で初期は十分。将来 Turnstile を /submit に追加可（後付け可能） |

## テスト方針

### 純関数（TDD）
- `js/setup-request-validate.js` — フォーム値検証
  - 必須項目チェック、数値範囲、給与モード整合性、変動歩率の3パターン1つ以上必須
- `worker/setup-request/validate.js` — Worker 側ペイロード検証
  - フロント側検証と同じロジック + 添付ファイル MIME/サイズ
- `worker/setup-request/token.js` — トークン生成・hash 化・検証

### 結合テスト
- dev `cabis-billing-dev` Worker に対し:
  - issue-url → validate-token (valid) → submit → メール受信確認 → admin 申請レビュー表示確認 → 取込 → companies/{slug} 存在確認 → 申請 imported 化確認
  - 期限切れシナリオ（expiresAt を過去にセットして検証）
  - トークン無効シナリオ
  - 二重送信シナリオ

### 実機テスト
- dev URL を中野氏自身が踏んで全パターン記入・送信 → メール受信 → admin で取込
- 添付ファイル（PDF・JPG・PNG）の送信確認
- メール添付が正しく届くか確認

## デプロイ・運用

### 初回セットアップ

1. taxicabis.com の DNS に Mail Channels の SPF/DKIM レコード追加（**中野氏作業**）
2. Worker に `MAIL_FROM=noreply@taxicabis.com`, `MAIL_TO=haqei64384@gmail.com` 環境変数追加
3. `firestore.rules` に `companySetupRequests` ルール追加 + `firebase deploy --only firestore:rules`
4. dev → 本番の順で Worker デプロイ

### 運用

- 中野氏は admin で「未取込」タブを週1〜2回チェック（メール見落とし保険）
- アーカイブから14日経過で自動削除（cron 不要・admin 取込時にチェック）
- DNS設定（SPF/DKIM）は taxicabis.com の Cloudflare DNS で完結

## オープン項目

- **Mail Channels DNS 設定**: SPF/DKIM の具体的レコードは Cloudflare の手順に従う（実装時に確認）
- **slug 生成の重複チェック**: `companies/` と `companySetupRequests/`（pending）の両方を見て衝突回避
- **Worker での admin 認証方式**: 既存 cabis-billing は admin 用 endpoint を持たない（checkout/webhook/cancel のみ）。
  `/issue-url` `/archive` の admin 認証は新規。候補:
  (1) Cloudflare Access の JWT を Worker で検証
  (2) admin 専用 secret key を Worker に環境変数で設定し、admin.html → Worker のヘッダで送る
  (3) Firebase Auth ID Token を Worker で検証（admin UID リストと突合）
  → 実装計画で確定（既存パターンとの整合性で (3) が有力）
- **添付ファイルのウイルスチェック**: 中野氏自身のメール受信ボックスでの判断に委ねる（OS側のセキュリティ）
- **期限切れ申請の自動クリーンアップ**: 当面は admin から手動アーカイブ。スパムが増えたら自動化検討

## 関連

- onboarding playbook: `.company/secretary/notes/onboarding-playbook.md`
- マルチカンパニー段階3: `docs/superpowers/specs/2026-05-19-admin-company-management-design.md`
- 給与モード別フィールド: `docs/superpowers/specs/2026-05-19-company-payroll-mode-fields-design.md`
- decisions: `.company/secretary/notes/2026-05-20-decisions.md`（6. 完全招待制 / 7. slug 匿名識別子化）
- slug 生成純関数: `js/slug-gen.js` / テスト `tests/slug-gen.test.js`
- 既存 Worker: `worker/index.js` (cabis-billing)
- 既存会社管理: `js/admin-companies.js` / `admin.html` 「🏢 会社管理」セクション

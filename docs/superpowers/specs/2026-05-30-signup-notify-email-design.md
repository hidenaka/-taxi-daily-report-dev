# 招待登録時 admin メール通知（DB非保存）設計書

- **基準**: dev/main @ `a85e77865`、確認日 2026-05-30
- **ブランチ**: `feat/signup-notify-email`（dev clone `~/work/taxi-dev`、origin=dev）
- **目的**: 招待URL経由のアカウント登録時、氏名・電話・会社名を入力させ、**adminのCabisアドレスにメール通知**する。**PIIはFirestoreに保存しない**（サーバーは匿名のまま）。管理者は受信メール＋手元の照合表（C案: パスワード付きファイル/Notes）で「誰が誰か」を把握する。

## 背景

- 会社所属は `users/{uid}.companyId`（匿名slug）。サーバーは個人特定情報を持たない設計。
- 管理上「どの匿名userId/companyId＝どの実在ドライバーか」を知りたい。サーバーに置かず、登録のたびメールで受け取り、手元で照合表（C）に転記する。
- **同型の実績パターンが既存**: `worker/src/setup-request/`（ヒアリング申請）が、連絡先をフォーム入力→Resendで admin にメール送信し**Firestoreに保存しない**。本機能はこれを個人ドライバー登録向けに再利用する。

## スコープ

招待URL登録フォームに **氏名・電話・会社名（すべて必須）** を追加。`signUp()` 成功後、billing worker の新エンドポイント `/notify-signup` にPOST → worker が Resend で `MAIL_TO` に通知メール送信。**Firestore書き込みゼロ**。メール送信は **best-effort**（失敗してもアカウント作成は成功扱い）。

**非対象(YAGNI)**: 管理画面での受信一覧化、再送、添付、会社管理者への通知（admin=運営のみ）、PIIのDB保存、照合表(C)の自動化。

## アーキテクチャ（採用案A）

クライアント（登録フォーム）→ `signUp()` でアカウント作成 → 成功時IDトークン取得 → worker `/notify-signup` にPOST → worker が検証＋メール送信。既存 Resend基盤（`sendMail` / `MAIL_FROM` / `MAIL_TO` / `RESEND_API_KEY`）を再利用。**新規secret・新インフラ不要**。

### コンポーネント

| ユニット | 役割 | 依存 |
|---|---|---|
| `worker/src/signup-notify/body.js`（新規・純関数） | `buildSignupNotificationBody({...})` メール本文生成（DB非保存・照合表突合の注記入り） | なし |
| `worker/src/signup-notify/handler.js`（新規） | `/notify-signup` ハンドラ。IDトークン検証→入力検証→body生成→`sendMail` | body.js / 既存 mail.js / verify-id-token.js |
| `worker/src/index.js`（編集） | `POST /notify-signup` ルート追加＋CORS | handler.js |
| `js/signup-notify.js`（新規） | ペイロード組み立て＋POST（純関数 `buildNotifyPayload`/`validateSignupFields` ＋ best-effort送信 `postSignupNotify`） | なし（fetchはdev/prod base切替） |
| `login.html`（編集） | 招待登録フォームに氏名・電話・会社名（必須）を追加、`signUp()` 成功後に `postSignupNotify` 呼び出し | signup-notify.js |
| `tests/signup-notify.test.js`（新規, app側） | `buildNotifyPayload` / `validateSignupFields` の純関数テスト | run.js |
| `worker/test/...`（新規, worker側） | `buildSignupNotificationBody` の純関数テスト | worker のテスト設定 |

### `/notify-signup` 仕様（worker）

- メソッド: `POST`。CORS: 既存 `corsHeaders(env)` を適用（`ALLOWED_ORIGIN`）。OPTIONS は既存204処理。
- リクエスト: `{ idToken, userId, name, phone, companyName }`（JSON）。
- 認証: `verifyFirebaseIdToken(idToken, env.FIREBASE_PROJECT_ID)`（既存）。失敗→401。スパム防止。
- 検証: `name`/`phone`/`companyName` が非空、各 長さ上限（例 name≤50, phone≤30, companyName≤80）。userId 形式 `^[a-z][a-z0-9_]*$`。違反→400。
- companyId 補助: 可能なら `findCompanyIdByUserId(env, token, userId)`（既存, index.js）で匿名slugを引いてメールに併記（取れなければ空欄でも送信は続行）。
- 送信: `buildSignupNotificationBody(...)` → `sendMail({ apiKey: env.RESEND_API_KEY, from: env.MAIL_FROM, to: env.MAIL_TO, subject, text })`。
- レスポンス: `{ ok: true }` / エラーは `{ error }`。**Firestoreには一切書かない**。

### `buildSignupNotificationBody`（純関数, worker/src/signup-notify/body.js）

入力: `{ userId, companyId, name, phone, companyName, submittedAt }`。出力: テキスト本文。
- 「招待URLから新規ドライバー登録がありました」見出し。
- `■ 登録キー（サーバー側・匿名）: userId=..., companyId=...`
- `■ 本人記入（Firestoreには保存していません）: 氏名 / 電話 / 会社名`
- `■ 受付時刻`
- 「お手元の照合表（パスワード付きファイル/Notes）に転記してください」「slug以外の会社特定情報はサーバーに保存されません」注記。

### `js/signup-notify.js`（client）

- `validateSignupFields({name, phone, companyName})` → `{ ok, errors }`（純関数・テスト可能）。空・長さ上限を検証。
- `buildNotifyPayload({idToken, userId, name, phone, companyName})` → POST body（純関数）。
- `postSignupNotify(base, payload)` → `fetch(base + '/notify-signup', {POST})`。**best-effort**: try/catchで握りつぶし、失敗は `console.warn` のみ（呼び出し側で登録はブロックしない）。
- base は既存 `billingApiBase()` 相当（dev=cabis-billing-dev / prod=cabis-billing の workers.dev）。`subscription-state.js` のロジックを共有 or 同等関数。

### `login.html` 招待登録フォーム

- 既存の新規登録（userId＋password）に **氏名・電話・会社名（必須）** の入力を追加。招待slug必須は既存 `signUp` ガードのまま。
- 送信ハンドラ: `validateSignupFields` でクライアント検証 → `signUp(userId, password)` 成功 → `getIdToken()` → `postSignupNotify(base, buildNotifyPayload({...}))`（await はするが結果でブロックしない）→ 通常の登録完了遷移。

## データフロー

招待URL（companyId pending）→ 登録フォーム（userId/password＋氏名/電話/会社名）→ `signUp()`（Firebase, companyId は既存どおり users/{uid} に付与）→ 成功→IDトークン→ `/notify-signup` POST → worker 検証→メール送信（Resend→MAIL_TO）。**PIIはメール経路のみ**。

## エラー処理

- メール送信（POST）失敗は**登録をブロックしない**（best-effort、`console.warn`、必要なら小トースト「通知に失敗（登録は完了）」）。
- worker: 認証失敗401・検証失敗400・Resend失敗は5xxまたは`{ok:false}`を返すが、クライアントは登録完遂を優先。
- 必須未入力はクライアント側で送信前に弾く（フォーム検証）。

## テスト

- app: `validateSignupFields`（空/長さ/正常）、`buildNotifyPayload`（必要キーが揃う）を `node --test`。
- worker: `buildSignupNotificationBody`（各フィールドが本文に出る・DB非保存注記が入る）を worker のテストで。
- 手動スモーク: dev worker デプロイ後、dev 招待URLで登録→admin（MAIL_TO=haqei64384@gmail.com）にメール着信、Firestoreにdrives/userConfigsは作るが氏名/電話/会社名は保存されないことを確認。

## デプロイ（2系統）

- **worker**: `cd worker && wrangler deploy`（dev=cabis-billing-dev）→ 確認 → `wrangler deploy --env production`（本番=cabis-billing）。`RESEND_API_KEY`・`MAIL_FROM`・`MAIL_TO` は既設（setup-requestで使用中）＝**新規secret不要**。worker デプロイは Pages/タグとは別系統。
- **app**: `login.html` / `js/signup-notify.js` は通常の dev反映（`!~/work/taxi-dev/dpush.sh`）→ 本番タグ。新規js追加につき `sw.js` の `CACHE_NAME` を bump、`STATIC_FILES` に `./js/signup-notify.js` 追加。

## 確度の低い点（実装中に検証）

- `login.html` の招待登録フォームの正確な位置・`signUp` 呼び出し箇所・IDトークン取得API（`getCurrentUser().getIdToken()` 等）。
- worker のテスト実行方法（worker/ 配下に既存テストあり: header-ocr.test.js は functions側。worker/ のテスト設定を確認）。
- `findCompanyIdByUserId` の引数（worker内部のFirestore admin token取得が必要なら、companyId併記は任意=取れなければ省略）。
- 招待登録が無償会社で `/start-free` を既に叩く導線があるなら、そこに相乗りせず独立エンドポイントにする（責務分離）。

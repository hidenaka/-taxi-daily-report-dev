# 招待登録時 admin メール通知（DB非保存）設計書

- **基準**: dev/main @ `a85e77865`、確認日 2026-05-30
- **ブランチ**: `feat/signup-notify-email`（dev clone `~/work/taxi-dev`、origin=dev）
- **目的**: 招待URL経由のアカウント登録時、**氏名・電話**を入力させ、**adminのCabisアドレスにメール通知**する。**PIIはFirestoreに保存しない**（サーバーは匿名のまま）。管理者は受信メール＋手元の照合表（C案: パスワード付きファイル/Notes）で「誰が誰か」を把握する。

## 背景

- 会社所属は `users/{uid}.companyId`（匿名slug）。サーバーは個人特定情報を持たない設計。
- 管理上「どの匿名userId/companyId＝どの実在ドライバーか」を知りたい。サーバーに置かず、登録のたびメールで受け取り、手元で照合表（C）に転記する。
- **同型の実績パターンが既存**: `worker/src/setup-request/`（ヒアリング申請）が、連絡先をフォーム入力→Resendで admin にメール送信し**Firestoreに保存しない**。本機能はこれを個人ドライバー登録向けに再利用する。

## スコープ

招待URL登録フォームに **氏名・電話（必須）＋利用目的の同意（必須チェック）** を追加。`signUp()` 成功後、billing worker の新エンドポイント `/notify-signup` にPOST → worker が Resend で `MAIL_TO` に通知メール送信。**Firestore書き込みゼロ**。メール送信は **best-effort**（失敗してもアカウント作成は成功扱い）。

**会社名は集めない**（`companyId`/slug＋手元の照合表で会社は分かる＝冗長PIIを削減）。

**非対象(YAGNI)**: 管理画面での受信一覧化、再送、添付、会社管理者への通知（admin=運営のみ）、PIIのDB保存、照合表(C)の自動化、クライアント暗号化（将来の選択肢）。

## 個人情報保護（プライバシー設計）— 本機能の前提条件

「製品DBに置かない」だけでは不十分。氏名・電話を集める時点で個人情報取扱事業者の義務が発生し、PIIはメール経路（Resend＝米国／Gmail）に残る。以下を**実装の必須要件**とする。

1. **収集時の利用目的の明示＋同意（必須）**: 登録フォームに「氏名・電話を、本人確認・連絡・会社照合のために取得し、運営へメール通知する。Firestore（製品DB）には保存しない。送信に Resend（米国）を利用する」旨を表示し、**同意チェックボックス（未チェックでは送信不可）**。`legal/privacy.html` に同趣旨を追記し、フォームからリンク。
2. **Worker でのPIIログ禁止（必須）**: `/notify-signup` ハンドラはペイロード（氏名・電話）を `console.log` 等で出力しない。エラーログにも本文を含めない（ログ＝漏洩経路）。
3. **データ最小化（必須）**: 集めるのは **氏名・電話のみ**。会社名・生年月日等は集めない。
4. **保持・削除の運用（運用ルールとして spec/README に明記）**: 受信メールは照合表(C)へ転記後に削除する運用。Resend 側の保持期間を把握。本人からの削除依頼に応じる窓口を privacy.html に記載。
5. **第三者委託の明示**: Resend（米国・越境移転）／Gmail を委託先として privacy.html に記載。

（注：法的厳密性は専門家確認を前提。本 spec は設計上の安全策を定義する。）

## アーキテクチャ（採用案A）

クライアント（登録フォーム）→ `signUp()` でアカウント作成 → 成功時IDトークン取得 → worker `/notify-signup` にPOST → worker が検証＋メール送信。既存 Resend基盤（`sendMail` / `MAIL_FROM` / `MAIL_TO` / `RESEND_API_KEY`）を再利用。**新規secret・新インフラ不要**。

### コンポーネント

| ユニット | 役割 | 依存 |
|---|---|---|
| `worker/src/signup-notify/body.js`（新規・純関数） | `buildSignupNotificationBody({...})` メール本文生成（DB非保存・照合表突合の注記入り） | なし |
| `worker/src/signup-notify/handler.js`（新規） | `/notify-signup` ハンドラ。IDトークン検証→入力検証→body生成→`sendMail`。**PIIをログしない** | body.js / 既存 mail.js / verify-id-token.js |
| `worker/src/index.js`（編集） | `POST /notify-signup` ルート追加＋CORS | handler.js |
| `js/signup-notify.js`（新規） | `validateSignupFields`/`buildNotifyPayload`（純関数）＋ best-effort送信 `postSignupNotify` | なし |
| `login.html`（編集） | 招待登録フォームに 氏名・電話（必須）＋利用目的同意チェック を追加、`signUp()` 成功後に `postSignupNotify` 呼び出し | signup-notify.js |
| `legal/privacy.html`（編集） | 利用目的・委託先(Resend/Gmail)・削除依頼窓口を追記 | — |
| `tests/signup-notify.test.js`（新規, app側） | `buildNotifyPayload` / `validateSignupFields`（同意未チェック/空/長さ）の純関数テスト | run.js |
| `worker/test/...`（新規, worker側） | `buildSignupNotificationBody` の純関数テスト | worker のテスト設定 |

### `/notify-signup` 仕様（worker）

- メソッド: `POST`。CORS: 既存 `corsHeaders(env)`（`ALLOWED_ORIGIN`）。OPTIONS は既存204処理。
- リクエスト: `{ idToken, userId, name, phone }`（JSON）。**会社名は含めない**。
- 認証: `verifyFirebaseIdToken(idToken, env.FIREBASE_PROJECT_ID)`（既存）。失敗→401。スパム防止。
- 検証: `name`/`phone` 非空、長さ上限（name≤50, phone≤30）。userId 形式 `^[a-z][a-z0-9_]*$`。違反→400。
- companyId 補助: 可能なら `findCompanyIdByUserId(env, token, userId)`（既存, index.js）で匿名slugを引きメールに併記（取れなければ省略・送信は継続）。
- 送信: `buildSignupNotificationBody(...)` → `sendMail({ apiKey: env.RESEND_API_KEY, from: env.MAIL_FROM, to: env.MAIL_TO, subject, text })`。
- レスポンス: `{ ok: true }` / エラーは `{ error }`。**Firestoreには一切書かない／PIIをログしない**。

### `buildSignupNotificationBody`（純関数, worker/src/signup-notify/body.js）

入力: `{ userId, companyId, name, phone, submittedAt }`。出力: テキスト本文。
- 「招待URLから新規ドライバー登録がありました」見出し。
- `■ 登録キー（サーバー側・匿名）: userId=..., companyId=...`
- `■ 本人記入（Firestoreには保存していません）: 氏名 / 電話`
- `■ 受付時刻`
- 「お手元の照合表（パスワード付きファイル/Notes）に転記後、本メールは削除してください」注記。

### `js/signup-notify.js`（client）

- `validateSignupFields({name, phone, consent})` → `{ ok, errors }`（純関数）。空・長さ上限・**同意未チェックを不可**。
- `buildNotifyPayload({idToken, userId, name, phone})` → POST body（純関数）。会社名・consent はペイロードに含めない（consentは送信可否のゲートのみ）。
- `postSignupNotify(base, payload)` → `fetch(base + '/notify-signup', {POST})`。**best-effort**: try/catchで握りつぶし、失敗は `console.warn`（PII本文はログしない）。
- base は既存 `billingApiBase()` 相当（dev=cabis-billing-dev / prod=cabis-billing）。

### `login.html` 招待登録フォーム

- 既存の新規登録（userId＋password）に **氏名・電話（必須）＋利用目的の説明文＋同意チェック（必須）** を追加。招待slug必須は既存 `signUp` ガードのまま。**会社名欄は追加しない**。
- 送信ハンドラ: `validateSignupFields`（同意含む）→ `signUp(userId, password)` 成功 → `getIdToken()` → `postSignupNotify(base, buildNotifyPayload({...}))`（await はするが結果でブロックしない）→ 通常の登録完了遷移。

## データフロー

招待URL（companyId pending）→ 登録フォーム（userId/password＋氏名/電話＋同意）→ `signUp()`（Firebase, companyId は既存どおり users/{uid} に付与）→ 成功→IDトークン→ `/notify-signup` POST → worker 検証→メール送信（Resend→MAIL_TO）。**PIIはメール経路のみ。DB・ログには残さない。**

## エラー処理

- 同意未チェック・必須未入力はクライアント側で送信前に弾く（フォーム検証）。
- メール送信（POST）失敗は**登録をブロックしない**（best-effort、`console.warn`、必要なら小トースト「通知に失敗（登録は完了）」）。
- worker: 認証失敗401・検証失敗400・Resend失敗は `{ok:false}`/5xx を返すが、クライアントは登録完遂を優先。

## テスト

- app: `validateSignupFields`（空/長さ/**同意未チェック**/正常）、`buildNotifyPayload`（必要キーが揃う・会社名やconsentを含まない）を `node --test`。
- worker: `buildSignupNotificationBody`（各フィールドが本文に出る・DB非保存/削除依頼注記が入る・会社名フィールドが無い）を worker のテストで。
- 手動スモーク: dev worker デプロイ後、dev 招待URLで登録→admin（MAIL_TO）にメール着信、Firestoreに氏名/電話が保存されないこと＋Worker ログにPIIが出ないことを確認。

## デプロイ（2系統）

- **worker**: `cd worker && wrangler deploy`（dev=cabis-billing-dev）→ 確認 → `wrangler deploy --env production`（本番=cabis-billing）。`RESEND_API_KEY`・`MAIL_FROM`・`MAIL_TO` は既設＝**新規secret不要**。worker デプロイは Pages/タグとは別系統。
- **app**: `login.html` / `js/signup-notify.js` / `legal/privacy.html` は通常の dev反映（`!~/work/taxi-dev/dpush.sh`）→ 本番タグ。新規js追加につき `sw.js` の `CACHE_NAME` を bump、`STATIC_FILES` に `./js/signup-notify.js` 追加。

## 確度の低い点（実装中に検証）

- `login.html` の招待登録フォームの正確な位置・`signUp` 呼び出し箇所・IDトークン取得API（`getCurrentUser().getIdToken()` 等）。
- worker のテスト実行方法（worker/ のテスト設定を確認）。
- `findCompanyIdByUserId` の引数（worker内部のFirestore admin token取得が必要なら、companyId併記は任意=取れなければ省略）。
- `legal/privacy.html` の既存構成（追記箇所）。

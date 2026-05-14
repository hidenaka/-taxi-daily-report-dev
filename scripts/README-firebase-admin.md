# Firebase Admin CLI 管理スクリプト

`adminUids` コレクションを CLI で管理するためのスクリプト群。

## 事前準備 (初回のみ)

### 1. firebase-admin SDK のインストール

```bash
npm install
```

(devDependencies に `firebase-admin` が含まれる)

### 2. gcloud CLI のインストール (まだなら)

```bash
brew install --cask google-cloud-sdk
```

### 3. Application Default Credentials のセットアップ

```bash
gcloud auth application-default login
```

- ブラウザが開く
- Google アカウントでログイン (Firebase プロジェクトのオーナーアカウント)
- 完了すると `~/.config/gcloud/application_default_credentials.json` に保存される

## スクリプト一覧

### 1. admin UID を登録

```bash
node scripts/setup-admin-uid.mjs <email>
```

例:

```bash
# dev環境 (default)
node scripts/setup-admin-uid.mjs admin@taxi.local

# 本番環境 (明示)
node scripts/setup-admin-uid.mjs admin@taxi.local --project=taxi-dailydata
```

### 2. 登録済み admin 一覧

```bash
node scripts/list-admin-uids.mjs
node scripts/list-admin-uids.mjs --project=taxi-dailydata
```

### 3. admin を削除

```bash
node scripts/remove-admin-uid.mjs <email-or-uid>
```

例:

```bash
node scripts/remove-admin-uid.mjs admin@taxi.local
node scripts/remove-admin-uid.mjs abc123XYZ...
```

## トラブルシューティング

### `Could not load the default credentials`

→ `gcloud auth application-default login` を実行。

### `The email "..." was not found in Firebase Auth`

→ admin 用ユーザーをアプリの「管理者ツール」または `createUserWithEmailAndPassword` で先に作成する必要がある。

### `Error: Project not found`

→ `--project=...` の指定を確認。`firebase projects:list` で正しいID を確認できる。

### `PermissionDenied: Caller does not have required permissions`

→ ログインしている Google アカウントが Firebase プロジェクトのオーナー or 編集者であることを確認。
   Firebase Console → プロジェクトの設定 → ユーザーと権限。

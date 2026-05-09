# タクシー日報分析

個人タクシー乗務員のための日報管理PWA。OCR済みテキストから売上集計・歩率計算・天候記録を自動化。

## セットアップ
1. GitHub Personal Access Token を発行(`repo` 権限)
2. `settings.html` を開いてトークンとデータリポジトリを設定
3. 「ユーザー」セクションで自分のユーザー ID(例: `user_self`)を保存
4. `data/config/{userId}.json` のレートテーブルとデフォルト値を確認

## 開発
- ユニットテスト: `npm test` (= `node --test tests/*.test.js`)
- ローカル起動: `python3 -m http.server 8000` または `npx serve`

詳細仕様は `docs/superpowers/specs/` を参照。

---

## マルチユーザー対応(2026-04-27 追加)

複数人で同じデータリポジトリを共有して、営業サポート(需要パターン)の集計精度を高められます。

### データ構造

| パス | 内容 |
|---|---|
| `data/drives/{userId}/YYYY-MM-DD.json` | 乗務データ(ユーザー別フォルダ) |
| `data/config/{userId}.json` | 各ユーザーの設定 |
| `data/users.json` | 集計対象のアクティブユーザー一覧 |

### スコープ

| 機能 | データソース |
|---|---|
| 個人パフォーマンス(収入・効率・時給など) | 各ユーザー独立(自分のみ) |
| ペース参考カード | 自分のみ |
| 曜日×時間 効率ヒートマップ | 自分のみ |
| 推奨検索 / 高期待値エリア / 降車エリア別 / 履歴 | 全員データ統合 |
| 近隣エリアマップ | 全員データ統合 |

### 安全性

書き込み API (`saveDrive`, `saveConfig`) は内部で必ず自分の `userId` を解決するため、他人のフォルダへの誤書き込みは構造的に不可能です。

### 知人を追加する手順(運営者向け)

1. `data/users.json` に新ユーザーを追記:
   ```json
   { "userId": "user_X", "displayName": "...", "active": true }
   ```
2. 共有 PAT を発行(または既存 PAT を共有)
3. 知人に `docs/setup-for-collaborator.md` を渡す
4. 知人本人が手動で OCR する場合: `docs/ai-prompt-template.md` も渡す

### 知人の写真をまとめて取込む(運営者向け)

過去分(初期データ)を Gemini Web 経由でテキスト化 → bulk push する手順は `docs/admin-bulk-import.md` を参照。

`scripts/admin-bulk-push.mjs` 一発で users.json 登録 + 全日 push まで完結する。

```bash
GITHUB_TOKEN=$(gh auth token) DATA_REPO=owner/taxi-daily-report-data \
  node scripts/admin-bulk-push.mjs --user user_X --display "Xさん"
```

知人本人の **日次運用** は別経路: `docs/setup-for-collaborator.md`(本人がアプリの入力画面ペーストモードから push)。

### マイグレーション(既存データを userId フォルダに移動)

```bash
GITHUB_TOKEN=ghp_xxx DATA_REPO=owner/taxi-daily-report-data \
  node scripts/migrate-to-userid.mjs --dry-run
# 問題なければ --dry-run を外して本実行
```

idempotent(再実行安全)で、元ファイルは削除しません(ロールバック保険)。

---

## 関連ドキュメント

- `docs/superpowers/specs/2026-04-27-multi-user-support-design.md` — マルチユーザー設計仕様
- `docs/superpowers/plans/2026-04-27-multi-user-support-plan.md` — 実装計画
- `docs/ai-prompt-template.md` — 知人本人向け AI 変換プロンプト
- `docs/setup-for-collaborator.md` — 知人向けセットアップ手順書

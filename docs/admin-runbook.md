# 管理者ランブック

このアプリの**運営者(管理者)**が、システムを健全に保つ・新規ユーザーを追加する・アプリを更新するためのプロセス記録。

---

## 環境メモ

| 項目 | 内容 |
|---|---|
| PWA リポ(public) | https://github.com/hidenaka/taxi-daily-report (= GitHub Pages配信元) |
| データリポ(private) | https://github.com/hidenaka/taxi-daily-report-data |
| PWA URL | https://hidenaka.github.io/taxi-daily-report/ |
| 公開先 | GitHub Pages (push後 1〜2分でビルド・反映) |
| ローカル作業ディレクトリ | iCloud Drive `タクシー乗務アプリ/タクシー日報/` (git管理外) |
| デプロイ用 git クローン | `/tmp/taxi-deploy/taxi-daily-report` (毎回再生成可) |
| 認証 | `gh auth login` 済み(hidenaka アカウント) |

**重要**: ローカル作業ディレクトリは git 管理外。コード変更は別途 `/tmp/taxi-deploy/` のクローンへ rsync → commit → push する必要がある。

---

## 1. 新規ユーザー追加(初回フロー)

### 必要情報
- 知人の希望 userId(英小文字+数字+_、例: `user_aaa`)
- 知人の表示名(例: `Aさん`)
- 過去日報の写真(初期投入用、任意)

### 手順

#### Step 1. 知人用 PAT を発行

知人は GitHub アカウントを作成せず、管理者が発行した PAT をアプリに貼り付ける方式で運用します。

1. GitHub で自身のアカウントにログイン → 右上アイコン → **Settings** → **Developer settings** → **Personal access tokens** → **Fine-grained tokens** → **Generate new token**
2. 入力項目:
   - **Token name**: `taxi-app-user-xxx` (知人の userId が分かる名称)
   - **Expiration**: `1 year` (切れたら再発行)
   - **Description**: 知人の名前等を記載 (管理用メモ)
3. **Repository access** → `Only selected repositories` → `taxi-daily-report-data` を選択
4. **Permissions** → Repository permissions → **Contents** を `Read and write`
5. ページ最下部の **Generate token** をクリック
6. 表示された **`ghp_xxxxxx...`** を **すぐコピー** (画面を閉じると二度と見られません)
7. LINE 等で知人に送信

> 管理者は各知人の PAT を発行・失効・再発行の責任を負います。発行した PAT は自分のメモに保管しておくか、GitHub のトークン一覧から参照します。
> 知人が PAT を紛失したり有効期限が切れたりしたら、同じ手順で再発行して送り直します。

#### Step 2. 過去日報の一括取込み(任意)

知人から写真を受け取った場合のみ:

1. `data/paste-here.txt` を空にする
2. ローカルで `open data/paste-here.txt`(TextEdit)
3. **自分の Gemini Web で** 写真+プロンプト(`docs/ai-prompt-template.md` 参照)を投げる
4. 出力テキストを `paste-here.txt` にペースト&保存
5. 検証:
   ```bash
   node scripts/validate-pasted-bulk.mjs
   ```
   - パース失敗0、重複日付の同一性、キャンセル統計、車種推論結果を確認
6. 問題なければ push:
   ```bash
   GITHUB_TOKEN=$(gh auth token) DATA_REPO=hidenaka/taxi-daily-report-data \
     node scripts/admin-bulk-push.mjs --user user_X --display "Xさん"
   ```
   - 車種を上書きしたい日があれば: `--override 2026-01-20:premium,2025-10-08:japantaxi`
   - 最初は `--dry-run` で予定確認推奨
7. このスクリプトが users.json への追加も自動で行う

#### Step 3. 知人を users.json に登録(写真がない場合のみ)

`admin-bulk-push.mjs` を実行しなかった場合のみ手動追加:

```bash
gh api repos/hidenaka/taxi-daily-report-data/contents/data/users.json --jq '.content' | base64 -d > /tmp/users.json
# /tmp/users.json を編集して新規エントリ追加
# {"users":[{"userId":"user_X","displayName":"Xさん","active":true}, ...]}
# その後 GitHub Web UI で再アップロード or scripts/repair-users-json.mjs 流用
```

#### Step 4. 知人にセットアップ手順を渡す

`docs/setup-for-novice.md` を案内(LINE等で送る)。必要情報をセットで:
- PWA URL: `https://hidenaka.github.io/taxi-daily-report/`
- データリポ名: `hidenaka/taxi-daily-report-data`
- userId: `user_X`(Step 2 or 3 で登録したもの)
- PAT: Step 1 で発行した `ghp_xxx...`

知人本人がセットアップ後、テスト日報を1件入力 → 翌日反映確認すれば完了。

---

## 2. 継続: 知人の追加日報を取込む

知人本人が PWA で push できる前提なら不要。
できないとき(写真だけ送ってきた等)は **1.Step 2 と同じ手順** を再実行。`admin-bulk-push.mjs` は idempotent なので既存日付は上書き、新規日付は追加される。

---

## 3. PWA(コード)の更新を反映する

iCloud のローカル作業ディレクトリで編集 → `taxi-daily-report` リポへ push → GitHub Pages 自動デプロイ。

```bash
# 1. デプロイ用クローンを最新化
mkdir -p /tmp/taxi-deploy && cd /tmp/taxi-deploy
[ -d taxi-daily-report ] && rm -rf taxi-daily-report
gh repo clone hidenaka/taxi-daily-report
cd taxi-daily-report
git config user.email "...@..."
git config user.name "..."

# 2. iCloud から rsync(データファイルは除外)
SRC="/Users/hideakimacbookair/Library/Mobile Documents/com~apple~CloudDocs/タクシー乗務アプリ/タクシー日報"
rsync -av --exclude='.git' --exclude='node_modules' \
  --exclude='data/paste-here.txt' --exclude='data/paste-here-validated.json' \
  --exclude='data/friend_report_texts' \
  "$SRC/" ./

# 3. テスト
npm test  # 必要なら

# 4. SW cache version を bump(JS/HTML 変更時は必須)
# sw.js の CACHE_NAME 'taxi-daily-vNN' を +1

# 5. commit + push
git add -A
git commit -m "feat: ..."
git push origin main

# 6. ブラウザで確認
# - 1〜2分後 https://hidenaka.github.io/taxi-daily-report/ をハードリロード
# - SW 更新されない時は DevTools > Application > Service Workers > Unregister
```

**ハマりどころ**: SW cache version を bump し忘れると、ブラウザがJS/HTMLを古いまま使い続ける。**JS/HTML を1文字でも変えたら sw.js も bump**。

---

## 4. データリポの修復(まれ)

users.json が壊れた・誰かが間違えて他人フォルダに書込んだ等のレアケース:

```bash
# users.json 形式修復
GITHUB_TOKEN=$(gh auth token) DATA_REPO=hidenaka/taxi-daily-report-data \
  node scripts/repair-users-json.mjs
# → user_self + user_mm を含む正しい {users:[...]} 形式に上書き
```

データの誤書込みは git history (data リポ) から復旧可能。

---

## 5. 仕様メモ(仕様書を読まずに済むように)

### 5.1 キャンセル判定

`js/parser.js` で以下を自動キャンセル扱い(売上¥0):

- 行頭が **「キ」**(明示マーカー)
- **金額 = ¥400**(無条件)
- **金額 = ¥500 + 走行距離 0km**
- **金額 = ¥1,000 + 走行距離 0km**

走行距離0kmで乗降同所だが金額が上記以外(待機料金等)は **キャンセル扱いにしない**(ユーザー要望)。

### 5.2 車種(premium/japantaxi)自動判定(管理者一括取込み時のみ)

`scripts/admin-bulk-push.mjs` と `bulk-input.html` の `inferVehicleType`:

1. ヘッダー `車種:` に値があれば優先
2. なければ自動推論:
   - 1件でも `迎` 列に **「ア」(アプリ配車)** があれば → **japantaxi** 確定
   - そうでなければ 迎車比率 ≥ 70% → **premium**、それ未満 → **japantaxi**

入力画面(`input.html`)では auto-infer は走らず、ユーザーがドロップダウンで選択。

### 5.3 重複日付処理(admin-bulk-push.mjs)

paste-here.txt に同じ日付が複数回出てきた場合:
- 完全一致(trips/出庫/帰庫すべて同じ) → 1つに統合
- 内容相違あり → push中止しエラー報告(paste-here.txt を直して再実行)

### 5.4 ストレージパス

| 内容 | パス |
|---|---|
| ユーザー一覧 | `data/users.json` (形式: `{users:[{userId,displayName,active}]}`) |
| 各ユーザーの設定 | `data/config/{userId}.json` |
| 各ユーザーの乗務 | `data/drives/{userId}/YYYY-MM-DD.json` |

### 5.5 営業サポート画面のスコープ

| カード | データソース |
|---|---|
| 出庫ペース参考 | 自分のみ |
| 曜日 × 時間 ¥/h | タブで自分のみ/全員統合切替(休憩除外実稼働ベース) |
| 推奨検索 / 高期待値 / 降車エリア別 | 全員統合 |
| 履歴の「他」グレーバッジ | 自分以外のtrip(全員統合カードで表示) |

---

## 6. トラブル一覧

| 症状 | 原因 | 対処 |
|---|---|---|
| PWA に最新コードが反映されない | SW cache 版が古い | sw.js の CACHE_NAME bump 忘れ → +1 して再push |
| `zsh: event not found` | tokenの `!` を履歴展開した | `export GITHUB_TOKEN='...'` でsingle quote |
| `★ 相違ある重複: ...` | paste-here.txt に同日異内容 | 片方削除 or どちらが正しいか確認 |
| `users.json` が flat array | 古いスクリプトが上書き | `node scripts/repair-users-json.mjs` |
| 401/403 in API call | tokenの権限不足 | Fine-grained PAT で Contents=Read+Write 確認 |
| 写真が `アプリ車` だらけなのに premium 推論 | ア列を読み取れていない | プロンプトに「迎の列に ア があればその文字列をそのまま出力」と追記 |

---

## 7. パスワードを忘れたユーザーへの対応（現行: Firebase Auth）

> 本アプリはメールアドレス・電話番号を保存していないため、Firebase 標準の「リセットメール送信」は使えない。運営が本人確認したうえで手動リセットする。**個人情報は新たに集めない**方針。

### 受付（login.html の案内）
パスワードを忘れたユーザーには、`cabis@taxicabis.com` 宛に以下を**最初のメールで全部**書いて送ってもらう（往復を減らすため）:
- ログインID（覚えている範囲で）
- 所属の会社名
- 最後に乗務した日（だいたいで可）
- その日のおおよその営業収入

### 本人確認の判定基準
「最後に乗務した日」と「その日のおおよその営業収入」が、記録と**ざっくり**合えばOK。
金額の1円単位一致は求めない（本人でも思い出せず弾かれるため）。なりすまし対策は「直近の乗務日＋売上の概数を他人は知らない」ことで担保する。

### 手順

```bash
# 1) 本人確認: 直近の日報（日付＋営業収入概算）を表示（リセットしない）
node scripts/reset-password.mjs <ログインID>

# 2) 申告とざっくり合致したら、新パスワードを設定（8文字以上）
node scripts/reset-password.mjs <ログインID> <新パスワード>

# 本番に対して実行する場合は --project を明示
node scripts/reset-password.mjs <ログインID> <新パスワード> --project=taxi-dailydata
```

- 既定は dev（`taxi-dailydata-dev`）。**本番は必ず `--project=taxi-dailydata`** を付ける。
- 設定後、新パスワードを本人に伝え、ログイン後に本人で変更してもらう。
- ログインIDが分からない場合: 会社名で `drives/` 配下を探すか、Firebase Console の Authentication でユーザー一覧を確認。

事前準備は `scripts/README-firebase-admin.md`（`npm install` + `gcloud auth application-default login`）。

---

## 8. 今後の拡張候補

- 知人本人がアプリから自分のデータを削除する経路(現状は管理者のみ可)
- displayName の変更 UI(現状は users.json 手編集)
- 退会フロー(active: false 切替 + データ archive)
- 過去 root-level の `data/drives/*.json` 削除(マイグレーション保険として残置中)
- 知人本人が `data/config/{userId}.json` を持っていない場合のデフォルト config 作成 UI

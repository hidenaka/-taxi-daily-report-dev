# セッション引継ぎ: 2026-07-08 10:06

## 現在のタスク
羽田空港の画像計測由来データを使い、各乗り場の平均的な列移動傾向を見られる新しい空港ツールページを追加。実装・ローカル検証まで完了し、dev 反映用の commit 前状態。

## 完了済み
- [x] `tools/data/advance-forecast.json` の `slots` / `actualsToday` / `rowWidth` を使う方針を確認。
- [x] 新ページ `tools/noriba-trends.html` を追加。
- [x] 集計・描画ロジック `tools/js/noriba-trends.js` を追加。
- [x] 到着便ページ `tools/arrivals.html` に「乗り場傾向」タブを追加。
- [x] `sw.js` の `CACHE_NAME` を `v324` に更新し、新 HTML/JS をプリキャッシュ対象に追加。
- [x] `tests/noriba-trends.test.js` を追加し、傾向ビン変換・台数換算・乗り場別サマリー・朝昼夕夜集計を回帰テスト化。
- [x] ローカルサーバーで `tools/noriba-trends.html` / `tools/js/noriba-trends.js` / `tools/data/advance-forecast.json` が 200 で取得できることを確認。

## 未完了・次のアクション（優先順）
- [ ] 今回の変更を必要ファイルだけ commit し、dev `main` へ push。
- [ ] dev Pages で `https://hidenaka.github.io/-taxi-daily-report-dev/tools/noriba-trends.html` を開き、ページ表示と「回数/台数」切り替えを確認。
- [ ] 本番反映が必要ならタグ push で prod へ同期し、本番 `tools/noriba-trends.html` を確認。

## 重要な決定事項
- 初期版は新しいデータ生成パイプラインを増やさず、既存の `advance-forecast.json` を使う。
- `slots` は平均傾向、`actualsToday` は今日実測、`rowWidth` は列移動回数から推定台数への換算に使う。
- 朝=5-11時、昼=11-16時、夕方=16-21時、夜=21-5時で時間帯集計する。
- Service Worker は cache-first なので、新ページ追加時も `CACHE_NAME` bump と `STATIC_FILES` 登録を行う。

## 既知の問題・注意点
- 現在の作業ブランチは `fix/pages-deploy-retry` で、追跡先は `dev/main`。プロジェクト指示上は `main` 作業だが、このブランチは現在 `dev/main` と同じ先端から作業している。
- `CLAUDE.md`、`ocr-spike/`、`tmp/` は未追跡だが今回の作業対象外。
- ローカルの `tools/data/advance-forecast.json` は古いサンプルの可能性があるため、公開環境では配信済みの最新 JSON で確認する。

## 関連ファイル（現在の状態付き）
- `tools/noriba-trends.html`: 新規追加。乗り場傾向ページ本体。
- `tools/js/noriba-trends.js`: 新規追加。傾向データ変換、乗り場別サマリー、時間帯集計、画面描画。
- `tests/noriba-trends.test.js`: 新規追加。純粋関数の回帰テスト。
- `tools/arrivals.html`: 空港ツール内に「乗り場傾向」タブを追加。
- `sw.js`: `v324` に更新し、新ページと新 JS を `STATIC_FILES` に追加。
- `SESSION.md`: この引継ぎを先頭に追記。

## 検証コマンド / 動作確認手順
```bash
node --test tests/noriba-trends.test.js
node --test tests/noriba-trends.test.js tests/forecast-section.test.js
npm test
node --test tests/noriba-trends.test.js tests/sw-precache-imports.test.js tests/help-video-sw.test.js
node --check tools/js/noriba-trends.js
python3 -m http.server 8000
curl -s -o /tmp/noriba-trends.html -w "%{http_code} %{size_download}\n" http://localhost:8000/tools/noriba-trends.html
curl -s -o /tmp/noriba-trends.js -w "%{http_code} %{size_download}\n" http://localhost:8000/tools/js/noriba-trends.js
curl -s -o /tmp/advance-forecast.json -w "%{http_code} %{size_download}\n" http://localhost:8000/tools/data/advance-forecast.json
```

---

# セッション引継ぎ: 2026-07-06 19:24

## 現在のタスク
`test20260706 / 11111111` の無償利用開始が反映されない件の続行と、ログインID登録で先頭数字を拒否する不具合の修正。Worker 側の `/start-free` は本番へ反映済みで、`test20260706` への直接 `/start-free` は `{"ok":true}` 済み。今回追加で、静的アプリ側の userId 検証を「英小文字または数字始まり」に統一し、Service Worker キャッシュ版数も更新。

## 完了済み
- [x] `js/userid.js` の `isValidUserId()` を数字始まり許可へ変更。
- [x] `login.html` の signup 入力 `pattern`、`SUID_RE`、画面文言を数字始まり許可へ変更。
- [x] `js/firebase-auth.js` の signup / localStorage / view-as / setUserId 検証を共通 `USER_ID_RE` に統一。
- [x] `js/invite-url.js` と `js/admin-companies.js` の紹介者 `ref` 検証を数字始まり許可へ変更。
- [x] `worker/src/signup-notify/handler.js` に `isValidSignupNotifyUserId()` を追加し、通知側の userId 検証も数字始まり許可へ変更。
- [x] `settings.html`、`admin-settings.html`、`js/firebase-storage.js`、`js/storage-github.js`、`js/admin-invite.js`、`scripts/import-friend-report.mjs` の関連検証/文言を更新。
- [x] `sw.js` の `CACHE_NAME` を `v323` に更新。
- [x] RED確認: 数字始まり userId/ref の追加テストが旧実装で失敗することを確認。
- [x] GREEN確認: 関連 80 件 pass、構文チェック pass、全体 `npm test` 909 件 pass。

## 未完了・次のアクション（優先順）
- [ ] 今回の変更を必要ファイルだけ commit し、dev `main` へ push。
- [ ] dev Pages で `login.html` / `sw.js` 更新到達を確認。
- [ ] 本番反映が必要ならタグ push で prod へ同期し、本番 `login.html` / `sw.js` 更新到達を確認。
- [ ] 公開環境で `test20260706 / 11111111` にログインし、サブスク状態が active/free として扱われることを確認。

## 重要な決定事項
- userId の新ルールは「先頭は英小文字または数字、以降は英小文字・数字・アンダースコア」。大文字、記号、`_` 始まりは拒否する。
- 登録フォームは引き続き 3〜30 文字制限を維持する。
- Service Worker が静的ファイルを cache-first で返すため、HTML/JS修正時は `CACHE_NAME` bump が必須。

## 既知の問題・注意点
- 現在の作業ブランチは `fix/pages-deploy-retry` で追跡先は `dev/main`。プロジェクト指示の `main` ではないが、このブランチは `dev/main` を upstream にしている。
- `CLAUDE.md` と `ocr-spike/` は未追跡だが今回の作業対象外。
- `SESSION.md`、`worker/package.json`、`worker/src/index.js`、`tests/worker-company-resolver.test.js` は前回の Worker 無償付与修正の差分として残っている。

## 関連ファイル（現在の状態付き）
- `login.html`: signup の入力検証・表示文言を数字始まり許可へ変更済み。
- `js/firebase-auth.js`: userId 検証を `USER_ID_RE` に集約済み。
- `js/userid.js`: 中央 userId 検証を数字始まり許可へ変更済み。
- `js/invite-url.js`: 招待URL `ref` 捕捉/読込を数字始まり許可へ変更済み。
- `js/admin-companies.js`: 紹介URL生成の `ref` を数字始まり許可へ変更済み。
- `worker/src/signup-notify/handler.js`: 通知側 userId 検証ヘルパを追加済み。
- `sw.js`: `CACHE_NAME` を `taxi-daily-v323` に更新済み。
- `tests/userid.test.js`、`tests/invite-url.test.js`、`tests/admin-companies.test.js`、`tests/signup-notify-userid.test.js`: 回帰テスト追加/更新済み。

## 検証コマンド / 動作確認手順
```bash
node --test tests/userid.test.js tests/invite-url.test.js tests/admin-companies.test.js tests/signup-notify-userid.test.js
node --test tests/userid.test.js tests/invite-url.test.js tests/admin-companies.test.js tests/signup-notify-userid.test.js tests/signup-notify.test.js tests/signup-notify-body.test.js tests/worker-company-resolver.test.js
node --check js/firebase-auth.js
node --check js/userid.js
node --check js/invite-url.js
node --check js/admin-companies.js
node --check js/admin-invite.js
node --check js/firebase-storage.js
node --check js/storage-github.js
node --check worker/src/signup-notify/handler.js
node --check scripts/import-friend-report.mjs
node --check sw.js
npm test
```

---

# セッション引継ぎ: 2026-07-06 18:43

## 現在のタスク
`test20260706` が「ご利用のお申し込み（無償）」を進めても利用可能にならない不具合を修正。原因は Cloudflare Worker `/start-free` の `findCompanyIdByUserId()` が、同じ `userId` の匿名 stray `users` doc が複数あると `companyId` を解決できず `no_company` 扱いにすること。

## 完了済み
- [x] 認証・課金ルール `docs/auth-account-billing-rules.md` を確認。
- [x] `subscribe.html` → `js/subscription-state.js startFree()` → `worker/src/index.js /start-free` → `subscriptions/{userId}` の流れを確認。
- [x] TDD RED: `tests/worker-company-resolver.test.js` を追加し、匿名 stray 複数 + 本登録 doc ありで companyId を返すべきケースが失敗することを確認。
- [x] `worker/src/index.js` に `resolveCompanyIdFromUserQueryRows()` を追加し、本登録 doc（`isAnonymous !== true`）を優先して companyId を選ぶよう修正。
- [x] `findCompanyIdByUserId()` の `runQuery` から `limit: 2` を外し、匿名 stray が複数あっても本登録 doc を取りこぼさないよう修正。
- [x] `worker/package.json` に `"type": "module"` を追加し、Worker ESM テスト時の Node 警告を解消。
- [x] 関連テスト 126 件 pass、全体 `npm test` 904 件 pass を確認。
- [x] `npm run deploy -- --env=""` で dev Worker デプロイを試行したが、Cloudflare API 認証エラー（code 10000）で未反映。
- [x] Wrangler OAuth を狭いスコープ（`account:read user:read workers_scripts:write workers:write`）で再ログインし直した。
- [x] dev Worker `cabis-billing-dev` をデプロイ済み。Version ID: `bb6f74f0-3347-4997-8347-0d4e247f3e34`。
- [x] 本番 Worker `cabis-billing` をユーザー承認後にデプロイ済み。Version ID: `a576f3b4-fec7-4938-98b7-b15732ae6ebe`。
- [x] dev/prod の `/health` がどちらも `{"ok":true,"service":"cabis-billing"}` を返すことを確認。
- [x] ユーザー報告「まだ変わらない」後、本番 `/start-free` を `test20260706` で直接実行し `{"ok":true}` を確認。サーバー側の無償付与は成功済み。

## 未完了・次のアクション（優先順）
- [ ] 公開環境で `test20260706 / 11111111` にログインし、ホームや core/analysis ページに入れることをブラウザで確認。

## 重要な決定事項
- userId で `users` を検索する Worker 処理は、匿名 stray を件数エラー扱いにせず、本登録 doc を優先する。
- 本登録候補が複数ある場合は安全側で `null` にする。
- `isAnonymous` が欠落している旧 doc は本登録扱いにする。

## 既知の問題・注意点
- 現在の作業ブランチは `fix/pages-deploy-retry` で、プロジェクト指示の `main` ではない。未コミット変更もあるためブランチ切替はしていない。
- `CLAUDE.md` と `ocr-spike/` は未追跡だが今回の作業対象外。
- 既存の `SESSION.md` 変更は前セッションの内容として保持し、今回の引継ぎを先頭に追記した。
- Worker 修正は dev/prod の Cloudflare Worker に反映済み。
- 初回の dev Worker デプロイは `Authentication error [code: 10000]` で失敗したが、Wrangler OAuth 再ログイン後に解消。
- 今回はサーバー側から直接 `start-free` したため、既に開いているブラウザタブでは `sessionStorage` の `taxi_sub_cache_v1` が最大90秒古い可能性がある。タブを閉じて開き直すか、90秒後に再読み込みする。

## 関連ファイル（現在の状態付き）
- `worker/src/index.js`: `findCompanyIdByUserId()` の companyId 解決を匿名 stray 対応済み。
- `tests/worker-company-resolver.test.js`: 無償付与 companyId 解決の回帰テストを追加済み。
- `worker/package.json`: ESM 指定 `"type": "module"` を追加済み。
- `SESSION.md`: 今回の引継ぎを先頭に追記済み。

## 検証コマンド / 動作確認手順
```bash
node --test tests/worker-company-resolver.test.js
node --test tests/worker-company-resolver.test.js tests/subscription-state.test.js tests/access-control.test.js tests/invite-url.test.js tests/firebase-auth-doc.test.js
node --check worker/src/index.js
node --check js/subscription-state.js
npm test > /tmp/taxi-daily-report-npm-test.log 2>&1
tail -n 40 /tmp/taxi-daily-report-npm-test.log
npm run deploy -- --env=""
curl -s https://cabis-billing-dev.haqei64384.workers.dev/health
npm run deploy:prod
curl -s https://cabis-billing.haqei64384.workers.dev/health
curl -s -X POST https://cabis-billing.haqei64384.workers.dev/start-free -H 'Content-Type: application/json' -d '{"userId":"test20260706","agreement":{"termsVersion":"2026-05-08","privacyVersion":"2026-05-08","tokuteishouVersion":"2026-05-08"}}'
```

---

# セッション引継ぎ: 2026-07-05 16:40

## 現在のタスク
GitHub Pages deploy 失敗通知メールの抑制対応と、詳細画面「時間帯別まとめ」の列順修正に続き、空港ツールの「乗り場の動き」表示へ列移動の補充/抜け分離を追加中。バックエンド `taxi-ic-helper` は `departure` を出力済みで、日報アプリUI側がそれを表示する段階。

## 完了済み
- [x] GitHub Pages Source を `Deploy from a branch` から `GitHub Actions` に変更し、二重実行を停止。
- [x] `.github/workflows/pages.yml` を追加・修正し、Pages deploy を retry 付き custom workflow に移行。
- [x] Pages actions を `actions/configure-pages@v6`, `actions/upload-pages-artifact@v5`, `actions/deploy-pages@v5` に更新。
- [x] `chore(data): relay taxi data` の自動データ更新で Pages deploy が全 retry 後も一時失敗した場合、job を failure にせず通知メールを抑制する条件を追加。
- [x] commit `5b2d69f1` (`fix: suppress transient data pages deploy alerts`) を dev `main` に push。
- [x] 修正コミットの GitHub Actions run `28663206671` が build/deploy とも success。
- [x] 修正後の自動データ更新 run `28663338593` (`chore(data): relay taxi data 2026-07-03 22:22 JST`) が build/deploy とも success。
- [x] Pages API で `build_type: workflow` を確認。
- [x] Dependabot Updates run `28663277186` も success を確認。
- [x] prod `hidenaka/taxi-daily-report` の失敗 run `28667620763` (`f44960e`) を確認。deploy step のエラーは `Deployment failed, try again later.`。
- [x] prod `.github/workflows/pages.yml` は retry なしだったため、retry 2回 + データ更新 commit の soft-fail 条件を追加。
- [x] prod commit `5895e9e6` (`fix: suppress transient prod pages deploy alerts`) を作成。
- [x] prod run `28668161815` は初回 deploy 失敗後、`Deploy to GitHub Pages retry 1` で success。
- [x] prod の次回データ更新 run `28668452585` (`chore(data): relay taxi data 2026-07-04 00:00 JST`) が build/deploy とも success。
- [x] 詳細画面「時間帯別まとめ」で、9時台出庫時に `0-5時` と `19-0時(翌)` の列順が逆になる問題を修正。
- [x] `getShiftZones('09:05')` の回帰テストを追加し、期待順 `9-14時`, `14-19時`, `19-0時(翌)`, `0-5時` を確認。
- [x] dev commit `60f22ba6` (`fix: keep shift period columns chronological`) を push。
- [x] dev Pages run `28723314710` が build/deploy とも success。
- [x] production tag `v2026.07.05-period-order` を push。
- [x] production sync run `28723351562` が success。
- [x] prod Pages run `28723355392` が build/deploy とも success。
- [x] `tools/js/forecast-section.js` の `renderMovement()` で `departure` がある新JSONの場合のみ「補充 N」「抜け N」を分離表示するよう変更。
- [x] `tools/arrivals.html` の `#stall-movement-block` CSS に4列表示用の幅と `sm-departure` を追加。
- [x] `tests/forecast-section.test.js` に `departure` 表示、台数換算、旧JSON互換のテストを追加。
- [x] `sw.js` の `CACHE_NAME` を `v321` に更新。
- [x] TDD RED: 追加テスト2件が期待どおり失敗することを確認。
- [x] GREEN: `node --test tests/forecast-section.test.js tests/sw-precache-imports.test.js` が 35 pass / 0 fail。
- [x] フルテスト `npm test` が 903 pass / 0 fail。
- [x] Kimi WebBridge でローカル `tools/arrivals.html` を開き、`advance-forecast.json generatedAt=2026-07-05T16:26:00+09:00` の `departure` が「補充」「抜け」として表示されることを確認。
- [x] 320px幅相当で `#stall-movement-block` の `scrollWidth` が 320px 内に収まることを確認。
- [x] UI表示強化コミット `f0dd36a3` (`feat(arrivals): show queue departures separately`) を dev `main` へ push。
- [x] dev Pages run `28733621067` が build/deploy とも success。
- [x] 公開 dev の `forecast-section.js` / `arrivals.html` / `sw.js` が更新済みで、`advance-forecast.json` は `generatedAt=2026-07-05T16:37:00+09:00`、`departure` あり。
- [x] production tag `v2026.07.05-queue-direction-ui` を push。
- [x] production sync run `28733695020` が success。
- [x] prod Pages run `28733699835` が success。
- [x] 公開 prod の `forecast-section.js` / `arrivals.html` / `sw.js` が更新済みで、`advance-forecast.json` は `generatedAt=2026-07-05T16:37:00+09:00`、`departure` あり。

## 未完了・次のアクション（優先順）
- [ ] もし今後も failure メールが届く場合は、そのメールの repo/workflow/run URL を確認し、Pages 以外の通知源か切り分ける。

## 重要な決定事項
- 通常のコード変更 deploy が失敗した場合は failure のまま残す。
- 自動データ更新 commit の Pages deploy 一時失敗だけを success 扱いにし、次回データ更新で自然再試行させる。
- 本番 `hidenaka/taxi-daily-report` は通常は直接編集しない。ただし `.github/workflows/pages.yml` は dev から prod へコピーされないため、ユーザー承認後に prod workflow のみ直接更新した。
- `getShiftZones()` は営業日の流れに合わせ、時計時刻順ではなく出庫時刻からの生成順を表示順として使う。

## 既知の問題・注意点
- 2026-07-03 22:10 JST の `Deploy GitHub Pages` run `28662729139` は修正前の failure として履歴に残る。
- 2026-07-03 21:12 JST の `pages build and deployment` run `28659781256` は GitHub Pages Source 変更前の branch-based Pages failure。
- prod の 2026-07-03 23:31, 23:37, 23:44, 23:48 JST などの failure は prod workflow 修正前の履歴として残る。
- 未追跡の `CLAUDE.md` と `ocr-spike/` は今回の作業対象外で未変更。

## 関連ファイル（現在の状態付き）
- `.github/workflows/pages.yml`: 修正済み、dev `main` に push 済み。
- prod `.github/workflows/pages.yml`: GitHub Contents API で直接修正済み、commit `5895e9e6`。
- `.github/workflows/deploy.yml`: 確認のみ。タグ push 時の本番同期 workflow で、今回の連続通知とは別。
- `js/chart-helpers.js`: `getShiftZones()` の列順を生成順に修正済み。
- `tests/chart-helpers.test.js`: 時間帯列順の回帰テスト追加済み。
- `SESSION.md`: この引継ぎ内容に更新済み。
- `tools/js/forecast-section.js`: 補充/抜け分離表示を追加済み。dev/prod 反映済み。
- `tools/arrivals.html`: 乗り場の動きブロックの4列CSSを追加済み。dev/prod 反映済み。
- `tests/forecast-section.test.js`: 補充/抜け表示テストを追加済み。dev/prod 反映済み。
- `sw.js`: `CACHE_NAME` を `v321` に更新済み。dev/prod 反映済み。

## 検証コマンド / 動作確認手順
```bash
git status --short --branch
gh run list -R hidenaka/-taxi-daily-report-dev --limit 20 --json databaseId,name,displayTitle,status,conclusion,createdAt,url,workflowName
gh run view 28663206671 -R hidenaka/-taxi-daily-report-dev --json status,conclusion,jobs,url
gh run view 28663338593 -R hidenaka/-taxi-daily-report-dev --json status,conclusion,jobs,url
gh api repos/hidenaka/-taxi-daily-report-dev/pages
gh run list -R hidenaka/taxi-daily-report --limit 20 --json databaseId,name,displayTitle,status,conclusion,createdAt,url,workflowName,headSha
gh run view 28668161815 -R hidenaka/taxi-daily-report --json status,conclusion,jobs,url
gh run view 28668452585 -R hidenaka/taxi-daily-report --json status,conclusion,jobs,url
gh api repos/hidenaka/taxi-daily-report/pages
node --test tests/chart-helpers.test.js
npm test
node --test tests/forecast-section.test.js tests/sw-precache-imports.test.js
gh run view 28723314710 -R hidenaka/-taxi-daily-report-dev --json status,conclusion,jobs,url
gh run view 28723351562 -R hidenaka/-taxi-daily-report-dev --json status,conclusion,jobs,url
gh run view 28723355392 -R hidenaka/taxi-daily-report --json status,conclusion,jobs,url
```

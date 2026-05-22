---
created: "2026-05-22"
project: taxi-daily-report
feature: IC判定ページ UI改善（案A: ステップ型・答えファースト）
status: design-approved
branch: feat/ic-judge-ui-redesign
related-tickets:
  - .company/pm/tickets/2026-05-15-ic-route-jct-selector.md (本設計に統合・クローズ予定)
related-files:
  - タクシー日報/tools/ic.html
  - タクシー日報/tools/css/style.css
  - タクシー日報/tools/js/app.js
  - タクシー日報/tools/js/data-loader.js
  - タクシー日報/tools/data/favorites.json
review-mockup: レビュー/IC判定UI改善-3案比較-2026-05-22.html
---

# IC判定ページ UI改善（案A: ステップ型・答えファースト）

## 目的

IC判定ページについて「機能は十分だが使い勝手が良くない／構成が感覚的でない」という本人フィードバックを解消する。
画面構成を「乗った→降りた→これが控除距離」という思考順に並べ替え、入力の二重表示を解消し、出口お気に入りを編集可能にする。

**経路計算ロジックは一切変更しない。** 本改修は DOM 構造・CSS・表示制御・お気に入り保存先の変更に限定する（機能退行リスクを最小化）。

## 現状の問題点（確定済み）

本人ヒアリングで「IC入力」「ルート・経由JCT選択」「判定結果の見せ方」「全体の縦並び構成」の4領域すべてに摩擦ありと回答。コード調査で具体化した問題：

1. **入力の二重表示** — 入口ICが「自由入力（検索）」と「プルダウン」を同時常時表示。どちらを使うか迷う。
2. **入口/出口の非対称** — 入口は検索主体、出口はお気に入りプルダウン＋「別のICを探す」折りたたみ。操作モデルが左右で異なる。
3. **答えが埋もれる** — DOM順が「入力 → ルート比較 → 通るルート → 判定 → ログ」。最も見たい控除km・判定が中段以降に沈む。
4. **控除kmの二重表示** — ルート比較カードと判定バッジの両方に控除kmが出て冗長。
5. **縦長** — 8セクションが縦に積層。目的の場所まで遠い。

なお「出口は空港中央がほぼ固定、入口は毎回変わる」は意図的なドメイン設計であり、賢いデフォルトとして維持する。
本人の典型フロー＝「開く → GPS現在地 → 近い順から入口IC → 出口は空港（固定）」。

## 採用案: 案A（ステップ型・答えファースト）

3案（A=ステップ型 / B=結果ピン留め / C=最小変更）をモックで提示し、本人が案Aを選択。
理由：画面の並びが思考順と一致し説明不要で使える／入力直後に答えが出る／GPSチップを入口の主役にでき典型フローに最適／出口編集要望を自然に組み込める。

## 画面構成（上→下）

| 順 | セクション | 内容 |
|----|-----------|------|
| 1 | タブ | 現状維持（⏱乗務タイマー / 🛣IC判定 / ✈到着便） |
| 2 | **入口IC** | 右肩に小さくGPS状態＋[再取得][GPSオフ]。直下に📍近い順チップ（既存 `geo-suggest` を主役化、会社負担+控除ありの緑グローも流用）。手動入力は「🔍別のICを検索」折りたたみ1本（**プルダウン廃止**） |
| 3 | 入れ替え | ⇅ 入口と出口を入れ替える（現状維持） |
| 4 | **出口IC** | ★お気に入りチップ（**編集可**）＋「🔍別のICを検索」折りたたみ |
| 5 | **答えカード** | 入口・出口が両方そろったら出現。判定バッジ（🟢全区間会社負担 / ⚫全区間自己負担 / 🔵区間混在）＋控除km(片道/往復)＋総走行距離(目安)＋[片道だけ保存][往復で保存]。未確定時はプレースホルダ「入口と出口を選ぶと控除距離が出ます」 |
| 6 | **ルート＆詳細** | 複数候補時のみ表示。横並びミニカード（既存 `route-comparison` を縮約）＋「▸通るルート / 通過IC・JCT / 区間内訳」を**1つの折りたたみに集約** |
| 7 | **今日のログ** | 一覧・控除距離合計・走行可能距離・消去（現状維持。保存ボタンは答えカードへ移設） |

### 表示制御
- 答えカード／ルート＆詳細は、入口・出口の両方が確定するまで非表示（プレースホルダのみ）。
- 既存 `update()` の呼び出しタイミングは変えず、レンダリング先 DOM の表示/非表示を制御する。
- 初回GPS取得で最寄りICを入口に自動セットする既存挙動（`initialEntrySet`）は維持。該当チップが選択状態で表示される。

## 新機能: 編集できる出口お気に入り

唯一の新規機能。現状 `data/favorites.json`（アプリ同梱の固定ファイル）から読むのみで編集不可。これを localStorage 化して本人が管理できるようにする。

### データ
- 保存先：`localStorage` キー `cabis.exitFavorites`（値＝ic_id の配列。例 `["kukou_chuou","kasumigaseki","ginza"]`）。
- 初回（キー未存在）は `data/favorites.json` の `exit_favorites` を**シード**して保存。既存ユーザーも初期表示は従来通り。
- デフォルト選択は空港中央（`kukou_chuou`）を維持。

### 純関数モジュール（テスト対象）
`tools/js/exit-favorites.js`（新設）に副作用のない純関数を切り出す：
- `seedFavorites(defaults)` — localStorage未存在時にdefaultsで初期化し配列を返す
- `loadFavorites(defaults)` — localStorage優先で読む。なければseed
- `addFavorite(list, icId)` — 重複なく末尾追加した新配列を返す
- `removeFavorite(list, icId)` — 除去した新配列を返す
- `saveFavorites(list)` — localStorageへ永続化

DOM操作・localStorage I/O の薄いラッパは `app.js` 側。純関数のみユニットテスト。

### 操作（インライン方式・別画面に飛ばさない）
- チップ列の末尾に「⚙編集」。タップで編集モードトグル。
- 編集モード中：各お気に入りチップに「×」（タップで削除）＋「＋追加」チップ（タップで検索フィールド表示→IC選択で追加）。
- 空配列も許容（全部消したら検索のみで運用可）。再シードはしない。
- 変更は即 localStorage 保存。

## 既存ロジック互換（壊さない保証）

シグネチャ維持でそのまま再利用する関数：
- `calculateAllRoutes(entryIc, exitIc)` / `update()` / `renderVerdict(result)` / `renderRouteComparison(allRoutes)` / `renderRoutePath(result)` / `renderBreakdown(result)` / `renderSessionLog()`
- GPS：`initGeo` / `onGeoState` / `onGeoUpdate` / `refreshNearestSuggestions` / `findNearestICs` / `entryGivesCompanyPayDeduction`
- ルート計算・控除計算（`judge.js` / `route-options.js` / `shutoko-graph.js` 等）は **1行も変更しない**。

変更するもの：
- `tools/ic.html` — セクションのDOM順・class・新マークアップ（チップ列、答えカード枠、折りたたみ集約）。`route-select`(hidden) の内部state参照要素は温存。
- `tools/css/style.css` — チップ主役化、答えカード強調枠、ミニカード、編集モードのスタイル追加。
- `tools/js/app.js` — `populateExitFavorites` を localStorage 化、入口チップ＝geo-suggest の昇格、答えカード表示制御、保存ボタン移設、お気に入り編集ハンドラ配線。
- `tools/js/exit-favorites.js`（新規）— 上記純関数。
- `tools/js/data-loader.js` — 変更なし想定（favorites.json はシード元として読み続ける）。

## GPS無効時の挙動

`onGeoState` の既存分岐（denied / error / unsupported / idle）を流用：
- これらの状態では入口の「🔍別のICを検索」折りたたみを自動展開し「手動モード」を明示。
- 近い順チップ領域は非表示（既存 `hideGeoSuggest` を流用）。
- GPSオン復帰でチップ再表示。

## エラーハンドリング

- localStorage 読み取り失敗（JSON破損・容量等）→ try/catch で defaults にフォールバック（既存ログ保存と同じ防御方針）。
- お気に入りに存在しない/データ未掲載の ic_id → スキップ（既存 `populateExitFavorites` のガードを踏襲）。
- 起動時の致命的エラーは既存の `error-banner` 機構をそのまま使用。

## テスト

- **回帰**：route計算系の既存445テストは無影響（ロジック不変）で全pass維持を確認。
- **追加**：`tests/exit-favorites.test.js` — seed/load/add/remove/save の純関数を網羅（重複追加・空配列・破損JSONフォールバック）。
- **実機**：dev反映後 iPhone で ①GPSチップから入口選択 ②お気に入り編集（追加/削除/空） ③答えカードの出現と控除km ④片道/往復保存とログ反映 ⑤GPSオフ時の手動モード を確認。

## デプロイ

いつものフロー：**dev実装 → 本人がdev実機確認・承認 → 本番**。
- `sw.js` の `CACHE_NAME` を bump（新規JS `exit-favorites.js` 追加のため）。リリース後はPWA再起動を案内。

## 旧チケットの扱い

`.company/pm/tickets/2026-05-15-ic-route-jct-selector.md`（経由JCT指定UI）は、ルート＝ミニカード選択方式（既存 route-comparison）で実質吸収済み。本設計に統合し、当該チケットは done/closed に更新する。

## スコープ外（YAGNI）

- 「よく使う区間／履歴」機能（本人ヒアリングで未選択）。出口の編集可お気に入りでカバー。
- ルート計算・控除距離精度の改修（別チケット領域。本改修は見せ方のみ）。
- 入口IC側のお気に入り（典型フローはGPS主体のため不要）。

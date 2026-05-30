# 設計仕様: 合意ベースの匿名グループ営業情報共有

- 日付: 2026-05-30
- 対象: Cabis（タクシー乗務日報 PWA）
- ステータス: 設計承認済み（ユーザー確認 2026-05-30）。次工程 = writing-plans。
- 作業場所: 隔離worktree `~/work/taxi-group-sharing`（branch `feat/group-anon-sharing`）。並行セッション多数のため共有クローンでは作業しない。

## 1. 目的

現在、各ユーザーの営業データ(drives)は Firestore ルールで本人のみ読み取り可に厳格隔離されている。
本機能は、当人同士が合意して作ったグループの中だけで、個別の営業情報（いつ・どこで載せたか）を
匿名プールとして共有し、互いの稼ぎ方を学べるようにする。特定個人の合計営収は出さない。
グループはユーザーが自助で作成・共有する。

## 2. 確定した設計判断

| # | 項目 | 決定 |
|---|---|---|
| 1 | 共有粒度 | 個別の乗車記録。運賃は分析ページで必要時参照。個人/月の合計は出さない |
| 2 | 匿名性 | 匿名プール（誰の乗車か分からない） |
| 3 | 匿名化方式 | サーバー側（サービスアカウント）。生drivesは非公開のまま |
| 4 | グループ作成 | 招待リンク/QR式（既存招待URL部品を流用）。参加＝提供への同意 |
| 5 | 提供範囲 | 過去含む全乗車。ただし日報ごとに共有オプトアウト可 |
| 6 | 最小グループ人数 | 2人以上。「合計を出さない」は人数でなく §6.5 集計のみ表示で担保 |
| 7 | プール項目 | 時刻 / 乗車地エリア / 降車地エリア / 営Km / 迎車 / 運賃。メモは除外。※人数(男女)はtripに保存されていないため対象外 |
| 8 | 場所の精度 | 区＋地域まで（既存 `extractArea()` を再利用。例「大田区上池台4」→「大田区上池台」） |
| 9 | 更新頻度 | 1時間ごと＋必要時に再集計 |
| 10 | 複数グループ | 1ユーザーは複数グループに加盟可。各グループのプールにそれぞれ提供 |
| 11 | メンバー表示 | 人数のみ（個人は出さない） |
| 12 | 退会時 | 残メンバーのみから再集計 → 自分の提供分はプールから消える |
| 13 | 閲覧条件 | グループ作成者が選択：参加すれば閲覧可／一定の提供が必要 |
| 14 | アクセス | 自分のアカウントでログイン状態でアプリを開けば閲覧可。所属はuserIdに紐づく |

## 3. 日報ごとの共有オプトアウト

- 既定は共有。入力ページOCR後（保存時）に「この日はグループに共有しない」トグル。詳細ページでも後から切替。
- drive ドキュメントに `shareOptOut: true`。Worker は匿名化時にこのフラグの立つ日をスキップ。

## 4. データモデル（Firestore）

```
groups/{groupId}
  name, inviteSlug("gr-XXXXXX"), createdBy(userId), memberUserIds:[userId],
  requireContributionToView: bool, minViewContribution: number, createdAt, updatedAt

groups/{groupId}/pool/{poolItemId}   // 身元情報なし(userIdなし)・個別trip単位
  boardTime, pickupArea(区+地域), dropoffArea(区+地域),
  km, isPickup(迎車), amount   // メモ・userId・日付の個人紐付け・人数は持たない
```

- 生 `drives/{userId}/daily/{date}` のルールは一切変更しない。

### 4.1 プールは「バラの個別乗車」（1日まとめを作らない）

プールは individual trip 単位。1日(drive)単位でまとめない。
理由: 日単位だと「ある匿名の1日の全乗車＝その人の1日合計」が復元でき、要件「1日まとめ／個人合計を見せない」に反する。
バラのtripなら、誰の・どの日かに紐付かない「点」の集合＝いつ・どこで載るかの傾向だけが残る。

帰結（重要）: グループ分析は trip 単位で成立する集計のみに限定。
- 使う: エリア×時間帯の発生ヒート、エリア別運賃統計、`dropoffAreaAnalysis`/`highValueAreas`/`buildNeighborMap`。
- 使わない: `hourlyDowEfficiency` 等の稼働分ベース時給/効率（1日構造=出庫〜帰庫・休憩が必要＝プールに持たない）。個人の自分専用分析に留める。

## 5. Firestore ルール方針

- `groups/{groupId}/pool/{id}`: read はメンバーのみ、write は Worker(サービスアカウント)のみ＝クライアント書き込み不可。
- `groups/{groupId}`: メンバー read 可。作成・メンバー加減は所定遷移のみ（詳細は plan）。
- 既存 `drives` ルールは不変＝他人の生データは引き続き読めない（だから匿名プールが必要）。

## 6. 匿名化パイプライン（Worker）

- ランタイム: 既存 Cloudflare Worker(cabis-billing) に Cron Trigger を追加、または専用 scheduled worker。サービスアカウントでFirestore読み取り。
- 手順: グループの memberUserIds → 各メンバーdrives読み(shareOptOut日スキップ・キャンセルtripスキップ) → 身元剥がし＋エリア粗化(extractArea相当) → 現メンバー分だけで pool 再構築。
- min2未満は pool 生成しない。実行 = 1時間ごと＋必要時。

## 6.5 「合計を出さない」の担保 = 分析表示が集計のみ（実コード確認済み）

分析ページ `support.html` は集計関数のみ使用（`hourlyDowEfficiency`・`peerMedianHourlyDow`・`dropoffAreaAnalysis`・`highValueAreas`・ヒートマップ）。生の個人別トリップ一覧も合計値も表示していない（`rankDrivesBySales` 等の個別ランキングも未使用）。
よって表示の出し方の都合上、特定個人の全営業・合計を UI から取り出せない。これが最小2人でも成立する根拠。

実装ガード（必須）: グループプールを分析に流す際は既存の集計ビュー（§4.1の trip単位のもの）のみ。プールに「生トリップ一覧」「個人/プール合計の総額」「per-driveランキング」を新規追加しない。

## 7. UI

- グループ管理（設定 or 新規ページ）: 作成、招待リンク/QR(qr-code.js流用)、参加(`?group=<slug>`捕捉→同意画面→参加)、退会、人数表示、作成者の閲覧条件設定。
- 同意画面: 「参加すると、過去含むあなたの営業情報が匿名でこのグループのプールに入ります（個人や合計は出ません）」。
- 分析ページ: 「グループプール」表示を追加（§4.1の trip単位集計のみ）。個人別合計は一切出さない。2人未満は「あと1人で解放」。
- 入力/詳細ページ: 日報ごとの「共有しない」トグル。

## 8. 既存資産の再利用（Explore確認済み）

- 招待: `js/slug-gen.js`(generateSlug prefix='gr-')、`js/invite-url.js`(captureInviteSlug → `?group=`版を追加)、signupと同様に参加で users/{uid} or groups に記録。
- QR: `js/qr-code.js`(renderQrSvg/downloadQrPng)。settings.html 紹介セクションが実例。
- trip構造: boardTime/alightTime/boardPlace/alightPlace/km/amount/isCancel/isCharter。drive: date/departureTime/returnTime/trips[]/rests[]/totalKm/companyId/updatedAt。
- エリア: `extractArea(place)`(chart-helpers) が「区+町名」抽出済み。
- 集計: `dropoffAreaAnalysis`/`highValueAreas`/`buildNeighborMap`/`extractArea`（trip単位で動く）。
- 複数ユーザー集計の実例: `getAllUsersDrivesForMonth`（_userId付与）＋ support.html の `isAll?peerMedianHourlyDow:...`。ただし規約上クライアントは他人drives読めない→グループはWorker経由pool必須。
- テスト: node:test + ESM。`tests/drive-cache.test.js` の Map製storageモック、依存注入パターン。

## 9. スコープ外 / 後続

- 高度な再識別攻撃への厳密k-匿名性は v1 では最小2人＋集計のみ表示で対応。必要なら後続強化。
- 並行セッション多数 → 本機能は専用worktreeで実装。デプロイは dev反映(dpush)→確認→本番タグ。

## 10. 受け入れ基準（抜粋）

- 非メンバー/未ログインはプールを一切読めない（ルールで遮断）。
- プールに userId・メモが存在しない。1日(drive)単位の塊も存在しない（trip単位のみ）。
- 日報を「共有しない」にすると次回再集計後にプールから消える。
- 退会すると次回再集計後に自分の提供分が消える。
- 1ユーザーが複数グループに加盟でき、各プールに正しく反映。
- プール分析は集計ビューのみ。生一覧・合計・個別ランキングは出ない。

## 実装プラン分割（順に積む）

1. 基盤（純ロジック）: trip→pool-item 匿名化＋エリア粗化＋shareOptOut/キャンセル除外。全ユニットテスト可。← 最初のプラン
2. 匿名化Worker: 同意メンバーdrives→pool再構築(min2/opt-out/退会反映)＋Cron。
3. グループ基盤＋招待UI: 作成/参加/退会・人数・閲覧条件・Firestoreルール。
4. 分析UI統合: pool を §4.1 集計ビューに流す。

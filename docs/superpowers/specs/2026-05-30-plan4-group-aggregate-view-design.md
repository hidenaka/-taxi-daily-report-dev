# Plan 4 設計: グループ集計ビューの復活（承認済み方針 2026-05-30）

## 方針（ユーザー承認済み）
新しいプール表示を作らない。**support.html に温存されている「全員統合(他の乗務員)」ビュー（`hourScopeTabs` が `display:none`、`peerMedianHourlyDow` 中央値ヒートマップ＋エリア分析）を、グループメンバーに対して復活**させる。データは他人の生drivesではなく、**グループの匿名集計**を使う。

## プール内容の変更（Plan2 修正）
現状のプール = バラの個別乗車（`groups/{id}/pool/current.items`）。
→ **集計結果型に作り替える**：Worker が現メンバーの drives から、既存ビューが使う集計を計算して結果だけ保存。
- `peerMedianHourlyDow(memberDrivesWith_userId)` の出力（dow×hour の中央値マトリクス。各セル `{ peerValues, median, days, stability... }`）
- `dropoffAreaAnalysis` / `highValueAreas` / `buildNeighborMap` のエリア集計結果
- 保存先: `groups/{id}/pool/current`（または `/pool/aggregate`）に上記の**集計結果のみ**。生drives・個人識別・合計は保存しない。
- min2 維持。Worker は各メンバー drives を読む時に一時的に `_userId`(本人userId) を付けて peerMedian を計算→出力には userId は残らない（中央値/値リストのみ）。

## なぜ集計をサーバーで保存するか（プライバシー）
- 既存ビューはクライアントで `allDrives`(他人の生drives) から集計を計算する作り。グループでは規約上クライアントは他人 drives を読めない。
- かつ「1日まとめ/個人合計は出さない」要件 → プールに per-person/per-day を置かない。
- よって **Worker が集計だけ計算して保存**＝生データも個人も置かず、表示は中央値/エリア集計のみ。要件を全て満たす。

## Worker 実装（chart-helpers 再利用）
- `worker/src/group-pool.js`(または core) で、`peerMedianHourlyDow` 等を `js/chart-helpers.js` から import して使う（Cloudflare の esbuild がバンドル。chart-helpers は DOM 非依存の純関数群＝node test 済みなので Worker でも動く想定。要確認: chart-helpers が window/DOM を参照していないか）。
- refreshGroupPool を「集計を計算して保存」に変更（buildGroupPool/buildPoolItems は集計入力の前処理として活用 or 役割変更）。
- 各メンバー drives 読み込み時に area 粗化(extractArea)・shareOptOut 日スキップ・キャンセル除外は維持。

## support.html 表示（既存コード復活）
- `hourScopeTabs`(line ~143, display:none) を**グループに所属するメンバーには表示**（または「自分/グループ」スコープを追加）。
- スコープ=group のとき、`matrix` を `getAllUsersDrivesForMonth`→`peerMedianHourlyDow` で計算する代わりに、**グループプールの保存済み集計マトリクスを読んで使う**（既存の isAll レンダリング `matrix[dow][h].peerValues` 等をそのまま使えるよう、保存集計の shape を peerMedianHourlyDow 出力に揃える）。
- エリア分析(dropoffAreaAnalysis 等)も同様にプールの集計結果を使う。
- 表示は「みんな N人の中央値」「◎みんな揃って稼げる」等、既存の集計表示のまま。個人値・合計は出さない（既存ビューがそもそも出さない）。
- プールを読む前に `/group-pool-refresh` を叩いて鮮度を保つ（オンデマンド再構築、Plan2）。
- 複数グループ加盟時は対象グループ選択 UI（または既定で1つ目）。

## 注意・リスク
- **support.html は並行セッションが頻繁に編集する最大ファイル**＝実装時に最新へ rebase してから着手。衝突注意。
- chart-helpers を Worker でバンドルする際のサイズ・DOM依存の有無を着手時に確認。
- 集計マトリクスの shape を既存 isAll レンダリングが期待する形に正確に合わせる（`peerValues`/`days`/`stability`/median 等）。実装前に support.html の isAll 描画(line ~1070-1140)と peerMedianHourlyDow の出力を精読。

## 着手手順（次セッション推奨）
1. 最新 origin/main に rebase（support.html 衝突解消）。
2. support.html の isAll 描画 + peerMedianHourlyDow 出力 shape を精読 → 保存集計の形を確定。
3. chart-helpers の Worker バンドル可否確認。
4. Worker: 集計計算→pool保存に変更（TDD: 集計計算の純part）。
5. support.html: group スコープ追加＋プール集計を既存描画に供給＋メンバーのみタブ表示。
6. dev push + kimi で 2メンバー想定の表示確認（要2アカ or seed）。

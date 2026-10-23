# 警視庁 交通量調査レイヤー: 取得・変換・座標確認・更新・切戻しの手順

最終更新: 2026-10-22

工事の画面（`tools/radar.html`）の「交通量調査」ボタンで重ねる、警視庁の定期交通量調査（令和6年 主要交差点交通量・区部）のデータの作り方です。値は調査日の7時〜19時に観測した実績で、現在の交通量・通常日の代表値・渋滞予測ではありません。毎日の自動更新には入れず、警視庁が公表を更新したときに手で実行します。

## 1. 関係するファイル

| ファイル | 役割 |
|---|---|
| `.github/scripts/build-keishicho-traffic-counts.mjs` | 公式 ZIP → 地図用 JSON と品質レポート |
| `.github/scripts/locate-keishicho-points.mjs` | 調査地点の位置を OSM の情報で確かめ、座標ファイルを作る |
| `.github/scripts/lib/read-zip.mjs` | 依存なしで ZIP を読む（ファイル名は CP932） |
| `.github/scripts/data/keishicho-coords-r6.json` | 地点ごとの座標と確認状態（生成物。build が読む） |
| `.github/scripts/data/keishicho-visual-checks.json` | 航空写真で目で確かめた結果（手で書く。自動照合より優先） |
| `.github/scripts/locate-keishicho-arms.mjs` | 流入方向（A・B・C…）が地図のどちらを向くかを決め、向きのファイルを作る |
| `.github/scripts/data/keishicho-places-r6.json` | 方向の地名を国土地理院の地名検索で引いた結果（向きの手がかり） |
| `.github/scripts/data/keishicho-arm-checks.json` | 向きを目で確かめた結果（手で書く。直した向き・決められない地点） |
| `.github/scripts/data/keishicho-arms-r6.json` | 地点ごとの向き（生成物。build が読む） |
| `tools/js/traffic-count-data.js` | CSV の読み方・合計の検査・画面用の整形（純粋な関数） |
| `tools/js/traffic-count-layer.js` | 地図の層・ボタン・地点の詳細 |
| `tools/data/keishicho-traffic-counts.json` | 地図に出す地点（座標を確認済みのものだけ） |
| `docs/roadwork/keishicho-traffic-counts-quality.json` | 変換済み・表示・未配置の地点数、未配置の地点、合計の食い違い |
| `tests/keishicho-traffic-counts.test.js` | 変換・座標・生成物の自動テスト |

## 2. 公式データの取得

1. 警視庁「交通量統計表」 https://www.keishicho.metro.tokyo.lg.jp/about_mpd/jokyo_tokei/tokei_jokyo/ryo.html を開き、最新の年と、主要交差点（区部）の CSV 一式の場所を確かめる。
2. 同じページの「権利・リンク」 https://www.keishicho.metro.tokyo.lg.jp/about/kenri_link.html で、二次利用の条件（出典の記載・加工した旨の記載）が変わっていないか確かめ、確認日を `CURRENT_MAP_BRIEF.md` の実装記録に書く。条件が変わっていたら、ここで止めて相談する。
3. ZIP を作業用の場所に落とす（リポジトリには入れない）。

```sh
mkdir -p /tmp/keishicho && cd /tmp/keishicho
curl -sSL -A "Mozilla/5.0" -o kousatenkubu.zip \
  https://www.keishicho.metro.tokyo.lg.jp/about_mpd/jokyo_tokei/tokei_jokyo/ryo.files/02_kousatenkubu_csv.zip
```

2026-10-22 に取得した版: 597,226 バイト、91 地点 × 3 種の CSV（ほかに自転車道の CSV 2 件と説明の txt。自転車道は今回は使わない）。

## 3. 位置の確かめ（OSM）

公式 CSV には緯度経度がありません。交差点名と交差道路名だけから座標を推定しないため、次の2段で確かめます。

1. OSM の名前付きの信号・交差点の点を、東京都の範囲で1回だけ取得する（Overpass API。地点ごとに何度も問い合わせない）。

```sh
cd /tmp/keishicho
curl -s -A "taxi-roadwork/1.0" --data-urlencode 'data=[out:json][timeout:180];area["name"="東京都"]["admin_level"="4"]->.t;(node(area.t)["highway"="traffic_signals"]["name"];node(area.t)["junction"]["name"];node(area.t)["highway"="traffic_signals"]["name:ja"];);out body;' \
  https://overpass-api.de/api/interpreter -o signals.json
```

2. 自動で照合する（リポジトリの直下で実行）。

```sh
node .github/scripts/locate-keishicho-points.mjs --zip /tmp/keishicho/kousatenkubu.zip --signals /tmp/keishicho/signals.json --checked-at YYYY-MM-DD
```

- 「その交差点名」の点から 45m 以内に、交差道路名の2本の道路（`tools/lanes/lanes23.geojson` の OSM の道路名）が両方あり、その2本が点から 60m 以内で交わっているときだけ `verified-osm`（地図に出す。画面には「OpenStreetMap で自動照合・目では未確認」と出る）。
- 陸橋などの立体交差は道路の線が交わらないので候補に回る。航空写真で目で確かめて `verified-visual` にする。
- 名前の点が無い・道路が合わない地点は、2本の道路が交わる所を `candidate-roads`（候補）として残す。地図には出さない。
- 確かめようが無い地点は `unplaced`。

3. 航空写真で目で確かめる。国土地理院の航空写真で、候補の座標が交差点の中心か、2本の道路が交わっているかを見る。結果を `.github/scripts/data/keishicho-visual-checks.json` に書き、もう一度 2 を実行する。
   - 確かめられた: `"status": "verified-visual"` と、見たもの（`source`）・確認日（`checkedAt`）。位置を直したときは `lat`・`lon` も書く。
   - 交差点ではなかった・どちらの交差点か決められない: `"status": "mismatch"` と理由（`note`）。
   - 決められない: `"status": "candidate-roads"` のまま理由を書く。
   - 南千束（704）は必ず目で確かめる。

2026-10-22 の結果: 地図に出す 61 地点（すべて目視。はじめ目視 17・OSM の自動照合 44 だったが、自動照合の 44 地点も航空写真と地理院地図で交差点の中心にあることを目で確かめた。座標は1地点も動いていない）、候補のまま 8、交差点ではない・区別できない 6、確かめられない 16。公式の表で合計が食い違う地点（松原橋 703・谷原 4001）も目視した。
   - 自動照合の地点は、航空写真（z18）と地理院地図（z17）を並べた4地点ずつの画像で見た。江戸橋1（212）と夢の島（520）は広い範囲でも見直し、OSM の道路の線で交差道路の2本が数 m 以内にあることも確かめた。

## 3-2. 流入方向の向き（地図の矢印）

地図を寄せると、交差点へ入ってきた方向ごとの台数を矢印で描く。向きは次の順で決める。

1. 4 の変換を1回実行してから、`node .github/scripts/locate-keishicho-arms.mjs` を実行する。
   - 道路の線（`tools/lanes/` の OSM）が交差点まわりの円（55m・90m）を横切る所から、腕（交差点から出る道）の向きを取る。
   - 公式 CSV の方向記号は反時計回りに A→B→C… と振ってある（各方向の流出が「左折・直進・右折」の順に並ぶため）。A をどの腕に置くかは、方向の地名（「五反田方面」など）の向きといちばん合うように選ぶ。
2. 地理院地図と航空写真に矢印と地名を重ねた画像を作り、全地点を目で確かめる。結果を `keishicho-arm-checks.json` に書く（直した向きは `bearings`、決められない地点は `"status": "unclear"`）。もう一度 1 を実行し、4 の変換をやり直す。
3. 目で確かめた地点だけが `armBearings` を持ち、矢印が出る。決められない地点は印と数だけ。

2026-10-22 の結果: 61 地点のうち向きを確かめた 59 地点に矢印。自動の向きを直したのは 5 地点（水道橋 208・北参道 505・夢の島 520・松原橋 703・四面道 813）。赤坂1（203）と東新橋1（6001）は道を見分けられず矢印なし。

## 4. 変換

```sh
node .github/scripts/build-keishicho-traffic-counts.mjs --zip /tmp/keishicho/kousatenkubu.zip --fetched-at YYYY-MM-DD
```

- 出力: `tools/data/keishicho-traffic-counts.json` と `docs/roadwork/keishicho-traffic-counts-quality.json`。
- 生成物の検査（地点番号の重複、緯度経度の範囲、座標の根拠、必須の項目）に通らないと書き出さずに止まる。
- 欠損（空欄・「-」）は 0 にせず null のまま。公式の表の中で合計が合わない箇所は、値を直さずに品質レポートへ書き、画面にも注意を出す。
- 地点の12時間計・時間別の合計は、公式の流出方向別 CSV の「全方向合計」を使う（`totalSource: "official"`）。流入計を足し直した値は `inflowSum12h` に分けて持ち、合わない地点は `totalsDiffer: true`（画面にも両方を出す）。
- 同じ入力からは同じ JSON になる。確かめ方: 2回実行して前後の `shasum` が同じであること（テスト「変換スクリプト: 別々に2回実行して…」でも確かめている）。

```sh
node .github/scripts/build-keishicho-traffic-counts.mjs --zip /tmp/keishicho/kousatenkubu.zip --fetched-at YYYY-MM-DD && shasum tools/data/keishicho-traffic-counts.json
node .github/scripts/build-keishicho-traffic-counts.mjs --zip /tmp/keishicho/kousatenkubu.zip --fetched-at YYYY-MM-DD && shasum tools/data/keishicho-traffic-counts.json
```

## 5. 確かめ

```sh
npm test                                   # 全体
node --test tests/keishicho-traffic-counts.test.js
```

- 南千束（704）が地図用 JSON にあり、12時間計（四輪 56,784 台）が公式 CSV と一致すること。
- 品質レポートの `meta.counts`（変換済み・表示・未配置）を `CURRENT_MAP_BRIEF.md` の実装記録に写す。`tools/radar.html` の「この地図について」の交通量調査の段落にある地点数と取り込み日（`tcAboutCount`。データを読み込むと自動で書き換わるが、読み込む前の文も合わせておく）も書き換える。
- ブラウザで `tools/radar.html` の工事の画面を開き、菱形のボタンでオン・オフする。広く見ると印の大きさ、寄ると矢印と台数が出ること、南千束を押して交差点の図が出ることを見る。

## 6. 障害時の切り戻し

- 交通量調査だけを止める: `tools/data/keishicho-traffic-counts.json` を前の版に戻す（`git checkout <前のコミット> -- tools/data/keishicho-traffic-counts.json`）。JSON が読めない・形が違う場合、画面は「交通量調査は、いま使えません」と出し、工事と雨雲の表示はそのまま動く。
- 機能ごと外す: `tools/js/koji-ui.js` の `createTrafficCountLayer` の3行、`tools/radar.html` の `tcBtn`・`tcNote`・`tcDetail` とその CSS、`sw.js` の2行を戻す（このレイヤーの最初のコミットを `git revert` する）。
- 公開の前にステージング（dev）で確認し、本番へは別に承認を得てから出す。

# 工事の絵の「道の形」（信号・カーブ・坂）

最終更新: 2026-10-23

工事を押すと出る「いつも／工事中」の絵（`tools/js/koji-lane-anim.js`）に、工事のまわり前後150mの信号・カーブ・坂を描く。値は毎朝の取り込み（`.github/scripts/sync-koji.mjs`）で工事ごとに足す。

## 足す値（`tools/data/koji.json` の各工事の properties）

| 項目 | 中身 | 材料 |
|---|---|---|
| `sigAt` | 信号の位置（m）を「,」でつないだ文字。+ は線の向き（始点→終点、点は `roadBearing`）の先。35m 以内の信号は1つにまとめる | `.github/scripts/data/osm-road-features-23.json`（OSM の信号） |
| `roadU` | 道の形。t=-150..150m を10mおきに、道の中心が右へ何mずれるか（0.5m単位、「,」区切り、分からない所は空）。工事の所で 0・横向き | `tools/lanes/lanes23.geojson`（同じ名前の道、無ければ幹線）の線を5mおきに埋め、工事の所から外へ、前の値にいちばん近い点をたどる（上下線の2本を行き来しない） |
| `curveDeg` | 道の向きが変わる角度（度）。+ は右へ曲がる | `roadU` の前後90〜140mの向きの差。`roadU` が片側しか無いときは、道の線に2次式を当てはめて前後120mで測る |
| `slopePct` | 坂（%）。+ は線の向きへ上る | 国土地理院 標高タイル dem5a（z15）を前後100m・20mおきに読む |

- 坂は、橋・トンネルが前後110mにかかる所、標高が20mで2.5m以上飛ぶ所、12%を超える所では出さない（地面の高さしか分からず、橋の上の道を測れないため）。
- どれかが失敗しても、工事のデータそのものは出す（足せた値だけ足す）。標高タイルが取れない日は坂が消えるだけ。
- 2026-10-23 の結果（757件）: 信号 660件・カーブ 611件・坂 524件。坂3%以上は17件。

## 絵での向き

絵の → の車は、ふさがれる側の車線を走る車。都のデータのふさぐ側が線の右（`side=+1`）なら、左側通行なので → の車は線と逆向きに走る。そのため `roadShape()`（`tools/js/koji-lane-scene.js`）で値を裏返す。

絵では `roadU` のとおりに道を曲げる（縦横同じ縮尺。ずれが70pxを超える道だけ縦を縮める）。

## 試し方

```sh
node .github/scripts/sync-koji.mjs --local   # 取りに行かず、いまの koji.json に道の形だけ足し直す
node --test tests/koji-road-shape.test.js
```

## 信号・橋の写しの更新（年に1回ほど）

Overpass API で、23区のまわりの `highway=traffic_signals` と、幹線道路の `bridge`・`tunnel`・`layer<0` を取り、`osm-road-features-23.json` を作り直す（形式はファイルの `meta.note`）。出典は © OpenStreetMap contributors (ODbL)。

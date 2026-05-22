---
created: "2026-05-22"
project: taxi-daily-report
feature: 横浜北線(K7) 欠落IC 3件の追加（岸谷生麦・馬場・新横浜）
status: implemented
branch: feat/ic-yokohama-kitasen
related-files:
  - タクシー日報/tools/data/ics.json
  - タクシー日報/tools/data/shutoko_graph.json
audit-ref: .company/qa/reports/2026-05-16-ic-graph-reality-audit.md
---

# 横浜北線(K7) 欠落IC 3件の追加

## 背景
本人指摘：横浜方面で控除の発生しない区間（横浜北線/北西線）の出入口が足りない。具体例＝馬場・新横浜。

WEB調査（Wikipedia 横浜北線/横浜北西線・首都高公式）と現状データ突合の結果：
- **横浜北線(K7)**：生麦JCT→横浜港北JCT(8.2km)の途中3IC＝**岸谷生麦・馬場・新横浜が丸ごと欠落**。現状はK7が `namamugi→yokohama_kohoku` の1辺(8.2km)のみ。
- **横浜北西線(K7北西)**：全長7.1kmの大半がトンネルで運転者の出入口は両端の横浜港北・横浜青葉のみ＝**既に網羅済み**（追加不要）。
- K7・北西線とも控除0（`deduction.json kitasen_route` に明記）。追加ICは控除非発生のまま。

## 追加内容（実在の営業キロ・座標）

| id | 名称 | 営業キロ(生麦JCT起点) | GPS | 種別 |
|---|---|---|---|---|
| `kishiya_namamugi` | 岸谷生麦 | 0.8 | 35.49125, 139.66339 | フルIC |
| `baba` | 馬場 | 3.7 | 35.506528, 139.640917 | 両方向（入口ETC専用） |
| `shin_yokohama` | 新横浜 | 7.0 | 35.5165861, 139.605675 | 両方向（入口ETC専用） |

全て `route:"K7"` / `route_name:"横浜北線"` / `entry_type:"both"` / `ramp_access:"full"` / `is_split_point:false`。

## グラフ変更（shutoko_graph.json）
旧辺 `namamugi→yokohama_kohoku 8.2km(K7)` を削除し、実順路でチェーン化：

| 辺 | km | 直線距離 | 物理整合 |
|---|---|---|---|
| namamugi→kishiya_namamugi | 1.3 | 1.25 | OK |
| kishiya_namamugi→baba | 2.9 | 2.65 | OK |
| baba→shin_yokohama | 3.4 | 3.38 | OK |
| shin_yokohama→yokohama_kohoku | 1.3 | 1.20 | OK |

合計8.9km（旧8.2km）。差は namamugi(生麦IC)が生麦JCTからやや東にあるため。K7は控除0なので控除計算に影響なし、総走行距離(目安)表示が約+0.7kmのみ。各辺は監査不変条件「辺km≥GPS直線距離」を満たす。

## 検証
- JSON妥当（ics 306件 / nodes 303 / edges 337）。
- 物理整合：新4辺すべて km≥直線距離。
- 連結性・経路：namamugi↔横浜港北=8.9kmチェーン成立、馬場→空港中央/新横浜→大黒JCT 等の経路が成立。
- `deduction.json` 変更なし（K7控除0は既存記載どおり）。
- 全480テストpass（ramp_access必須・entry_type制約・距離テスト等に抵触なし）。

## スコープ外
- 横浜北西線の追加（既に横浜港北・横浜青葉で網羅）。
- 横浜港北出入口の選択可化（現状 transit_only の通過点扱いのまま。本人選択＝3ICのみ）。
- K7起点を namamugi(生麦IC)→namamugi_jct(生麦JCT)へ厳密化するリファクタ（既存挙動温存のため見送り）。

## 出典
- 首都高速神奈川7号横浜北線 / 横浜北西線（Wikipedia）
- 馬場・新横浜・岸谷生麦 各出入口（Wikipedia・首都高公式）

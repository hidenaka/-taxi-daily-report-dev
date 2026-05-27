# 設計: Semantic Sketch-to-Map（意味的解釈による地図生成）

- 日付: 2026-05-27
- 対象: 京北の管理者（バックエンドのバッチ処理）、ドライバー（地図閲覧）
- 関連: `2026-05-27-stands-pdf-georef-tool-design.md` の発展形（画像マッチング案を完全に廃止）

## 背景・課題

これまでの試行はすべて行き詰まった:
- **座標推測**（Claude目視）→ 誤差50-100m
- **手動4点ホモグラフィ**（PDF合わせUI）→ ユーザー手間
- **SIFT特徴量マッチング** → inlier ratio 19%（手描き↔実地図のスタイル差で失敗）
- **SuperPoint+LightGlue** → ratio 21%（同上・自然画像モデルでは無理）
- **MatchAnything**（残差1m級は出るが）→ 重み非公開＋HF枠で詰む

行き詰まりの本質: **「画像同士をピクセルで合わせる」発想に縛られていた**こと。

新発想: **画像認識を一切やらず、Claude(VLM)の意味理解力 + OSM道路網データで進入線を生成する**。

ユーザーの「これは需要絶対ある」の直観の通り、タクシー乗り場・商業施設案内図・不動産チラシ・観光案内図など、**手描き略図を実地図に転写する**共通課題に応える汎用エンジン。

## ゴール

47施設の進入線を**実OSM道路の上に必ず乗っている**状態にする。ユーザー作業はゼロ。

## 確定した設計判断

| 論点 | 決定 |
|---|---|
| マッチング手段 | **画像処理は一切なし**。Claude(VLM)がPDFを読解→構造化記述→OSM道路にマッピング |
| 道路データ | **OSM (Overpass API)**。無料・無制限・道路名+geometry完備 |
| 構造化記述の作成者 | **Claude**（私）がPDFを順次読解。1施設1〜2分 |
| 進入線の構成 | 「OSM上の道路A→（交差点で接続）→道路B→施設pinまで」を線として生成 |
| 道路が見つからない時 | OSMで道路名検索が失敗した施設はスキップ（人手レビュー対象に） |
| OSM上に存在しない構内動線 | 範囲外（PDFの補助表示で対応） |

## アーキテクチャ

```
PDF画像 (handる略図)
   ↓ Claude が読解
sketch-semantics-keiho.json（構造化記述）
   {
     "roppongi_hills": {
       "approaches": [
         { "label_ja": "六本木通り側から進入",
           "main_road": "六本木通り",
           "entry_direction": "east",
           "destination_side": "north",
           "turn": "left" },
         { "label_ja": "けやき坂側から進入", ... }
       ]
     }
   }
   ↓
[Overpass API] - 道路名で line geometry を取得
   "六本木通り" → 多数のway → line配列
   "けやき坂通り" → 同上
   ↓
[road-network] - 道路網グラフ構築
   ノード=交差点・ターミネータ、エッジ=道路セグメント
   接続関係を判定
   ↓
[sketch-to-line] - semanticsから動線生成
   ・main_road の line上で「entry_direction」側の端を起点
   ・施設pinに最も近い道路上点を終点
   ・turn指示があれば中継道路を経由
   ・接続点(交差点)で繋ぐ
   ↓
approaches[].line に { lat, lng } 配列で書き込み
   ↓ seed JSON 更新
   ↓ dev seed deploy
   ↓
ドライバーが stands.html を開く → 線が実OSM道路の上に出る
```

## コンポーネント分割（純関数 + バッチ）

| ファイル | 種別 | 責務 | テスト |
|---|---|---|---|
| `scripts/data/sketch-semantics-keiho.json` | データ | Claude が読解した47施設の構造化記述 | — |
| `scripts/lib/overpass-fetch.mjs` | アダプタ | Overpass APIから道路ways取得＋キャッシュ | 手動 |
| `scripts/lib/road-network.mjs` | 純関数 | ways → グラフ構築・交差点判定・最近接点 | ✅ node:test |
| `scripts/lib/sketch-to-line.mjs` | 純関数 | semantics + 道路網 → 進入線(lat,lng配列) | ✅ node:test |
| `scripts/generate-lines-semantic.mjs` | バッチ | semantics読込→Overpass取得→線生成→seed更新 | 手動 |

純関数（road-network・sketch-to-line）はNode:testでTDD。アダプタ層は外部APIなので手動検証。

## データ構造

### `sketch-semantics-keiho.json`（私が記述）

```json
{
  "roppongi_hills": {
    "approaches": [
      {
        "label_ja": "六本木通り側から進入",
        "main_road": "六本木通り",
        "entry_direction": "east",
        "destination_side": "south",
        "turn": "left",
        "_pdf_notes": "メトロハット脇→センターループ入口A"
      },
      {
        "label_ja": "けやき坂側から進入",
        "main_road": "けやき坂通り",
        "entry_direction": "south",
        "destination_side": "north",
        "turn": null,
        "_pdf_notes": "けやき坂上り→入口B(三方向進入可)"
      }
    ]
  }
}
```

フィールド意味:
- `main_road`: 進入する主道路の OSM 名（漢字）
- `entry_direction`: `east|west|north|south` （施設pinに対し、車がどの方向から来るか）
- `destination_side`: `east|west|north|south|north-east|...`（施設pin周りで入口が位置する方角）
- `turn`: `left|right|null`（折れ込みの有無）
- `_pdf_notes`: 私の読解メモ（任意・人間がレビュー用）

### Overpass query
```
[out:json][timeout:25];
(
  way["highway"]["name"="六本木通り"](around:600,35.6604,139.7292);
);
out geom;
```
半径600m、施設pin中心。

### 進入線生成ロジック

```
input: semantics(1施設の1approach), road_ways(Overpassの結果), pin{lat,lng}
1. main_road のways群を結合 → 1本の長い polyline
2. entry_direction に従って「起点」を選ぶ
   - east: polyline上で pin より東側の最遠点
   - 同様に west/north/south
3. 終点 = pin に最も近い polyline 上の点
4. polyline上を 起点 → 終点 まで切り取り
5. turn が指定されていれば、終点付近の交差点で道路Bに繋ぐ
6. 結果の点列を line として返す
```

## 段取り

### Phase 1: 仕組み構築（純関数中心・1日相当）
1. `overpass-fetch.mjs` 実装（OSM API・JSONレスポンス）
2. `road-network.mjs` 純関数 + TDD（way配列→polyline結合→最近接点）
3. `sketch-to-line.mjs` 純関数 + TDD（semantics→line生成）
4. `generate-lines-semantic.mjs` バッチ実装

### Phase 2: 私が47PDFを読解→semantics作成
- 各PDFを `Read` で開いて、`main_road`/`entry_direction`/`destination_side`/`turn` を判定
- 47施設 × 1〜2分 = 1〜2時間
- 出力: `sketch-semantics-keiho.json`

### Phase 3: バッチ実行→approach線生成→dev反映→確認
- `node scripts/generate-lines-semantic.mjs` 一回実行
- seed JSON が47件分更新される
- `deploy-stands-to-dev.sh` でdev反映
- 実機で六本木ヒルズ→泉ガーデン→…と確認

### Phase 4（後続）: 多業界対応の汎用化
- スクリプトを汎用エンジン化（任意のPDF＋大まかな緯度経度→自動生成）
- 商業施設案内図・不動産チラシ等に展開可能

## テスト

- **road-network**: TDD で「ways → polyline結合・最近接点・交差点判定」
- **sketch-to-line**: TDD で「東から来る指定→東端を起点・左折→隣接道路で続行」
- **バッチ**: 六本木ヒルズで結果が「六本木通り→けやき坂」の道路上に乗っているか目視
- **既存テスト**: 全件 pass を維持

## エラー処理

- Overpass APIが道路名で見つけられない施設 → スキップしてログ出力（人手レビュー対象）
- `main_road` が複数候補に分かれる場合 → 施設pin に最も近いものを採用
- 進入線が短すぎる場合（5m未満）→ 警告ログ・既存線は上書きしない

## デプロイ

- 既存 worktree `~/work/taxi-dev-stands` で実装
- データのみの変更（コード変更は新規ファイル追加のみ）
- 既存ビューア（地図描画・入口カード）はそのまま使える
- SW: 新規スクリプトはバックエンド用なので SW登録不要

## 多業界への汎用性（この設計の本質）

入力フォーマット:
- PDF/画像（手描き略図）
- 大まかな中心緯度経度
- 道路名（必須）／方向・折れ込み（任意）

汎用エンジンとして：
- タクシー乗り場（今回）
- 商業施設案内図（最寄駅から店舗まで）
- 不動産チラシ（物件まで・最寄駅から）
- 観光案内図（駅から名所まで）
- フードコート図（OSMにある通路情報があれば）
- 工場・キャンパス案内図（同上）

共通して「手描き図 + 緯度経度 + 道路名」さえあれば、実地図に正確な動線が乗る。

## オープン項目（実装中に決める・本spec範囲外）

- 道路名のOSM/JA表記揺れ（「六本木通り」vs「Roppongi-dori」）→ 両方検索のフォールバックで対応予定
- 都心の重複道路（首都高3号と一般の六本木通りが重なる場所）→ 高速道（`highway=motorway`）はexclude
- 交差点の正確な検出 → Overpass で `node` も取得して接続判定

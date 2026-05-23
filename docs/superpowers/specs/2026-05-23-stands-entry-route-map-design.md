# 設計: 乗り場入港ルール・マップ（stands）

- 日付: 2026-05-23
- 対象: 京北交通（組合）所属のタクシードライバー
- 関連: 京北からの提供データ（Gmail「乗り場データ」keihokumiai@gmail.com / 2026-05-23）
  - 全体マニュアル ver.3（乗務員向け進入ルール総説・テキスト）
  - 43施設の個別PDF（施設ごとの地図/敷地図に進入ルート＋吹き出し注意書き）
- 会社slug: dev `co-7q7ros` / 本番 `co-swyg3o`

## 背景・課題

六本木ヒルズ・泉ガーデン・各病院・各ホテル等、都心の高単価施設には
「タクシー専用乗り場への進入ルール」が施設ごとに存在する。現状は紙/PDFのマニュアルで
配布されており、ドライバーが現場で「どの道から入り、どこが乗り場か」を即座に参照できない。
京北から43施設分の乗り場データ（地図＋進入ルート＋注意事項）が提供された。

## ゴール

ドライバーが地図アプリで、施設ピンをタップするだけで
**「進入ルート（地図上に線で描画）＋注意事項テキスト」** を現場で参照できる。
データは会社（京北）に紐づき、京北所属ドライバーのみ閲覧できる。

## 完成イメージ（ユーザーが確定）

- 原本PDFを貼るのではなく、**本物の地図（航空写真）の上に進入ルートを線（矢印付き）で描き込み**、
  横に注意事項テキストも表示する。
- ルートの粒度は**建物敷地内の乗り場位置まで**（航空写真が必要）。
- 43施設すべてを対象。日報アプリ内に設置。京北限定表示。
- ルートデータは**アプリ内の描画エディタ**で作成・編集（管理者のみ）。デプロイ不要で即反映。
- 43本のルートの下書きは Claude が PDF から自動生成 → 本人がエディタで微調整。

## スコープ外（今回やらない）

- 全体マニュアル ver.3 のアプリ内表示（テキスト総説。必要なら別途リンク/別タスク）
- 他組合・他会社への横展開（まず京北のみ。データモデルは会社単位で将来拡張可）
- ルートのナビ機能（音声案内・経路誘導）。本機能は「参照」に徹する
- 注意事項の細分項目化（当面は自由文1ブロック。将来「進入方向/待機台数/禁止事項」へ拡張可）

## 確定した設計判断

| 論点 | 決定 |
|---|---|
| 表示方式 | 航空写真地図の上にルート線（矢印）＋注意事項テキスト |
| 地図実装 | Leaflet ＋ Esri World Imagery（無料航空写真タイル）＋道路名ラベル重ね。**repo同梱**（オフライン対応） |
| 粒度 | 建物敷地内の乗り場位置まで（航空写真へなぞる） |
| データ保管 | Firestore に会社単位保存（デプロイ不要で即反映） |
| 編集 | アプリ内描画エディタ。**同ページ内の管理者専用モード** |
| 編集権限 | 当面は管理者（本人）1人。将来 京北内担当者に開放可 |
| 注意事項 | 自由文1ブロック（将来項目化可） |
| 下書き | Claude が43施設をPDFから自動シード → 本人が微調整 |
| 設置 | 日報アプリ `tools/stands.html`。京北所属のみ閲覧 |

## アーキテクチャ

```
ドライバー(閲覧)              管理者(編集)
   │                            │
   ▼                            ▼
tools/stands.html  ──(編集モード: 管理者のみ)──> 描画エディタ(同ページ内)
   │                            │
   ▼ 読む                        ▼ 保存(即反映)
Firestore: companies/{companyId}/stands/{standId}
```

### コンポーネント分割（単一責務）

| ファイル | 責務 | 依存 |
|---|---|---|
| `tools/stands.html` | ページ枠・地図コンテナ・ボトムシート・編集ツールバー（管理者時のみ表示） | Leaflet, stands-* js |
| `tools/js/stands-data.js` | Firestore I/O（会社単位の stands 読み書き）＋データ形状の検証 | Firebase SDK |
| `tools/js/stands-map.js` | Leaflet 初期化・基盤タイル・ピン描画・ルート線描画（矢印）・ボトムシート連携 | Leaflet |
| `tools/js/stands-editor.js` | 描画エディタ（ピン配置/ルート点打ち/向き反転/注意事項入力/保存/参照PDFパネル）。**管理者時のみ動的読込** | stands-map.js, stands-data.js |
| `tools/js/stands-app.js` | 起動・アクセス判定・会社slug解決・GPS現在地・閲覧/編集モード切替 | 上記すべて, geo.js |
| `vendor/leaflet/` | Leaflet 本体（CSS/JS）を同梱 | — |

各ユニットの境界:
- `stands-data.js` は「Firestoreの形」だけを知る。地図のことは知らない。
- `stands-map.js` は「描画」だけを知る。Firestoreのことは知らない（データはappが渡す）。
- `stands-editor.js` は地図とデータの両方を使うが、起動はappが管理者判定後にのみ行う。

## データ構造（Firestore: `companies/{companyId}/stands/{standId}`）

```json
{
  "name": "六本木ヒルズ",
  "category": "office|hotel|hospital|commercial",
  "pin": { "lat": 35.6604, "lng": 139.7292 },
  "routes": [
    { "points": [{"lat":35.66,"lng":139.73}, {"lat":35.6604,"lng":139.7292}],
      "label": "進入", "kind": "approach" },
    { "points": [ ... ], "label": "敷地内", "kind": "onsite" }
  ],
  "notes": "けやき坂側から進入。待機3台まで。客待ち禁止区域あり。",
  "sourcePdf": "01_roppongi_hills.pdf",
  "updatedAt": "<server timestamp>",
  "updatedBy": "<userId>"
}
```

- `routes[].points` の**並び順 = ルートの向き**（矢印の向き）。
- 1施設に複数線可（道路からの `approach` ＋ 敷地内の `onsite`）。
- `pin` = 乗り場そのものの位置（地図の中心/初期表示に使用）。
- `category` はピン色・絞り込みフィルタに使用（任意）。

### データ形状の検証（stands-data.js）
- `name`（必須・非空）、`pin.lat/lng`（必須・数値・東京周辺の妥当範囲）。
- `routes` は配列。各 `points` は2点以上。`notes` は文字列（任意）。
- 不正データは描画スキップ＋console警告（1施設の不正で全体を落とさない）。

## 地図（閲覧）

- 基盤: **Esri World Imagery**
  `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}`
  ＋ 道路名/地名ラベル重ね（Esri Reference 系 or Carto labels）。Esri帰属表記を必須で表示。
- 施設ピンを全件描画（43件・都心集中。必要ならズームアウト時クラスタリング）。
- ピンをタップ → 地図がその施設へ寄り、**ルート線（矢印付き）を描画**＋下からボトムシートで
  施設名・注意事項テキストを表示。
- GPS現在地（既存 `geo.js` 流用）と「現在地から近い乗り場」サジェスト。
- モバイル優先・PWA。Leaflet同梱でアプリ枠はオフライン起動可（タイル画像は要ネット）。

### ルート線の矢印描画（stands-map.js）
- polyline を描画し、線分中点付近に向き矢印を重ねる（軽量実装: 自前で矢印マーカーを
  等間隔配置、または polylineDecorator 相当の最小実装）。外部依存は最小化。

## 描画エディタ（管理者のみ・stands-editor.js）

- 「編集モード」トグルは**管理者判定が真の時のみ**表示。
- **ピン配置**: 航空写真上でドラッグして乗り場位置に置く。
- **ルート描画**: 地図クリックで点追加 → polyline 化。点の削除/Undo、向き反転、複数線追加。
- **注意事項入力**（textarea）。
- **参照パネル**: 元のPDF画像を横/別ペインに表示しながらなぞれる（正確に写すため）。
  - 参照PDFは `tools/data/stands-ref/<file>.png`（画像化したもの）等を読み込む。
- **保存** → Firestore（`updatedAt`/`updatedBy` 付与）。即時に閲覧側へ反映。

## アクセス制御（Firestore Rules）

- `companies/{companyId}/stands/{standId}`
  - `read`: 当該 companyId に所属するログインユーザーのみ（`userConfig` の会社slugで判定）。
  - `write`: 管理者フラグを持つユーザーのみ。
- ルールに `belongsToCompany(companyId)` / 既存 `isAdmin()` を用いた match を1ブロック追加。
- `tools.html` のツールカードは**京北所属ユーザーにのみ表示**。直アクセス時もアプリ側で
  会社不一致なら「利用できません」を表示（多層防御）。

## 下書きシード（Claude による事前投入）

1. 43個のPDFをダウンロード（Gmail添付。dev作業ディレクトリへ）。
2. 各PDFを読み、`name` / `pin`（施設の緯度経度を geocode）/ `routes`（航空写真基準の概略線）
   / `notes`（PDFから読み取ったテキスト）を生成。
3. まず **dev（`co-7q7ros`）の Firestore にシード**（iCloud外の作業ディレクトリでスクリプト実行）。
4. ルート線は概略。**正確化は本人がエディタで微調整**。
5. シードスクリプトは新規（既存 `seed-keiho-company.mjs` とは別物・会社docには触れない）。
   会社seed誤実行ガードレールに抵触しないこと。本番投入は本人承認後。

### 精度の限界（明記）
- Claude の航空写真へのなぞりは推定であり「だいたいの線」。最終精度はエディタで担保する。
- `notes` テキストは画像PDFからの読み取り（vision）。読み取り誤りは本人が編集で訂正。

## 段取り（フェーズ）

- **Phase 1（仕組み構築＋検証）**: ページ・地図・エディタ・Firestoreモデル・Rules を実装。
  代表3〜5施設（六本木ヒルズ等）を dev にシードし、閲覧↔編集を端から端まで動作確認。
- **Phase 2（全件シード）**: 残り全43施設を dev にシード。
- **Phase 3（仕上げ）**: 本人がエディタで微調整 → QA → 承認 → 本番（`co-swyg3o`、`v*`タグ）。
- 新規ファイル追加につき **SW キャッシュ `CACHE_NAME` を bump**、`STATIC_FILES` に
  `tools/stands.html` / `tools/js/stands-*.js` / `vendor/leaflet/*` を追加。
- リリース後は PWA 再起動を案内。

## テスト

- 単体: データ形状検証、ルート幾何ヘルパー（向き/矢印位置）、会社スコープ絞り込み、
  アクセス判定（京北/非京北・管理者/非管理者）。
- ヘッドレス・スモーク: 既存手順（localStorage `taxi_user_id` ＋ sessionStorage
  `taxi_sub_cache_v1` を seed）で、dev Firestore からピン＋ルートが描画されるか検証。
- 編集→保存→再読込で永続化されるか（dev）。

## デプロイ

- 作業: `~/work/taxi-dev-stands`（worktree, branch `feat/stands-entry-route-map`, dev/main基点）。
- dev反映: `!~/work/taxi-dev/dpush.sh ~/work/taxi-dev-stands`（Claudeは push しない）。
- 本番: 本人承認後に `v*` タグ（tagpush.sh）。

# 到着便ページへのタクシー出庫予測の組み込み — 設計

> 作成: 2026-05-18 / branch: `feat/arrivals-forecast-section` / 対象リポジトリ: `taxi-daily-report`

## 背景・課題

taxi-ic-helper リポジトリに「ターミナル別タクシー出庫台数予測」を表示する `forecast.html`
（羽田タクシー需要予測）が存在する。しかしこのページに到達できる経路は
「到着便ページの📈予測タブ」1本のみで、本番の日報アプリ（`taxi-daily-report`）には
予測ページ自体が存在しない。乗務員が使う本番アプリから予測が見られない。

## ゴール

本番の `tools/arrivals.html`（到着便ページ）1枚に、タクシー出庫予測を上部セクションとして
組み込む。乗務員が到着便ページを開けば、追加操作なしで「今後2時間の出庫台数予測」が見える。

## 非ゴール（今回やらないこと）

- 新規ページ・新タブ・iframe は作らない。
- 既存ヒートマップの「タクシー候補」モードは残す。統合予測との一本化はしない。
  結果として到着便ページに2系統のタクシー関連予測（便ベースの「タクシー候補」＋
  観測ベースの「統合予測」）が並ぶ。将来の整理対象として認識するが今回は触らない。
- taxi-ic-helper の `forecast.html` 本体、および同リポジトリのナビ
  （index.html / ic.html に予測タブが無い件）は今回いじらない。
- 予測精度（MAE）・係数補正状態の表示は本番には載せない（ML開発用の内部指標のため）。

## 全体構成

本変更は `taxi-daily-report` リポジトリ**のみ**で完結する。taxi-ic-helper 側は
変更しない。taxi-ic-helper が GitHub に既にコミットしている予測データ JSON を、
同期ワークフロー経由で読むだけ。

予測の中身は taxi-ic-helper の `forecast.html` から **セクション1〜3のみ**移植する:

1. **統合予測（今後2時間）** ＋ 校正バナー（throughput-banner）
2. **内訳: 短期予測（ルールベース）**
3. **類似日マッチング**（類似日リスト＋ヒストリカル予測カーブ）

セクション4（予測精度）・5（係数補正状態）は移植しない。

## データ同期

既存ワークフロー `.github/workflows/sync-arrivals.yml`（15分ごとに taxi-ic-helper
リポジトリをチェックアウトし `src/data/arrivals.json` を `tools/data/` へコピー）を拡張する。

`arrivals.json` に加え、以下3ファイルも `src/data/` → `tools/data/` へコピーする:

- `stall-ensemble.json`
- `stall-forecast.json`
- `stall-pattern-match.json`

- コミット判定・リトライ（rebase）ロジックは4ファイルを対象に一般化する。
- 同期頻度は 15 分のまま。予測は「今後2時間」の見通しなので15分のラグで十分。
- 初回分は現時点のスナップショット3ファイルをリポジトリにコミットしておき、
  デプロイ直後から予測が表示される状態にする。以降はワークフローが更新する。

## ファイル構成

### 追加

| ファイル | 内容 |
|---|---|
| `tools/js/forecast-render.js` | taxi-ic-helper `js/forecast-render.js` を**そのまま複製**（297行・純粋なDOM描画・外部import無し）。未使用の `renderAccuracy` / `renderCorrections` も含むが無害なため改変しない（上流との差分を最小化）。 |
| `tools/js/forecast-section.js` | **新規・約40行**。3つのJSONを読み込み、`forecast-render.js` の該当関数を呼ぶ薄いローダー。`export async function initForecastSection()`。 |
| `tools/data/stall-ensemble.json` | 同期対象。初回スナップショットをコミット。 |
| `tools/data/stall-forecast.json` | 同上。 |
| `tools/data/stall-pattern-match.json` | 同上。 |

### 変更

| ファイル | 内容 |
|---|---|
| `tools/arrivals.html` | 予測セクションのマークアップ＋CSSを追加（後述）。 |
| `tools/js/arrivals-app.js` | `initForecastSection()` を import し、読み込み時に1回呼ぶ追記。 |
| `.github/workflows/sync-arrivals.yml` | 同期対象を4ファイルに拡張。 |
| `sw.js` | キャッシュ版数を上げる（`arrivals.html` はプリキャッシュ対象。更新を全端末へ配布するため）。 |

## コンポーネント設計

### forecast-section.js（新規）

`forecast.html` の `forecast-app.js` のうち、セクション1〜3に対応する fetch + render
処理だけを抜き出した薄いモジュール。

- `initForecastSection()` を export。
- 3つの fetch（`stall-ensemble.json` / `stall-forecast.json` / `stall-pattern-match.json`）
  はそれぞれ独立した try/catch。1つが失敗しても他のセクションは表示される。
- 失敗時は該当 meta 要素にエラー文言を出し、テーブルは空にする（`forecast-app.js` と同じ作法）。
- データパスは `data/stall-*.json`（`tools/` 起点の相対パス）。

### 描画の独立性

予測の読み込みは到着便データ（`arrivals.json`）の読み込みと**独立**させる。
`arrivals-app.js` は予測の初期化を「投げっぱなし」で呼び、予測の成否が
到着便本体の描画をブロックしないようにする。逆も同様。

## arrivals.html への組み込み

### 配置

予測セクション群を、天気バナー（`#weather-banner`）／鮮度バナー（`#stale-banner`）の
**直下、`#topics` / `#legend` / ヒートマップより上**に置く。
乗務前に最初に見たい「今後2時間の出庫台数」を最上部に出す。

### マークアップ

`forecast.html` のセクション1〜3に相当する要素を移植する:

- `#throughput-banner`
- `section.ensemble-section`（`#ensemble-meta` / `#ensemble-table-wrap`）
- 内訳見出し ＋ `#forecast-meta` / `#forecast-table-wrap`
- `section.pattern-section`（`#pattern-meta` / `#similar-days` / `#historical-curve-wrap`）

セクション全体の見出しは「🚕 タクシー出庫予測（今後2時間）」とする。
`forecast.html` のタイトルにある "(MVP)" は本番では落とす。

### CSS

`forecast.html` の `<style>` から、セクション1〜3が使うルールのみ移植する:
`.forecast-*` / `.pattern-*` / `.similar-day-*` / `.ensemble-*` / `.throughput-banner`
（`.star` / `.factor-cell` / `.total-cell` / `.src-*` 等の補助クラス含む）。
`.accuracy-*` / `.correction-*` は移植しない。

- `forecast.html` の CSS は CSS変数 `--high` / `--very-high` を使うが、`arrivals.html` の
  `:root` には未定義。`arrivals.html` の `:root` に `--high: #ffb84d;` `--very-high: #ff5252;`
  を追加する（`forecast.html` と同値）。
- `arrivals.html` はグローバルに `h2 { font-size:13px; color:var(--sub) }` を持つ。
  移植する `.ensemble-section h2` 等はより詳細度が高く上書きするので問題ないが、
  実装時に見出しの見え方を目視確認する。
- `.app-tab` / `.app-tabs` は両ページに既存。重複定義しない（arrivals 側を使う）。

### アクセス制御

`arrivals.html` は既に先頭で `enforceAccess('core')` を実行している。予測は同じページ内の
追加コンテンツなので、このアクセスゲートを自動的に継承する。新規のアクセス制御は不要。

## エラーハンドリング

- 予測データ3種は各々独立に取得失敗しても、該当 meta にエラー文言を出すのみ。
  到着便本体（便リスト・ヒートマップ）には影響しない。
- 同期ワークフロー未実行などで `tools/data/stall-*.json` が存在しない場合も、
  fetch が 404 → エラー文言表示で graceful degradation。初回スナップショットの
  コミットにより通常はこの状態にならない。

## テスト

- `forecast-render.js` は taxi-ic-helper 側で既存テスト済み。本リポジトリへは複製のみで
  改変しないため、追加テストは不要。
- 新規 `forecast-section.js` に軽量テストを1本追加（`tests/` 配下）。
  データ欠損・fetch失敗時にエラー文言を出して例外を投げ切らないことを確認する。
  fetch をスタブして検証する。
- 全既存テストの回帰確認（`npm test`）。

## デプロイ

既存の dev → 本番フローを遵守する。

1. `feat/arrivals-forecast-section` で実装。
2. dev環境（`dev` リモート）へ反映し、ユーザーが dev で動作確認。
3. ユーザー承認後、本番（`origin/main`）へ反映。

## 影響範囲・リスク

- 変更は `taxi-daily-report` リポジトリのみ。taxi-ic-helper には影響しない。
- 既存の到着便ページの機能（便リスト・ヒートマップ・天気/鮮度バナー）は変更しない。
  予測セクションは追加のみ。
- `sw.js` 版数更新により、全端末で `arrivals.html` の再キャッシュが走る。
- 既知のトレードオフ: 到着便ページに2系統のタクシー予測が並ぶ（非ゴール参照）。

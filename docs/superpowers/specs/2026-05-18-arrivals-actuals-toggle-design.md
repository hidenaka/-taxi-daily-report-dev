# 到着便ページ 出庫実績表示＋予測切替 設計書

> 作成: 2026-05-18

## 目的

到着便ページの「タクシー出庫予測」セクションは今後2時間の予測のみを表示している。これに加えて、**直近2時間に実際に出ていったタクシー台数（実績）を既定表示**にし、プルダウンで予測表示にも切り替えられるようにする。

## 背景

- 予測セクションは `stall-ensemble.json`（未来2時間の予測、5分スロット）を読み 15 分単位の表で描画している（`tools/js/forecast-section.js`）。
- 「実績」にあたるデータ（過去の実出庫台数）は現状アプリに配信されていない。
- 予測は F-3 車両トラッカー実測アンカー型に再設計済み。実績も同じ「トラッカーが実測した出庫台数」を使えば、実績と予測が同一の物差しで並ぶ。占有差分（net-diff）由来の実績は満車時0になるため使わない。

## 採用アプローチ（A）

taxi-ic-helper が新出力 `stall-actuals.json`（直近実出庫の15分集計）を生成 → relay が dev/prod へ配信 → 到着便ページの予測セクションにプルダウンを追加し、既定=実績／切替=予測。

### 不採用案
- **B（生履歴をアプリ配信しクライアント集計）**: 観測履歴 jsonl は大きく、アプリ側集計も重い。却下。
- **C（既存の精度評価用 actual を流用）**: それは占有差分（net-diff）基準で、満車時0になる。予測で解消したばかりの問題が実績側で再発するため却下。

## 設計

3パートに分かれる。

### パート1: taxi-ic-helper — `stall-actuals.json` の生成

`scripts/observe-taxi-pool.mjs` が observe-tick ごとに `data/stall-actuals.json` を書き出す。

- 内容: 直近2時間（now から遡って120分）の、車両トラッカー実測出庫を **15分スロット**で集計した配列。各スロット `{ slotStart: "H:MM", slotEnd: "H:MM", total: <整数> }`。
- データ源: `vehicle-track-history.jsonl` の `departed`（トラッカーが実測した出庫台数）。`departed` が `null` のtickは0として扱う。
- 集計の純関数を `scripts/lib/` に新設（テスト可能な単位）。`observe-taxi-pool.mjs` はそれを呼んで書き出すだけ。
- スキーマ: `{ schemaVersion, generatedAt, slots: [...] }`。`generatedAt` は JST 文字列（既存出力と同形式）。
- 乗り場別の内訳は持たない（トラッカーの `departed` は合算値で乗り場分離できないため）。実績は「スロット合計台数」のみ。

### パート2: relay — 配信ファイルに追加

`taxi-ic-helper/.github/workflows/relay-taxi-data.yml` の `FILES` に `stall-actuals.json` を追加（現状 `arrivals.json stall-ensemble.json` → `arrivals.json stall-ensemble.json stall-actuals.json`）。observe-tick の push で dev/prod 両方の `tools/data/` へ配信される。

### パート3: 到着便ページ — プルダウン切替

`tools/js/forecast-section.js` ＋ `tools/arrivals.html`。

- 予測セクションの見出し直下に `<select>` プルダウンを追加。選択肢: **「実績（直近2時間）」**（既定）と **「予測（今後2時間）」**。
- 既定（実績）: `stall-actuals.json` を読み、15分スロットの**合計台数**を表で表示。表の各行 = スロット時刻＋合計台数。
- 切替（予測）: 現行の `stall-ensemble.json` ベースの表（15分・乗り場別＋合計）をそのまま表示。
- 実績と予測で表の列構成が異なる（実績=時刻＋合計の1列、予測=乗り場別＋合計）。プルダウン切替で表全体を描き直す。
- データ取得失敗・古い（`isStale`、120分閾値）場合は現行と同じく「取得できていません」表示。実績・予測それぞれ独立に判定。
- プルダウンの選択は `localStorage` に保存し、次回開いたとき復元する（既定は実績）。

## テスト方針（TDD）

- taxi-ic-helper: トラッカー出庫の15分集計純関数（直近2時間の窓・`departed` null 混在・スロット境界）。
- 日報アプリ: 実績データの表描画、プルダウン切替で表が実績/予測に切り替わる、データ欠損・stale 時の表示、localStorage 復元。
- 既存の `forecast-section` テスト（`aggregateTo15min`/`isStale`/`loadEnsemble` 等）は回帰維持。
- 両リポジトリで `npm test` 全件パス。

## デプロイ

- taxi-ic-helper 側（`stall-actuals.json` 生成・relay）: main 直 push。observe-tick が次回から生成・配信。
- 日報アプリ側（UI）: dev に反映 → ユーザーが dev で確認 → 承認 → 本番（`origin/main` へ cherry-pick）。

## 波及・確認事項

- `stall-actuals.json` が未配信の初回（taxi-ic-helper 反映直後〜次 observe-tick まで）はアプリ側で「取得できていません」表示になる。observe-tick 1サイクル（最大5分）で解消。
- relay の `FILES` 追加は既存配信に影響しない（コピー対象が1つ増えるだけ）。
- 予測表示（プルダウン切替後）は現行と完全に同一。予測側のロジックは変更しない。

## スコープ外

- 実績の乗り場別内訳（トラッカーが乗り場分離できないため原理的に不可）。
- 実績の遡り時間のユーザー設定（固定2時間）。
- pattern-match のトラッカー化（別タスク・データ蓄積待ち）。

## 成功基準

- taxi-ic-helper が `stall-actuals.json` を生成し relay が dev/prod へ配信する。
- 到着便ページの予測セクションに実績/予測プルダウンがあり、既定で直近2時間の実出庫合計が表示される。
- プルダウンで予測表示に切り替わり、現行の予測表と同一の表示になる。
- 両リポジトリの `npm test` 全件パス。
- dev 実機で実績表示・切替・stale 表示が確認できる。

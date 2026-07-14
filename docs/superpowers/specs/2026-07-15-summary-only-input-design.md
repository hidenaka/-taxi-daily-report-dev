# 合計金額のみ入力（summary-only 日報）設計

日付: 2026-07-15
ステータス: レビュー待ち

## 背景と目的

日報は画像OCR（Firebase Functions / PP-OCRv5）で取り込むが、撮影条件やサーバーエラーで読み取れない日がある。現状 `input.html:565` に `if (!parsed) return alert(...)` のガードがあり、**明細（trips）が無い日報を保存する導線が存在しない**。そのため OCR が失敗した日は日報そのものを残せず、給与計算に穴が空く。

本設計は「売上合計（税込）だけを入力して、その日の日報を保存できる」経路を追加する。合わせて、実質使われていない Gemini テキスト貼付経路を `input.html` から撤去し、その場所を合計入力に置き換える。

## スコープ

含む:
- `input.html` に「明細あり / 合計のみ」の 2 モードを追加
- Gemini テキスト貼付 UI を `input.html` から撤去
- summary-only レコードのデータモデル定義と下流（給与・グラフ・コーチ）の対応
- 同日付レコードのモード跨ぎ上書き時の確認ダイアログ
- `ocr-import.html` の失敗時フォールバック導線

含まない:
- `bulk-input.html` / `admin.html`（引き続き `js/parser.js` を使う。parser.js は残す）
- グループプール（`js/group-pool-core.js`）: 改修不要。理由は「下流方針」参照
- 乗車回数・走行距離の入力（今回は売上のみ。YAGNI）

## データモデル

Firestore `drives/{userId}/daily/{YYYY-MM-DD}` に 2 フィールドを追加する。

| フィールド | 型 | 説明 |
|---|---|---|
| `_summaryOnly` | boolean | true = 合計のみレコード。明細ありレコードには付けない（undefined のまま） |
| `totalSales` | number | 税込の売上合計。`_summaryOnly === true` のときのみ意味を持つ |

summary-only レコードの形:
```js
{
  date: '2026-07-15',
  _summaryOnly: true,
  totalSales: 52300,          // 税込
  trips: [],
  rests: [],
  vehicleType, departureTime, returnTime, totalDistanceKm, memo, weather,
  violations, shareOptOut, createdAt, updatedAt, companyId,   // 既存どおり
  rawText: '',                // 新規は常に空
}
```

`trips: []` / `rests: []` は明示的に空配列で保存する（undefined にしない）。下流の `(drive.trips || [])` パターンを壊さないため。

**代替案（不採用）**: 合計額を持つダミー trip を 1 行入れる。乗車回数が 1 と数えられ、時刻・場所のない trip が全グラフに混入し、`trips.length` を数える箇所（`index.html:973`, `detail.html:136` ほか）を全部直す必要が出るため不採用。

## UI: input.html

### モード切替

画面上部（日付入力の直下）に 2 タブのセグメントを置く。

- **明細あり**（デフォルト）— 現状の挙動。OCR取り込み結果 or 既存レコードのプレビュー表を編集して保存
- **合計のみ** — プレビュー表を隠し、「売上合計（税込）」の数値入力 1 つを出す

ヘッダー系フォーム（日付・乗務種別・出庫・帰庫・総走行距離・メモ・違反チェック）は**両モード共通**で常に表示する。

`input.html?mode=summary` で開いた場合は「合計のみ」タブを選択した状態で起動する。

既存レコードを読み込んだ場合は、そのレコードの `_summaryOnly` に応じてタブを自動選択する。

### Gemini 貼付 UI の撤去

`input.html` から削除する要素:
- `#rawTextInput` textarea（:91）
- `<details>` の「🤖 外部AI（Gemini）で取り込む（自己責任）」ブロック（:96-101、プロンプトコピーボタン含む）
- 「テキストを読み込む」ボタンとそのハンドラ（:435-448）
- `import { parseReport, parseFormattedReport } from './js/parser.js'`（:163）

依存確認済み:
- OCR取り込み経路（`applyOcrImport`, :281）は sessionStorage の構造化データを `parsed` に直接セットしており parser.js に依存しない
- 既存レコード編集経路（:255）も `parsed` に直接セットしており依存しない
- `js/parser.js` は `admin.html:367` / `bulk-input.html:171` / テスト 2 本がまだ使うので**ファイルは残す**
- `rawText` の保存（:584）は textarea 由来 → 「既存レコードの rawText を引き継ぐ、無ければ空文字」に変更。過去レコードの rawText を消さない

### 保存バリデーション

`input.html:565` のガードをモード別に分岐:

- 明細ありモード: 現状どおり `parsed` が無ければ弾く。ただしメッセージは「テキストを読み込む」ではなく「日報画像を読み取ってください」に変更（Gemini 撤去に伴う文言修正）
- 合計のみモード: `totalSales` が空・非数値・0 以下なら「売上合計を入力してください」で弾く

## 上書き保護

保存時、同日付の既存レコードを読み、**モードが変わる上書き**のときだけ確認ダイアログを出す。

| 既存 | 保存しようとしているもの | 挙動 |
|---|---|---|
| なし | どちらでも | 無言で保存 |
| 明細あり | 明細あり | 無言で上書き（現状どおり） |
| 合計のみ | 合計のみ | 無言で上書き |
| **合計のみ** | **明細あり** | 「この日は合計のみで登録済みです。明細で上書きしますか？」 |
| **明細あり** | **合計のみ** | 「この日は明細付きで登録済みです。明細が消えます。合計のみで上書きしますか？」 |

後者（明細 → 合計のみ）が本命のガード。うっかり明細を消す事故を防ぐ。

## 下流の方針

| 下流 | 扱い | 改修 |
|---|---|---|
| `js/payroll.js:3 calcDailySales` | **含める**。`_summaryOnly` なら `totalSales` を使う | 要 |
| `calcMonthlySales` / 基本給 / 歩合 | 含める（`calcDailySales` 経由なので自動的に追従） | 不要 |
| `js/chart-helpers.js:96 isSummaryOnly` | `_summaryOnly` を判定に追加 | 要（1行） |
| 時間帯 / エリア / km 系グラフ | 明細ゼロなので自然に何も出ない。平均値の分母からは `isSummaryOnly` で除外 | 既存の呼び出し側（`index.html:976,1231`, `review.html:287,465,492`）は改修不要 |
| 客単価・時給などの平均 | 分母から除外（`chart-helpers.js:914 avgTripSales`, `coach/fact-engine.js:25` の 0 除算対策） | 要 |
| AI コーチ `js/coach/*` | 分析対象から除外（明細前提） | 要 |
| `js/group-pool-core.js` | **改修不要** | 不要 |
| `detail.html` / `index.html` | 「合計のみ」バッジ表示 | 要 |

### group-pool が改修不要な理由

`buildGroupPool`（`group-pool-core.js:56`）が共有プールに出力するのは `heatmap`（曜日×時刻の人ごと時給中央値）と `areas`（降車エリア集計）だけで、日合計売上は出力しない（コメント :55「合計は出力に残さない」）。さらに `peerMedianHourlyDow`（`chart-helpers.js:724`）は `workingMin > 0 && hourlyA > 0` のセルしか積まないため、明細ゼロの日報はプールに 1 セルも足さない。他メンバーの中央値を汚さない。

### isSummaryOnly の既存フラグ

現行の `isSummaryOnly` は `drive._importedFrom === 'spreadsheet'` または `trips.some(t => t._periodCount)` を見ているが、**これらを書き込むコードは現存しない**（過去のスプレッドシート移行の名残）。今回 `_summaryOnly` を追加することで、この関数が正式に機能する状態に戻る。既存の 2 条件は後方互換のため残す。

## ocr-import.html のフォールバック導線

`js/ocr-import.js` の失敗パス 3 箇所（:129 HTTPエラー / :140 明細0件 / :152 例外）で、`#ocrStatus` にメッセージを出すだけでなく **「合計金額だけ入力する」リンク（`input.html?mode=summary`）** を併せて表示する。

## テスト

`tests/` に Node 標準テストランナー（`npm test` = `node --test tests/*.test.js`）で追加。

新規 `tests/summary-only.test.js`:
1. `calcDailySales({_summaryOnly:true, totalSales:52300, trips:[]})` → `inclTax === 52300`, `exclTax === 52300/1.1`
2. `calcDailySales` の明細ありパスが従来どおり（回帰）
3. `isSummaryOnly({_summaryOnly:true})` === true / `isSummaryOnly({trips:[{amount:1000}]})` === false
4. `buildGroupPool` に summary-only 日を混ぜても heatmap セル数が増えない
5. `avgTripSales` が summary-only 日を分母に入れず NaN を返さない

既存テスト（`tests/chart-helpers.test.js`, `tests/parser.test.js` ほか）が全て通ること。特に `input.html` から parser の import を外しても `parser.test.js` / `parsefmt.test.js` は無関係に通る。

## リスク

- **明細あり日報を合計のみで上書きする事故** → 上書き確認ダイアログで防ぐ
- **合計のみ日が増えると分析の質が落ちる** → 仕様上避けられない。バッジ表示でユーザーに可視化する
- **Gemini 撤去で「画像は読めないが手で全明細を入れたい」ケースの導線が消える** → 元々「行を追加」ボタンが無く、ゼロから明細を手入力する導線は存在しなかった。実質の後退はない

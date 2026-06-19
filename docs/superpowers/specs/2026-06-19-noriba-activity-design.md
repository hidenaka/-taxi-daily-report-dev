# 乗り場アクティビティ（号別の今） — 設計

- 日付: 2026-06-19
- 対象: taxi-daily-report（到着便ページ）／データは既存（追加収集なし）
- 方向: 既存「乗り場別カード」をメーター型カードに刷新（ビジュアルコンパニオンで方向C確定）

## 1. 背景・目的
到着便ページの号別表示を、各乗り場（号1-4）の「**需要・動き・通常比・いつまで活発か**」を一目で掴めるメーター型カードに刷新する。タップで詳細（来る便リスト＋動きの推移グラフ＋通常比）。視覚的に「どの乗り場がどれくらい忙しく、いつまで続くか」を直感的に。号1・2＝T1（薄い赤）、号3・4＝T2（薄い青）で所属ターミナルを感覚的に色分け。

## 2. データソース（全て既存・追加収集不要）
- `arrivals.json`: 便ごと `poolLane`(号1-4), `terminal`, `estimatedTime`/`scheduledTime`, `estimatedTaxiPax`, `seatCount`, `fromName`, `status`。→ 需要（✈/便数/人数）、次便/最終便、詳細の来る便リスト。
- `advance-forecast.json`: `slots[96]`(全日15分予測カーブ＝**通常時の基準**), `actualsToday[12]`(今日実測), `current`, `rowWidth`, 各 `stall1..4`。→ 動き(今)、通常比(実測÷基準)、活発until(slots先読み)、推移グラフ。**2828行の蓄積実績から作られた基準**。
- `pool-status.json`: プール在台 → カード上部1行。
- いずれも relay で到着便ページに配信済み。**追加配信なし**。

## 3. コンポーネント
### データ層（`tools/js/arrivals-data.js` 拡張・純関数）
- `buildNoribaActivity(arrivals, forecast, now)` → 号別配列:
  ```
  { lane:1..4, terminal:"T1"|"T2",
    demand:{ flights60, pax60, planeIcons(1..5), nextFlight, lastFlight },
    movement:{ level:"強"|"中"|"弱"|null, normalRatio:number|null, ratioDir:"up"|"eq"|"down",
               activeUntil:"HH:MM"|"soon"|"long"|null, sparkFuture:number[] },
    detailFlights:[ {time, fromName, seatCount, taxiPax} ... ] }
  ```
- `classifyNormalRatio(actual, baseline)` → `{ratio, dir}`（0除算ガード）。
- `findActiveUntil(forwardSlots, peak)` → ピークの一定割合を下回る最初の時刻。
- 既存 `summarizeByNoriba` は需要集計に再利用 or 内部統合。

### 表示層
- `renderNoribaActivity(container, activity, opts)`（新規・`arrivals-render.js`）: メーターカード4枚（号1-4固定）＋プール在台行。各カードに需要(✈)・動きバー・通常比バッジ・活発until・ミニ折れ線。タップで詳細展開（来る便リスト＋推移SVG＋時間軸＋通常比文＋最終便）。
- `renderMovementCurve(svgEl, {normal, today, forecast, nowBin, activeBin, window})`（新規）: 推移グラフSVG。
- 既存 `renderNoribaCards` を置換。マウントは既存 `#noriba-cards-section` を流用（HTML変更最小）。

### 配線（`arrivals-app.js`）
- 既に `loadArrivals()`。`advance-forecast.json` を読む（forecast-section が既に読んでいれば共有、無ければ `loadForecast()` 追加）。`render()` で `renderNoribaActivity(#noriba-cards-section, buildNoribaActivity(...))` を呼ぶ（現 `renderNoribaCards` 呼び出しを置換）。

## 4. 視覚仕様
- 号1,2＝T1 薄い赤（背景 #241416 / border #5a2a2a）、号3,4＝T2 薄い青（背景 #10202a / border #2a4a5a）。各カードに「N号·T1/T2」。
- 需要: ✈ピクトグラム（便数を最大5個表示、6+は「✈×5 +」）＋「次60分 N便」。
- 動き: バー（色 黄→赤＝強さ）＋「動き 強/中/弱」＋通常比バッジ（↑多い/≈並み/↓静か）。
- いつまで: ⏱「活発〜HH:MM」/「まもなく落ち着く」/「当面活発」＋ミニ折れ線。
- タップ詳細: 来る便（時刻・地名・定員・推定人数）、推移グラフ（**表示窓=過去2時間〜先2時間**の固定窓、時間軸ラベル=開始/│今/活発終了/終端）、通常比の平易な説明、🏁最終便。
- **見切れ対策（本番必須）**: 幅100%流動／グラフSVGは `viewBox`＋幅100%でスケール／時刻ラベルは両端を内側寄せ／動き行は `flex-wrap` で折返し／長い地名は省略（…）／横スクロール無し。最小320px幅で崩れないこと。

## 5. 通常比・活発until のロジック
- 通常比 = `actualsToday[nowBin].stallX ÷ slots[nowBin].stallX`。基準≈0（<0.3等）なら非表示（「—」）。dir: >1.25=↑多い / 0.75〜1.25=≈並み / <0.75=↓静か。号別に算出。
- 活発until = now以降の `slots` を走査し、その号の**当日ピーク×50%** を下回る最初の時刻。下回らなければ「当面活発」。直近（次15分）で下回るなら「まもなく落ち着く」。
- **裏ロジック（しきい値・手法名・係数）はユーザー表示に出さない**。結果＋平易な意味のみ（[[feedback_no-mechanism-text-in-user-displays]]）。表示語: 「通常より多い/並み/静か」「活発〜◯時」。数字の「1.8×」は補助的に可（言葉優先）。

## 6. エラー処理・安全劣化
- forecast 欠落/古い → 動き・通常比・活発until を非表示にし、需要（arrivals）だけ表示。
- 基準≈0 → 通常比非表示。
- データ取得失敗 → カードは需要のみ、または既存挙動にフォールバック。

## 7. テスト
- `buildNoribaActivity`/`classifyNormalRatio`/`findActiveUntil` 純関数を `tests/*.test.js`（既存ハーネス `./run.js`）でユニットテスト:
  - 号振り分け＋T1/T2マッピング（1,2=T1 / 3,4=T2）。
  - 需要集計（次60分・欠航除外・過去便除外）。
  - 通常比（0除算ガード／↑≈↓判定）。
  - 活発until（ピーク割れ検出／当面活発／まもなく）。
- 既存全テスト緑維持。SW CACHE_NAME を bump。

## 8. 既存からの置換
- `renderNoribaCards`（現号別カード）→ `renderNoribaActivity` に置換。次便/最終便（深夜）情報は詳細・カードに保持。
- 列移動の forecast-section（メイン予測/実測）は**残す**（別セクション）。本機能は号別カードの刷新に限定（不要なリファクタはしない）。

## 9. 非対象（YAGNI）
- 地理的に正確な地図（模式色分けのみ）。
- 曜日/天候別の通常基準（時間帯平均で十分、後日精緻化の余地）。
- アニメーション（静的＋折れ線で十分）。
- pool-notice（末尾規制/現地案内）との統合（別バナーで既出荷済み、ここでは触らない）。

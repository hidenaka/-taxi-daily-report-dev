# 乗り場の状況（到着便・待機車両・流れの材料提示） — 設計

- 日付: 2026-06-19
- 対象: taxi-daily-report（到着便ページ）。既存の号別アクティビティカード(v1.79.0)を作り直す
- 方向: ビジュアルコンパニオン＋codexレビューで確定。**評価/おすすめを下さず、考える材料を中立に並べる**

## 1. 背景・目的
先日出した号別メーターカードを、(1)新指標「**待機車両**(埋まり具合)」を追加し、(2)狙い目度/おすすめ等の**評価を撤去**して「**到着便・待機車両・流れ**」の3要素を中立に提示する"考える材料"へ作り直す。良し悪しの判断は乗務員に委ねる（触媒スタンス。[[ref-orchestration]]の自律性保護と整合）。**判断時刻(◯時◯分時点)を明示**。

## 2. 用語・ラベル
- **到着便**: その号に来る便（需要）。arrivals 由来。
- **待機車両**: その号で待っているタクシーの埋まり具合。pool-status のカメラ計測（見える範囲）。
- **流れ**: 列移動（advance-forecast）。バーに「通常」目盛りを置き、通常比を**言葉でなく視覚で**表す。

## 3. データソース（全て既存・追加収集なし・relay配信済み）
- `arrivals.json` → 到着便（60分内便数、詳細の来る便リスト、直近便、最終便）。既存 `summarizeByNoriba` 再利用。
- `advance-forecast.json`（slots/actualsToday/current）→ 流れ（今の強弱、通常基準=slots当時間帯、先読みsparkline、いつ落ち着くか）。**leave-one-out修正後の正確な値**（[[reference_advance-commonmode-leaveoneout-fix]]）。
- `pool-status.json`（`stalls.stall1..4` の `occ`/`vehicles`）→ **待機車両**。NEW。pool-status は既に到着便ページのプール現況セクションが読込済み。
- 判断時刻: `arrivals.json.updatedAt` もしくは pool-status の `generatedAt` の新しい方。

## 4. 撤去するもの（shipped v1.79.0 から）
- 狙い目度 ◎○△、「今のおすすめ」バー、「今が狙い目/そこそこ/待ち長め」の評価語、通常比の言葉表現（「通常より多い↑」）、％。
- 絵文字（🚖⭐✈⏱）、発光（box-shadow glow）/強いグラデーション。

## 5. 残す・追加（各号 1-4 固定、T1=左罫線 赤/T2=左罫線 青）
- **到着便**: 便ドット（点）で本数＋「60分内 N便」。
- **待機車両**: セグメントバー（埋まり具合）。段数主体、補助語（少なめ/並程度/多め）は短く。
- **流れ**: トラックバー＋「**通常**」目盛り（fill が目盛りより右＝通常以上）＋強/中/弱。
- **この先**: 先読みミニ折れ線＋落ち着く時刻（事実。「活発」等の評価語は使わない）。
- 上部に「**HH:MM 時点**」の判断時刻。
- **タップで詳細**: 到着便リスト（時刻・地名・定員・推定人数）＋流れの推移グラフ（既存 `renderMovementCurveSvg`、時間軸付き）＋最終便。
- ビジュアル（codexレビュー反映）: 低彩度の共通カード背景＋微グラデ＋内側ハイライト、号番号を主役にしたタイポ階層（号 24-26px/800、ラベル 10.5px、補足は暖色寄り灰 #9b9a94/#7f837c）、意味色は細線・文字・バー先端のみ。

## 6. コンポーネント
### データ層（`tools/js/arrivals-data.js`・既存 `buildNoribaActivity` 拡張）
- `buildNoribaActivity(arrivals, forecast, poolStatus, now)` にシグネチャ拡張（poolStatus 追加）。各号に:
  - `occupancy: { level: 0..5segments, label:'少なめ'|'並程度'|'多め'|null, vehicles:number|null }`（pool-status の stallN.occ/vehicles から。欠落時 null）。
  - `movement` に `normalMarkerPct: number|null`（通常基準=slots当時間帯を、バー上の目盛り位置%として算出。今の値スケールに対する通常の相対位置）。
  - **狙い目度/ratioDir等の評価フィールドは出さない**（render で使わない）。`normalRatio` は内部に残してよいが表示しない。
- `occupancySegments(occ, capacity)`（占有→0..5段）、`normalMarkerPct(actualNow, baselineNow, peak)`（通常目盛り位置）を純関数で。

### 表示層（`tools/js/arrivals-render.js`・`renderNoribaActivity` 全面リスタイル）
- neutral material デザインに差し替え（到着便ドット/待機車両セグメント/流れトラック＋通常目盛り/この先sparkline/タップ詳細）。判断時刻ヘッダ。
- `renderMovementCurveSvg` は詳細グラフで流用。

### 配線（`tools/js/arrivals-app.js`）
- pool-status の既存ローダ（pool-status-section.js）を import し init で `state.poolStatus = (await loadPoolStatus()).data` を読込。`render()` の `renderNoribaActivity` 呼び出しに poolStatus と updatedLabel(判断時刻) を渡す。

## 7. エラー処理・安全劣化
- pool-status 欠落/古い → 待機車両 非表示（到着便・流れは出す）。
- forecast 欠落 → 流れ・通常目盛り・この先 非表示（到着便だけ）。
- arrivals だけでも到着便は出る。
- 見切れ対策（前回同様・必須）: 幅100%流動／SVG `viewBox` 幅100%スケール／セグメント・トラックは折返しに耐える／最小320pxで崩れない。

## 8. テスト
- `buildNoribaActivity`（poolStatus 追加）・`occupancySegments`・`normalMarkerPct` を `tests/*.test.js`（既存ハーネス `./run.js`）でユニットテスト:
  - 待機車両の結合（pool-status stallN.occ→段数・label）。pool-status 欠落→occupancy null（安全劣化）。
  - 通常目盛り位置の算出（基準≈0は目盛り非表示）。
  - 既存の到着便/流れ集計は回帰維持。
- 既存全テスト緑維持。SW `CACHE_NAME` bump。

## 9. 非対象（YAGNI）
- 狙い目度スコアリング・順位/ソート（号1-4固定）・「おすすめ」提示（撤去が要件）。
- 天候/深夜最終便圧の加味（材料は3要素に限定）。
- 待機車両の「全体台数」推定（カメラの見える範囲＝相対指標のみ。note は出さない＝裏ロジック非表示 [[feedback_no-mechanism-text-in-user-displays]]）。

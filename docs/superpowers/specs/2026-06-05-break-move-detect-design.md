# 休憩終了の移動検知ポップアップ 設計

- 日付: 2026-06-05
- 対象: `tools/index.html`（乗務タイマー）
- 状態: 設計確定（ユーザー承認済）→ 実装

## 1. 背景・目的

乗務タイマーで**休憩の「終了（ストップ/記録）」を押し忘れる**と、走行中もタイマーが休憩を加算し続け、合計休憩が**過大**になる。すると「もう必要休憩を満たした」と誤判定し、**実際には休憩不足のまま走り続け→会社ペナルティ**になる危険がある。事後（シフト後）に気づいても、その日の休憩はもう取り返せない。

対策：休憩中に**GPSで「休憩開始地点からの直線距離」を監視**し、一定距離（既定500m）を超えたら「走り出した＝休憩終了では？」と**確認ポップアップ**を出す。OKなら正しい終了時刻で休憩を締める。これにより押し忘れても休憩累計が狂わない。

ユーザーの使い方：休憩中はスマホをホルダー装着 or 手で操作（＝画面が生きていることが多い）。よってアプリ前面での監視が現実的に効く。手に持って近所を歩く誤検知を避けるため、**距離しきい値＋本人確認ポップアップ**方式にする。

## 2. スコープ（確定）

- **採用**: 移動検知ポップアップ（①のみ）
- **不採用**: 長時間休憩の催促（②）、過大カウント安全ネット（③）— 今回は入れない
- 距離方式（速度ではなく「開始地点からの直線距離」）。しきい値既定 **500m**、設定で変更可
- 終了時刻 = **しきい値を超えた時刻**（走り出した直後。休憩を過大にしない方向）

## 3. 挙動

### 3.1 監視の開始/終了
- 設定 `moveDetectOn`（既定 ON）が ON のとき、`btn-start`（休憩スタート）で：
  1. 現在位置を1回取得し `breakStartCoord = {lat, lon, at}` を保持（`at`=取得時刻）
  2. `navigator.geolocation.watchPosition`（`enableHighAccuracy:false`）で監視開始
- 監視停止（`clearWatch`）：`btn-record` / `btn-discard` / `btn-reset` / ポップアップ「はい」/ 休憩が走行中でなくなった時
- 位置許可が未許可なら開始時に要求。**拒否されたらこの機能は無効**（監視しない・エラーは出さない）

### 3.2 距離判定
- 各 position 更新で `distanceMeters(breakStartCoord, current)` を計算（ハバーサイン）
- 精度の悪い読み（`coords.accuracy > 200`）は無視（GPSグリッチ誤検知防止）
- `distance >= moveThresholdM`（既定500）になった**最初の更新時刻**を `crossingAt` として記録し、ポップアップを表示（既に表示中なら何もしない）

### 3.3 ポップアップ（`<dialog id="move-detect-dialog">`）
表示文（例）：
```
🚗 移動を検知しました（約500m）
休憩を終了しますか？
終了時刻 14:35
[ はい・終了する ]   [ いいえ・まだ休憩中 ]
```
- **はい** → 休憩を `crossingAt` で締めて記録：
  - `record = { recordedAt: <crossingAt ISO>, durationSec: floor((crossingAt - stopwatch.startedAt)/1000) }` を `records` に push
  - `stopwatch` を停止（running=false, startedAt=null, elapsedMs=0）、GPS停止、`prevRemainingMs=null`・`countdownNotified=false`
  - `saveState` → `renderAll`。合計休憩・連続走行可能時刻に反映
  - ガード：`crossingAt <= startedAt` や `durationSec<=0` の異常は記録せず破棄
- **いいえ** → ポップアップを閉じ、**基準点を現在地にリセット**（`breakStartCoord = current`、`crossingAt=null`）。監視は継続。コンビニ往復等で誤検知しても、新しい地点から再度しきい値を超えない限り再表示しない

### 3.4 バックグラウンド時（正直な限界）
- 休憩中に別アプリを開きタイマーが完全に裏 → iOSが `watchPosition` を凍結＝監視一時停止
- タイマーに戻る/走行中に画面が生きた時点で position 更新が来て距離判定 → 取りこぼしを後追いでポップアップ（その場合 `crossingAt` は復帰時刻になり、終了時刻はやや遅め）
- トンネル/ビル影でGPSロスト → 更新が来ない＝誤終了しない（安全側）

## 4. 設定UI

休憩全体に効くため、カウントダウンパネルではなく既存の**「設定」折りたたみ（`#settings-content`）**に追加：
- チェックボックス `移動を検知して休憩終了を知らせる`（`moveDetectOn`、既定 ON）
- 数値入力 `検知する距離`（`moveThresholdM`、m、既定500、min 100 / step 50）

## 5. データモデル（localStorage `taxi-timer-v1` に2項目追加）

| フィールド | 型 | 既定 | 説明 |
|---|---|---|---|
| `moveDetectOn` | boolean | `true` | 移動検知のON/OFF |
| `moveThresholdM` | number | `500` | 検知する直線距離(m)。`>=100` 妥当性チェック |

- `breakStartCoord` / `crossingAt` / watchId は**ランタイム状態**（永続化しない）
- 後方互換：旧データに無ければ既定（`normalizeTimerState` に追加、`moveDetectOn` は boolean 既定true、`moveThresholdM` は数値≥100 else 500）
- `saveState` に2項目を追記

## 6. 実装方針（純粋関数中心）

- 純粋関数 `distanceMeters(a, b)`（ハバーサイン, 引数 `{lat,lon}`）を追加しユニットテスト
  - 既存 `tools/js/geo.js` に距離関数があれば再利用を検討。無ければ `tools/js/countdown.js` に追加（テスト付）
- GPS/ダイアログのDOM配線は `tools/index.html` インラインに追加（既存の編集ダイアログ `<dialog>` と同じ流儀）
- SW：`tools/index.html` 変更のみなら `CACHE_NAME` bump（新規JSファイル化する場合は precache 追加も）

## 7. テスト

- `distanceMeters` のユニットテスト（既知2点間の距離≈実測、同一点=0、対称性）
- dev 反映後、kimi-webbridge ＋ `geolocation` を `evaluate` でモックして：
  1. 休憩開始→近距離(<500m)更新→ポップアップ出ない
  2. ≥500m更新→ポップアップ表示、終了時刻=超過時刻
  3. 「はい」→ 実経過(start→crossing)が合計休憩に加算、停止
  4. 「いいえ」→ 継続＋基準点リセット（再度500m動くまで再表示なし）
  5. `moveThresholdM` 変更が効く、`moveDetectOn` OFFで監視しない
  6. 位置拒否で無効（エラーなし）

## 8. スコープ外（YAGNI / 別途）

- 長時間休憩の催促・過大カウント安全ネット（②③）
- 速度ベース判定
- バックグラウンドでの確実な検知（iOS制約。Phase2 Web Push と同じ壁）
- 通知音の長さ設定／手動で休憩追加（別件で保留中）

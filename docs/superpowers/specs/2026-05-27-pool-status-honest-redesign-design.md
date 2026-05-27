# タクシープール現況UI 誠実再設計 Design

> 2026-05-27 設計。前提: 現況①+②は v1.35.0 で本番反映済み。本設計はその誠実化リファクタ。

## 背景

前ターンの実画像対比で、カメラ検出の在台 (`occ`) が実態の約半分しか拾えていないことが判明。これにより：

- 「在台 約N台」は**実数の半分程度**しか出ない（昼間のreal01で実態≈50台に対し検出22台）
- 「待ち目安 約N分」は `occ × 60 ÷ dep` の単純式なので、occ が過少なら**過少**に出る
- 「これから来る客 約N人」は `estimatedTaxiPax` の合計で、**機内乗客予想 × タクシー利用率予想**の二段階予想

これらの数値は乗務員の判断を誤らせる。一方で、**カメラ検出の偏りに強い指標**と**外部独立な指標**は別に存在する。それらだけを使ってUIを誠実に再設計する。

検出系の精度改善（ROI再校正）は別タスクで継続するが、本設計はその完了を待たずに「**いま信頼できるデータ**」だけで実用UIを成立させる。

---

## 設計原則

1. **絶対値を出さない**: カメラ検出由来の絶対値（occ, waitMin, estimatedTaxiPax）は UI に出さない
2. **比率・差分・外部独立は出す**: 同じバイアスで割った比率（trend, ratio）、外部運航データ（flightNumber, lobbyExitTime, seatCount）は出す
3. **過去比較で文脈化**: 直近1hの出庫を過去同条件（同曜日・祝日連休フラグ）と比較し、「いつもよりどうか」を一言で
4. **嘘をつかない**: データの限界を簡潔に明示（「カメラ推定で実数とズレあり」「運航データ・予測ではない」）

---

## 信頼度の評価軸

各データに対し3軸で判定し、**高／中／低**のラベルを付ける。

| 軸 | 高い側 | 低い側 |
|---|---|---|
| (i) ソース独立性 | 外部運航データ由来 | 内部カメラ検出由来 |
| (ii) 絶対値 vs 相対値 | 比率・差分・トレンド | 絶対値 |
| (iii) 平滑化・集計 | 多tick集計・中央値・持続確認あり | 単発tick・単純式 |

---

## データフィールド別の信頼度（3層整理）

### A) `cameras` / `total`（カメラ単位・全体）

| フィールド | 層 | 信頼度 | 採否 |
|---|---|---|---|
| `cameras.{real01,real02}.occ` | L1 | **低** | UI非表示（内部保持） |
| `cameras.{real01,real02}.fullRef` | L1 | 中 | UI非表示（内部のみ） |
| `cameras.{real01,real02}.level` | L2 | 中 | UI非表示（total.level に集約） |
| `total.occ` | L1 | **低** | UI非表示 |
| `total.level` | L2 | 中 | UI非表示（「今日の流れ」に集約） |

### B) `activity`（今日の流れ）

| フィールド | 層 | 信頼度 | 採否 |
|---|---|---|---|
| `activity.recent1hDepartures` | L1 | 中 | UI非表示（内部で過去比較に使う） |
| `activity.typical1h` | L1 | 中 | UI非表示（同上） |
| `activity.ratio` | L2 | **高** | UI 「今日の流れ」の中で形容詞化 |
| `activity.level` / `activity.arrow` | L2 | **高** | UI 主役 |
| **`activity.sameConditionCompare` (新規)** | L2 | **高** | UI 主役（「同曜日比 +13%」） |

### C) `stalls.stallN`（乗り場別）

| フィールド | 層 | 信頼度 | 採否 |
|---|---|---|---|
| `stalls.*.occ` | L1 | **低** | UI非表示 |
| `stalls.*.recent1hDep` | L1 | 中 | UI非表示（相対比較に使う） |
| `stalls.*.waitMin` | L2 | **低** | UI非表示（出力は後方互換のため残す） |
| `stalls.*.trend` | L2 | **高** | UI 主役（活発↑/横ばい→/少なめ↓） |
| **乗り場間の出庫量相対順位（新規）** | L3 | 中 | UI 副役（「4乗り場で一番動き活発」） |

### D) `terminalArrivals` ／ `terminalArrivalsList`

| フィールド | 層 | 信頼度 | 採否 |
|---|---|---|---|
| `terminalArrivals.{T1,T2}.next30/next60`（旧・人数集計） | L2 | **低** | UI非表示（廃止） |
| **`terminalArrivalsList.{T1,T2}` (新規・便リスト)** | L1 | **高** | UI 主役（運航データ直接） |

---

## UI完成形

```
🚕 タクシープール現況・出庫
📷 12:47時点（カメラ推定で実数とズレあり）
[real01カメラ写真] [real02カメラ写真]

▼ 今日の流れ
いつもより活発↑ （火曜平日 同時間帯比 +13%）

▼ 乗り場の動き
第1乗り場  少なめ↓
第2乗り場  活発↑
第3乗り場  活発↑ ← 4乗り場で一番動き活発
第4乗り場  少なめ↓

▼ これからお客がロビーに出る便 ✈ （運航データ・予測ではない）
T1 (JAL)
  あと10分  JL024  関西から     244席
  あと28分  JL026  福岡から     322席
  あと45分  JL044  那覇から     381席
T2 (ANA)
  あと08分  NH032  新千歳から   195席
  あと25分  NH128  那覇から     381席
  あと35分  NH024  伊丹から     244席
```

### 「同条件」過去比較の判定ロジック

- **日種別フラグ `dayKind`**（次の5択、優先順位順に判定）：
  1. `consecutive-last` — 連休（祝日が2日以上連続）の最終日
  2. `consecutive-middle` — 連休の中日（初日と最終日を除く）
  3. `consecutive-first` — 連休の初日
  4. `holiday` — 単独祝日（連休に含まれない祝日）または振替休日
  5. `weekend` — 土曜または日曜（祝日でない）
  6. `weekday` — 月〜金（祝日でない）
- **属性キー**: `(weekday[0-6], dayKind)` のタプル。例: 今日が火曜平日なら `(2, 'weekday')`、今日が連休最終日（その日の曜日が水曜）なら `(3, 'consecutive-last')`
- **過去サンプル抽出**: `slot-occupancy-history.jsonl` から、直近4週分のうち**同 `(weekday, dayKind)` ・同時間帯（now-1h〜now の wall-clock 時刻範囲）**にマッチするデータを集める。同じ日からは1サンプル（直近1h集計）
- **比較値**: サンプル群の `recent1hDepartures` の中央値を `peers_typical` とし、`percent = Math.round((今日のrecent1hDep / peers_typical - 1) * 100)`
- **ラベル**:
  - `percent >= +15` → `いつもより活発`
  - `percent <= -15` → `いつもより少なめ`
  - それ以外 → `いつも通り`
- **fallback**: サンプル数 < 3 なら `{ peers_typical: null, percent: null, label: null, dayLabel: '<曜日><日種別>' }`（UI側は同条件比較行を出さない、または「サンプル不足」表示）
- **dayLabel**: 例 `"火曜平日"` / `"日曜祝日"` / `"水曜・連休最終日"` — 表示用の人間可読ラベル
- **祝日カレンダー**: 日本祝日JSON（`~/repos/taxi-ic-helper/data/jp-holidays.json`）。形式: `[{ "date": "2026-01-01", "name": "元日" }, ...]`。**連休判定はこのJSONから前後日を見て自動算出**（連続祝日 or 祝日+土日 を連休とみなす）。年に1回手動更新（2026年分は最初に投入）

### 「便リスト」の生成ロジック

- **対象**: `arrivals.json` の `flights` で、`lobbyExitTime` が `[now, now+60min]` に入るもの
- **terminal 振り分け**: `terminal === 'T1'` → JAL、`'T2'` → ANA、`'T3'` は除外（国際）
- **フィールド**: `flightNumber`, `airline`, `fromName`, `seatCount`, `lobbyExitMinutes`（= `Math.round((lobbyExitTime - now) / 60000)`、分単位）, `lobbyExitTime`（"HH:MM"）
- **並び**: `lobbyExitMinutes` 昇順、同値時は flightNumber 文字列順
- **件数上限**: ターミナル毎に**最大 5便**まで pool-status.json に格納。残りは無視（必要なら次タイミングで降りてくる）
- **0件の場合**: 空配列 `[]`。UI側は該当ターミナル行を表示しない

### 乗り場相対順位ヒント

- 4乗り場のうち、`recent1hDep` が最大の乗り場 → `'最も動き活発'`、最小 → `'最も動き少なめ'`
- 同率の場合：最大/最小タイの全てに同じヒントを付ける
- 全乗り場 `recent1hDep === 0` の場合：ヒント無し

---

## 内部データ変更

`pool-status.json` の形：

```json
{
  "generatedAt": "...",
  "cameras": {...},          // 既存・内部のみ使用
  "total": {...},            // 既存・内部のみ使用
  "activity": {
    "recent1hDepartures": 59,
    "typical1h": 52,
    "ratio": 1.13,
    "level": "normal",
    "arrow": "flat",
    "sameConditionCompare": {  // 新規
      "peers_typical": 47,
      "percent": 26,
      "label": "いつもより活発",
      "dayLabel": "火曜平日"
    }
  },
  "stalls": {
    "stall1": {
      "label": "第1乗り場",
      "terminal": "T1",
      "occ": 5,              // 既存・内部のみ（UI非表示）
      "recent1hDep": 20,     // 既存・内部のみ
      "waitMin": 15,         // 既存・廃止（出力残すが UI 非表示）
      "trend": "down",       // 既存・UI主役
      "rankHint": "most-active"  // 新規（'most-active' | 'most-low' | null）
    },
    ...
  },
  "terminalArrivals": {        // 既存・内部のみ（後方互換）
    "T1": { "next30": 17, "next60": 26 },
    "T2": { "next30": 16, "next60": 27 }
  },
  "terminalArrivalsList": {    // 新規
    "T1": [
      { "flightNumber": "JL024", "airline": "JAL", "fromName": "関西", "seatCount": 244, "lobbyExitMinutes": 10, "lobbyExitTime": "12:57" },
      ...
    ],
    "T2": [...]
  }
}
```

### 後方互換

- 古いフィールド（`cameras`, `total`, `stalls.{occ,recent1hDep,waitMin}`, `terminalArrivals.next30/next60`）は**残す**（破壊しない）
- 新フィールドが**無い**古い `pool-status.json` でもUIはエラーにせず、該当行をグレースフルに省略

---

## 廃止する UI 表示

| 旧表示 | 理由 |
|---|---|
| `混み具合: ●●○○ 普通（在台 約N台・カメラ推定／実数より少なめ寄り）` | カメラ推定の絶対値、廃止 |
| `formatStallLine` の `在台 約N台` | 同上 |
| `formatStallLine` の `待ち目安 約N分` | 単純式、廃止 |
| `formatTerminalArrivals` の `30分で約N人 ／ 60分で約M人` | 人数予測の重ね合わせ、廃止 |

---

## 残課題（本設計の範囲外）

- **ROI再校正**（検出絶対値の改善）: `stall-slots.json` 座標・`edge_threshold`・fill `full_ref` のチューニング。Mac mini 側で `scripts/calibrate-slots.mjs` 等を使った別タスク。本設計とは独立に進める
- **天候フラグ**: 同条件比較に天候（晴/雨）を加える拡張。サンプル数の薄まりが懸念で、まずは曜日+祝日のみで運用
- **予測モード（forecast）**: 既存の「予測（目安・学習中）」は本設計の対象外。別系統で精度向上後に表示方針再検討

---

## 実装範囲

### Phase A: ic-helper（データ生成）

1. `data/jp-holidays.json` 投入（2026年の祝日・連休フラグ）
2. `scripts/lib/holiday-context.mjs` 新設 — `getDayContext(now, holidays)` → `{weekday, holidayFlag, dayLabel}`
3. `scripts/lib/pool-status.mjs` 拡張
   - `sameConditionCompare(rows, now, holidays)` 新設
   - `buildStallRankHint(stalls)` 新設
   - `buildTerminalArrivalsList(arrivals, now)` 新設（既存 `buildTerminalArrivals` は残す）
   - `buildPoolStatus` に新フィールド統合（既存フィールドは破壊しない）
4. `tests/pool-status.test.mjs` 拡張（新関数の境界値・fallback テスト）

### Phase B: 日報UI

1. `tools/js/pool-status-section.js`
   - 廃止: `waitText`, `formatStallLine` の在台・待ち目安部、`formatTerminalArrivals`、`混み具合` 行
   - 新設: `formatActivityLine(activity)` — 「いつもより活発↑ （火曜平日 同時間帯比 +13%）」
   - 新設: `formatStallLineV2(stall)` — 「第1乗り場  少なめ↓ ← 最も動き活発」（trend + rankHint）
   - 新設: `formatArrivalsList(terminalArrivalsList)` — 便リスト構築
   - `render()` 大幅改修
2. `tools/arrivals.html`
   - 説明文 ⓘ の中身刷新（過去比較・運航データ由来を明示）
   - `#pool-status-occ` は撤去（または空のまま残す）
3. `tests/pool-status-section.test.js` 拡張（新フォーマッタの境界値）
4. `sw.js` CACHE_NAME bump

### Phase C: 検証・反映

- dev反映（PUSH-genkyo.sh）
- 本番反映は次タグ `v1.36.0`（本人承認後）
- ic-helper側はpushしてMac miniでpull（既存ワークフロー）

---

## 成功基準

- UI 上のすべての数値が「カメラ検出の絶対値」ではなく「比率・差分・外部運航データ」由来であること
- 「同条件比較」が乗務員の状況把握を1行で支える
- 便リストが実用上の到着予定の見える化として機能（複数便を一目で）
- 既存テストはすべて緑、新テストも緑

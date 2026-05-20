# 到着便ページ強化 v2 — 設計書

> 作成: 2026-05-20
> 対象: タクシー日報 アプリ・到着便ページ (`tools/arrivals.html`)

## 目的

到着便ページに4つの機能を追加し、乗務員が「どの乗り場に並べばどこから来た客に当たるか」を実用判断できる情報を提供する。

1. **④ 航空会社別色分け + ターミナル文字タグ** — 行を見た瞬間に会社・ターミナルが分かる
2. **① 当日累計出庫台数** — JST 5:00 起点で当日の出庫実績を累計
3. **⑤(a) 出発地別 便集計** — 「どの方面の客が多く来ているか」を当日全便で集計
4. **② 出庫↔便マッチング推測** — 出庫実績の各乗り場・時間帯に「推測元の便」を紐付け

## 背景

- 既存の到着便ページは、便リスト・ヒートマップ・出庫実績/予測テーブルを持つが、乗り場とどの便の客が紐付くかが分からない
- 乗務員（ユーザー）は「ターミナルが感覚的に分かりにくい」「方面別の利用率を擦り合わせたい」と希望
- 羽田第1待機所のタクシー乗り場と着いたターミナル方角の対応は判明している:
  - T1 南側ゲート → 乗り場1
  - T1 北側ゲート → 乗り場2
  - T2 北側ゲート → 乗り場3
  - T2 南側ゲート（国際線含む） → 乗り場4
  - T3（国際線専用） → 第3待機所担当（**本仕様の対象外**）

## 採用アプローチ

### データ層の拡張（Lv3 を目指す）

便ごとに「どの乗り場の候補に該当するか」を判定する `stallCandidates` を `arrivals.json` に追加する。判定は **ODPT API の `odpt:gate` フィールド** を取得し、**ゲート番号 → 方角（北/南） → 乗り場** の lookup で行う。

**前提検証（Phase 3a の gate）:** ODPT の `odpt:gate` 充填率を 1日サンプリングで実測する。
- 充填率 ≥ 60% → そのまま Lv3 で実装継続
- 充填率 < 60% → Lv1（ターミナル粒度マッチ: T1→乗1+2, T2→乗3+4）にフォールバック

### UI 表示

```
┌─ 既存セクション ───────────────────────────────────────┐
│ [ターミナルタブ] [更新ボタン] [雷バナー] [遅延便情報]   │
│ [サマリー] [ヒートマップ]                              │
├─ 新セクション ────────────────────────────────────────┤
│ ⑤(a) 出発地別 集計（当日全便）                          │
├─ 既存：到着便リスト ──────────────────────────────────┤
│ ④ 航空会社色（左ボーダー） + ターミナル文字タグ         │
├─ 既存：出庫実績/予測テーブル ─────────────────────────┤
│ ① 当日累計（テーブル直上）                              │
│ ② 行展開で推測元便リスト（<details>）                  │
└────────────────────────────────────────────────────────┘
```

## 設計詳細

### 1. データ層

#### 1.1 ODPT API の拡張（Phase 3a）

`scripts/lib/odpt-client.mjs` `fetchHndArrivals()` の応答には既に全フィールドが含まれている（ODPTは応答に全フィールドを返す）。`odpt:gate` フィールドを `arrival-transformer.mjs` で取り出す処理を追加する。

```javascript
// arrival-transformer.mjs (擬似)
const gate = item['odpt:gate']
  ? item['odpt:gate'].split(':').pop().split('.').pop()  // "odpt.AirportGate:HND.Terminal2.62" → "62"
  : null;
```

#### 1.2 充填率の出力（Phase 3a）

`arrivals.json` 出力に `stats.gateFillRate` を追加する:

```json
{
  "flights": [...],
  "stats": {
    "unknownAircraft": ...,
    "gateFillRate": 0.73    // 0.0 〜 1.0
  }
}
```

1日サンプリングで充填率を確認し、60% を gating threshold とする。

#### 1.3 ゲート → 乗り場の Lookup 表（Phase 3b）

`data/hnd-gate-to-stall.json`（新規・手作りマスター）

```json
{
  "_note": "羽田公式 floor map から作成。更新時は CHANGELOG にも記載",
  "_updated": "2026-05-20",
  "T1": {
    "north": ["10", "11", "12", "13", "14", "15"],
    "south": ["1", "2", "3", "4", "5", "6", "7", "8", "9"]
  },
  "T2": {
    "north": ["60", "61", "62", "63", "64", "65", "66", "67", "68", "69", "50A", "50B", "51A", "51B", "52"],
    "south": ["53", "54", "55", "56", "57", "58", "59"]
  }
}
```

実際のゲート番号は羽田公式 floor map（T1/T2 北ウイング / 南ウイング / 北サテライト）を参照して列挙する。Phase 3b の最初のステップで実施。

#### 1.4 gate-to-stall 純関数（Phase 3b）

`scripts/lib/gate-to-stall.mjs`（新規）

```javascript
// gate (string|null) + terminal ("T1"|"T2"|"T3") + lookup → stallCandidates ([number])
//
// T3便:                 → []
// gate=null:            → null （未確定。UIで「乗り場推測不可」と表示）
// T1 + gate∈north:      → [2]
// T1 + gate∈south:      → [1]
// T2 + gate∈north:      → [3]
// T2 + gate∈south:      → [4]
// terminal=T1/T2 で gate がどちらにも該当しない → null
export function gateToStallCandidates(gate, terminal, lookup) { ... }
```

#### 1.5 arrival-transformer.mjs の拡張（Phase 3b）

便ごとの出力に追加:

```json
{
  "flightNumber": "NH103",
  ...
  "gate": "62",
  "gateSide": "north",
  "stallCandidates": [3]
}
```

T3便は `stallCandidates: []`、gate 未充填便は `stallCandidates: null`。

### 2. UI 表示層

#### 2.1 ④ 航空会社色 + ターミナル文字タグ（Phase 1）

**色マッピング**

| 航空会社（airline） | hex | 備考 |
|---|---|---|
| JAL | `#e60012` | 赤 |
| ANA | `#013193` | 青 |
| JJP (Jetstar) | `#ff5e1f` | 橙 |
| SKY (Skymark) | `#00b6f0` | 水 |
| ADO (Air Do) | `#4ea83a` | 緑 |
| SNA (Solaseed) | `#f4cd00` | 黄 |
| SFJ (StarFlyer) | `#4a4a4a` | グレー |
| その他 | `#777` | 灰 |

**表示**
- `.flight-row` の **左ボーダー** に航空会社色（3px solid）
- `.flight-line1` の末尾に **ターミナル文字タグ**（`T1` / `T2` / `T3`）を表示。タグ自体は単一のニュートラル背景色（`rgba(255,255,255,0.08)` 程度の薄いグレー）+ ターミナル名の文字色。航空会社色との衝突を避けるため、タグの背景に**ターミナル別の色付けはしない**

**変更ファイル**
- `tools/arrivals.html`: CSS 変数（航空会社色、ターミナル色）、`.terminal-tag` のスタイル
- `tools/js/arrivals-render.js`: `renderFlightList` に色クラス・タグ要素を追加
- `tools/js/airline-color.js`（新規）: `airlineToColorKey(airline)` 純関数

#### 2.2 ① 当日累計出庫台数（Phase 1）

**表示位置:** 出庫実績モードの `metaEl` を拡張。

```
実績 10:20 時点まで  /  JST 5:00 起点 累計 432台
```

**ロジック:** `computeAccumulatedTotal(slots, now)` は、`slotStart` が現在JSTの当日かつ JST 5:00 以降のスロットだけを取り出し、`total` を合計する（taxi-ic-helper 側の挙動に依存せず、関数側でフィルタ）。

**変更ファイル**
- `tools/js/forecast-section.js`: `renderActualsMode` で累計を計算し `metaEl` に追記
- 純関数 `computeAccumulatedTotal(slots)` を抽出してテスト可能に

予測モードでは表示しない（実績モードのみ）。

#### 2.3 ⑤(a) 出発地別 集計（Phase 2）

**表示位置:** ヒートマップ直下、到着便リスト直上の **新セクション**。

```
<section id="origin-summary">
  <h2>出発地別（今日 全便）</h2>
  <div id="origin-summary-list"></div>
</section>
```

**集計**
- 当日全便（status 不問。`欠航` は除外）
- **個別 `fromName` 単位**でグルーピング。「伊丹」「関空」「北九州」等は別レコードのまま（大都市まとめは行わない）
- 各グループに `flightCount`, `totalEstimatedTaxiPax`
- `totalEstimatedTaxiPax` の降順で並べる

**表示形式**
```
大阪       14便 / 推定タクシー客 87人
札幌       11便 / 推定タクシー客 64人
福岡        9便 / 推定タクシー客 52人
...
```

**変更ファイル**
- `tools/js/arrivals-data.js`: `aggregateByOrigin(flights)` 純関数を新規
- `tools/js/arrivals-render.js`: `renderOriginSummary(container, groups)` を新規
- `tools/arrivals.html`: 新 `<section>` の DOM と CSS
- `tools/js/arrivals-app.js`: `render()` で `renderOriginSummary` を呼ぶ

#### 2.4 ② 出庫↔便マッチング 行展開（Phase 3c）

**表示位置:** 既存 `forecast-section.js` の `renderActualsTable` を `<details>` ベースに改修。各 `<tr>` の行をクリック展開すると、その時間帯×乗り場のセルに紐付く推測元便リストが出る。

```
14:00-14:15  乗1=0  乗2=3  乗3=2  乗4=0  計=5  ▼
　└ 乗2 推測元便:
　     NH52  福岡  T1北 (ロビー出口 13:48)
　     JL304 札幌 T1北 (ロビー出口 13:55)
　   乗3 推測元便:
　     NH103 関空 T2北 (ロビー出口 13:42)
```

**マッチングロジック（純関数 `matchFlightsToStallSlots`）**
- 入力: `slots`（出庫実績スロット）、`flights`（arrivals.json の便）、`windowMin = 30`
- 各スロット × 各乗り場 (1-4) のセルに、推測元便を紐付ける:
  1. 便の `lobbyExitTime` が `slotStart - windowMin` 〜 `slotEnd` の範囲内
  2. 便の `stallCandidates` に該当乗り場番号を含む
  3. 上記両方を満たす便を「推測元便」として列挙
- 出力: `{ slotStart, stallMatches: { 1: [...flights], 2: [...flights], 3: [...flights], 4: [...flights] } }[]`

**フォールバック（gate充填率不足時）**
- `stallCandidates: null` の便はマッチング対象外（推測元便リストに出さない）
- Phase 3a の充填率が < 60% と判明した場合、Phase 3b の `gateToStallCandidates` は実装するが、**仕様を「gate を使わず terminal だけで判定」に切替**:
  - terminal=T1 → `stallCandidates: [1, 2]`
  - terminal=T2 → `stallCandidates: [3, 4]`
  - terminal=T3 → `stallCandidates: []`
- この場合 Phase 3c のマッチング UI は変更不要（複数候補便が両乗り場のセルに出るだけ）

**変更ファイル**
- `tools/js/arrivals-data.js`: `matchFlightsToStallSlots` 純関数
- `tools/js/forecast-section.js`: `renderActualsTable` を `<details>` 形式に改修
- `tools/arrivals.html`: `<details>` の折りたたみ CSS

## リポジトリ構成

本仕様は**2つの repo にまたがる**:

- **`乗務地図関係` (taxi-ic-helper) repo**: ODPT API から取得して `data/arrivals.json` を生成する側。Phase 3a/3b の `odpt-client.mjs`, `arrival-transformer.mjs`, `gate-to-stall.mjs`, `data/hnd-gate-to-stall.json` の変更はここで実施。生成物は GitHub Actions `relay-taxi-data.yml` で日報 dev/prod repo の `tools/data/` に自動 relay される
- **`タクシー日報` repo**: ブラウザで表示する側。Phase 1, 2, 3c の `tools/js/*`, `tools/arrivals.html` の変更はここで実施

別 worktree:
- 日報側: `タクシー日報-wt-arrivals-v2/` (`feat/arrivals-page-v2` branch、本仕様のホーム)
- 乗務地図側: Phase 3a 開始時に新規作成（例: `乗務地図関係-wt-arrivals-gate/` `feat/arrivals-gate-extraction` branch）

## データフロー

```
ODPT API
  └→ 乗務地図関係 repo: scripts/fetch-arrivals.mjs (GitHub Actions schedule)
       └→ scripts/lib/odpt-client.mjs (gate 取得追加 — Phase 3a)
            └→ scripts/lib/arrival-transformer.mjs (Phase 3b)
                 ├→ scripts/lib/gate-to-stall.mjs (新規 — Phase 3b)
                 └→ data/arrivals.json (stallCandidates 追加 — Phase 3b)
                      └→ GitHub Actions relay-taxi-data.yml
                           └→ タクシー日報 dev/prod repo: tools/data/arrivals.json

ブラウザ
  ├→ data/arrivals.json
  │    └→ tools/js/arrivals-data.js (aggregateByOrigin, matchFlightsToStallSlots)
  │         └→ tools/js/arrivals-render.js (色, 集計表示)
  │
  └→ data/stall-actuals.json (taxi-ic-helper 由来)
       └→ tools/js/forecast-section.js (累計, 行展開)
```

## フェーズ分け

| Phase | 機能 | 主な変更 | 検証 |
|---|---|---|---|
| 1 | ④ 色分け + ① 累計 | `arrivals-render.js`, `forecast-section.js` | 純関数テスト |
| 2 | ⑤(a) 出発地別集計 | `arrivals-data.js`, `arrivals-render.js`, html新セクション | `aggregateByOrigin` テスト |
| 3a | ODPT gate 取得 + 充填率出力 | `odpt-client.mjs`(変更), `arrival-transformer.mjs` | **1日サンプリングで実測。≥60% なら 3b へ。<60% なら 3b/3c を Lv1 にダウングレード** |
| 3b | Lookup表 + stallCandidates | `data/hnd-gate-to-stall.json`(新), `gate-to-stall.mjs`(新), `arrival-transformer.mjs` | lookup関数テスト |
| 3c | ② マッチング 行展開UI | `arrivals-data.js`, `forecast-section.js`, html `<details>` | `matchFlightsToStallSlots` テスト、UI 手動確認 |

各 Phase は独立して dev 反映 → ユーザー承認 → 本番反映可能。

## テスト方針

TDD で純関数中心にテスト。UI 描画は手動確認。

**新規/拡張テストファイル**
- `tests/arrivals-data.test.js`: `aggregateByOrigin`, `matchFlightsToStallSlots`
- `tests/forecast-section.test.js`: `computeAccumulatedTotal`
- `tests/arrivals-render.test.js`（既存に追加 or 新規）: `airlineToColorKey`
- `tests/gate-to-stall.test.js`（新規）: `gateToStallCandidates`

各テストは fixture を使い、エッジケース（T3便、gate=null、windowMin境界、欠航便除外）をカバー。

## 運用考慮

- **影響範囲:** Phase 1, 2, 3c は タクシー日報 repo のみ。Phase 3a, 3b は 乗務地図関係 (taxi-ic-helper) repo の ODPT 取得・変換側に変更が入る。Mac mini の出庫観測（slot-occupancy-tick.mjs）には影響なし
- **ODPT_TOKEN:** 既に GitHub Actions secret に登録済（`fetch-arrivals.mjs` で利用中）。追加申請不要
- **同時並行セッション:** 別 Claude セッション（`external-ai-disclosure`）が main workdir で動作中。本作業は別 worktree（`タクシー日報-wt-arrivals-v2/` `feat/arrivals-page-v2` ブランチ）で進行
- **デプロイ:** dev/main 反映 → ユーザー承認 → cherry-pick で `deploy/arrivals-v2` ブランチ → origin/main（本番）
- **gate-to-stall lookup 更新:** ターミナル工事・新サテライト開設等でゲート配置が変わったら `data/hnd-gate-to-stall.json` を手で更新。`_updated` フィールドで履歴管理

## スコープ外

- T3便（国際線専用）のマッチング — 第3待機所担当で本仕様の対象外
- 過去データ学習による推測精度向上 — 後日別仕様
- ゲート配置自動取得 — 公式ゲート対応表が無いため手作り維持
- 出庫予測モード側の②マッチング — 実績モードのみで実装（予測は乗り場別の数字のみ）

## 成功基準

- Phase 1+2 完了時: ④色分け・ターミナルタグ・①累計・⑤(a)出発地別集計が本番で動作。乗務員から「ターミナルが一目で分かる」「方面別が見える」のフィードバック
- Phase 3a 完了時: `arrivals.json.stats.gateFillRate` が観測可能。判定結果（Lv3 継続 / Lv1 ダウングレード）が定まる
- Phase 3b+3c 完了時: 出庫実績テーブルの行展開で、各乗り場・時間帯に推測元便が表示される。Lv1ダウングレード時はターミナル粒度の便が表示される（精度低下を許容）

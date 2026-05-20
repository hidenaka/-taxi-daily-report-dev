# 到着便ページ v2 — Plan B 実装計画（Phase 3a/3b/3c、2 repo）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ODPT API から `odpt:gate` を取得して `arrivals.json` に `gate`/`gateSide`/`stallCandidates` を追加し、到着便ページの出庫実績テーブルで「出庫スロット × 乗り場 → 推測元便」のマッチング推測を行展開UIで表示する。

**Architecture:** 2 repo にまたがる。乗務地図関係 (taxi-ic-helper) repo 側で ODPT gate 抽出と `arrival-transformer.mjs` 拡張、`gate-to-stall.mjs` 純関数の追加。日報 (タクシー日報) repo 側で `matchFlightsToStallSlots` 純関数と行展開 UI を追加。Phase 3a の充填率実測で Lv3（細マッチ）か Lv1（terminal粒度フォールバック）を選択する**決定ゲート**を含む。

**Tech Stack:** Vanilla JS (ES Modules), node:test, GitHub Actions (relay-taxi-data.yml)

**作業 worktree（2 つ）:**
- 日報側: `タクシー日報-wt-arrivals-v2/` (`feat/arrivals-page-v2` branch、既存)
- 乗務地図側: `乗務地図関係-wt-arrivals-gate/` (`feat/arrivals-gate-extraction` branch、Task 1 で新規作成)

**仕様参照:** `docs/superpowers/specs/2026-05-20-arrivals-page-v2-design.md`

**前提:** Plan A 完了は必須ではない（独立して進行可能）。ただし本番反映の順序として Plan A を先に出すことを推奨。

---

## File Structure

### 乗務地図関係 repo

| ファイル | 役割 | 操作 |
|---|---|---|
| `scripts/lib/arrival-transformer.mjs` | gate/gateFillRate 出力追加、stallCandidates 出力追加 | 変更 |
| `scripts/lib/gate-to-stall.mjs` | gate+terminal → stallCandidates の純関数 | 新規 |
| `data/hnd-gate-to-stall.json` | 羽田 floor map から作成した lookup マスター | 新規 |
| `tests/arrival-transformer.test.mjs` | gate/gateFillRate/stallCandidates テスト追加 | 変更 |
| `tests/gate-to-stall.test.mjs` | gateToStallCandidates テスト | 新規 |
| `tests/fixtures/odpt-arrival-sample.json` | gate あり/なしのケースを混在 | 変更 |

### タクシー日報 repo

| ファイル | 役割 | 操作 |
|---|---|---|
| `tools/js/arrivals-data.js` | `matchFlightsToStallSlots` を追加 | 変更 |
| `tools/js/forecast-section.js` | `renderActualsTable` を `<details>` 行展開化、`matchFlightsToStallSlots` を使う | 変更 |
| `tools/arrivals.html` | 行展開 CSS（`<details>`/`<summary>` のスタイル） | 変更 |
| `tests/arrivals-data.test.js` | `matchFlightsToStallSlots` テスト | 変更 |

---

## Task 1: 乗務地図関係 worktree 作成

**Files:** なし（環境セットアップ）

- [ ] **Step 1: ic-helper の dev branch から worktree 作成**

```bash
cd "/Users/hideakimacbookair/Library/Mobile Documents/com~apple~CloudDocs/タクシー乗務アプリ/乗務地図関係"
git fetch origin
git worktree add -b feat/arrivals-gate-extraction "../乗務地図関係-wt-arrivals-gate" origin/main
```

Expected: `Preparing worktree (new branch 'feat/arrivals-gate-extraction')` ... `HEAD is now at ...`

- [ ] **Step 2: worktree が作れたことを確認**

```bash
cd "/Users/hideakimacbookair/Library/Mobile Documents/com~apple~CloudDocs/タクシー乗務アプリ/乗務地図関係-wt-arrivals-gate"
git branch --show-current
```

Expected: `feat/arrivals-gate-extraction`

- [ ] **Step 3: テスト走行確認**

```bash
npm test 2>&1 | tail -10
```

Expected: 既存テスト全部 PASS（gate追加前のbaseline）

---

## Task 2: extractGate 関数 + flight ごとの gate フィールド

**Files:**
- Modify: `scripts/lib/arrival-transformer.mjs`
- Modify: `tests/arrival-transformer.test.mjs`
- Modify: `tests/fixtures/odpt-arrival-sample.json`

- [ ] **Step 1: fixture に gate ありの便を追加**

`tests/fixtures/odpt-arrival-sample.json` の **1便目（JL123）に追加**（既存の field の隣に `odpt:gate` を追加）:

```json
"odpt:gate": "odpt.AirportGate:HND.Terminal1.7"
```

**2便目（NH456）にも追加**:

```json
"odpt:gate": "odpt.AirportGate:HND.Terminal2.65"
```

3便目以降は gate を**追加しない**（未充填便のテストに使う）。

- [ ] **Step 2: Write the failing test**

`tests/arrival-transformer.test.mjs` の末尾に追記:

```javascript
test('flight に gate 文字列 (末尾の数字部分) を抽出する', () => {
  const r = transformArrivals(sample, seatsMaster, factorsMaster);
  // sample[0] (JL123) は odpt:gate: "odpt.AirportGate:HND.Terminal1.7"
  assert.equal(r.flights[0].gate, '7');
  // sample[1] (NH456) は odpt:gate: "odpt.AirportGate:HND.Terminal2.65"
  assert.equal(r.flights[1].gate, '65');
  // sample[2] (JL789) は gate なし → null
  assert.equal(r.flights[2].gate, null);
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
node --test tests/arrival-transformer.test.mjs
```

Expected: FAIL with `Expected: '7' / Received: undefined` または similar.

- [ ] **Step 4: extractGate 関数を追加**

`scripts/lib/arrival-transformer.mjs` の **`extractAirline` 関数の直後**（既存の `function classifyDomestic(code) {` の手前）に追加:

```javascript
function extractGate(odptValue) {
  if (!odptValue || typeof odptValue !== 'string') return null;
  // "odpt.AirportGate:HND.Terminal1.7" → "7"
  // "odpt.AirportGate:HND.InternationalPassengerTerminal.113" → "113"
  // "152" のような単純文字列 → "152"
  const parts = odptValue.split(':');
  const tail = parts.length > 1 ? parts[parts.length - 1] : odptValue;
  const m = tail.match(/\.([^.]+)$/);
  return m ? m[1] : tail;
}
```

- [ ] **Step 5: transformArrivals に gate フィールドを追加**

`scripts/lib/arrival-transformer.mjs` の `baseFields` オブジェクト内（`terminal,` の直後）に追記:

```javascript
    terminal,
    gate: extractGate(item['odpt:gate']),
    isInternational: classifyDomestic(from),
```

`taxiOpts == null` ブランチの return オブジェクトにも `gate` を含めるため、`baseFields` を spread しているのでそのまま含まれる（既存 spread が `...baseFields` のためOK）。確認のみで変更不要。

- [ ] **Step 6: Run test to verify it passes**

```bash
node --test tests/arrival-transformer.test.mjs
```

Expected: PASS（新テスト含む全て）

- [ ] **Step 7: Commit**

```bash
git add scripts/lib/arrival-transformer.mjs tests/arrival-transformer.test.mjs tests/fixtures/odpt-arrival-sample.json
git commit -m "feat(arrivals): ODPT odpt:gate を flights に抽出

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 3: stats.gateFillRate を出力

**Files:**
- Modify: `scripts/lib/arrival-transformer.mjs`
- Modify: `tests/arrival-transformer.test.mjs`

- [ ] **Step 1: Write the failing test**

`tests/arrival-transformer.test.mjs` の末尾に追記:

```javascript
test('stats.gateFillRate: gate が入っている flights の比率を返す', () => {
  const r = transformArrivals(sample, seatsMaster, factorsMaster);
  // sample 5件中、Task 2 で先頭2件に gate を入れた → 0.4
  assert.equal(r.stats.gateFillRate, 0.4);
});

test('stats.gateFillRate: 全便で gate なしなら 0', () => {
  const empty = sample.map(item => {
    const { 'odpt:gate': _, ...rest } = item;
    return rest;
  });
  const r = transformArrivals(empty, seatsMaster, factorsMaster);
  assert.equal(r.stats.gateFillRate, 0);
});

test('stats.gateFillRate: 空 flights なら 0', () => {
  const r = transformArrivals([], seatsMaster, factorsMaster);
  assert.equal(r.stats.gateFillRate, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node --test tests/arrival-transformer.test.mjs
```

Expected: FAIL with "gateFillRate is undefined" or similar.

- [ ] **Step 3: stats に gateFillRate を追加**

`scripts/lib/arrival-transformer.mjs` の末尾 `stats:` ブロックに追記:

```javascript
    stats: {
      totalFlights: flights.length,
      unknownAircraft: flights.filter(f => f.aircraftCode === null).length,
      internationalFlights: flights.filter(f => f.isInternational === true).length,
      byTerminal,
      totalEstimatedTaxiPax: flights.reduce((s, f) => s + (f.estimatedTaxiPax ?? 0), 0),
      gateFillRate: flights.length > 0
        ? Number((flights.filter(f => f.gate !== null).length / flights.length).toFixed(3))
        : 0
    }
```

- [ ] **Step 4: Run test to verify it passes**

```bash
node --test tests/arrival-transformer.test.mjs
```

Expected: PASS（5件中2件 gate あり → 0.4 が出る）

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/arrival-transformer.mjs tests/arrival-transformer.test.mjs
git commit -m "feat(arrivals): stats.gateFillRate を arrivals.json に出力

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 4: 充填率検証（決定ゲート）

**Files:** なし（運用タスク）

このタスクは **コードを書かず、Phase 3b/3c の方向性を決める**。

- [ ] **Step 1: feat/arrivals-gate-extraction を dev に push して GitHub Actions で本物データを取得**

```bash
cd "/Users/hideakimacbookair/Library/Mobile Documents/com~apple~CloudDocs/タクシー乗務アプリ/乗務地図関係-wt-arrivals-gate"
git push -u origin feat/arrivals-gate-extraction
```

Expected: PR を作るか、`update-arrivals.yml` を手動 trigger する（GitHub UI）。

- [ ] **Step 2: 1日分の本物 arrivals.json を観測**

最低 6時間（できれば1日）`update-arrivals.yml` を回し、各時刻の `arrivals.json` の `stats.gateFillRate` を記録する。

簡易確認スクリプト（worktree内）:

```bash
cat data/arrivals.json | node -e 'const d = JSON.parse(require("fs").readFileSync(0,"utf8")); console.log(`fillRate=${d.stats.gateFillRate} totalFlights=${d.stats.totalFlights} updatedAt=${d.updatedAt}`)'
```

GitHub の commit log で `data/arrivals.json` の履歴を辿り、複数時刻のサンプルを取る。

- [ ] **Step 3: 判定**

複数サンプルの **gateFillRate を平均** し、判定する:

- **平均充填率 ≥ 60%** → Lv3 継続。Task 5 へ進む
- **平均充填率 < 60%** → Lv1 フォールバック。**Task 5 をスキップ**し、Task 6 の `gateToStallCandidates` 実装を「gate を使わず terminal だけで判定」に切り替えて実装する

判定結果を **本plan の Task 5 のメモ欄に追記** してから次に進む。

例: `## Task 5 判定メモ（Task 4 で記録）: 平均充填率 73% → Lv3 継続`

- [ ] **Step 4: コミット不要（判定メモ更新がある場合のみ）**

判定メモを Plan に追記した場合のみ:

```bash
cd "/Users/hideakimacbookair/Library/Mobile Documents/com~apple~CloudDocs/タクシー乗務アプリ/タクシー日報-wt-arrivals-v2"
git add docs/superpowers/plans/2026-05-20-arrivals-page-v2-plan-b.md
git commit -m "docs(arrivals): Phase 3a 充填率判定メモを追記

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 5: data/hnd-gate-to-stall.json 作成

**Files:**
- Create: `data/hnd-gate-to-stall.json`

**前提:** Task 4 で「Lv3 継続」判定の場合のみ実施。Lv1 フォールバックの場合は Task 6 に進む。

### Task 5 判定メモ（Task 4 で記録）:

（Task 4 で平均充填率を記入。例: `平均充填率 73% → Lv3 継続`）

- [ ] **Step 1: 羽田公式 floor map から T1 のゲートを確認**

ブラウザで以下を開き、各ゲート番号を確認:
- T1: https://tokyo-haneda.com/text/floor/terminal1/2nd_floor.html （2階搭乗ゲート）
- T1 北ピア / 南ピアの境界を地図上で識別

- [ ] **Step 2: T2 のゲートを確認**

- T2: https://tokyo-haneda.com/text/floor/terminal2/2nd_floor.html
- 北サテライト（2025/3 新設）= 50A/B, 51A/B, 52
- 北ウイング / 南ウイング の境界を地図上で識別

- [ ] **Step 3: hnd-gate-to-stall.json を作成**

`data/hnd-gate-to-stall.json`（**ゲート番号は実際の羽田公式 floor map を見て列挙する。下記は構造のテンプレ、`_TODO_REPLACE_` 部分を確認したゲート番号に置換**）:

```json
{
  "_note": "羽田公式 floor map から作成。ゲート配置変更時は _updated を更新する",
  "_updated": "2026-05-20",
  "_source": "https://tokyo-haneda.com/text/floor/",
  "T1": {
    "north": ["_TODO_REPLACE_T1_NORTH_GATES_"],
    "south": ["_TODO_REPLACE_T1_SOUTH_GATES_"]
  },
  "T2": {
    "north": ["_TODO_REPLACE_T2_NORTH_GATES_INCL_SATELLITE_"],
    "south": ["_TODO_REPLACE_T2_SOUTH_GATES_"]
  }
}
```

- [ ] **Step 4: 確認**

JSON が valid であることを確認:

```bash
node -e 'JSON.parse(require("fs").readFileSync("data/hnd-gate-to-stall.json","utf8")); console.log("valid")'
```

Expected: `valid`

- [ ] **Step 5: Commit**

```bash
git add data/hnd-gate-to-stall.json
git commit -m "feat(arrivals): 羽田 gate → 乗り場方角 lookup マスターを追加

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 6: gate-to-stall.mjs 純関数

**Files:**
- Create: `scripts/lib/gate-to-stall.mjs`
- Create: `tests/gate-to-stall.test.mjs`

### Lv3 継続 vs Lv1 フォールバック の分岐

Task 4 の判定結果で以下を切り替える:

- **Lv3 継続:** 下記 Lv3 の実装をそのまま使う
- **Lv1 フォールバック:** Lv3 の実装をスキップし、**Step 3 を「Lv1 フォールバック実装」に差し替え**（後述）

### Step 1-5（Lv3 継続の場合）

- [ ] **Step 1: Write the failing test**

`tests/gate-to-stall.test.mjs` を新規作成:

```javascript
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { gateToStallCandidates } from '../scripts/lib/gate-to-stall.mjs';

const lookup = {
  T1: {
    north: ['10', '11', '12'],
    south: ['1', '2', '3']
  },
  T2: {
    north: ['60', '61', '50A', '52'],
    south: ['56', '57']
  }
};

test('gateToStallCandidates: T1 north gate → [2]', () => {
  assert.deepEqual(gateToStallCandidates('11', 'T1', lookup), [2]);
});

test('gateToStallCandidates: T1 south gate → [1]', () => {
  assert.deepEqual(gateToStallCandidates('2', 'T1', lookup), [1]);
});

test('gateToStallCandidates: T2 north gate → [3]', () => {
  assert.deepEqual(gateToStallCandidates('60', 'T2', lookup), [3]);
  assert.deepEqual(gateToStallCandidates('50A', 'T2', lookup), [3]);
});

test('gateToStallCandidates: T2 south gate → [4]', () => {
  assert.deepEqual(gateToStallCandidates('56', 'T2', lookup), [4]);
});

test('gateToStallCandidates: T3便は [] (第3待機所担当)', () => {
  assert.deepEqual(gateToStallCandidates('113', 'T3', lookup), []);
  assert.deepEqual(gateToStallCandidates(null, 'T3', lookup), []);
});

test('gateToStallCandidates: gate=null → null (推測不可)', () => {
  assert.equal(gateToStallCandidates(null, 'T1', lookup), null);
  assert.equal(gateToStallCandidates(null, 'T2', lookup), null);
});

test('gateToStallCandidates: T1/T2 で lookup に無いゲート → null', () => {
  assert.equal(gateToStallCandidates('999', 'T1', lookup), null);
  assert.equal(gateToStallCandidates('999', 'T2', lookup), null);
});

test('gateToStallCandidates: terminal が T1/T2/T3 以外 → []', () => {
  assert.deepEqual(gateToStallCandidates('10', 'T9', lookup), []);
  assert.deepEqual(gateToStallCandidates('10', null, lookup), []);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node --test tests/gate-to-stall.test.mjs
```

Expected: FAIL（モジュール未作成）

- [ ] **Step 3: Lv3 実装**

`scripts/lib/gate-to-stall.mjs` を新規作成:

```javascript
// 便のゲート番号とターミナルから「どの乗り場の候補に該当するか」を返す純関数。
//
// 戻り値:
//   [1] / [2] / [3] / [4]  ← 特定の乗り場（gate が lookup にあり、方角が判明）
//   []                     ← マッチング対象外（T3便など、他terminalで lookup を持たない）
//   null                   ← 推測不可（T1/T2 だが gate が null または lookup に無い）
//
// 羽田第1待機所の対応:
//   T1 南側ゲート → 乗1
//   T1 北側ゲート → 乗2
//   T2 北側ゲート → 乗3
//   T2 南側ゲート → 乗4
//   T3便 → 第3待機所担当（[]）

export function gateToStallCandidates(gate, terminal, lookup) {
  if (terminal === 'T3') return [];
  if (terminal !== 'T1' && terminal !== 'T2') return [];
  if (gate === null || gate === undefined) return null;
  const term = lookup[terminal];
  if (!term) return null;
  if (term.north && term.north.includes(gate)) {
    return terminal === 'T1' ? [2] : [3];
  }
  if (term.south && term.south.includes(gate)) {
    return terminal === 'T1' ? [1] : [4];
  }
  return null;
}
```

### Step 3 差し替え（Lv1 フォールバックの場合）

Task 4 で「Lv1 フォールバック」と判定した場合、**Step 3 の Lv3 実装は使わず**、下記に差し替える:

```javascript
// Lv1 フォールバック実装。gate と lookup は無視し、terminal のみで判定する。
// Task 4 で gateFillRate < 60% が判明したため。

export function gateToStallCandidates(gate, terminal, _lookup) {
  if (terminal === 'T1') return [1, 2];
  if (terminal === 'T2') return [3, 4];
  return [];
}
```

そして Step 1 のテストも以下に差し替える（Lv1 用テスト）:

```javascript
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { gateToStallCandidates } from '../scripts/lib/gate-to-stall.mjs';

test('gateToStallCandidates Lv1: T1 → [1, 2]', () => {
  assert.deepEqual(gateToStallCandidates(null, 'T1', null), [1, 2]);
  assert.deepEqual(gateToStallCandidates('999', 'T1', null), [1, 2]);
});

test('gateToStallCandidates Lv1: T2 → [3, 4]', () => {
  assert.deepEqual(gateToStallCandidates(null, 'T2', null), [3, 4]);
});

test('gateToStallCandidates Lv1: T3 → []', () => {
  assert.deepEqual(gateToStallCandidates(null, 'T3', null), []);
});

test('gateToStallCandidates Lv1: 不明 terminal → []', () => {
  assert.deepEqual(gateToStallCandidates(null, null, null), []);
});
```

### Step 4-5（共通）

- [ ] **Step 4: Run test to verify it passes**

```bash
node --test tests/gate-to-stall.test.mjs
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/gate-to-stall.mjs tests/gate-to-stall.test.mjs
git commit -m "feat(arrivals): gate→乗り場候補の純関数 gateToStallCandidates

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 7: arrival-transformer.mjs に gateSide/stallCandidates 出力追加

**Files:**
- Modify: `scripts/lib/arrival-transformer.mjs`
- Modify: `tests/arrival-transformer.test.mjs`
- Modify: `tests/fixtures/odpt-arrival-sample.json` (gate入りの便で T1北/T1南/T2北 のケースを揃える)

### Step 1: fixture を確認・拡張

- [ ] **Step 1: fixture を Task 5 の lookup と整合させ、T3便も追加**

Lv3 継続の場合、`data/hnd-gate-to-stall.json`（Task 5 で作成済み）に**実際に列挙したゲート番号**を fixture の `odpt:gate` 値に使う。具体例:

1. `data/hnd-gate-to-stall.json` の `T1.south` 配列に含まれるゲート（例: `"7"`）→ JL123 (T1) の `odpt:gate: "odpt.AirportGate:HND.Terminal1.7"`
2. `data/hnd-gate-to-stall.json` の `T2.north` 配列に含まれるゲート（例: `"65"`）→ NH456 (T2) の `odpt:gate: "odpt.AirportGate:HND.Terminal2.65"`

加えて、**T3便を1件 fixture に追加**（既存5件の末尾に）:

```json
{
  "@type": "odpt:FlightInformationArrival",
  "owl:sameAs": "urn:uuid:sample-6",
  "dc:date": "2026-04-25T14:30:00+09:00",
  "odpt:operator": "odpt.Operator:JAL",
  "odpt:airline": "odpt.Operator:JAL",
  "odpt:flightNumber": ["JL010"],
  "odpt:originAirport": "odpt.Airport:JFK",
  "odpt:arrivalAirport": "odpt.Airport:HND",
  "odpt:arrivalAirportTerminal": "odpt.AirportTerminal:HND.Terminal3",
  "odpt:scheduledArrivalTime": "15:00",
  "odpt:flightStatus": "odpt.FlightStatus:OnTime",
  "odpt:aircraftType": "B788",
  "odpt:gate": "odpt.AirportGate:HND.Terminal3.113"
}
```

これで T3便のテストが書ける。既存テスト（特に `arrivals-window-summary.test.mjs` の便数 assertion）への影響を確認するため、追加前後で `npm test` を走らせる。

Lv1 フォールバックの場合、fixture の gate 値は何でも良い（無視される）が、T3便の追加は同様に行う。

- [ ] **Step 2: Write the failing test**

`tests/arrival-transformer.test.mjs` の末尾に追記:

```javascript
import { readFileSync as fsReadFileSync } from 'node:fs';
const gateLookup = JSON.parse(fsReadFileSync('./data/hnd-gate-to-stall.json', 'utf8'));

test('stallCandidates: gate と lookup から乗り場候補を出力 (Lv3)', () => {
  // この test は Lv3 継続の場合のみ正しく動く。
  // Lv1 フォールバック時はテスト内容を Lv1 expectation に差し替える。
  const r = transformArrivals(sample, seatsMaster, factorsMaster, null, null);
  // sample[0] (JL123, T1, gate=7) → Lv3 では T1.south に含まれていれば [1]
  // ※ 実際の expectation は data/hnd-gate-to-stall.json と fixture の組み合わせで決まる
  // ここではテストを書く側で fixture の gate を T1.south に確実に含まれる値にする前提
  const jl123 = r.flights.find(f => f.flightNumber === 'JL123');
  assert.ok(jl123, 'JL123 should exist');
  // Lv3: [1] / Lv1: [1, 2]  ← Task 4 判定結果に応じて変える
  // assert.deepEqual(jl123.stallCandidates, [1]);  // Lv3 期待値
  // assert.deepEqual(jl123.stallCandidates, [1, 2]);  // Lv1 期待値
});

test('stallCandidates: T3便は [] (Lv3/Lv1 共通)', () => {
  const r = transformArrivals(sample, seatsMaster, factorsMaster, null, null);
  // Task 7 Step 1 で T3便 JL010 を fixture に追加済み
  const jl010 = r.flights.find(f => f.flightNumber === 'JL010');
  assert.ok(jl010, 'JL010 (T3) should exist in fixture');
  assert.deepEqual(jl010.stallCandidates, []);
});

test('stallCandidates: gate が null の T1便は null (Lv3) または [1,2] (Lv1)', () => {
  const r = transformArrivals(sample, seatsMaster, factorsMaster, null, null);
  // sample[2] (JL789, T1) は gate なし
  const jl789 = r.flights.find(f => f.flightNumber === 'JL789');
  // Lv3: null / Lv1: [1, 2]
  // assert.equal(jl789.stallCandidates, null);  // Lv3
  // assert.deepEqual(jl789.stallCandidates, [1, 2]);  // Lv1
});
```

**実装時の注意:** Task 4 判定結果に応じて、コメントアウトされた expectation のうち正しい側を有効化して、もう片方を削除する。

- [ ] **Step 3: Run test to verify it fails**

```bash
node --test tests/arrival-transformer.test.mjs
```

Expected: FAIL（stallCandidates 未実装）

- [ ] **Step 4: arrival-transformer.mjs を変更**

ファイル先頭に import 追加:

```javascript
import { estimatePax } from './pax-estimator.mjs';
import { computeLobbyExitTime, computeReachRate, hhmmToMinutes } from './route-reachability.mjs';
import { estimateTaxiPax } from './taxi-estimator.mjs';
import { gateToStallCandidates } from './gate-to-stall.mjs';
import { readFileSync } from 'node:fs';

const GATE_LOOKUP = (() => {
  try {
    return JSON.parse(readFileSync('./data/hnd-gate-to-stall.json', 'utf8'));
  } catch {
    return null;  // Lv1 フォールバック時は null でOK（gateToStallCandidates が無視する）
  }
})();
```

`baseFields` に `stallCandidates` を追加（`gate` の直後）:

```javascript
    terminal,
    gate: extractGate(item['odpt:gate']),
    stallCandidates: gateToStallCandidates(extractGate(item['odpt:gate']), terminal, GATE_LOOKUP),
    isInternational: classifyDomestic(from),
```

注: `extractGate` を2回呼んでいるが純関数で軽量なので問題ない（必要なら一旦変数に取り出す）。

- [ ] **Step 5: Run test to verify it passes**

Task 4 判定に応じてテストのコメントアウトを切り替えてから:

```bash
node --test tests/arrival-transformer.test.mjs
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/arrival-transformer.mjs tests/arrival-transformer.test.mjs tests/fixtures/odpt-arrival-sample.json
git commit -m "feat(arrivals): flights に stallCandidates を出力

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

- [ ] **Step 7: 乗務地図関係 repo を dev/origin にマージ**

```bash
git push -u origin feat/arrivals-gate-extraction
```

GitHub UI で PR 作成 → `main` にマージ。マージ後 `update-arrivals.yml` が次回起動するとき、本物 ODPT データで `stallCandidates` が入った `arrivals.json` が生成される。

`relay-taxi-data.yml` が発火して **日報 dev/prod repo の `tools/data/arrivals.json` に自動 relay** される。

- [ ] **Step 8: 日報 dev で arrivals.json を確認**

```bash
cd "/Users/hideakimacbookair/Library/Mobile Documents/com~apple~CloudDocs/タクシー乗務アプリ/タクシー日報-wt-arrivals-v2"
git fetch dev
git log dev/main --oneline -5
git pull dev feat/arrivals-page-v2  # relay 経由で来た tools/data/arrivals.json を取り込む（実際にはマージ操作になる）
cat tools/data/arrivals.json | node -e 'const d = JSON.parse(require("fs").readFileSync(0,"utf8")); console.log(d.flights.slice(0,3).map(f => ({fn:f.flightNumber, gate:f.gate, stallCand:f.stallCandidates})));'
```

Expected: 各便に `gate` と `stallCandidates` が入っている。

---

## Task 8: 日報repo: matchFlightsToStallSlots 純関数

**Files:**
- Modify: `tools/js/arrivals-data.js`
- Modify: `tests/arrivals-data.test.js`

**作業 worktree:** `/Users/hideakimacbookair/Library/Mobile Documents/com~apple~CloudDocs/タクシー乗務アプリ/タクシー日報-wt-arrivals-v2`

- [ ] **Step 1: Write the failing test**

`tests/arrivals-data.test.js` の末尾に追記:

```javascript
import { matchFlightsToStallSlots } from '../tools/js/arrivals-data.js';

test('matchFlightsToStallSlots: スロット×乗り場ごとに該当便を返す', () => {
  const slots = [
    { slotStart: '14:00', slotEnd: '14:15', total: 5, stall1: 0, stall2: 3, stall3: 2, stall4: 0 },
  ];
  const flights = [
    // lobbyExitTime 13:48, T1北→[2]、窓 30分 → 14:00 のスロット (13:30-14:15) に入る
    { flightNumber: 'NH52',  fromName: '福岡',  terminal: 'T1', lobbyExitTime: '13:48', stallCandidates: [2] },
    // lobbyExitTime 14:05, T2北→[3]、窓内
    { flightNumber: 'NH103', fromName: '関空',  terminal: 'T2', lobbyExitTime: '14:05', stallCandidates: [3] },
    // lobbyExitTime 13:00, 窓外
    { flightNumber: 'JL999', fromName: '札幌',  terminal: 'T1', lobbyExitTime: '13:00', stallCandidates: [1] },
    // stallCandidates: null は除外
    { flightNumber: 'JL000', fromName: '伊丹',  terminal: 'T1', lobbyExitTime: '13:55', stallCandidates: null },
    // T3便は stallCandidates: [] → どこにも入らない
    { flightNumber: 'JL010', fromName: 'NYC',  terminal: 'T3', lobbyExitTime: '14:00', stallCandidates: [] },
  ];
  const result = matchFlightsToStallSlots(slots, flights, 30);
  assert.equal(result.length, 1);
  assert.equal(result[0].slotStart, '14:00');
  assert.deepEqual(result[0].stallMatches[1].map(f => f.flightNumber), []);
  assert.deepEqual(result[0].stallMatches[2].map(f => f.flightNumber), ['NH52']);
  assert.deepEqual(result[0].stallMatches[3].map(f => f.flightNumber), ['NH103']);
  assert.deepEqual(result[0].stallMatches[4].map(f => f.flightNumber), []);
});

test('matchFlightsToStallSlots: 1便が複数の乗り場候補に該当する (Lv1)', () => {
  const slots = [
    { slotStart: '14:00', slotEnd: '14:15', total: 2, stall1: 1, stall2: 1, stall3: 0, stall4: 0 },
  ];
  const flights = [
    // Lv1 フォールバック: T1便は stallCandidates: [1, 2] になる
    { flightNumber: 'JL512', fromName: '福岡', terminal: 'T1', lobbyExitTime: '13:55', stallCandidates: [1, 2] },
  ];
  const result = matchFlightsToStallSlots(slots, flights, 30);
  assert.deepEqual(result[0].stallMatches[1].map(f => f.flightNumber), ['JL512']);
  assert.deepEqual(result[0].stallMatches[2].map(f => f.flightNumber), ['JL512']);
});

test('matchFlightsToStallSlots: lobbyExitTime が無い便は除外', () => {
  const slots = [{ slotStart: '14:00', slotEnd: '14:15', total: 1, stall1: 1, stall2: 0, stall3: 0, stall4: 0 }];
  const flights = [
    { flightNumber: 'JL000', fromName: 'X', terminal: 'T1', lobbyExitTime: null, stallCandidates: [1] },
  ];
  const result = matchFlightsToStallSlots(slots, flights, 30);
  assert.deepEqual(result[0].stallMatches[1], []);
});

test('matchFlightsToStallSlots: 空 slots は []', () => {
  assert.deepEqual(matchFlightsToStallSlots([], [], 30), []);
  assert.deepEqual(matchFlightsToStallSlots(null, [], 30), []);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node --test tests/arrivals-data.test.js
```

Expected: FAIL（関数未実装）

- [ ] **Step 3: 純関数を実装**

`tools/js/arrivals-data.js` の末尾に追記:

```javascript
// 出庫実績スロット × 乗り場 (1-4) のセルに対して、紐付け候補の便を返す純関数。
// 各セルの「推測元便」は:
//   - 便の lobbyExitTime が slotStart - windowMin 〜 slotEnd の範囲内
//   - 便の stallCandidates に該当乗り場番号 (1-4) を含む
// stallCandidates: null の便は除外。stallCandidates: [] (T3便など) は対象外。
//
// 入力 slots: [{ slotStart, slotEnd, stall1..4, total, ... }]
// 出力: [{ slotStart, slotEnd, stallMatches: { 1: [...], 2: [...], 3: [...], 4: [...] } }]
export function matchFlightsToStallSlots(slots, flights, windowMin = 30) {
  if (!Array.isArray(slots) || slots.length === 0) return [];
  const flightsByStall = { 1: [], 2: [], 3: [], 4: [] };
  for (const f of flights || []) {
    if (!f.lobbyExitTime) continue;
    if (!Array.isArray(f.stallCandidates) || f.stallCandidates.length === 0) continue;
    for (const s of f.stallCandidates) {
      if (flightsByStall[s]) flightsByStall[s].push(f);
    }
  }
  return slots.map(slot => {
    const startM = toSlotMinutes(slot.slotStart);
    const endM = toSlotMinutes(slot.slotEnd);
    const stallMatches = { 1: [], 2: [], 3: [], 4: [] };
    for (const stall of [1, 2, 3, 4]) {
      for (const f of flightsByStall[stall]) {
        const lm = toSlotMinutes(f.lobbyExitTime);
        if (lm === null) continue;
        if (lm >= startM - windowMin && lm <= endM) {
          stallMatches[stall].push(f);
        }
      }
    }
    return { slotStart: slot.slotStart, slotEnd: slot.slotEnd, stallMatches };
  });
}

function toSlotMinutes(hhmm) {
  if (!hhmm || typeof hhmm !== 'string') return null;
  const [h, m] = hhmm.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
node --test tests/arrivals-data.test.js
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tools/js/arrivals-data.js tests/arrivals-data.test.js
git commit -m "feat(arrivals): 出庫スロット×乗り場のマッチング純関数 matchFlightsToStallSlots

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 9: 日報repo: forecast-section.js を行展開UI化

**Files:**
- Modify: `tools/js/forecast-section.js`
- Modify: `tools/arrivals.html` (CSS)

- [ ] **Step 1: CSS を追加**

`tools/arrivals.html` の `<style>` 内、`.fc-table` のスタイル付近に以下を追加:

```css
.fc-table tbody tr.fc-row > td { cursor: default; }
.fc-table details.fc-expand { margin: 0; }
.fc-table details.fc-expand summary { list-style: none; cursor: pointer; padding: 2px 0; color: var(--sub); font-size: 11px; }
.fc-table details.fc-expand summary::-webkit-details-marker { display: none; }
.fc-table details.fc-expand[open] summary { color: var(--accent); }
.fc-match-block { font-size: 11px; padding: 4px 0 4px 8px; color: var(--fg); }
.fc-match-block .fc-match-stall { font-weight: 600; color: var(--accent); margin-right: 4px; }
.fc-match-block .fc-match-flight { display: block; padding: 1px 0; font-variant-numeric: tabular-nums; }
.fc-match-block .fc-match-meta { color: var(--sub); margin-left: 6px; }
.fc-match-empty { color: var(--sub); padding: 4px 8px; font-size: 11px; }
```

- [ ] **Step 2: forecast-section.js の `loadActuals` の呼び出し元で arrivals.json も読む**

`tools/js/forecast-section.js` の `loadActuals` 関数の直後に追加:

```javascript
// arrivals.json を取得する（マッチング用）。失敗時は空配列扱い。
export async function loadArrivalsForMatch(fetchFn = fetch) {
  try {
    const res = await fetchFn('data/arrivals.json', { cache: 'no-store' });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data.flights) ? data.flights : [];
  } catch {
    return [];
  }
}
```

- [ ] **Step 3: `renderActualsTable` を行展開対応に変更**

`tools/js/forecast-section.js` の `renderActualsTable` を以下に差し替える:

```javascript
// 出庫実績スロット配列を HTML テーブルに描画する（乗り場別＋合計＋マッチング行展開）。
// matchedSlots は matchFlightsToStallSlots の出力。slots と1:1対応する。
export function renderActualsTable(slots, matchedSlots = null) {
  if (!slots || slots.length === 0) return '<p class="fc-empty">実績データなし</p>';
  const rows = slots.map((s, i) => {
    const match = matchedSlots && matchedSlots[i];
    const expand = match ? renderMatchExpand(match) : '';
    return `<tr class="fc-row">
      <td class="fc-time">${s.slotStart}-${s.slotEnd}</td>
      <td>${s.stall1 ?? 0}</td><td>${s.stall2 ?? 0}</td><td>${s.stall3 ?? 0}</td><td>${s.stall4 ?? 0}</td>
      <td class="fc-total">${s.total ?? 0}</td>
    </tr>${expand}`;
  }).join('');
  return `<table class="fc-table">
    <thead><tr><th>時間帯</th><th>乗1</th><th>乗2</th><th>乗3</th><th>乗4</th><th>計</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function renderMatchExpand(match) {
  const blocks = [1, 2, 3, 4].map(stall => {
    const flights = match.stallMatches[stall] || [];
    if (flights.length === 0) return '';
    const lines = flights.map(f => `
      <span class="fc-match-flight">
        ${f.flightNumber} ${f.fromName}
        <span class="fc-match-meta">${f.terminal} / ロビー出口 ${f.lobbyExitTime}</span>
      </span>`).join('');
    return `<div class="fc-match-block"><span class="fc-match-stall">乗${stall}</span>${lines}</div>`;
  }).join('');
  const inner = blocks || '<div class="fc-match-empty">推測元便なし</div>';
  return `<tr><td colspan="6"><details class="fc-expand"><summary>▼ 推測元便を表示</summary>${inner}</details></td></tr>`;
}
```

注: 既存の `renderActualsTable` を呼び出している箇所（同ファイル内 `renderActualsMode`）も `matchedSlots` を渡すよう変更が必要（次ステップ）。

- [ ] **Step 4: `renderActualsMode` を matchFlightsToStallSlots と組み合わせる**

`tools/js/forecast-section.js` の import 行に追加:

```javascript
import { matchFlightsToStallSlots } from './arrivals-data.js';
```

`renderActualsMode` を以下に差し替える:

```javascript
async function renderActualsMode(metaEl, tableEl) {
  const [actualsRes, flights] = await Promise.all([
    loadActuals(),
    loadArrivalsForMatch(),
  ]);
  const { data, error } = actualsRes;
  if (error) {
    metaEl.textContent = `実績データを取得できていません（${error}）`;
    tableEl.innerHTML = '';
    return;
  }
  const ts = (data.generatedAt || '').slice(0, 16).replace('T', ' ');
  if (isStale(data.generatedAt, new Date(), STALE_MINUTES)) {
    metaEl.textContent = ts
      ? `実績データを取得できていません（最終 ${ts}）`
      : '実績データを取得できていません';
    tableEl.innerHTML = '';
    return;
  }
  const accum = computeAccumulatedTotal(data.slots, new Date());
  const tsPart = ts ? `実績 ${ts} 時点まで` : '';
  const accumPart = `JST 5:00 起点 累計 ${accum}台`;
  metaEl.textContent = tsPart ? `${tsPart}  /  ${accumPart}` : accumPart;
  const matchedSlots = matchFlightsToStallSlots(data.slots, flights, 30);
  tableEl.innerHTML = renderActualsTable(data.slots, matchedSlots);
}
```

- [ ] **Step 5: テスト確認**

```bash
npm test
```

Expected: 全テスト PASS

- [ ] **Step 6: 手動確認**

```bash
python3 -m http.server 8000 &
```

ブラウザで `/tools/arrivals.html` を開き:
- 出庫実績テーブルの各行の下に「▼ 推測元便を表示」リンクが出る
- クリックすると展開して、乗1/乗2/乗3/乗4 ごとの推測元便が並ぶ
- 便には「便名 / 出発地 / Tx / ロビー出口時刻」が出る
- 推測元便なしの場合は「推測元便なし」表示

確認後 `pkill -f "python3 -m http.server 8000"` で停止。

- [ ] **Step 7: Commit**

```bash
git add tools/js/forecast-section.js tools/arrivals.html
git commit -m "feat(arrivals): 出庫実績テーブルに行展開で推測元便を表示

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 10: 日報repo: dev push & 本番反映

**Files:** なし（運用タスク）

- [ ] **Step 1: dev に push**

```bash
cd "/Users/hideakimacbookair/Library/Mobile Documents/com~apple~CloudDocs/タクシー乗務アプリ/タクシー日報-wt-arrivals-v2"
git push dev feat/arrivals-page-v2
```

GitHub UI で PR 作成 → `dev/main` にマージ。

- [ ] **Step 2: ユーザー確認待ち**

dev 環境（taxi-daily-report-dev）の Pages で動作確認をユーザーに依頼。OK出るまで本番反映しない。

- [ ] **Step 3: 本番反映（ユーザー承認後のみ）**

`deploy/arrivals-page-v2` ブランチを `origin/main` から作り、Plan B の全コミットを cherry-pick:

```bash
git fetch origin
git checkout -b deploy/arrivals-page-v2 origin/main
git log feat/arrivals-page-v2 --oneline | head -10
# Plan A のコミットを既に deploy 済みなら、Plan B のコミットだけ cherry-pick
# Plan A もまだなら両方
git cherry-pick <Plan_B_commit_SHAs>
git push origin deploy/arrivals-page-v2
```

GitHub UI で `deploy/arrivals-page-v2` → `origin/main` の PR を作って merge。

---

## Plan B 完了基準

- 乗務地図関係 repo の更新が main にマージされ、`update-arrivals.yml` が新フィールド付き `arrivals.json` を生成し、`relay-taxi-data.yml` で日報 dev/prod に配信される
- 日報repo の dev で出庫実績テーブルの行展開で推測元便が表示される
- ユーザー確認 → 本番反映完了

## 注意事項

- Task 4 の判定結果（充填率 ≥/< 60%）で Task 5・6・7 の実装内容が分岐する。**Task 4 完了前に Task 5 に進まない**
- 乗務地図関係 repo と日報repo の **2 worktree** を扱う。コマンドの cd 先を間違えない
- `tests/fixtures/odpt-arrival-sample.json` を編集するとき、既存テスト（`arrivals-window-summary.test.mjs` 等）が壊れないか確認
- Task 7 で `arrival-transformer.mjs` に `readFileSync` で lookup を読むと、テスト時に CWD が違うと失敗する。テストは worktree のルートから実行することを保証（`npm test` がそれを満たしている）
- `data/hnd-gate-to-stall.json` は手作りマスター。羽田公式 floor map のリンク切れ時は internet archive を使う

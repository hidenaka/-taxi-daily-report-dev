# 乗り場別 同条件過去比較 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 各乗り場の出庫数を「普段（同曜日・同時間帯）と比べてどうか」で判断できるよう、`pool-status.json` の `stalls.*` に `sameConditionCompare` を追加し、UIで「いつもの ±N%」を表示する。

**Architecture:** 既存 `sameConditionCompare(rows, now, holidays, weeks=4)` 純関数に第5引数 `stallKey` を追加して一般化。`buildStalls` 内で各 stall に対して呼び出し、出力を付与。UI側は `formatStallLineV2` を拡張して `rankHint` × `percent` の有無で6パターン分岐。既存テストは引数省略時の挙動が不変なので壊れない。

**Tech Stack:** Node.js ESM 純関数 + `node --test`。UIはvanilla JS module。Service Worker。

**2リポジトリ構成（前回と同じ）:**
- **Phase A** = `~/repos/taxi-ic-helper` branch `feat/pool-status`
- **Phase B** = `~/work/taxi-dev-wt-pool-status` branch `feat/pool-status`
- **Phase C** = 反映（ic-helper push、Mac mini pull、PUSH-genkyo.sh、v1.37.0 タグ）

**設計書**: `~/work/taxi-dev-wt-pool-status/docs/superpowers/specs/2026-05-27-stall-same-condition-compare-design.md`

---

## File Structure

### Phase A — `~/repos/taxi-ic-helper`
- Modify: `scripts/lib/pool-status.mjs` — `sameConditionCompare` 第5引数 `stallKey` 追加、`buildStalls` で各 stall に付与
- Modify: `tests/pool-status.test.mjs` — stall別比較・後方互換テスト追加

### Phase B — `~/work/taxi-dev-wt-pool-status`
- Modify: `tools/js/pool-status-section.js` — `formatStallLineV2` 拡張
- Modify: `tests/pool-status-section.test.js` — 6パターンテスト
- Modify: `sw.js` — CACHE_NAME bump

---

# Phase A — ic-helper（データ生成）

> 作業ディレクトリ: `~/repos/taxi-ic-helper`。テスト: `cd ~/repos/taxi-ic-helper && npm test`

### Task A1: sameConditionCompare に stallKey 引数追加（後方互換）

**Files:**
- Modify: `~/repos/taxi-ic-helper/scripts/lib/pool-status.mjs`
- Test: `~/repos/taxi-ic-helper/tests/pool-status.test.mjs`

- [ ] **Step 1: 失敗するテストを書く**

`tests/pool-status.test.mjs` 末尾に追記:

```js
test('sameConditionCompare: stallKey 指定で stall別出庫の中央値で比較', () => {
  // 過去3週(2,3,4週前)の火曜平日 stall3 dep を 10/10/10、今日の stall3 dep を 15 にする
  const now = new Date('2026-05-12T12:00:00+09:00');
  const past = [];
  for (const d of [14, 21, 28]) {
    const targetBase = now.getTime() - d * 86400000;
    // 11:00〜12:00 の60分間、stall3 だけ毎分1tickで occ が 20→10 に線形減少（stall3で10台出庫）
    const startOcc = 20, endOcc = 10;
    for (let i = 0; i <= 60; i++) {
      const ts = new Date(targetBase - (60 - i) * 60000).toISOString();
      const occ3 = Math.max(0, Math.round(startOcc - (startOcc - endOcc) * (i / 60)));
      past.push({ ts, mode: 'day', stalls: {
        stall1: { occ: 0 }, stall2: { occ: 0 }, stall3: { occ: occ3 }, stall4: { occ: 0 }, stall4_back: { occ: 0 }
      }});
    }
  }
  // 今日: stall3 dep を 15 にする (occ 25→10 で 15台減)
  const today = [];
  const todayBase = now.getTime();
  for (let i = 0; i <= 60; i++) {
    const ts = new Date(todayBase - (60 - i) * 60000).toISOString();
    const occ3 = Math.max(0, Math.round(25 - 15 * (i / 60)));
    today.push({ ts, mode: 'day', stalls: {
      stall1: { occ: 0 }, stall2: { occ: 0 }, stall3: { occ: occ3 }, stall4: { occ: 0 }, stall4_back: { occ: 0 }
    }});
  }
  const r = sameConditionCompare([...past, ...today], now, TEST_HOLIDAYS, 4, 'stall3');
  // peers_typical = median(10, 10, 10) = 10、percent = (15/10 - 1) * 100 = 50
  assert.equal(r.peers_typical, 10);
  assert.equal(r.percent, 50);
  assert.equal(r.label, 'いつもより活発');
  assert.equal(r.dayLabel, '火曜平日');
});

test('sameConditionCompare: stallKey null（既定）は既存挙動（全体合計）', () => {
  // Task A3 の既存テストを引数明示なしと null 明示で結果が同じことを確認
  const now = new Date('2026-05-12T12:00:00+09:00');
  const past = buildHistoryRows([14, 21, 28], 8);
  const today = buildHistoryRows([0], 12);
  const rows = [...past, ...today];
  const r1 = sameConditionCompare(rows, now, TEST_HOLIDAYS);
  const r2 = sameConditionCompare(rows, now, TEST_HOLIDAYS, 4, null);
  assert.deepEqual(r1, r2);
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd ~/repos/taxi-ic-helper && node --test tests/pool-status.test.mjs`
Expected: FAIL（stallKey 引数が無視され、全体合計を返してしまう → stall別の値と一致しない）

- [ ] **Step 3: 最小実装**

`scripts/lib/pool-status.mjs` の `sameConditionCompare` を次に置き換え（既存関数全体）:

```js
/** rows から指定 Date の直近1h出庫合計（全体または stall別）を返す。 */
function recent1hAt(rows, atDate, stallKey = null) {
  const bins = computeSlotActuals(rows, atDate, 60);
  if (stallKey) return bins.reduce((s, b) => s + (b[stallKey] || 0), 0);
  return bins.reduce((s, b) => s + b.total, 0);
}

/** 過去 weeks 週間の同(weekday, dayKind)の同時間帯サンプルから median を取る。
 *  stallKey=null（既定）で全体、'stall1'..'stall4' で per-stall。 */
export function sameConditionCompare(rows, now, holidays, weeks = 4, stallKey = null) {
  const today = getDayContext(now, holidays);
  const today1h = recent1hAt(rows, now, stallKey);
  const samples = [];
  for (let w = 1; w <= weeks; w++) {
    const past = new Date(now.getTime() - w * 7 * 86400000);
    const ctx = getDayContext(past, holidays);
    if (ctx.weekday !== today.weekday) continue;
    if (ctx.dayKind !== today.dayKind) continue;
    const v = recent1hAt(rows, past, stallKey);
    samples.push(v);
  }
  if (samples.length < 3) {
    return { peers_typical: null, percent: null, label: null, dayLabel: today.dayLabel };
  }
  samples.sort((a, b) => a - b);
  const m = Math.floor(samples.length / 2);
  const peers_typical = samples.length % 2 ? samples[m] : Math.round((samples[m - 1] + samples[m]) / 2);
  if (!(peers_typical > 0)) {
    return { peers_typical, percent: null, label: null, dayLabel: today.dayLabel };
  }
  const percent = Math.round((today1h / peers_typical - 1) * 100);
  let label;
  if (percent >= 15) label = 'いつもより活発';
  else if (percent <= -15) label = 'いつもより少なめ';
  else label = 'いつも通り';
  return { peers_typical, percent, label, dayLabel: today.dayLabel };
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `cd ~/repos/taxi-ic-helper && npm test`
Expected: PASS（既存テスト全件 + 新2件 が緑。stallKey 省略時の既存挙動が壊れていないことが既存テストで保証される）

- [ ] **Step 5: コミット**

```bash
cd ~/repos/taxi-ic-helper
git add scripts/lib/pool-status.mjs tests/pool-status.test.mjs
git commit -m "feat(pool-status): sameConditionCompare に stallKey 引数追加（後方互換）"
```

---

### Task A2: buildStalls で各 stall に sameConditionCompare を付与

**Files:**
- Modify: `~/repos/taxi-ic-helper/scripts/lib/pool-status.mjs`
- Test: `~/repos/taxi-ic-helper/tests/pool-status.test.mjs`

- [ ] **Step 1: 失敗するテストを書く**

`tests/pool-status.test.mjs` 末尾に追記:

```js
test('buildStalls: holidays 指定時、各 stall に sameConditionCompare フィールドが付く', () => {
  const now = new Date('2026-05-12T12:00:00+09:00');
  // 過去3週(火曜平日)で stall1 dep=8 のサンプルを作る
  const past = [];
  for (const d of [14, 21, 28]) {
    const targetBase = now.getTime() - d * 86400000;
    const startOcc = 20, endOcc = 12;
    for (let i = 0; i <= 60; i++) {
      const ts = new Date(targetBase - (60 - i) * 60000).toISOString();
      const occ1 = Math.max(0, Math.round(startOcc - (startOcc - endOcc) * (i / 60)));
      past.push({ ts, mode: 'day', stalls: {
        stall1: { occ: occ1 }, stall2: { occ: 0 }, stall3: { occ: 0 }, stall4: { occ: 0 }, stall4_back: { occ: 0 }
      }});
    }
  }
  // 今日: stall1 dep=8 にする (普段通り → percent ≈ 0)
  const today = [];
  for (let i = 0; i <= 60; i++) {
    const ts = new Date(now.getTime() - (60 - i) * 60000).toISOString();
    const occ1 = Math.max(0, Math.round(20 - 8 * (i / 60)));
    today.push({ ts, mode: 'day', stalls: {
      stall1: { occ: occ1 }, stall2: { occ: 0 }, stall3: { occ: 0 }, stall4: { occ: 0 }, stall4_back: { occ: 0 }
    }});
  }
  const stalls = buildStalls([...past, ...today], now, TEST_HOLIDAYS);
  assert.ok(stalls.stall1.sameConditionCompare);
  assert.equal(stalls.stall1.sameConditionCompare.dayLabel, '火曜平日');
  assert.equal(typeof stalls.stall1.sameConditionCompare.percent, 'number');
  assert.ok(stalls.stall1.sameConditionCompare.label);
  // 他stallはサンプル無しで fallback
  assert.equal(stalls.stall2.sameConditionCompare.peers_typical, null);
  assert.equal(stalls.stall2.sameConditionCompare.label, null);
  assert.equal(stalls.stall2.sameConditionCompare.dayLabel, '火曜平日');
});

test('buildStalls: holidays 未指定（既存呼び出し）でも壊れず、sameConditionCompare=null', () => {
  const base = Date.parse('2026-05-12T12:00:00+09:00');
  const rows = [];
  for (let i = 0; i < 20; i++) rows.push(occRow(new Date(base + i * 30000).toISOString(), 12, 10, 14, 4, 8));
  const stalls = buildStalls(rows, new Date(base + 20 * 30000)); // holidays 省略
  assert.equal(stalls.stall1.sameConditionCompare, null);
  assert.equal(stalls.stall3.sameConditionCompare, null);
  // 既存フィールド（label/terminal/occ/recent1hDep/waitMin/trend）は維持
  assert.equal(stalls.stall1.label, '第1乗り場');
  assert.equal(stalls.stall1.terminal, 'T1');
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd ~/repos/taxi-ic-helper && node --test tests/pool-status.test.mjs`
Expected: FAIL — `Cannot read properties of undefined (reading 'dayLabel')` 等（stalls.stall1.sameConditionCompare が未定義）

- [ ] **Step 3: 最小実装**

`scripts/lib/pool-status.mjs` の `buildStalls` を次に置き換える（既存関数全体）:

```js
/** 乗り場別ブロック（在台・直近1h出庫・待ち目安・動き方・ターミナル）を組み立てる。
 *  holidays 指定時は各 stall に sameConditionCompare を付与（省略時は null）。 */
export function buildStalls(rows, now, holidays = null) {
  const occ = currentOccupancyByStall(rows, now, 5);
  const dep1h = stallDepartures(rows, now, 60);
  const depRecent30 = stallDepartures(rows, now, 30);
  const depPrior30 = stallDepartures(rows, new Date(now.getTime() - 30 * 60000), 30);
  const out = {};
  for (const s of STALL_NAMES) {
    out[s] = {
      label: STALL_LABEL[s],
      terminal: STALL_TERMINAL[s],
      occ: occ[s],
      recent1hDep: dep1h[s],
      waitMin: waitMinFor(occ[s], dep1h[s]),
      trend: stallTrend(depRecent30[s], depPrior30[s]),
      sameConditionCompare: holidays ? sameConditionCompare(rows, now, holidays, 4, s) : null,
    };
  }
  return out;
}
```

- [ ] **Step 4: buildPoolStatus 側で holidays を渡す**

`buildPoolStatus` 内の `buildStalls(rows, now)` 呼び出しを `buildStalls(rows, now, holidays)` に置き換える:

```js
  const stallsBase = buildStalls(rows, now, holidays);
```

- [ ] **Step 5: テストが通ることを確認**

Run: `cd ~/repos/taxi-ic-helper && npm test`
Expected: PASS（全テスト緑）

- [ ] **Step 6: コミット**

```bash
cd ~/repos/taxi-ic-helper
git add scripts/lib/pool-status.mjs tests/pool-status.test.mjs
git commit -m "feat(pool-status): buildStalls で各 stall に sameConditionCompare 付与"
```

---

### Task A3: 実データで生成して新フィールド出力を確認

**Files:**
- I/O 確認のみ、コード変更なし

- [ ] **Step 1: publish-pool-status.mjs が既に holidays を渡していることを確認**

Run:
```bash
cd ~/repos/taxi-ic-helper && grep "buildPoolStatus" scripts/publish-pool-status.mjs
```
Expected: `const status = buildPoolStatus(rows, new Date(), arrivals, holidays);` が出る（前回タスク A7 で配線済）。OK ならコード変更不要。

- [ ] **Step 2: 実データで生成**

Run:
```bash
cd ~/repos/taxi-ic-helper && node scripts/publish-pool-status.mjs
node -e "
const s = require('./data/pool-status.json');
console.log('stall1.sameConditionCompare:', JSON.stringify(s.stalls.stall1.sameConditionCompare));
console.log('stall3.sameConditionCompare:', JSON.stringify(s.stalls.stall3.sameConditionCompare));
console.log('既存フィールド: stall1.trend=' + s.stalls.stall1.trend + ' rankHint=' + s.stalls.stall1.rankHint);
"
```
Expected:
- 各 stall に `sameConditionCompare: {peers_typical, percent, label, dayLabel}` が出力
- サンプル不足の時間帯では `peers_typical: null, percent: null, label: null, dayLabel: '<曜日種別>'` の fallback
- 既存フィールド（trend / rankHint 等）は維持

- [ ] **Step 3: コミット（data/pool-status.json も更新分含めて）**

```bash
cd ~/repos/taxi-ic-helper
git add data/pool-status.json
git commit -m "data: pool-status.json に stall別 sameConditionCompare を反映"
```

> **Phase A 完了**。ic-helper feat/pool-status に3コミット。

---

# Phase B — 日報UI（formatStallLineV2 拡張）

> 作業ディレクトリ: `~/work/taxi-dev-wt-pool-status`。テスト: `cd ~/work/taxi-dev-wt-pool-status && npm test`

### Task B1: formatStallLineV2 に sameConditionCompare 表示を追加

**Files:**
- Modify: `~/work/taxi-dev-wt-pool-status/tools/js/pool-status-section.js`
- Test: `~/work/taxi-dev-wt-pool-status/tests/pool-status-section.test.js`

- [ ] **Step 1: 失敗するテストを書く（6パターン）**

`tests/pool-status-section.test.js` 末尾に追記:

```js
test('formatStallLineV2: rankHint=most-active + percent あり', async () => {
  assert.equal(
    formatStallLineV2({
      label: '第3乗り場', trend: 'up', rankHint: 'most-active',
      sameConditionCompare: { peers_typical: 20, percent: 5, label: 'いつも通り', dayLabel: '火曜平日' }
    }),
    '第3乗り場  活発↑ ← 最も動き活発（いつもの +5%）'
  );
});

test('formatStallLineV2: rankHint=most-low + percent マイナス', async () => {
  assert.equal(
    formatStallLineV2({
      label: '第1乗り場', trend: 'down', rankHint: 'most-low',
      sameConditionCompare: { peers_typical: 22, percent: -23, label: 'いつもより少なめ', dayLabel: '火曜平日' }
    }),
    '第1乗り場  少なめ↓ ← 最も動き少なめ（いつもの -23%）'
  );
});

test('formatStallLineV2: rankHint なし + percent あり', async () => {
  assert.equal(
    formatStallLineV2({
      label: '第2乗り場', trend: 'flat', rankHint: null,
      sameConditionCompare: { peers_typical: 10, percent: -2, label: 'いつも通り', dayLabel: '火曜平日' }
    }),
    '第2乗り場  横ばい→（いつもの -2%）'
  );
});

test('formatStallLineV2: rankHint=most-active + percent null（サンプル不足、既存挙動）', async () => {
  assert.equal(
    formatStallLineV2({
      label: '第3乗り場', trend: 'up', rankHint: 'most-active',
      sameConditionCompare: { peers_typical: null, percent: null, label: null, dayLabel: '火曜平日' }
    }),
    '第3乗り場  活発↑ ← 最も動き活発'
  );
});

test('formatStallLineV2: rankHint=most-low + percent null', async () => {
  assert.equal(
    formatStallLineV2({
      label: '第4乗り場', trend: 'flat', rankHint: 'most-low',
      sameConditionCompare: null
    }),
    '第4乗り場  横ばい→ ← 最も動き少なめ'
  );
});

test('formatStallLineV2: rankHint なし + sameConditionCompare 未提供（旧データ、既存挙動）', async () => {
  assert.equal(
    formatStallLineV2({ label: '第2乗り場', trend: 'flat', rankHint: null }),
    '第2乗り場  横ばい→'
  );
});

test('formatStallLineV2: percent=0 は "+0%"', async () => {
  assert.equal(
    formatStallLineV2({
      label: '第2乗り場', trend: 'flat', rankHint: null,
      sameConditionCompare: { peers_typical: 10, percent: 0, label: 'いつも通り', dayLabel: '火曜平日' }
    }),
    '第2乗り場  横ばい→（いつもの +0%）'
  );
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd ~/work/taxi-dev-wt-pool-status && node --test tests/pool-status-section.test.js`
Expected: FAIL — 既存 `formatStallLineV2` は `sameConditionCompare` を読まないため、新パターンの期待値と不一致

- [ ] **Step 3: 最小実装**

`tools/js/pool-status-section.js` の `formatStallLineV2` を次に置き換える（既存関数全体）:

```js
const RANK_HINT_JA = {
  'most-active': '最も動き活発',
  'most-low': '最も動き少なめ',
};

/** 乗り場1行（V2: trend + rankHint + 同条件過去比較）。
 *  rankHint × sameConditionCompare.percent の有無で6パターン分岐。 */
export function formatStallLineV2(stall) {
  if (!stall) return '';
  const trend = stall.trend ? trendText(stall.trend) : '—';
  const hint = stall.rankHint ? RANK_HINT_JA[stall.rankHint] : null;
  const sc = stall.sameConditionCompare;
  const hasPercent = sc && typeof sc.percent === 'number';
  // percent の符号付き表記（既存 formatActivityLine と同じルール）
  const pctText = hasPercent
    ? `いつもの ${sc.percent >= 0 ? '+' : ''}${sc.percent}%`
    : null;

  let tail = '';
  if (hint && pctText) tail = ` ← ${hint}（${pctText}）`;
  else if (hint) tail = ` ← ${hint}`;
  else if (pctText) tail = `（${pctText}）`;

  return `${stall.label}  ${trend}${tail}`;
}
```

> 既存 `RANK_HINT_JA` 定義（`← 最も動き活発` の形式）を上記の新形式（矢印を別途付与）に変更している点に注意。テストの期待値と整合させる。

- [ ] **Step 4: テストが通ることを確認**

Run: `cd ~/work/taxi-dev-wt-pool-status && npm test`
Expected: PASS（既存テスト + 新7件すべて緑。既存 `formatStallLineV2` テスト4件は `sameConditionCompare` 未提供パターンなので tail=hint-only or empty で一致する）

- [ ] **Step 5: コミット**

```bash
cd ~/work/taxi-dev-wt-pool-status
git add tools/js/pool-status-section.js tests/pool-status-section.test.js
git commit -m "feat(pool-status): formatStallLineV2 に同条件過去比較表示を追加"
```

---

### Task B2: SW CACHE_NAME bump

**Files:**
- Modify: `~/work/taxi-dev-wt-pool-status/sw.js`

- [ ] **Step 1: dev最新の CACHE_NAME 確認**

Run:
```bash
cd ~/work/taxi-dev-wt-pool-status && git fetch -q origin main && echo "現状: $(grep '^const CACHE_NAME' sw.js)" && echo "dev最新: $(git show origin/main:sw.js | grep '^const CACHE_NAME')"
```

- [ ] **Step 2: sw.js bump（dev最新+1）**

現状 v229 / dev最新 v229 → v230 にする。`sw.js` 2行目を次に置き換え:

```js
const CACHE_NAME = CACHE_PREFIX + 'v230';
```

> dev 最新が v230 以上に進んでいたら、その +1 にする。

- [ ] **Step 3: 全テスト最終確認**

Run: `cd ~/work/taxi-dev-wt-pool-status && npm test`
Expected: PASS

- [ ] **Step 4: コミット**

```bash
cd ~/work/taxi-dev-wt-pool-status
git add sw.js
git commit -m "chore(sw): CACHE_NAME bump（乗り場別 同条件比較）"
```

---

# Phase C — 反映

> Phase A の Mac mini 反映 + Phase B の dev反映 + 本番 v1.37.0 タグ。

- [ ] **Step 1: ic-helper push（Claude実行可）**

```bash
cd ~/repos/taxi-ic-helper
git fetch -q origin main
git checkout feat/pool-status
git rebase origin/main
# data/pool-status.json 衝突したら ours採用
# git checkout --ours -- data/pool-status.json && git add data/pool-status.json && GIT_EDITOR=true git rebase --continue
git checkout main
git reset --hard feat/pool-status
git push origin main
```

- [ ] **Step 2: Mac mini で pull（Claude実行可、nakanohideaki@100.88.23.4 で SSH 通る）**

```bash
ssh nakanohideaki@100.88.23.4 'cd ~/repos/taxi-ic-helper && git pull --ff-only origin main'
```

- [ ] **Step 3: 次のobserve-tick（5分以内）で stall別 sameConditionCompare 出力を確認**

```bash
sleep 320  # 約5分待つ
cd ~/repos/taxi-ic-helper && git fetch -q origin main
git show origin/main:data/pool-status.json | python3 -c "
import json, sys
d = json.load(sys.stdin)
for k in ['stall1','stall2','stall3','stall4']:
    sc = d['stalls'][k].get('sameConditionCompare')
    print(f'{k}: {sc}')
"
```
Expected: 各 stall に sameConditionCompare が出力（多くはサンプル不足で fallback）。

- [ ] **Step 4: relay 経由で日報 dev に届くか確認**

```bash
cd ~/work/taxi-dev-wt-pool-status && git fetch -q origin main
git show origin/main:tools/data/pool-status.json | python3 -c "
import json, sys
d = json.load(sys.stdin)
print('stall1.sameConditionCompare:', d['stalls']['stall1'].get('sameConditionCompare'))
"
```
Expected: 数分以内に relay 経由で届く。

- [ ] **Step 5: 日報 dev反映（Claude実行可、PUSH-genkyo.sh）**

```bash
bash ~/work/taxi-dev-wt-pool-status/PUSH-genkyo.sh
```

Expected: rebase + push 成功。衝突したら sw.js を最大版数+1 に統一して continue。

- [ ] **Step 6: dev確認URL で動作目視（ユーザー作業）**

dev URL の `arrivals.html` を PWA再起動で開き、乗り場の動きに「（いつもの ±N%）」が出るか確認。サンプル不足の時間帯は出ない（既存表示と同じ）。

- [ ] **Step 7: 本番反映 v1.37.0（ユーザー判断 or Claude実行）**

```bash
cd ~/work/taxi-dev && git tag v1.37.0 origin/main && git push origin v1.37.0
```

deploy.yml が自動で本番にrsync。本番ユーザーは PWA再起動で v230 SW取得。

---

## Self-Review

**1. Spec coverage**
- ✅ `sameConditionCompare` に第5引数 `stallKey` → Task A1
- ✅ `buildStalls` に `sameConditionCompare` 付与 → Task A2
- ✅ `buildPoolStatus` 経由で出力 → Task A2 Step4
- ✅ 後方互換（holidays 省略時 null） → Task A2 テスト2件目
- ✅ publish 配線確認 → Task A3
- ✅ `formatStallLineV2` 6パターン → Task B1
- ✅ percent=0 の `+0%` 表示 → Task B1 テスト7件目（spec修正反映）
- ✅ SW bump → Task B2
- ✅ 反映フロー（Claude push可、Mac mini pull、PUSH-genkyo.sh、v1.37.0タグ） → Phase C

**2. Placeholder scan**: TBD/TODO 無し、各ステップに実コード・実コマンド・期待出力あり。

**3. Type consistency**
- `sameConditionCompare` 戻り値の形 `{peers_typical, percent, label, dayLabel}` は A1/A2/B1 で完全一致 ✓
- A1 で `stallKey` 引数追加、A2 でその引数を使用、内部関数 `recent1hAt` も同じ stallKey 引数を受ける ✓
- B1 の `RANK_HINT_JA` 値が新形式（矢印を別途付与）に変わったが、tail テンプレートに `← ${hint}` を統一しているので一致 ✓
- `STALL_NAMES`（A2の既存定数）と `formatStallLineV2` の `label` プロパティの関係は既存通り ✓

---

## 実行方法

`superpowers:subagent-driven-development`（前回と同じ流れ）。Phase A は ic-helper、Phase B は日報UI、Phase C は Claude/ユーザーで分担実行。

# 乗り場別の判断材料（待ち時間目安＋直近の動き方＋到着便）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** タクシープール現況UIに「乗り場（第1〜4）別の在台数・待ち時間目安・直近の出庫の動き」と「ターミナル別のこれから来る客（到着便）」を、責任を負わない事実ベースで追加する。

**Architecture:** データ生成側（`~/repos/taxi-ic-helper`, branch `feat/pool-status`）で `buildPoolStatus` を拡張し `pool-status.json` に `stalls{}` と `terminalArrivals{}` を焼き込む。UI側（`~/work/taxi-dev-wt-pool-status`, branch `feat/pool-status`）は `data.stalls` / `data.terminalArrivals` を読むだけ。**両フィールドが無い古いデータでもUIは壊れずグレースフルに縮退する**ため、2リポジトリは独立にリリース可能。

**Tech Stack:** Node.js ESM 純関数 + `node --test`。UIはvanilla JS module。Service Worker キャッシュ。

**2リポジトリ構成（重要）:**
- **Phase A** = `~/repos/taxi-ic-helper`（データ生成。テスト: `npm test` = `node --test`。ファイルは `*.mjs`、テストは `tests/*.test.mjs`）
- **Phase B** = `~/work/taxi-dev-wt-pool-status`（UI。テスト: `npm test` = `node --test tests/*.test.js`。dev反映: `bash ~/work/taxi-dev-wt-pool-status/PUSH-genkyo.sh`）
- 両repoとも既に branch `feat/pool-status` をチェックアウト済み（新worktree不要）。両repoともiCloud外なので `npm`/`node` 安全。

**設計上の確定事項（変更不可・承認済み 2026-05-26）:**
- 責任を負わないため**事実のみ**。「第N乗り場に並べ」と断定しない。「待ち目安」「これから来る客」など目安・事実の語彙のみ。
- 乗り場↔ターミナル対応（`stall-slots.json` のラベルで確認済み）: **第1・2乗り場 = T1（JAL） / 第3・4乗り場 = T2（ANA）**。T3（国際）は対象外。
- 待ち時間目安 = `在台 × 60 ÷ 直近1h出庫`。直近1h出庫が0なら `null`（UIは「—」）。
- 直近の動き方 = `直近30分の出庫 ÷ その前30分の出庫`。`≥1.25`→up / `<0.75`→down / それ以外→flat。前30分が0なら flat（基準不足）。
- 到着便 = `arrivals.json` の各便で、`lobbyExitTime`（客がロビーに出る時刻）が今から30分以内/60分以内に入るものの `estimatedTaxiPax` を terminal別に合計。`next60` は `next30` を内包（累積）。
- 乗り場第4の在台・出庫は `stall4` + `stall4_back`（カメラ2）を合算（既存 `computeSlotActuals` の畳み込みと一致させる）。

---

## File Structure

### Phase A — `~/repos/taxi-ic-helper`
- Modify: `scripts/lib/pool-status.mjs` — 純関数 `currentOccupancyByStall` / `waitMinFor` / `stallTrend` / `buildStalls` / `buildTerminalArrivals` を追加し、`buildPoolStatus` に第3引数 `arrivals` を足して `stalls` / `terminalArrivals` を返す。
- Modify: `scripts/publish-pool-status.mjs` — `data/arrivals.json` を読んで `buildPoolStatus(rows, now, arrivals)` に渡す。
- Modify: `tests/pool-status.test.mjs` — 新純関数と拡張スキーマのテストを追記。

### Phase B — `~/work/taxi-dev-wt-pool-status`
- Modify: `tools/js/pool-status-section.js` — 純フォーマッタ `waitText` / `trendText` / `formatStallLine` / `formatTerminalArrivals` を追加し、`render()` で新DOMコンテナへ描画。
- Modify: `tools/arrivals.html` — `#pool-status-block` 内に `#pool-status-stalls` と `#pool-status-arrivals` のコンテナを追加。
- Modify: `tests/pool-status-section.test.js` — 新フォーマッタのテストを追記。
- Modify: `sw.js` — `CACHE_NAME` を bump（v222 → v223。push時に dev 最新と衝突したら大きい方+1）。

---

# Phase A — データ生成側（taxi-ic-helper）

> 作業ディレクトリ: `~/repos/taxi-ic-helper`。テスト実行: `cd ~/repos/taxi-ic-helper && npm test`

### Task A1: 乗り場別の現在在台数（currentOccupancyByStall）

**Files:**
- Modify: `~/repos/taxi-ic-helper/scripts/lib/pool-status.mjs`
- Test: `~/repos/taxi-ic-helper/tests/pool-status.test.mjs`

- [ ] **Step 1: 失敗するテストを書く**

`tests/pool-status.test.mjs` の import 行に `currentOccupancyByStall` を追加する。先頭の import を次に置き換える:

```js
import { occLevel, activityLevel } from '../scripts/lib/pool-status.mjs';
import { currentOccupancy, fullRefFor, buildPoolStatus } from '../scripts/lib/pool-status.mjs';
import { currentOccupancyByStall, waitMinFor, stallTrend, buildStalls, buildTerminalArrivals } from '../scripts/lib/pool-status.mjs';
```

ファイル末尾に追記:

```js
test('currentOccupancyByStall: 乗り場別中央値・第4は back を合算', () => {
  const base = Date.parse('2026-05-25T12:00:00+09:00');
  const rows = [];
  for (let i = 0; i < 5; i++) rows.push(occRow(new Date(base + i * 30000).toISOString(), 10, 8, 12, 4, 8));
  const cur = currentOccupancyByStall(rows, new Date(base + 5 * 30000), 5);
  assert.equal(cur.stall1, 10);
  assert.equal(cur.stall2, 8);
  assert.equal(cur.stall3, 12);
  assert.equal(cur.stall4, 12); // stall4(4) + stall4_back(8)
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd ~/repos/taxi-ic-helper && node --test tests/pool-status.test.mjs`
Expected: FAIL — `currentOccupancyByStall is not a function`（import が undefined）

- [ ] **Step 3: 最小実装を書く**

`scripts/lib/pool-status.mjs` の `currentOccupancy` 関数定義の直後（51行目あたり、`}` の後）に追記:

```js
const STALL_KEYS = {
  stall1: ['stall1'], stall2: ['stall2'], stall3: ['stall3'], stall4: ['stall4', 'stall4_back'],
};

/** 乗り場別（第1〜4）の現在在台数。第4は stall4_back を合算（departures の畳み込みと一致）。 */
export function currentOccupancyByStall(rows, now, windowTicks = 5) {
  const rs = sorted(rows).filter(r => r.tsMs <= now.getTime());
  const tail = rs.slice(-windowTicks);
  const out = {};
  for (const stall of Object.keys(STALL_KEYS)) {
    const vals = tail.map(r => STALL_KEYS[stall].reduce(
      (s, k) => s + (typeof r.stalls?.[k]?.occ === 'number' ? r.stalls[k].occ : 0), 0));
    out[stall] = Math.round(median(vals));
  }
  return out;
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `cd ~/repos/taxi-ic-helper && node --test tests/pool-status.test.mjs`
Expected: PASS（既存テストも全て緑）

- [ ] **Step 5: コミット**

```bash
cd ~/repos/taxi-ic-helper
git add scripts/lib/pool-status.mjs tests/pool-status.test.mjs
git commit -m "feat(pool-status): 乗り場別の現在在台数 currentOccupancyByStall"
```

---

### Task A2: 待ち時間目安と動き方（waitMinFor / stallTrend）

**Files:**
- Modify: `~/repos/taxi-ic-helper/scripts/lib/pool-status.mjs`
- Test: `~/repos/taxi-ic-helper/tests/pool-status.test.mjs`

- [ ] **Step 1: 失敗するテストを書く**

`tests/pool-status.test.mjs` 末尾に追記:

```js
test('waitMinFor: 在台×60÷直近1h出庫。出庫0は null', () => {
  assert.equal(waitMinFor(10, 30), 20);   // 10*60/30
  assert.equal(waitMinFor(9, 4), 135);    // 9*60/4 = 135
  assert.equal(waitMinFor(5, 0), null);   // 出庫0 → 算出不能
  assert.equal(waitMinFor(0, 12), 0);     // 在台0 → 0分
});

test('stallTrend: 直近30/前30 の比で up/flat/down。前30が0は flat', () => {
  assert.equal(stallTrend(10, 4), 'up');    // 2.5 >= 1.25
  assert.equal(stallTrend(5, 4), 'up');     // 1.25 ちょうど
  assert.equal(stallTrend(4, 4), 'flat');   // 1.0
  assert.equal(stallTrend(2, 4), 'down');   // 0.5 < 0.75
  assert.equal(stallTrend(3, 4), 'flat');   // 0.75 ちょうどは flat（<0.75 のみ down）
  assert.equal(stallTrend(8, 0), 'flat');   // 前30=0 は基準不足 → flat
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd ~/repos/taxi-ic-helper && node --test tests/pool-status.test.mjs`
Expected: FAIL — `waitMinFor is not a function`

- [ ] **Step 3: 最小実装を書く**

`scripts/lib/pool-status.mjs` の `currentOccupancyByStall` の直後に追記:

```js
/** 待ち時間目安（分）。在台×60÷直近1h出庫。出庫0は算出不能で null。 */
export function waitMinFor(occ, recent1hDep) {
  if (!(recent1hDep > 0)) return null;
  return Math.round((occ * 60) / recent1hDep);
}

/** 直近30分 vs その前30分の出庫比で動き方を判定。≥1.25→up / <0.75→down / 他→flat。前30が0は flat。 */
export function stallTrend(recent30, prior30) {
  if (!(prior30 > 0)) return 'flat';
  const ratio = recent30 / prior30;
  if (ratio >= 1.25) return 'up';
  if (ratio < 0.75) return 'down';
  return 'flat';
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `cd ~/repos/taxi-ic-helper && node --test tests/pool-status.test.mjs`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
cd ~/repos/taxi-ic-helper
git add scripts/lib/pool-status.mjs tests/pool-status.test.mjs
git commit -m "feat(pool-status): 待ち時間目安 waitMinFor と動き方 stallTrend"
```

---

### Task A3: 乗り場別ブロック組み立て（buildStalls）

**Files:**
- Modify: `~/repos/taxi-ic-helper/scripts/lib/pool-status.mjs`
- Test: `~/repos/taxi-ic-helper/tests/pool-status.test.mjs`

- [ ] **Step 1: 失敗するテストを書く**

`tests/pool-status.test.mjs` 末尾に追記:

```js
test('buildStalls: 4乗り場のスキーマとターミナル対応。出庫無しは waitMin=null/trend=flat', () => {
  const base = Date.parse('2026-05-25T12:00:00+09:00');
  const rows = [];
  // 在台一定（出庫が発生しない）データ
  for (let i = 0; i < 20; i++) rows.push(occRow(new Date(base + i * 30000).toISOString(), 10, 8, 12, 4, 8));
  const stalls = buildStalls(rows, new Date(base + 20 * 30000));
  assert.deepEqual(Object.keys(stalls), ['stall1', 'stall2', 'stall3', 'stall4']);
  assert.equal(stalls.stall1.label, '第1乗り場');
  assert.equal(stalls.stall1.terminal, 'T1');
  assert.equal(stalls.stall3.terminal, 'T2');
  assert.equal(stalls.stall4.occ, 12);          // stall4 + back
  assert.equal(stalls.stall1.recent1hDep, 0);   // 在台一定 → 出庫0
  assert.equal(stalls.stall1.waitMin, null);    // 出庫0 → null
  assert.equal(stalls.stall1.trend, 'flat');
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd ~/repos/taxi-ic-helper && node --test tests/pool-status.test.mjs`
Expected: FAIL — `buildStalls is not a function`

- [ ] **Step 3: 最小実装を書く**

`scripts/lib/pool-status.mjs` の `typical1hDepartures` 関数の直後（75行目あたり）に追記:

```js
const STALL_NAMES = ['stall1', 'stall2', 'stall3', 'stall4'];
const STALL_LABEL = { stall1: '第1乗り場', stall2: '第2乗り場', stall3: '第3乗り場', stall4: '第4乗り場' };
const STALL_TERMINAL = { stall1: 'T1', stall2: 'T1', stall3: 'T2', stall4: 'T2' };

/** 指定窓（分）の乗り場別出庫合計。computeSlotActuals の stallN を合算。 */
function stallDepartures(rows, now, windowMinutes) {
  const bins = computeSlotActuals(rows, now, windowMinutes);
  const out = { stall1: 0, stall2: 0, stall3: 0, stall4: 0 };
  for (const b of bins) for (const s of STALL_NAMES) out[s] += b[s];
  return out;
}

/** 乗り場別ブロック（在台・直近1h出庫・待ち目安・動き方・ターミナル）を組み立てる。 */
export function buildStalls(rows, now) {
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
    };
  }
  return out;
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `cd ~/repos/taxi-ic-helper && node --test tests/pool-status.test.mjs`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
cd ~/repos/taxi-ic-helper
git add scripts/lib/pool-status.mjs tests/pool-status.test.mjs
git commit -m "feat(pool-status): 乗り場別ブロック buildStalls"
```

---

### Task A4: ターミナル別の到着便（buildTerminalArrivals）

**Files:**
- Modify: `~/repos/taxi-ic-helper/scripts/lib/pool-status.mjs`
- Test: `~/repos/taxi-ic-helper/tests/pool-status.test.mjs`

- [ ] **Step 1: 失敗するテストを書く**

`tests/pool-status.test.mjs` 末尾に追記:

```js
test('buildTerminalArrivals: lobbyExitTime で next30/next60 を terminal別に集計', () => {
  const now = new Date(Date.parse('2026-05-25T12:00:00+09:00'));
  const arrivals = { flights: [
    { terminal: 'T1', lobbyExitTime: '12:20', estimatedTaxiPax: 5 },  // next30 ⊂ next60
    { terminal: 'T1', lobbyExitTime: '12:50', estimatedTaxiPax: 3 },  // next60 のみ
    { terminal: 'T2', lobbyExitTime: '12:10', estimatedTaxiPax: 7 },  // next30 ⊂ next60
    { terminal: 'T3', lobbyExitTime: '12:15', estimatedTaxiPax: 9 },  // 対象外
    { terminal: 'T1', lobbyExitTime: '11:55', estimatedTaxiPax: 4 },  // 過去 → 除外
    { terminal: 'T2', lobbyExitTime: '13:30', estimatedTaxiPax: 8 },  // 60分超 → 除外
  ] };
  const ta = buildTerminalArrivals(arrivals, now);
  assert.deepEqual(ta.T1, { next30: 5, next60: 8 });
  assert.deepEqual(ta.T2, { next30: 7, next60: 7 });
});

test('buildTerminalArrivals: flights 無し/不正でも 0 を返す', () => {
  const now = new Date(Date.parse('2026-05-25T12:00:00+09:00'));
  assert.deepEqual(buildTerminalArrivals(null, now), { T1: { next30: 0, next60: 0 }, T2: { next30: 0, next60: 0 } });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd ~/repos/taxi-ic-helper && node --test tests/pool-status.test.mjs`
Expected: FAIL — `buildTerminalArrivals is not a function`

- [ ] **Step 3: 最小実装を書く**

`scripts/lib/pool-status.mjs` の `buildStalls` の直後に追記:

```js
/** "HH:MM"（24+ は翌日）を now と同じ JST 日付基準の Date に。不正は null。 */
function lobbyExitDate(timeStr, now) {
  const m = String(timeStr ?? '').match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (h >= 24) { d.setDate(d.getDate() + 1); h -= 24; }
  d.setHours(h, min, 0, 0);
  return d;
}

/** ターミナル別（T1=第1・2乗り場/T2=第3・4乗り場）に、lobbyExitTime が今後30/60分の便の estimatedTaxiPax を合計。 */
export function buildTerminalArrivals(arrivals, now) {
  const out = { T1: { next30: 0, next60: 0 }, T2: { next30: 0, next60: 0 } };
  const flights = arrivals?.flights ?? [];
  const nowMs = now.getTime();
  const ms30 = nowMs + 30 * 60000;
  const ms60 = nowMs + 60 * 60000;
  for (const f of flights) {
    const t = f.terminal;
    if (t !== 'T1' && t !== 'T2') continue;
    const d = lobbyExitDate(f.lobbyExitTime, now);
    if (!d) continue;
    const ms = d.getTime();
    if (ms <= nowMs || ms > ms60) continue;
    const pax = typeof f.estimatedTaxiPax === 'number' ? f.estimatedTaxiPax : 0;
    out[t].next60 += pax;
    if (ms <= ms30) out[t].next30 += pax;
  }
  return out;
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `cd ~/repos/taxi-ic-helper && node --test tests/pool-status.test.mjs`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
cd ~/repos/taxi-ic-helper
git add scripts/lib/pool-status.mjs tests/pool-status.test.mjs
git commit -m "feat(pool-status): ターミナル別到着便 buildTerminalArrivals"
```

---

### Task A5: buildPoolStatus へ統合（後方互換）

**Files:**
- Modify: `~/repos/taxi-ic-helper/scripts/lib/pool-status.mjs:84-102`（`buildPoolStatus`）
- Test: `~/repos/taxi-ic-helper/tests/pool-status.test.mjs`

- [ ] **Step 1: 失敗するテストを書く**

`tests/pool-status.test.mjs` 末尾に追記:

```js
test('buildPoolStatus: stalls を必ず含み、arrivals 未指定なら terminalArrivals は null', () => {
  const base = Date.parse('2026-05-25T12:00:00+09:00');
  const rows = [];
  for (let i = 0; i < 20; i++) rows.push(occRow(new Date(base + i * 30000).toISOString(), 12, 10, 14, 4, 8));
  const st = buildPoolStatus(rows, new Date(base + 20 * 30000));
  assert.equal(Object.keys(st.stalls).length, 4);
  assert.equal(st.stalls.stall4.terminal, 'T2');
  assert.equal(st.terminalArrivals, null); // 後方互換: arrivals 省略時
});

test('buildPoolStatus: arrivals を渡すと terminalArrivals が入る', () => {
  const now = new Date(Date.parse('2026-05-25T12:00:00+09:00'));
  const rows = [];
  for (let i = 0; i < 20; i++) rows.push(occRow(new Date(now.getTime() - (20 - i) * 30000).toISOString(), 12, 10, 14, 4, 8));
  const arrivals = { flights: [{ terminal: 'T1', lobbyExitTime: '12:20', estimatedTaxiPax: 5 }] };
  const st = buildPoolStatus(rows, now, arrivals);
  assert.equal(st.terminalArrivals.T1.next30, 5);
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd ~/repos/taxi-ic-helper && node --test tests/pool-status.test.mjs`
Expected: FAIL — `Cannot read properties of undefined (reading 'length')`（`st.stalls` が未定義）

- [ ] **Step 3: 最小実装を書く**

`scripts/lib/pool-status.mjs` の `buildPoolStatus` のシグネチャと return を次に置き換える。

シグネチャ（84行目）:

```js
export function buildPoolStatus(rows, now = new Date(), arrivals = null) {
```

return 文（96-101行目）を次に置き換える:

```js
  return {
    generatedAt: jstIso(now),
    cameras,
    total: { occ: totalOcc, level: occLevel(totalOcc, totalRef) },
    activity: { recent1hDepartures: recent, typical1h: typical, ratio: act.ratio, level: act.level, arrow: act.arrow },
    stalls: buildStalls(rows, now),
    terminalArrivals: arrivals ? buildTerminalArrivals(arrivals, now) : null,
  };
```

- [ ] **Step 4: テストが通ることを確認**

Run: `cd ~/repos/taxi-ic-helper && npm test`
Expected: PASS（pool-status だけでなく全テスト緑。既存の `buildPoolStatus(rows, now)` 2引数呼び出しも壊れない）

- [ ] **Step 5: コミット**

```bash
cd ~/repos/taxi-ic-helper
git add scripts/lib/pool-status.mjs tests/pool-status.test.mjs
git commit -m "feat(pool-status): buildPoolStatus に stalls/terminalArrivals を統合(後方互換)"
```

---

### Task A6: publish-pool-status.mjs で arrivals.json を読む

**Files:**
- Modify: `~/repos/taxi-ic-helper/scripts/publish-pool-status.mjs:31-39`

- [ ] **Step 1: 実装を書く**（このタスクはI/O配線のためTDD対象外。手動検証で代替）

`scripts/publish-pool-status.mjs` の `main()` 内、`const status = buildPoolStatus(rows, new Date());` の行を次に置き換える:

```js
        let arrivals = null;
        try {
          if (existsSync('./data/arrivals.json')) {
            arrivals = JSON.parse(readFileSync('./data/arrivals.json', 'utf8'));
          }
        } catch (e) { console.error(`[pool-status] arrivals read failed: ${e.message}`); }
        const status = buildPoolStatus(rows, new Date(), arrivals);
```

- [ ] **Step 2: 実データで生成して新フィールドを確認**

Run:
```bash
cd ~/repos/taxi-ic-helper && node scripts/publish-pool-status.mjs
node -e "const s=require('./data/pool-status.json'); console.log('stalls keys:', Object.keys(s.stalls||{})); console.log('stall1:', JSON.stringify(s.stalls?.stall1)); console.log('terminalArrivals:', JSON.stringify(s.terminalArrivals));"
```
Expected: `stalls keys: [ 'stall1', 'stall2', 'stall3', 'stall4' ]` が出力され、`terminalArrivals` が `{T1:{...},T2:{...}}`（`arrivals.json` があれば）。

- [ ] **Step 3: コミット**

```bash
cd ~/repos/taxi-ic-helper
git add scripts/publish-pool-status.mjs data/pool-status.json
git commit -m "feat(pool-status): publish が arrivals.json を読み terminalArrivals を出力"
```

> **Phase A 完了**。`feat/pool-status` にコミット済み。これがライブ（Mac mini）に反映されるのは別途のデプロイ操作（Phase C 参照）。UIはこの反映前でもグレースフルに縮退する。

---

# Phase B — UI側（日報 worktree）

> 作業ディレクトリ: `~/work/taxi-dev-wt-pool-status`。テスト実行: `cd ~/work/taxi-dev-wt-pool-status && npm test`

### Task B1: UI純フォーマッタ（waitText / trendText / formatStallLine / formatTerminalArrivals）

**Files:**
- Modify: `~/work/taxi-dev-wt-pool-status/tools/js/pool-status-section.js`
- Test: `~/work/taxi-dev-wt-pool-status/tests/pool-status-section.test.js`

- [ ] **Step 1: 失敗するテストを書く**

`tests/pool-status-section.test.js` の import 行を次に置き換える:

```js
import { levelText, levelDots, activityText, isStale, waitText, trendText, formatStallLine, formatTerminalArrivals } from '../tools/js/pool-status-section.js';
```

ファイル末尾に追記:

```js
test('pool-status-section: 乗り場フォーマッタ', async () => {
  assert.equal(waitText(20), '約20分');
  assert.equal(waitText(null), '—');
  assert.equal(trendText('up'), '活発↑');
  assert.equal(trendText('flat'), '横ばい→');
  assert.equal(trendText('down'), '少なめ↓');
  assert.equal(trendText('xxx'), '—');
  assert.equal(
    formatStallLine({ label: '第1乗り場', occ: 9, waitMin: 135, trend: 'up' }),
    '第1乗り場：在台 約9台 ／ 待ち目安 約135分 ／ 出 活発↑'
  );
  assert.equal(
    formatStallLine({ label: '第2乗り場', occ: 0, waitMin: null, trend: 'flat' }),
    '第2乗り場：在台 約0台 ／ 待ち目安 — ／ 出 横ばい→'
  );
});

test('pool-status-section: ターミナル到着便フォーマッタ', async () => {
  const ta = { T1: { next30: 5, next60: 8 }, T2: { next30: 0, next60: 7 } };
  assert.deepEqual(formatTerminalArrivals(ta), [
    '第1・2乗り場（JAL T1）これから来る客：30分で約5人 ／ 60分で約8人',
    '第3・4乗り場（ANA T2）これから来る客：30分で約0人 ／ 60分で約7人',
  ]);
  assert.deepEqual(formatTerminalArrivals(null), []);
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd ~/work/taxi-dev-wt-pool-status && node --test tests/pool-status-section.test.js`
Expected: FAIL — `waitText is not a function` 等

- [ ] **Step 3: 最小実装を書く**

`tools/js/pool-status-section.js` の `activityText` 関数の直後（14行目あたり）に追記:

```js
const TREND_JA = { up: '活発↑', flat: '横ばい→', down: '少なめ↓' };

export function waitText(waitMin) {
  return (typeof waitMin === 'number') ? `約${waitMin}分` : '—';
}
export function trendText(trend) { return TREND_JA[trend] || '—'; }

/** 1乗り場分の事実行を組み立てる（断定しない・目安語彙のみ）。 */
export function formatStallLine(stall) {
  if (!stall) return '';
  return `${stall.label}：在台 約${stall.occ ?? '—'}台 ／ 待ち目安 ${waitText(stall.waitMin)} ／ 出 ${trendText(stall.trend)}`;
}

const TERMINAL_LABEL = { T1: '第1・2乗り場（JAL T1）', T2: '第3・4乗り場（ANA T2）' };

/** terminalArrivals を T1→T2 の順で人が読める行配列に。null/欠落は空配列。 */
export function formatTerminalArrivals(ta) {
  if (!ta) return [];
  const out = [];
  for (const t of ['T1', 'T2']) {
    const v = ta[t];
    if (!v) continue;
    out.push(`${TERMINAL_LABEL[t]}これから来る客：30分で約${v.next30 ?? 0}人 ／ 60分で約${v.next60 ?? 0}人`);
  }
  return out;
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `cd ~/work/taxi-dev-wt-pool-status && node --test tests/pool-status-section.test.js`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
cd ~/work/taxi-dev-wt-pool-status
git add tools/js/pool-status-section.js tests/pool-status-section.test.js
git commit -m "feat(pool-status): 乗り場別・到着便のUI純フォーマッタ"
```

---

### Task B2: arrivals.html に表示コンテナを追加

**Files:**
- Modify: `~/work/taxi-dev-wt-pool-status/tools/arrivals.html:238`

- [ ] **Step 1: DOMコンテナを追加**

`tools/arrivals.html` の `<div id="pool-status-activity" ...>今日の流れ: —</div>` の行（238行目）の**直後**に次を挿入:

```html
      <div id="pool-status-stalls" style="margin-top:8px; font-size:13px; line-height:1.7;"></div>
      <div id="pool-status-arrivals" style="margin-top:6px; font-size:12px; color:var(--sub); line-height:1.6;"></div>
```

- [ ] **Step 2: 構文確認（タグの対応崩れが無いか）**

Run: `cd ~/work/taxi-dev-wt-pool-status && node -e "const h=require('fs').readFileSync('tools/arrivals.html','utf8'); const o=(h.match(/<div/g)||[]).length, c=(h.match(/<\/div>/g)||[]).length; console.log('div open',o,'close',c);"`
Expected: open と close の差が編集前と変わらない（2つ追加し2つ閉じたので差は不変）。

- [ ] **Step 3: コミット**

```bash
cd ~/work/taxi-dev-wt-pool-status
git add tools/arrivals.html
git commit -m "feat(pool-status): 乗り場別・到着便の表示コンテナを追加"
```

---

### Task B3: render() で新コンテナへ描画（グレースフル縮退）

**Files:**
- Modify: `~/work/taxi-dev-wt-pool-status/tools/js/pool-status-section.js:31-60`（`initPoolStatusSection`）

- [ ] **Step 1: render を拡張**

`tools/js/pool-status-section.js` の `initPoolStatusSection` 内、要素取得部に2つ追加。`const img2 = document.getElementById('pool-cam-real02');` の直後に挿入:

```js
  const stallsEl = document.getElementById('pool-status-stalls');
  const arrivalsEl = document.getElementById('pool-status-arrivals');
```

次に `render()` 関数内、`if (actEl) { ... }` ブロックの**直後**（`}` の後、`render` 関数を閉じる `}` の前）に挿入:

```js
    if (stallsEl) {
      const stalls = data.stalls;
      if (stalls) {
        const order = ['stall1', 'stall2', 'stall3', 'stall4'];
        stallsEl.innerHTML = order
          .filter(k => stalls[k])
          .map(k => `<div>${formatStallLine(stalls[k])}</div>`)
          .join('');
      } else {
        stallsEl.innerHTML = '';
      }
    }
    if (arrivalsEl) {
      const lines = formatTerminalArrivals(data.terminalArrivals);
      arrivalsEl.innerHTML = lines.length
        ? lines.map(l => `<div>${l}</div>`).join('')
        : '';
    }
```

> グレースフル縮退: 古い `pool-status.json`（`stalls`/`terminalArrivals` 無し）でも `else`/空配列で何も表示せず既存表示は無傷。

- [ ] **Step 2: 既存テストが壊れていないか確認**

Run: `cd ~/work/taxi-dev-wt-pool-status && npm test`
Expected: PASS（全テスト緑。render はDOM依存なので単体テストは B1 のフォーマッタで担保済み）

- [ ] **Step 3: ヘッドレスでUI描画を確認（サンプルデータ注入）**

新フィールド入りのサンプルを置いて、describe-style の手動確認を行う:

```bash
cd ~/work/taxi-dev-wt-pool-status
node -e "
const { formatStallLine, formatTerminalArrivals } = await import('./tools/js/pool-status-section.js');
const sample = { stalls: { stall1:{label:'第1乗り場',occ:9,waitMin:135,trend:'up'}, stall2:{label:'第2乗り場',occ:0,waitMin:null,trend:'flat'}, stall3:{label:'第3乗り場',occ:5,waitMin:30,trend:'down'}, stall4:{label:'第4乗り場',occ:12,waitMin:48,trend:'flat'} }, terminalArrivals: { T1:{next30:5,next60:8}, T2:{next30:0,next60:7} } };
console.log(['stall1','stall2','stall3','stall4'].map(k=>formatStallLine(sample.stalls[k])).join('\n'));
console.log(formatTerminalArrivals(sample.terminalArrivals).join('\n'));
" --input-type=module
```
Expected: 4乗り場行 + 2ターミナル行が想定どおり表示される。

- [ ] **Step 4: コミット**

```bash
cd ~/work/taxi-dev-wt-pool-status
git add tools/js/pool-status-section.js
git commit -m "feat(pool-status): render で乗り場別・到着便を描画(グレースフル縮退)"
```

---

### Task B4: Service Worker キャッシュ bump + dev反映

**Files:**
- Modify: `~/work/taxi-dev-wt-pool-status/sw.js:2`

- [ ] **Step 1: CACHE_NAME を bump**

`sw.js` の2行目を次に置き換える:

```js
const CACHE_NAME = CACHE_PREFIX + 'v223';
```

> `pool-status-section.js` は既に `STATIC_FILES`（sw.js:74）に含まれるため新規追加は不要。`arrivals.html` 更新も version bump で再取得される。

- [ ] **Step 2: 全テスト最終確認**

Run: `cd ~/work/taxi-dev-wt-pool-status && npm test`
Expected: PASS（全テスト緑）

- [ ] **Step 3: コミット**

```bash
cd ~/work/taxi-dev-wt-pool-status
git add sw.js
git commit -m "chore(sw): CACHE_NAME v222→v223 (乗り場別・到着便)"
```

- [ ] **Step 4: dev反映（ユーザーに依頼）**

Claude は push しない。ユーザーに次を案内する（行頭 `!` でこのセッション内実行）:

```
! bash ~/work/taxi-dev-wt-pool-status/PUSH-genkyo.sh
```

> dpush の rebase で `sw.js` が dev 最新版数と衝突したら、大きい方 +1 に統一して `git rebase --continue`（[[project_taxi-dev-clone-push-workflow]] [[feedback_taxi-daily-report-sw-cache-deploy]]）。
> 反映後は PWA を再起動して新SW適用を案内する。

---

# Phase C — デプロイ・検証メモ（実装後）

- **日報 dev**: Phase B の `PUSH-genkyo.sh` で dev に反映。dev確認URLで `arrivals.html` の現況ブロックに乗り場別・到着便が出るか確認。**ただし** ライブの `pool-status.json` がまだ Phase A 反映前なら `stalls`/`terminalArrivals` は出ず、既存表示のみ（縮退）になる＝正常。
- **taxi-ic-helper ライブ反映**: Phase A の `feat/pool-status` をライブ（Mac mini, Tailscale `100.88.23.4`）へ反映する操作はユーザー管轄（observe-tick が動くブランチへ取り込み→次tickで新 `pool-status.json` 生成→relay で日報 `tools/data/` へ配信）。このopsはユーザーの合図で別途。
- **本番**: ①現況UIと同様、本番は保留（本番タグ `v*` は dev 全体を rsync 公開するため、stands 等と一括で出す方針）。次タグ v1.35.0 想定。
- **③（順位・おすすめ示唆）**: 責任観点で別途・後回し（このプラン対象外）。

---

## Self-Review

**1. Spec coverage（承認設計の各要件 → タスク対応）**
- 在台数（乗り場別）→ A1 `currentOccupancyByStall` ✓
- 待ち時間目安（在台×60÷直近1h出庫, 0は—）→ A2 `waitMinFor` + B1 `waitText` ✓
- 直近の動き方（30分比 ≥1.25↑/<0.75↓）→ A2 `stallTrend` + B1 `trendText` ✓
- ターミナル別到着便（estimatedTaxiPax × lobbyExitTime, 30/60分）→ A4 `buildTerminalArrivals` ✓
- 乗り場↔ターミナル（第1・2=T1, 第3・4=T2）→ A3 `STALL_TERMINAL` + B1 `TERMINAL_LABEL` ✓
- 事実のみ・断定しない → 語彙「待ち目安」「これから来る客」「出 活発/横ばい/少なめ」、「並べ」表現なし ✓
- pool-status.json へ焼き込み → A5 / A6 ✓
- UI は現況下に一覧 → B2 配置（activity の下）✓

**2. Placeholder scan**: TBD/TODO/「適切なエラー処理」等のプレースホルダ無し。各コードステップに実コードあり ✓

**3. Type consistency**:
- stall キー: 全タスクで `stall1`〜`stall4`（`stall4` は back 合算）で一貫 ✓
- `waitMin`: `number | null`（A2で定義 → A3 で格納 → B1 `waitText` が number判定）✓
- `trend`: `'up'|'flat'|'down'`（A2 → A3 → B1 `trendText` の `TREND_JA` キー一致）✓
- `terminalArrivals`: `{T1:{next30,next60}, T2:{next30,next60}} | null`（A4 → A5 → B1 `formatTerminalArrivals`）✓
- `buildPoolStatus` 第3引数 `arrivals` は optional（既存2引数テスト不変）✓
- `STALL_KEYS`(A1) と `STALL_NAMES`/`STALL_TERMINAL`(A3) は別定数だが同一 stall 集合で矛盾なし ✓

---

## 実行方法

このプランは `superpowers:subagent-driven-development`（タスクごとに新サブエージェント＋段階レビュー、推奨）で実装する。Phase A → Phase B の順。各タスクは独立コミット。

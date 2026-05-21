# 効率ヒートマップ意味レイヤー Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 効率ヒートマップの各セルに「稼ぎ時/普通/休憩向き」ラベルと「安定度（◎○△）」を付け、常設の凡例とともに review.html / support.html 両方に表示する。

**Architecture:** 純粋ロジック（変動係数・安定度判定・相対ラベル判定・凡例文字列・日別値抽出）を `js/chart-helpers.js` に集約し、ユニットテストで担保。日別¥/hは既存の `hourlyDowEfficiency` / `dowZoneEfficiency` を「日付グループ単位」で呼び直して再利用（DRY、既存関数を変更しない）。両HTMLの描画関数（`renderHourEff` / `renderHeatmap`）からこの共通ロジックを呼び、セル表示・タップ詳細・凡例を拡張する。

**Tech Stack:** Vanilla ES Modules（フレームワークなし）、`node --test`（`tests/*.test.js`）、PWA（sw.js キャッシュ）。

**前提:** 仕様書 `docs/superpowers/specs/2026-05-22-heatmap-meaning-layer-design.md`。作業worktree `タクシー日報-wt-heatmap-guidance`（branch `feat/analysis-heatmap-guidance`）。確定済み判断: A=3段階 / B=CV閾値0.3,0.6（暫定）/ C=zoneは文字ラベル＋hourは色＋アイコン＋タップ / D=折りたたみは本計画スコープ外。

---

## File Structure

- `js/chart-helpers.js` — **Modify**: 純関数 `coefficientOfVariation` / `stabilityTier` / `classifyEarning` / `heatmapLegendHtml` と日別抽出 `hourlyDowDailyValues` / `zoneDailyValues` を追加（末尾に追記、既存関数は不変）。
- `tests/chart-helpers.test.js` — **Modify**: 上記新関数のテストを追記。
- `support.html` — **Modify**: import行(214)拡張、`renderHourEff`(1053-1109)にラベル・安定度・凡例・タップ詳細を追加。
- `review.html` — **Modify**: import行(186)拡張、`renderHeatmap`(594-649)にラベル・安定度・凡例・タップ詳細を追加。
- `sw.js` — **Modify**: `CACHE_NAME` を `v178`→`v179` にbump。

---

### Task 1: 純関数（変動係数・安定度・相対ラベル）

**Files:**
- Modify: `js/chart-helpers.js`（ファイル末尾に追記）
- Test: `tests/chart-helpers.test.js`（末尾に追記）

- [ ] **Step 1: Write the failing tests**

`tests/chart-helpers.test.js` の末尾に追記:

```js
import {
  coefficientOfVariation, stabilityTier, classifyEarning
} from '../js/chart-helpers.js';

test('coefficientOfVariation: 標準偏差/平均。全て同値ならCV=0', () => {
  assert.equal(coefficientOfVariation([100, 100, 100]), 0);
});

test('coefficientOfVariation: 空配列や平均0は0を返す', () => {
  assert.equal(coefficientOfVariation([]), 0);
  assert.equal(coefficientOfVariation([0, 0]), 0);
});

test('coefficientOfVariation: 既知値（母集団標準偏差）', () => {
  // values [2,4,4,4,5,5,7,9]: mean=5, 母分散=4, std=2, CV=0.4
  assert.equal(coefficientOfVariation([2,4,4,4,5,5,7,9]), 0.4);
});

test('stabilityTier: 3件未満は insufficient', () => {
  assert.equal(stabilityTier([100, 100]), 'insufficient');
  assert.equal(stabilityTier([]), 'insufficient');
});

test('stabilityTier: CV<=0.3=stable, <=0.6=mid, >0.6=volatile', () => {
  assert.equal(stabilityTier([100, 100, 100]), 'stable');        // CV=0
  assert.equal(stabilityTier([2,4,4,4,5,5,7,9]), 'mid');          // CV=0.4
  assert.equal(stabilityTier([10, 50, 100]), 'volatile');        // CV>0.6
});

test('classifyEarning: 有効値分布の上位1/3=earn, 下位1/3=rest, 中間=normal', () => {
  const vals = [10, 20, 30, 40, 50, 60, 70, 80, 90]; // 9件
  assert.equal(classifyEarning(90, vals), 'earn');   // 最上位
  assert.equal(classifyEarning(80, vals), 'earn');   // pct=7/9>=2/3
  assert.equal(classifyEarning(50, vals), 'normal'); // pct=4/9
  assert.equal(classifyEarning(10, vals), 'rest');   // pct=0
  assert.equal(classifyEarning(20, vals), 'rest');   // pct=1/9<1/3
});

test('classifyEarning: 値0や有効値3件未満は none', () => {
  assert.equal(classifyEarning(0, [10, 20, 30]), 'none');
  assert.equal(classifyEarning(50, [50, 60]), 'none');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd タクシー日報-wt-heatmap-guidance && node --test tests/chart-helpers.test.js`
Expected: FAIL（`coefficientOfVariation is not a function` 等のimportエラー）

- [ ] **Step 3: Write minimal implementation**

`js/chart-helpers.js` の末尾に追記:

```js
// ───────── 意味レイヤー: 安定度・相対ラベル ─────────

// 変動係数 (母標準偏差 / 平均)。空 or 平均0 は 0。
export function coefficientOfVariation(values) {
  if (!values || values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (mean === 0) return 0;
  const variance = values.reduce((a, b) => a + (b - mean) * (b - mean), 0) / values.length;
  return Math.sqrt(variance) / mean;
}

// 日別¥/h配列 → 安定度tier。3件未満は判定不可。
// CV<=0.3:安定 / <=0.6:中 / >0.6:ムラ大
export function stabilityTier(dailyValues) {
  if (!dailyValues || dailyValues.length < 3) return 'insufficient';
  const cv = coefficientOfVariation(dailyValues);
  if (cv <= 0.3) return 'stable';
  if (cv <= 0.6) return 'mid';
  return 'volatile';
}

// 値を、有効セル値リスト(validValues)の相対順位で earn/normal/rest に分類。
// 上位1/3=earn, 下位1/3=rest, 中間=normal。値0 or 有効値3件未満は none。
export function classifyEarning(value, validValues) {
  if (!(value > 0) || !validValues || validValues.length < 3) return 'none';
  const n = validValues.length;
  const rankBelow = validValues.filter(x => x < value).length;
  const pct = rankBelow / n;
  if (pct >= 2 / 3) return 'earn';
  if (pct < 1 / 3) return 'rest';
  return 'normal';
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/chart-helpers.test.js`
Expected: PASS（新規7テスト含む全通過）

- [ ] **Step 5: Commit**

```bash
git add js/chart-helpers.js tests/chart-helpers.test.js
git commit -m "feat(chart): 安定度(CV)・相対稼ぎ時ラベルの純関数を追加"
```

---

### Task 2: 日別¥/h抽出（既存関数を日付グループ単位で再利用）

**Files:**
- Modify: `js/chart-helpers.js`（Task 1 の追記の続き）
- Test: `tests/chart-helpers.test.js`

- [ ] **Step 1: Write the failing tests**

`tests/chart-helpers.test.js` の末尾に追記:

```js
import { hourlyDowDailyValues, zoneDailyValues } from '../js/chart-helpers.js';
import { getShiftZones, ZONE_PRESETS } from '../js/chart-helpers.js';

test('hourlyDowDailyValues: 同じ曜日の別日が、その時間帯セルに日別¥/hとして積まれる', () => {
  // 2026-04-23(木) と 2026-04-30(木) の 19時台。各日 workingMin=60, 売上 6000/3000
  const mk = (date, amount) => ({
    date, departureTime: '19:00', returnTime: '20:00',
    trips: [{ no: 1, boardTime: '19:10', alightTime: '19:30', boardPlace: 'A', alightPlace: 'B', km: 5, amount, isPickup: false, isCancel: false, waitTime: '' }],
    rests: []
  });
  const drives = [mk('2026-04-23', 6000), mk('2026-04-30', 3000)];
  const daily = hourlyDowDailyValues(drives);
  const dow = 4; // 木
  assert.equal(daily[dow][19].length, 2, '木19時に2日分');
  assert.deepEqual([...daily[dow][19]].sort((a,b)=>a-b), [3000, 6000]);
});

test('hourlyDowDailyValues: 実稼働0の時間帯は積まれない', () => {
  const drives = [{
    date: '2026-04-23', departureTime: '18:00', returnTime: '19:00',
    trips: [], rests: [{ startTime: '18:00', endTime: '19:00', place: 'X' }] // 全休憩
  }];
  const daily = hourlyDowDailyValues(drives);
  assert.equal(daily[4][18].length, 0, '休憩で実稼働0なら積まれない');
});

test('zoneDailyValues: ゾーン単位で日別¥/hが積まれる', () => {
  const zones = ZONE_PRESETS['human'].zones;
  const mk = (date) => ({
    date, departureTime: '19:00', returnTime: '20:00',
    trips: [{ no: 1, boardTime: '19:10', alightTime: '19:30', boardPlace: 'A', alightPlace: 'B', km: 5, amount: 4000, isPickup: false, isCancel: false, waitTime: '' }],
    rests: []
  });
  const drives = [mk('2026-04-23'), mk('2026-04-30')];
  const daily = zoneDailyValues(drives, zones);
  // 19時が属するゾーンキーを特定して2日分あることを確認
  const dow = 4;
  const total = Object.values(daily[dow]).reduce((acc, arr) => acc + arr.length, 0);
  assert.equal(total, 2, '木曜のいずれかのゾーンに2日分');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/chart-helpers.test.js`
Expected: FAIL（`hourlyDowDailyValues is not a function`）

- [ ] **Step 3: Write minimal implementation**

`js/chart-helpers.js` の末尾に追記（`hourlyDowEfficiency` / `dowZoneEfficiency` は同ファイル内で定義済みなのでそのまま呼べる）:

```js
// drives を日付ごとにグループ化（内部用）
function groupDrivesByDate(drives) {
  const m = new Map();
  for (const d of (drives || [])) {
    if (!d || !d.date) continue;
    if (!m.has(d.date)) m.set(d.date, []);
    m.get(d.date).push(d);
  }
  return m;
}

// 7×24 の各セルに「その日の実稼働がある時間帯の ¥/h」を日別配列で返す。
// 既存 hourlyDowEfficiency を日付グループ単位で呼び直して再利用。
export function hourlyDowDailyValues(drives) {
  const result = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => []));
  for (const [, dayDrives] of groupDrivesByDate(drives)) {
    const m = hourlyDowEfficiency(dayDrives);
    for (let dow = 0; dow < 7; dow++) {
      for (let h = 0; h < 24; h++) {
        if (m[dow][h].workingMin > 0) result[dow][h].push(m[dow][h].hourlyA);
      }
    }
  }
  return result;
}

// 7×ゾーンキー の各セルに日別 ¥/h を配列で返す（review用）。
export function zoneDailyValues(drives, zones) {
  const keys = zones.map(z => z.key);
  const result = Array.from({ length: 7 }, () => {
    const o = {};
    for (const k of keys) o[k] = [];
    return o;
  });
  for (const [, dayDrives] of groupDrivesByDate(drives)) {
    const { matrix } = dowZoneEfficiency(dayDrives, zones);
    for (let dow = 0; dow < 7; dow++) {
      for (const k of keys) {
        if (matrix[dow][k] > 0) result[dow][k].push(matrix[dow][k]);
      }
    }
  }
  return result;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/chart-helpers.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add js/chart-helpers.js tests/chart-helpers.test.js
git commit -m "feat(chart): 日別¥/h抽出(hourly/zone)を既存関数の再利用で追加"
```

---

### Task 3: 凡例文字列ヘルパー

**Files:**
- Modify: `js/chart-helpers.js`
- Test: `tests/chart-helpers.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { heatmapLegendHtml } from '../js/chart-helpers.js';

test('heatmapLegendHtml: 稼ぎ時/休憩向き/安定/ムラの語と使い方を含む', () => {
  const html = heatmapLegendHtml('self');
  assert.ok(html.includes('稼ぎ時'));
  assert.ok(html.includes('休憩向き'));
  assert.ok(html.includes('◎'));
  assert.ok(html.includes('△'));
  assert.ok(html.includes('休憩'));
});

test('heatmapLegendHtml: scope=all のとき「みんな」を補足', () => {
  assert.ok(heatmapLegendHtml('all').includes('みんな'));
  assert.ok(!heatmapLegendHtml('self').includes('みんな'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/chart-helpers.test.js`
Expected: FAIL（`heatmapLegendHtml is not a function`）

- [ ] **Step 3: Write minimal implementation**

`js/chart-helpers.js` の末尾に追記:

```js
// ヒートマップ凡例＋使い方1行。scope: 'self' | 'all'
export function heatmapLegendHtml(scope) {
  const who = scope === 'all' ? '<b>みんなの傾向</b>です。' : '';
  return `<div class="heat-legend" style="font-size:11px;color:var(--muted);line-height:1.6;margin-bottom:8px;">
    ${who}数字が大きい時間ほど<b>稼ぎ時</b>、低い時間は<b>休憩向き</b>。<b>◎</b>=安定して同じくらい稼げる / <b>△</b>=日によってムラが大きい / 薄いセル=記録がまだ少ない。<br>
    👉 休憩は「休憩向き」の時間に取ると、稼ぎ時を逃しません。
  </div>`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/chart-helpers.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add js/chart-helpers.js tests/chart-helpers.test.js
git commit -m "feat(chart): ヒートマップ凡例文字列ヘルパーを追加"
```

---

### Task 4: support.html ヒートマップに意味レイヤーを配線

**Files:**
- Modify: `support.html`（import行 214、`renderHourEff` 1053-1109）

- [ ] **Step 1: import を拡張**

`support.html:214` の `from './js/chart-helpers.js'` の import に以下を追加:
`hourlyDowDailyValues, classifyEarning, stabilityTier, heatmapLegendHtml`

（既存の `{ hourlyDowEfficiency, ... }` の波括弧内、末尾の `OFFICE_AREA` の後ろにカンマ区切りで追記）

- [ ] **Step 2: matrix計算直後に日別値と有効値リストを用意**

`renderHourEff()`（1053-）の `const matrix = hourlyDowEfficiency(sourceDrives);`（1055）の**直後**に挿入:

```js
  const daily = hourlyDowDailyValues(sourceDrives);
  const validValues = [];
  for (let dow = 0; dow < 7; dow++) for (const h of HOUR_ORDER) {
    if (matrix[dow][h].days >= 3 && matrix[dow][h].hourlyA > 0) validValues.push(matrix[dow][h].hourlyA);
  }
```

- [ ] **Step 3: 凡例を本体HTMLの先頭に差し込む**

`renderHourEff()` の `let html = '<div style="overflow-x:auto;">...` の行（1061）を、凡例を前置する形に変更:

変更前:
```js
  let html = '<div style="overflow-x:auto;"><div class="heatgrid" style="min-width:560px;">';
```
変更後:
```js
  let html = heatmapLegendHtml(hourScope);
  html += '<div style="overflow-x:auto;"><div class="heatgrid" style="min-width:560px;">';
```

- [ ] **Step 4: セルに安定度アイコンを付与**

セル生成箇所（1083-1085）を変更。

変更前:
```js
      const lowSample = c.days < 3 ? ' low-sample' : '';
      const display = v >= 1000 ? Math.round(v / 100) / 10 + 'k' : Math.round(v);
      html += `<div class="cell${lowSample}" style="background:rgb(${r},${g},${b});" data-dow="${dow}" data-h="${h}">${display}</div>`;
```
変更後:
```js
      const lowSample = c.days < 3 ? ' low-sample' : '';
      const display = v >= 1000 ? Math.round(v / 100) / 10 + 'k' : Math.round(v);
      const stab = stabilityTier(daily[dow][h]);
      const stabMark = stab === 'stable' ? '<span class="stab" style="color:#1b5e20;">◎</span>'
        : stab === 'volatile' ? '<span class="stab" style="color:#b71c1c;">△</span>' : '';
      html += `<div class="cell${lowSample}" style="background:rgb(${r},${g},${b});position:relative;" data-dow="${dow}" data-h="${h}"><span style="position:relative;z-index:1;">${display}</span><span style="position:absolute;top:0;right:1px;font-size:8px;line-height:1;">${stabMark}</span></div>`;
```

- [ ] **Step 5: タップ詳細に区分・安定度・レンジを追加**

タップ詳細の有効データ分岐（1101-1106）を変更。

変更前:
```js
      const scopeLabel = hourScope === 'all' ? '全員統合' : '自分';
      tip.innerHTML = `
        <strong>${DOW_LABELS[dow]} ${h}時台</strong> (${scopeLabel}・乗務した日数 ${c.days}日)<br>
        ¥/h <strong>${formatYen(c.hourlyA)}</strong> (=売上÷実稼働時間)<br>
        <span style="font-size:11px;color:var(--muted);">${c.count}件 ・ 売上計${formatYen(c.sales)} ・ 乗務計${formatMin(c.presentMin)} ・ 休憩計${formatMin(c.restMin)} ・ 実稼働${formatMin(c.workingMin)}</span>
      `;
```
変更後:
```js
      const scopeLabel = hourScope === 'all' ? '全員統合' : '自分';
      const tier = classifyEarning(c.hourlyA, validValues);
      const tierTxt = tier === 'earn' ? '🟢 稼ぎ時' : tier === 'rest' ? '🔵 休憩向き' : tier === 'normal' ? '普通' : '';
      const dv = daily[dow][h];
      const stab2 = stabilityTier(dv);
      const stabTxt = stab2 === 'stable' ? '◎ 安定して稼げる' : stab2 === 'mid' ? '○ ややムラ' : stab2 === 'volatile' ? '△ 日によりムラ大' : '— 記録が少なく判定不可';
      const range = dv.length ? `${formatYen(Math.min(...dv))}〜${formatYen(Math.max(...dv))}/h` : '—';
      tip.innerHTML = `
        <strong>${DOW_LABELS[dow]} ${h}時台</strong> (${scopeLabel}・乗務した日数 ${c.days}日)<br>
        ${tierTxt ? '<strong>' + tierTxt + '</strong>　' : ''}安定度: ${stabTxt}<br>
        ¥/h <strong>${formatYen(c.hourlyA)}</strong> (=売上÷実稼働時間)・日別レンジ ${range}<br>
        <span style="font-size:11px;color:var(--muted);">${c.count}件 ・ 売上計${formatYen(c.sales)} ・ 乗務計${formatMin(c.presentMin)} ・ 休憩計${formatMin(c.restMin)} ・ 実稼働${formatMin(c.workingMin)}</span>
      `;
```

- [ ] **Step 6: ローカルサーブで手動確認**

Run: `python3 -m http.server 8000`（worktreeルートで）。ブラウザで `http://localhost:8000/support.html` を開く（要ログイン・full plan）。
確認:
- ヒートマップ上に凡例（稼ぎ時/休憩向き/◎△/使い方）が出る
- セル右上に ◎ / △ が出る（安定/ムラのセル）
- 「自分のみ」「全員統合」タブ切替で凡例文言が変わる（全員時「みんなの傾向」）
- セルtapで「稼ぎ時/休憩向き・安定度・日別レンジ」が出る
- days<3 セルが従来どおり薄い（low-sample）
- 車種タブ切替で再判定される

> ログイン環境が用意できない場合は Task 7 の統合確認にまとめてよい。最低限 `node --test` が緑であることを Step なしで確認。

- [ ] **Step 7: Commit**

```bash
git add support.html
git commit -m "feat(support): ヒートマップに稼ぎ時/休憩向きラベル・安定度・凡例を追加"
```

---

### Task 5: review.html ヒートマップに意味レイヤーを配線

**Files:**
- Modify: `review.html`（import行 186、`renderHeatmap` 594-649）

review.html はゾーン単位でセルが広いため、セル本体に**文字ラベル（稼ぎ時/休憩向き）**＋安定度アイコンを出す（論点C: zoneは文字、hourは色＋アイコン）。

- [ ] **Step 1: import を拡張**

`review.html:186` の import に追加:
`zoneDailyValues, classifyEarning, stabilityTier, heatmapLegendHtml`
（`calcZoneBreakdown` の後ろにカンマ区切りで追記）

- [ ] **Step 2: matrix計算直後に日別値・有効値を用意**

`renderHeatmap()` の `const { matrix, days } = dowZoneEfficiency(allDrives, preset.zones);`（598）の**直後**に挿入:

```js
  const dailyZ = zoneDailyValues(allDrives, preset.zones);
  const validValues = [];
  for (let dw = 0; dw < 7; dw++) for (const z of preset.zones) {
    if (dailyZ[dw][z.key].length >= 3 && matrix[dw][z.key] > 0) validValues.push(matrix[dw][z.key]);
  }
```

- [ ] **Step 3: セル本体にラベル＋安定度を表示**

セル生成箇所（608-615）を変更。

変更前:
```js
    for (const z of preset.zones) {
      const v = matrix[dow][z.key];
      const intensity = v > 0 ? Math.min(1, v / max) : 0;
      const bg = v > 0 ? `rgba(76, 175, 80, ${0.15 + 0.7 * intensity})` : '#fafafa';
      const text = v > 0 ? formatYen(v).replace('¥','') : '—';
      const color = intensity > 0.6 ? '#fff' : '#222';
      cellsHtml += `<div class="cell heat-touch" data-dow="${dow}" data-k="${z.key}" data-v="${v}" data-days="${days[dow]}" style="background:${bg};color:${color};">${text}</div>`;
    }
```
変更後:
```js
    for (const z of preset.zones) {
      const v = matrix[dow][z.key];
      const intensity = v > 0 ? Math.min(1, v / max) : 0;
      const bg = v > 0 ? `rgba(76, 175, 80, ${0.15 + 0.7 * intensity})` : '#fafafa';
      const text = v > 0 ? formatYen(v).replace('¥','') : '—';
      const color = intensity > 0.6 ? '#fff' : '#222';
      const tier = classifyEarning(v, validValues);
      const stab = stabilityTier(dailyZ[dow][z.key]);
      const tierTag = tier === 'earn' ? '稼ぎ時' : tier === 'rest' ? '休憩向き' : '';
      const stabMark = stab === 'stable' ? '◎' : stab === 'volatile' ? '△' : '';
      const sub = (tierTag || stabMark)
        ? `<br><span style="font-size:8px;font-weight:600;opacity:.85;">${tierTag}${stabMark ? ' ' + stabMark : ''}</span>` : '';
      cellsHtml += `<div class="cell heat-touch" data-dow="${dow}" data-k="${z.key}" data-v="${v}" data-days="${days[dow]}" style="background:${bg};color:${color};">${text}${sub}</div>`;
    }
```

- [ ] **Step 4: 凡例を本体HTMLに前置**

`renderHeatmap()` の `document.getElementById('heatBody').innerHTML = ` のテンプレート（622-627）冒頭に凡例を加える。

変更前:
```js
  document.getElementById('heatBody').innerHTML = `
    <div style="display:flex;gap:3px;flex-wrap:wrap;margin-bottom:8px;">${presetTabs}</div>
```
変更後:
```js
  document.getElementById('heatBody').innerHTML = `
    ${heatmapLegendHtml('self')}
    <div style="display:flex;gap:3px;flex-wrap:wrap;margin-bottom:8px;">${presetTabs}</div>
```

- [ ] **Step 5: タップ詳細に区分・安定度・レンジを追加**

タップ詳細の `v > 0` 分岐（641-643）を変更。

変更前:
```js
      if (v > 0) {
        tip.innerHTML = `<strong>${DOW_LABELS[dow]}曜 × ${zone.label}</strong><br>
          平均時間単価: <strong>${formatYen(v)}/h</strong> (${days}日ベース)`;
      } else {
```
変更後:
```js
      if (v > 0) {
        const tier = classifyEarning(v, validValues);
        const tierTxt = tier === 'earn' ? '🟢 稼ぎ時' : tier === 'rest' ? '🔵 休憩向き' : tier === 'normal' ? '普通' : '';
        const dv = dailyZ[dow][k];
        const stab = stabilityTier(dv);
        const stabTxt = stab === 'stable' ? '◎ 安定して稼げる' : stab === 'mid' ? '○ ややムラ' : stab === 'volatile' ? '△ 日によりムラ大' : '— 記録が少なく判定不可';
        const range = dv.length ? `${formatYen(Math.min(...dv))}〜${formatYen(Math.max(...dv))}/h` : '—';
        tip.innerHTML = `<strong>${DOW_LABELS[dow]}曜 × ${zone.label}</strong><br>
          ${tierTxt ? '<strong>' + tierTxt + '</strong>　' : ''}安定度: ${stabTxt}<br>
          平均時間単価: <strong>${formatYen(v)}/h</strong> (${days}日ベース)・日別レンジ ${range}`;
      } else {
```

- [ ] **Step 6: ローカルサーブで手動確認**

`http://localhost:8000/review.html` を開く。確認:
- 凡例が出る
- ゾーンセルに「稼ぎ時 ◎ / 休憩向き △」等のラベルが出る
- セルtapで区分・安定度・レンジが出る
- ゾーンプリセット切替（人の動き別/シフト別）で再判定される
- 車種タブ切替で再判定される

- [ ] **Step 7: Commit**

```bash
git add review.html
git commit -m "feat(review): ヒートマップに稼ぎ時/休憩向きラベル・安定度・凡例を追加"
```

---

### Task 6: SWキャッシュbump＋最終確認

**Files:**
- Modify: `sw.js`（`CACHE_NAME`）

- [ ] **Step 1: CACHE_NAME を bump**

`sw.js` の `const CACHE_NAME = CACHE_PREFIX + 'v178';` を `'v179'` に変更。

- [ ] **Step 2: 全テスト実行**

Run: `node --test tests/*.test.js`
Expected: 全テストPASS（既存＋新規）

- [ ] **Step 3: 両ページ統合確認（実機推奨）**

dev環境へデプロイ後（既存の dev→承認→prod フロー）、PWAを再起動して:
- review.html / support.html 両方で凡例・ラベル・安定度・タップ詳細が出る
- 既存挙動（色スケール、low-sample、車種フィルタ、全員統合タブ）が壊れていない
- iPhone実機（PWA再起動）で表示崩れがないこと

- [ ] **Step 4: Commit**

```bash
git add sw.js
git commit -m "chore(sw): キャッシュをv179にbump（ヒートマップ意味レイヤー反映）"
```

---

## Self-Review 結果

**1. Spec coverage（仕様の各要件 → タスク対応）**
- 稼ぎ時/普通/休憩向きラベル（相対・3段階, 論点A） → Task 1 `classifyEarning` + Task 4/5 配線 ✅
- 安定度/ムラ（CV, 論点B） → Task 1 `stabilityTier` + Task 2 日別抽出 + Task 4/5 ✅
- 常設ガイド（凡例＋使い方1行） → Task 3 + Task 4/5 ✅
- 両ページ（review/support） → Task 4(support) / Task 5(review) ✅
- セル本体は最小・詳細はタップ（情報過多回避, 論点C） → Task 4(hour=色+アイコン+tap) / Task 5(zone=文字+アイコン+tap) ✅
- days<3グレー・車種フィルタ・全員統合の既存維持 → Task 4/5 で既存ロジック非破壊、Task 6で回帰確認 ✅
- SW CACHE bump → Task 6 ✅
- 非ゴール（お手本ゲート/入力画面/新規バックエンド/折りたたみ） → 本計画は触れない ✅

**2. Placeholder scan:** TBD/TODO・曖昧指示なし。全コードステップに実コードあり。✅

**3. Type consistency:** `classifyEarning(value, validValues)` / `stabilityTier(dailyValues)` / `coefficientOfVariation(values)` / `hourlyDowDailyValues(drives)→7×24配列` / `zoneDailyValues(drives,zones)→7×{key:配列}` / `heatmapLegendHtml(scope)` の名称・引数・戻り値が Task 1〜5 で一貫。tier値 `earn/normal/rest/none`、stability値 `stable/mid/volatile/insufficient` も一貫。✅

**4. 既知の許容事項:**
- 相対ラベルの「有効値」母数は support=`days>=3`、review=`dailyZ[].length>=3`。両者は実運用上ほぼ一致（1日1乗務が大半）。安定度判定は両ページとも `dailyValues.length>=3`。
- ローカル手動確認はログイン/プラン制約があるため、最終はdev実機確認（Task 6 Step 3）に集約してよい。

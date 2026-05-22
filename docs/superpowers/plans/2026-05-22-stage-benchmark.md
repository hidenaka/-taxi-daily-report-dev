# ステージ制お手本 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** review.html に「目標ステージ別の稼ぎ方」カードを追加し、本人の全期間データを日次税込営収のステージ（5千円刻み）に分け、選んだステージの日々の曜日×時間 平均売上ヒートマップを表示する。

**Architecture:** 純ロジック（日別営収・ステージ割り・平均売上行列）を `js/chart-helpers.js` に追加（既存 `hourlyDowEfficiency` を流用、既存関数は無変更）。review.html に24時間グリッドCSS・ステージカード・`renderStageBenchmark()` を足し、`renderAll` から呼ぶ。dev はデータ空のため確認用 `preview-stage.html`（サンプルデータ）を用意し、本番前に削除。

**Tech Stack:** Vanilla ES Modules、`node --test`（`tests/*.test.js`）、PWA（sw.js）。

**前提:** 仕様 `docs/superpowers/specs/2026-05-22-stage-benchmark-design.md`。worktree `タクシー日報-wt-stage-benchmark`（branch `feat/stage-benchmark`, dev/main基点）。確定: 平均売上の分母=その曜日の該当日数 / 初期選択=最多日数ステージ / 表示=百円丸め。

---

## File Structure

- `js/chart-helpers.js` — **Modify**（末尾に追記）: `dailySalesList` / `salesStages` / `stageHeatmap`。既存関数は無変更。
- `tests/chart-helpers.test.js` — **Modify**: 上記のテスト追記。
- `review.html` — **Modify**: import追加(`salesStages, stageHeatmap`)、`HOUR_ORDER`定数、`.heatgrid` CSS、`#stageCard` HTML、`renderStageBenchmark()`、`renderAll`に追加、`selectedStageKey`状態。
- `preview-stage.html` — **Create**: サンプルデータ確認ページ（本番前に削除）。
- `sw.js` — **Modify**: `CACHE_NAME` bump。

---

### Task 1: 純ロジック（日別営収・ステージ・平均売上行列）

**Files:**
- Modify: `js/chart-helpers.js`（末尾に追記）
- Test: `tests/chart-helpers.test.js`（末尾に追記）

- [ ] **Step 1: Write the failing tests**

`tests/chart-helpers.test.js` の末尾に追記:

```js
import { dailySalesList, salesStages, stageHeatmap } from '../js/chart-helpers.js';

test('dailySalesList: キャンセル・summary除外、sales/dow正確', () => {
  const drives = [
    { date: '2026-04-23', trips: [ // 木
      { boardTime:'19:00', alightTime:'19:20', amount: 4000, isCancel:false },
      { boardTime:'19:30', alightTime:'19:40', amount: 2000, isCancel:true } // キャンセルは除外
    ], rests: [] },
    { date: '2026-04-24', summaryOnly: true, trips: [], rests: [] } // summary除外
  ];
  const list = dailySalesList(drives);
  assert.equal(list.length, 1);
  assert.equal(list[0].sales, 4000);
  assert.equal(list[0].dow, 4);
  assert.equal(list[0].count, 1);
});

test('salesStages: 5千円刻み境界・端バケット・空ステージ除外', () => {
  const mk = (date, amount) => ({ date, trips:[{boardTime:'10:00',alightTime:'10:10',amount,isCancel:false}], rests:[] });
  const drives = [
    mk('2026-04-01', 48000),  // 〜5万
    mk('2026-04-02', 60000),  // 6.0–6.5万 (idx2)
    mk('2026-04-03', 64999),  // 6.0–6.5万 (同じ)
    mk('2026-04-04', 65000),  // 6.5–7万 (idx3)
    mk('2026-04-05', 125000), // 12万+
  ];
  const stages = salesStages(drives);
  const byKey = Object.fromEntries(stages.map(s => [s.label, s.count]));
  assert.equal(byKey['〜5万'], 1);
  assert.equal(byKey['6–6.5万'], 2);
  assert.equal(byKey['6.5–7万'], 1);
  assert.equal(byKey['12万+'], 1);
  // 空ステージ(5–5.5万等)は含まれない
  assert.equal(stages.some(s => s.label === '5–5.5万'), false);
  // lower昇順
  assert.deepEqual(stages.map(s => s.lower), [...stages.map(s=>s.lower)].sort((a,b)=>a-b));
});

test('stageHeatmap: 平均売上=その曜日のセル売上合計÷該当日数', () => {
  // 木曜の2日。各日 19時に売上(4000, 6000) → 木19時 平均5000
  const mk = (date, amount) => ({
    date, departureTime:'19:00', returnTime:'20:00',
    trips:[{ boardTime:'19:10', alightTime:'19:30', amount, isCancel:false }], rests:[]
  });
  const drives = [ mk('2026-04-23', 4000), mk('2026-04-30', 6000) ]; // 両方木曜
  const { matrix, dowDayCount } = stageHeatmap(drives);
  assert.equal(dowDayCount[4], 2);
  assert.equal(Math.round(matrix[4][19].avgSales), 5000);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd タクシー日報-wt-stage-benchmark && node --test tests/chart-helpers.test.js`
Expected: FAIL（`dailySalesList is not a function`）

- [ ] **Step 3: Write minimal implementation**

`js/chart-helpers.js` の末尾に追記（`isSummaryOnly` / `dowOf` / `hourlyDowEfficiency` は同ファイル内に既存）:

```js
// ───────── ステージ制お手本 ─────────

// 日別の税込営収リスト（rankDrivesBySales と同じ売上定義: 非キャンセルtripのamount合計）
export function dailySalesList(drives) {
  return (drives || [])
    .filter(d => d && !isSummaryOnly(d) && d.date)
    .map(d => {
      const valid = (d.trips || []).filter(t => !t.isCancel);
      const sales = valid.reduce((s, t) => s + (t.amount || 0), 0);
      return { date: d.date, sales, count: valid.length, dow: dowOf(d.date) };
    })
    .filter(d => d.sales > 0);
}

// 1日の税込営収を5千円刻みステージに分ける。該当日(>=1)のステージのみ、lower昇順で返す。
// 端: min未満は「〜{min}万」、max以上は「{max}万+」。
export function salesStages(drives, opts = {}) {
  const min = opts.min ?? 50000;
  const max = opts.max ?? 120000;
  const step = opts.step ?? 5000;
  const man = n => {
    const v = n / 10000;
    return Number.isInteger(v) ? String(v) : String(Math.round(v * 10) / 10);
  };
  const classify = (sales) => {
    if (sales < min) return { key: 'lt', lower: 0, upper: min, label: `〜${man(min)}万` };
    if (sales >= max) return { key: 'gte', lower: max, upper: Infinity, label: `${man(max)}万+` };
    const idx = Math.floor((sales - min) / step);
    const lower = min + idx * step;
    return { key: `b${idx}`, lower, upper: lower + step, label: `${man(lower)}–${man(lower + step)}万` };
  };
  const map = new Map();
  for (const d of dailySalesList(drives)) {
    const st = classify(d.sales);
    if (!map.has(st.key)) map.set(st.key, { ...st, dates: [] });
    map.get(st.key).dates.push(d.date);
  }
  return [...map.values()]
    .map(s => ({ ...s, count: s.dates.length }))
    .sort((a, b) => a.lower - b.lower);
}

// 選択ステージの drives から 曜日×時間 の平均売上行列を作る。
// 平均売上 = その曜日のセル売上合計(按分) ÷ その曜日の該当日数。既存 hourlyDowEfficiency を流用。
export function stageHeatmap(stageDrives) {
  const hm = hourlyDowEfficiency(stageDrives);
  const dowDayCount = Array(7).fill(0);
  for (const d of (stageDrives || [])) {
    if (!d || isSummaryOnly(d) || !d.date) continue;
    dowDayCount[dowOf(d.date)]++;
  }
  const matrix = Array.from({ length: 7 }, (_, dow) =>
    Array.from({ length: 24 }, (_, h) => {
      const c = hm[dow][h];
      const dc = dowDayCount[dow];
      return { avgSales: dc > 0 ? c.sales / dc : 0, avgCount: dc > 0 ? c.count / dc : 0, dowDays: dc };
    })
  );
  return { matrix, dowDayCount };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/chart-helpers.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add js/chart-helpers.js tests/chart-helpers.test.js
git commit -m "feat(chart): ステージ制お手本の純関数（日別営収・ステージ・平均売上行列）"
```

---

### Task 2: review.html にステージカードを配線

**Files:**
- Modify: `review.html`（import 186 / CSS / HTML / JS）

- [ ] **Step 1: import に追加**

`review.html:186` の chart-helpers import の `heatmapLegendHtml` の後ろに `, salesStages, stageHeatmap` を追加。

- [ ] **Step 2: HOUR_ORDER 定数と状態変数を追加**

`review.html` のJS先頭付近（`let allDrives = [];` 198 の近く）に追加:

```js
const HOUR_ORDER = [7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,0,1,2,3,4,5,6];
let selectedStageKey = null;
```

- [ ] **Step 3: 24時間グリッドCSSを追加**

`review.html` の `<style>` 内（`.heat .cell` 群の近く、19行目付近の後）に追加:

```css
.heatgrid { display: grid; grid-template-columns: 28px repeat(24, minmax(34px, 1fr)); gap: 1px; font-size: 9px; }
.heatgrid .hh { text-align: center; color: var(--muted); font-size: 8px; padding: 2px 0; }
.heatgrid .dlbl { text-align: center; color: var(--muted); font-size: 9px; padding: 4px 0; font-weight: 600; }
.heatgrid .cell { border-radius: 2px; display: flex; align-items: center; justify-content: center; font-size: 10px; color: #fff; cursor: pointer; min-height: 30px; font-weight: 600; }
.heatgrid .cell.empty { background: #eceff1; color: #b0bec5; }
.heatgrid .cell.low-sample { opacity: 0.4; }
.stage-chip { margin: 2px; }
```

- [ ] **Step 4: ステージカードのHTMLを追加**

`review.html` の `heatCard` の `</section>`（141行目 `<section class="card" id="weatherCard">` の直前）に挿入:

```html
  <section class="card" id="stageCard">
    <div class="section-h">
      <strong>目標ステージ別の稼ぎ方</strong>
      <span class="desc">その売上だった日の曜日×時間 平均売上</span>
    </div>
    <div id="stageBody"></div>
    <div class="detail-tip" id="stageTip"></div>
    <p class="muted" style="font-size:10px;margin-top:6px;">1日の税込営収でステージ分け（全期間・自分のデータ）。マスは平均売上、タップで詳細</p>
  </section>
```

- [ ] **Step 5: renderStageBenchmark() を追加**

`renderHeatmap()` 関数の後（668行目 `}` の後）に追加:

```js
function renderStageBenchmark() {
  const body = document.getElementById('stageBody');
  const tip = document.getElementById('stageTip');
  tip.classList.remove('show');
  const stages = salesStages(allDrives);
  if (!stages.length) {
    body.innerHTML = '<p class="muted" style="font-size:12px;">まだデータがありません</p>';
    return;
  }
  let sel = stages.find(s => s.key === selectedStageKey);
  if (!sel) { sel = stages.reduce((a, b) => b.count > a.count ? b : a); selectedStageKey = sel.key; }
  const dateSet = new Set(sel.dates);
  const stageDrives = allDrives.filter(d => dateSet.has(d.date));
  const { matrix, dowDayCount } = stageHeatmap(stageDrives);
  let max = 0;
  for (let dow = 0; dow < 7; dow++) for (const h of HOUR_ORDER) if (matrix[dow][h].avgSales > max) max = matrix[dow][h].avgSales;
  if (max === 0) max = 1;
  const chips = stages.map(s => {
    const active = s.key === selectedStageKey;
    const style = active ? 'background:var(--primary);color:#fff;font-weight:600;' : 'background:#f0f0f0;color:#333;';
    return `<button data-stage="${s.key}" class="stage-chip" style="${style}border:none;padding:5px 9px;border-radius:14px;font-size:11px;cursor:pointer;">${s.label}<span style="opacity:.8;font-size:10px;"> ${s.count}日</span></button>`;
  }).join('');
  let grid = '<div style="overflow-x:auto;"><div class="heatgrid" style="min-width:840px;"><div></div>';
  for (const h of HOUR_ORDER) grid += `<div class="hh">${h}</div>`;
  for (let dow = 0; dow < 7; dow++) {
    const dowColor = dow === 0 ? '#d32f2f' : dow === 6 ? '#1976d2' : '#333';
    grid += `<div class="dlbl" style="color:${dowColor};">${DOW_LABELS[dow]}</div>`;
    const lowDow = dowDayCount[dow] > 0 && dowDayCount[dow] < 3;
    for (const h of HOUR_ORDER) {
      if (dowDayCount[dow] === 0) { grid += `<div class="cell empty" data-dow="${dow}" data-h="${h}">·</div>`; continue; }
      const v = matrix[dow][h].avgSales;
      const ratio = Math.min(1, v / max);
      const bg = v > 0 ? `rgba(76,175,80,${0.12 + 0.78 * ratio})` : '#fafafa';
      const disp = v >= 100 ? Math.round(v / 100) * 100 : (v > 0 ? Math.round(v) : '');
      grid += `<div class="cell${lowDow ? ' low-sample' : ''}" style="background:${bg};color:${ratio > 0.6 ? '#fff' : '#222'};" data-dow="${dow}" data-h="${h}">${disp}</div>`;
    }
  }
  grid += '</div></div>';
  body.innerHTML = `
    <div style="display:flex;flex-wrap:wrap;margin-bottom:8px;">${chips}</div>
    <p class="muted" style="font-size:11px;margin:0 0 6px;">「${sel.label}」の日（${sel.count}日）の曜日×時間 平均売上。濃い＝その時間に稼いでた。薄いグレー＝その曜日の該当日が3日未満</p>
    ${grid}`;
  body.querySelectorAll('.stage-chip').forEach(b => b.onclick = () => { selectedStageKey = b.dataset.stage; renderStageBenchmark(); });
  body.querySelectorAll('.heatgrid .cell').forEach(el => el.onclick = () => {
    const dow = parseInt(el.dataset.dow), h = parseInt(el.dataset.h);
    tip.classList.add('show');
    if (dowDayCount[dow] === 0) { tip.innerHTML = `<strong>${DOW_LABELS[dow]} ${h}時</strong>: この曜日に該当日なし`; return; }
    const c = matrix[dow][h];
    tip.innerHTML = `<strong>${DOW_LABELS[dow]} ${h}時台</strong>（${sel.label}・${DOW_LABELS[dow]}の該当${dowDayCount[dow]}日）<br>平均売上 <strong>${formatYen(c.avgSales)}</strong>・平均${c.avgCount.toFixed(1)}件`;
  });
}
```

- [ ] **Step 6: renderAll に追加**

`renderAll`（257-262）の `renderMemos();` の前に `renderStageBenchmark();` を追加:

```js
  renderRanks();
  renderStageBenchmark();
  renderMemos();
```

- [ ] **Step 7: テスト＆構文確認**

Run: `node --test tests/*.test.js`（回帰なし全pass）
`node -e "require('fs').readFileSync('review.html','utf8')"` で読込OK。変更した`<script type=module>`のテンプレートリテラル/括弧を目視確認。

- [ ] **Step 8: Commit**

```bash
git add review.html
git commit -m "feat(review): 目標ステージ別の稼ぎ方カード（曜日×時間 平均売上ヒートマップ）"
```

---

### Task 3: 確認用プレビュー（dev はデータ空のため）

**Files:**
- Create: `preview-stage.html`

- [ ] **Step 1: プレビューを作成**

`preview-stage.html` を作成。要件:
- `<script type="module">` で `import { salesStages, stageHeatmap, DOW_LABELS } from './js/chart-helpers.js';`（本物のロジック）
- `formatYen` をローカル定義（`v => '¥' + Math.round(v).toLocaleString()`）
- `HOUR_ORDER` をローカル定義（review.htmlと同じ配列）
- `.heatgrid` 系CSS（review.htmlに足したものと同一）を `<style>` に入れる
- **サンプルデータ生成**: 約70日分の drives を生成し、日次営収が複数ステージにまたがるようにする（〜5万を数日、5〜7万を多め、8〜10万を数日、11〜12万+を1〜2日）。各日 `date/departureTime/returnTime/trips[{boardTime,alightTime,amount,isCancel:false}]/rests` を持たせ、時間帯で売上に強弱（夕方〜夜を厚め）をつける。高ステージほど夜が厚い等で違いが出るように。
- `renderStageBenchmark()` を review.html からコピーし、`allDrives` をサンプルに、`document.getElementById` 対象を本ページの要素に合わせる（`stageBody`/`stageTip` を置く）
- 先頭に注意バナー: 「⚠️ レイアウト確認用のサンプルデータ・プレビュー（実データではない）。確認後に削除します。」
- viewport meta を入れモバイル幅で確認可能に

- [ ] **Step 2: 構文・未定義参照チェック**

`preview-stage.html` の `<script type=module>` を一時 .mjs に抜き出して `node --check`（importは外して関数本体の構文確認）。未定義参照（HOUR_ORDER/formatYen/DOW_LABELS/salesStages/stageHeatmap）がページ内で定義/import済みであることを目視確認。確認後、一時ファイルは削除。

- [ ] **Step 3: Commit**

```bash
git add preview-stage.html
git commit -m "docs(preview): ステージ制お手本のサンプルデータ確認ページ（本番前に削除）"
```

---

### Task 4: SWキャッシュbump＋最終確認

**Files:**
- Modify: `sw.js`

- [ ] **Step 1: CACHE_NAME を確認して bump**

`sw.js` の `const CACHE_NAME = CACHE_PREFIX + 'vNNN';` の現行版数を確認し、次の番号へ上げる（例 v182 → v183）。**現行値を必ず読んでから +1 する**（決め打ちしない）。

- [ ] **Step 2: 全テスト**

Run: `node --test tests/*.test.js`
Expected: 全pass。

- [ ] **Step 3: Commit**

```bash
git add sw.js
git commit -m "chore(sw): キャッシュをbump（ステージ制お手本）"
```

---

## Self-Review 結果

**1. Spec coverage**
- ステージ定義（税込営収・5千刻み・〜5万/12万+・該当日のみ） → Task 1 `salesStages` ✅
- ステージ選択UI（チップ＋日数・初期最多） → Task 2 Step 5 ✅
- 曜日×時間 平均売上ヒートマップ（分母=該当日数・百円丸め・色濃淡） → Task 1 `stageHeatmap` + Task 2 ✅
- 低サンプル(dow<3)グレー・タップ詳細（平均売上/日数/平均件数） → Task 2 Step 5 ✅
- 全期間・自分のみ・車種フィルタ共存（allDrives入力・renderAllで再描画） → Task 2 Step 6 ✅
- 既存 hourlyDowEfficiency 無変更・rankDrivesBySales無変更 → Task 1（追加のみ）✅
- 確認手段（dev空対策） → Task 3 preview ✅
- SW bump → Task 4 ✅
- 非ゴール（他乗務員/期間フィルタ/タイムライン/ギャップ） → 触れない ✅

**2. Placeholder scan:** TBD/TODO・曖昧指示なし。全コードステップに実コード。✅

**3. Type consistency:** `dailySalesList(drives)→[{date,sales,count,dow}]`、`salesStages(drives,opts)→[{key,lower,upper,label,dates,count}]`、`stageHeatmap(stageDrives)→{matrix:[7][24]{avgSales,avgCount,dowDays}, dowDayCount:[7]}`、`HOUR_ORDER`/`selectedStageKey`/`formatYen`（app.js import済）/`DOW_LABELS`（chart-helpers import済）が Task 間で一貫。✅

**4. 既知の許容事項:**
- `dailySalesList` は `rankDrivesBySales` と売上定義が重複（2行）。回帰回避のため既存関数は触らず別関数で持つ。
- 平均売上の分母は「その曜日の全該当日数」（走ってない時間帯は平均が下がる＝リアル、論点A採用）。

# 乗り場の状況（到着便・待機車両・流れの材料提示） Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 到着便ページの号別カードを、評価/おすすめを下さず「到着便・待機車両・流れ」を中立に並べる"考える材料"カードに作り直し、新指標「待機車両(占有)」と判断時刻を加える。

**Architecture:** 既存 `buildNoribaActivity`(arrivals-data.js) に pool-status の占有を結合し、流れバー用の通常目盛り位置も算出（純関数・テスト）。`renderNoribaActivity`(arrivals-render.js) を中立材料デザインに全面リスタイル。`arrivals-app.js` で pool-status を読み込み渡す。

**Tech Stack:** Vanilla JS ESM、テストは `node --test tests/*.test.js`（独自ハーネス `tests/run.js`：`import { test, assert } from './run.js'` / `assert.equal`）。DOM描画はユニットテスト不可→render層は node --check ＋ 実機(kimi-webbridge)/node DOMスタブで検証。

## Global Constraints
- テストは `tests/*.test.js`、`import { test, assert } from './run.js'`、`assert.equal(actual, expected)`。
- 号1,2＝T1（左罫線 `#b06a58`）、号3,4＝T2（左罫線 `#5d8ba0`）。カード背景は低彩度共通 `linear-gradient(180deg,rgba(255,255,255,.03),rgba(255,255,255,.006))`＋`inset 0 1px rgba(255,255,255,.04)`。
- **評価・順位・おすすめ・狙い目度・％・通常比の言葉表現は出さない**。通常比は流れバー上の「通常」目盛りで視覚化のみ。裏ロジック(しきい値/手法名)も出さない。
- 絵文字（🚖⭐✈⏱）・発光・強グラデは使わない。意味色は細線・文字・バー先端のみ。号番号を主役(24-26px/800)、補足は暖色寄り灰(`#9b9a94`/`#7f837c`)。
- 上部に「HH:MM 時点」の判断時刻。
- 本番で見切れない：幅100%流動／グラフSVGは `viewBox`＋幅100%／最小320pxで崩れない。
- pool-status 欠落→待機車両のみ非表示／forecast 欠落→流れ・通常目盛り・この先 非表示／arrivals だけでも到着便は出す（安全劣化）。
- 既存全テスト緑維持。SW `CACHE_NAME` bump。列移動の既存セクションは不変。

---

## File Structure
- `tools/js/arrivals-data.js`（拡張）— `occupancySegments` / `occupancyLabel` 追加、`buildNoribaActivity` に poolStatus 引数＋occupancy＋流れの fillPct/normalMarkerPct を追加。
- `tests/noriba-activity.test.js`（修正＋追加）— 既存呼び出しを新シグネチャに更新、新関数テスト追加。
- `tools/js/arrivals-render.js`（差し替え）— `renderNoribaActivity` を中立材料デザインに。`renderMovementCurveSvg` は流用。
- `tools/arrivals.html`（修正）— 旧 `.nrf-*` CSS を新デザインCSSに差し替え。
- `tools/js/arrivals-app.js`（修正）— pool-status 読込＋render呼び出しに poolStatus/判断時刻を渡す。
- `sw.js`（修正）— CACHE_NAME bump。

---

## Task 1: データ層（占有結合＋通常目盛り＋テスト）

**Files:**
- Modify: `tools/js/arrivals-data.js`
- Modify: `tests/noriba-activity.test.js`

**Interfaces:**
- Consumes: 既存 `summarizeByNoriba`、`classifyNormalRatio`、`findActiveUntil`（同モジュール）。
- Produces:
  - `occupancySegments(occ:number, capacity:number): 0..5`
  - `occupancyLabel(segments:number|null): '少なめ'|'並程度'|'多め'|null`
  - `buildNoribaActivity(arrivals, forecast, poolStatus, now): NoribaLane[]` — 各 lane に追加: `occupancy:{segments,label,vehicles}`、`movement.fillPct:0..100`、`movement.normalMarkerPct:0..100|null`。

- [ ] **Step 1: 既存テストを新シグネチャに更新 ＋ 失敗するテストを追加**

`tests/noriba-activity.test.js`:
- 既存の `buildNoribaActivity(arr(), fc(), NOW)` 呼び出し（3箇所: 「号→T1/T2と需要集計」「3号は通常比up…」「動きが弱い号…」テスト内）の引数に poolStatus を追加 → `buildNoribaActivity(arr(), fc(), null, NOW)`。
- 「forecast欠落時…」テストの `buildNoribaActivity(arr(), null, NOW)` → `buildNoribaActivity(arr(), null, null, NOW)`。
- import 行に `occupancySegments, occupancyLabel` を追加。
- ファイル末尾に追記:
```js
test('occupancySegments: 占有→0..5段(容量比)', () => {
  assert.equal(occupancySegments(0, 8), 0);
  assert.equal(occupancySegments(4, 8), 3);   // round(4/8*5)=round(2.5)=3
  assert.equal(occupancySegments(8, 8), 5);
  assert.equal(occupancySegments(20, 8), 5);  // clamp
  assert.equal(occupancySegments(4, 0), 0);   // 容量0は0
});

test('occupancyLabel: 段数→言葉', () => {
  assert.equal(occupancyLabel(1), '少なめ');
  assert.equal(occupancyLabel(3), '並程度');
  assert.equal(occupancyLabel(5), '多め');
  assert.equal(occupancyLabel(null), null);
});

test('buildNoribaActivity: pool-statusから待機車両を結合', () => {
  const ps = { stalls: { stall3: { occ: 4 } } };
  const a = buildNoribaActivity(arr(), fc(), ps, NOW)[2]; // 3号
  assert.equal(a.occupancy.vehicles, 4);
  assert.equal(a.occupancy.segments >= 1, true);
  assert.equal(typeof a.occupancy.label, 'string');
});

test('buildNoribaActivity: pool-status欠落時は待機車両null(安全劣化)', () => {
  const a = buildNoribaActivity(arr(), fc(), null, NOW)[0];
  assert.equal(a.occupancy.vehicles, null);
  assert.equal(a.occupancy.segments, 0);
  assert.equal(a.occupancy.label, null);
});

test('buildNoribaActivity: 流れの通常目盛り位置(基準≈0は非表示)', () => {
  const a = buildNoribaActivity(arr(), fc(), null, NOW)[2]; // 3号 基準あり
  assert.equal(typeof a.movement.fillPct, 'number');
  assert.equal(typeof a.movement.normalMarkerPct, 'number');
  const a1 = buildNoribaActivity(arr(), fc(), null, NOW)[0]; // 1号 fcのstall1基準は1で>0.3
  assert.equal(a1.movement.fillPct >= 0, true);
});
```

- [ ] **Step 2: テストが落ちることを確認**

Run: `cd ~/work/taxi-noriba-status && node --test tests/noriba-activity.test.js`
Expected: FAIL（`occupancySegments is not a function` / 引数不一致での値ズレ）

- [ ] **Step 3: 純関数と結合を実装**

`tools/js/arrivals-data.js` の `buildNoribaActivity` 直前（`// ── 乗り場アクティビティ` ブロック内、`export function buildNoribaActivity` の前）に追加:
```js
// 占有(待機車両数)→0..5段。容量(その号の前列台数 rowWidth)比でスケール。
export function occupancySegments(occ, capacity) {
  if (typeof occ !== 'number' || !(capacity > 0)) return 0;
  return Math.max(0, Math.min(5, Math.round((occ / capacity) * 5)));
}
// 段数→短い量の言葉(評価でなく量の目安)。
export function occupancyLabel(segments) {
  if (segments == null) return null;
  return segments <= 1 ? '少なめ' : (segments <= 3 ? '並程度' : '多め');
}
```

`buildNoribaActivity` のシグネチャと中身を変更。現行:
```js
export function buildNoribaActivity(arrivals, forecast, now = new Date()) {
```
を:
```js
export function buildNoribaActivity(arrivals, forecast, poolStatus, now = new Date()) {
```
に変更。`out` オブジェクトに occupancy を初期化（`demand`/`detailFlights` と並べて）:
```js
      occupancy: { segments: 0, label: null, vehicles: null },
```
`out` 生成直後（`if (!fc) return out;` の前）に占有結合を追加:
```js
    // 待機車両(占有): pool-status の stallN.occ。容量は forecast.rowWidth（無ければ8）。
    const psStall = poolStatus && poolStatus.stalls ? poolStatus.stalls['stall' + lane] : null;
    if (psStall && typeof psStall.occ === 'number') {
      const cap = (forecast && forecast.rowWidth && forecast.rowWidth['stall' + lane]) || 8;
      const seg = occupancySegments(psStall.occ, cap);
      out.occupancy = { segments: seg, label: occupancyLabel(seg), vehicles: psStall.occ };
    }
```
movement を組む箇所（`out.movement = { ... }` の中）に fillPct / normalMarkerPct を追加。`const activeUntil` 抑制の後、`out.movement = {` の直前に算出を追加:
```js
    const fillPct = peak > 0 ? Math.max(0, Math.min(100, Math.round((actualNow / peak) * 100))) : 0;
    const normalMarkerPct = (peak > 0 && baselineNow > 0.3) ? Math.max(0, Math.min(100, Math.round((baselineNow / peak) * 100))) : null;
```
そして `out.movement = {` のオブジェクトに以下2行を追加（`level, normalRatio, ratioDir, activeUntil,` の並びに）:
```js
      fillPct, normalMarkerPct,
```

- [ ] **Step 4: テストが通ることを確認**

Run: `cd ~/work/taxi-noriba-status && node --test tests/noriba-activity.test.js`
Expected: PASS。続けて `node --test tests/*.test.js` で全体緑。

- [ ] **Step 5: コミット**

```bash
cd ~/work/taxi-noriba-status
git add tools/js/arrivals-data.js tests/noriba-activity.test.js
git commit -m "feat(noriba): 待機車両(占有)結合+流れの通常目盛り位置を算出"
```

---

## Task 2: 表示層（中立材料デザインに差し替え）

**Files:**
- Modify: `tools/js/arrivals-render.js`（`renderNoribaActivity` を差し替え）
- Modify: `tools/arrivals.html`（`.nrf-*` CSS を差し替え）

**Interfaces:**
- Consumes: Task 1 の `buildNoribaActivity` 出力（occupancy / movement.fillPct / movement.normalMarkerPct を含む）、既存 `renderMovementCurveSvg`。
- Produces: `renderNoribaActivity(container, activity, opts?:{updatedLabel?:string}): void`（中立材料デザイン）。

- [ ] **Step 1: `renderNoribaActivity` を差し替え**

`tools/js/arrivals-render.js` の現行 `export function renderNoribaActivity(container, activity, opts = {}) { ... }`（`container.querySelectorAll('.nrf-card').forEach...` で終わる関数全体）を以下に置換。`renderMovementCurveSvg` と内部 `_esc` はそのまま使う:
```js
// 号別「乗り場の状況」を中立に提示(評価しない)。container は #noriba-cards-section を流用。
export function renderNoribaActivity(container, activity, opts = {}) {
  if (!container) return;
  if (!Array.isArray(activity) || activity.length === 0) { container.innerHTML = ''; return; }
  const dots = (n) => { let h = ''; for (let i = 0; i < 5; i++) h += `<i class="${i < n ? 'on' : ''}"></i>`; return h; };
  const segs = (n, hot) => { let h = ''; for (let i = 0; i < 5; i++) h += `<i class="${i < n ? (hot ? 'hi' : 'on') : ''}"></i>`; return h; };
  const fwdText = (au) => {
    if (au == null) return '';
    if (au === 'soon') return 'まもなく落ち着き';
    if (au === 'long') return 'しばらく続く見込み';
    return `〜${au} ごろまで`;
  };
  const cards = activity.map((a) => {
    const tcls = a.terminal === 'T1' ? 't1' : 't2';
    const mv = a.movement || {};
    // 流れバー
    const fill = (typeof mv.fillPct === 'number') ? mv.fillPct : 0;
    const lvl = mv.level || '—';
    const flowRow = (mv.level != null)
      ? `<span class="ns-lab">流れ</span><div class="ns-trk"><div class="fill" style="width:${fill}%"></div>${mv.normalMarkerPct != null ? `<div class="norm" style="left:${mv.normalMarkerPct}%"></div><div class="normlab" style="left:${mv.normalMarkerPct}%">通常</div>` : ''}</div><span class="ns-val">${_esc(lvl)}</span>`
      : '';
    // 待機車両
    const occRow = (a.occupancy && a.occupancy.label != null)
      ? `<span class="ns-lab">待機車両</span><div class="ns-segs">${segs(a.occupancy.segments, a.occupancy.segments >= 4)}</div><span class="ns-val">${_esc(a.occupancy.label)}</span>`
      : '';
    const fwd = (mv.level != null && a.movement.curve)
      ? `<div class="ns-fwd">この先 <span class="ns-spark" data-spark="${(mv.sparkFuture || []).join(',')}" data-color="#8a8f88"></span> ${_esc(fwdText(mv.activeUntil))}<span class="ns-more">詳細 ›</span></div>`
      : `<div class="ns-fwd"><span class="ns-more" style="margin-left:auto">詳細 ›</span></div>`;
    // 詳細
    const flList = (a.detailFlights || []).slice(0, 6).map((f) => {
      const pax = (typeof f.taxiPax === 'number') ? `・約${f.taxiPax}人` : '';
      const seat = (typeof f.seatCount === 'number') ? `定員${f.seatCount}` : '';
      return `<div class="ns-fl"><span class="o">${_esc(f.time)} ${_esc(f.fromName)}</span><span class="m">${seat}${pax}</span></div>`;
    }).join('') || `<div class="ns-fl"><span class="m">60分内の到着便はありません</span></div>`;
    const last = a.demand && a.demand.lastFlight ? `<div class="ns-fl" style="border:0"><span class="o">最終便</span><span class="m">${_esc(a.demand.lastFlight.time)} ${_esc(a.demand.lastFlight.fromName)}</span></div>` : '';
    const curveSvg = renderMovementCurveSvg(a.movement && a.movement.curve);
    const nextF = a.demand && a.demand.nextFlight ? `次 ${_esc(a.demand.nextFlight.time)} ${_esc(a.demand.nextFlight.fromName)}` : '';
    return `<div class="ns-card ${tcls}" data-noriba="${a.lane}">
      <div class="ns-top"><span class="no">${a.lane}</span><span class="term">${_esc(a.terminal)}</span><span class="last">${nextF}</span></div>
      <div class="ns-met">
        <span class="ns-lab">到着便</span><div class="ns-planes">${dots(a.demand.planeIcons)}</div><span class="ns-val">60分内 ${a.demand.flights60}便</span>
        ${occRow}
        ${flowRow}
      </div>
      ${fwd}
      <div class="ns-detail" hidden>
        <h5>到着便（60分内）</h5>${flList}
        ${curveSvg ? `<div class="ns-curve"><div class="ns-clab">流れの推移 ── 今日(実測/予測) ┈通常</div>${curveSvg}</div>` : ''}
        ${last}
      </div>
    </div>`;
  }).join('');
  const head = `<div class="ns-hd"><span class="ttl">乗り場の状況</span></div><div class="ns-asof"><b>${_esc(opts.updatedLabel || '')}</b> 時点</div>`;
  container.innerHTML = `<div class="ns-wrap">${head}${cards}</div>`;
  container.querySelectorAll('[data-spark]').forEach((el) => {
    const v = el.getAttribute('data-spark').split(',').map(Number).filter((x) => !Number.isNaN(x));
    if (v.length < 2) return;
    const w = 46, h = 12, mx = Math.max(...v, 1);
    const pts = v.map((a, i) => `${(i / (v.length - 1) * w).toFixed(1)},${(h - a / mx * (h - 2) - 1).toFixed(1)}`).join(' ');
    el.innerHTML = `<svg width="${w}" height="${h}" style="vertical-align:middle"><polyline points="${pts}" fill="none" stroke="${el.getAttribute('data-color')}" stroke-width="1.3"/></svg>`;
  });
  container.querySelectorAll('.ns-card').forEach((card) => {
    card.addEventListener('click', () => {
      const d = card.querySelector('.ns-detail');
      if (d) { d.hidden = !d.hidden; card.classList.toggle('open', !d.hidden); }
    });
  });
}
```

- [ ] **Step 2: `arrivals.html` の CSS を差し替え**

`tools/arrivals.html` の `<style>` 内、`/* 乗り場アクティビティ（号別の今） */` から `.nrf-axis .now { ... }` までの旧 `.nrf-*` ブロック全体を、次に置換:
```css
    /* 乗り場の状況（材料提示） */
    .ns-wrap { font-family: inherit; }
    .ns-hd { display: flex; justify-content: space-between; margin: 4px 12px 0; }
    .ns-hd .ttl { font-size: 13px; font-weight: 600; color: #cfccc4; }
    .ns-asof { font-size: 11px; color: #9b9a94; margin: 0 12px 11px; }
    .ns-asof b { color: #cfccc4; font-weight: 700; font-variant-numeric: tabular-nums; }
    .ns-card { position: relative; background: linear-gradient(180deg,rgba(255,255,255,.03),rgba(255,255,255,.006)); border: 1px solid #1c1e23; border-radius: 11px; margin: 0 12px 9px; padding: 10px 12px 11px; box-shadow: inset 0 1px rgba(255,255,255,.04); }
    .ns-card.t1 { border-left: 3px solid #b06a58; } .ns-card.t2 { border-left: 3px solid #5d8ba0; }
    .ns-top { display: flex; align-items: baseline; gap: 7px; margin-bottom: 9px; }
    .ns-top .no { font-size: 24px; font-weight: 800; line-height: 1; letter-spacing: -.01em; }
    .ns-top .term { font-size: 9.5px; font-weight: 600; margin-top: 2px; }
    .ns-card.t1 .term { color: #c08576; } .ns-card.t2 .term { color: #7fa6b8; }
    .ns-top .last { margin-left: auto; font-size: 10.5px; color: #7f837c; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .ns-met { display: grid; grid-template-columns: 56px 1fr auto; gap: 7px 9px; align-items: center; }
    .ns-met .ns-lab { font-size: 10.5px; color: #8a8f88; }
    .ns-met .ns-val { font-size: 11px; color: #cfccc4; white-space: nowrap; font-variant-numeric: tabular-nums; }
    .ns-planes { display: flex; gap: 3px; align-items: center; }
    .ns-planes i { width: 7px; height: 7px; border-radius: 50%; background: #3a4a52; }
    .ns-planes i.on { background: #7fa6b8; }
    .ns-segs { display: flex; gap: 3px; }
    .ns-segs i { width: 14px; height: 8px; border-radius: 1.5px; background: #22242a; }
    .ns-segs i.on { background: #8a8f88; } .ns-segs i.hi { background: #b07a5e; }
    .ns-trk { position: relative; height: 8px; border-radius: 2px; background: #1c1e23; }
    .ns-trk .fill { position: absolute; left: 0; top: 0; height: 100%; border-radius: 2px; background: #6f736f; }
    .ns-trk .norm { position: absolute; top: -2px; width: 2px; height: 12px; background: #cfccc4; opacity: .65; }
    .ns-trk .normlab { position: absolute; top: -13px; font-size: 8px; color: #8a8f88; transform: translateX(-50%); white-space: nowrap; }
    .ns-fwd { margin-top: 9px; display: flex; align-items: center; gap: 7px; font-size: 10.5px; color: #7f837c; }
    .ns-fwd .ns-more { margin-left: auto; color: #9b9a94; }
    .ns-detail { margin-top: 9px; border-top: 1px dashed rgba(255,255,255,.12); padding-top: 8px; }
    .ns-detail h5 { margin: 0 0 4px; font-size: 10.5px; color: #9b9a94; font-weight: 600; }
    .ns-fl { display: flex; justify-content: space-between; gap: 8px; font-size: 11px; padding: 2px 0; border-bottom: 1px solid rgba(255,255,255,.05); }
    .ns-fl .o { color: #e7e4dc; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .ns-fl .m { color: #9b9a94; text-align: right; white-space: nowrap; }
    .ns-curve { background: rgba(0,0,0,.25); border-radius: 6px; padding: 6px 7px; margin-top: 6px; }
    .ns-curve svg { width: 100%; height: auto; display: block; }
    .ns-clab { font-size: 9.5px; color: #7f837c; }
```

- [ ] **Step 3: 構文チェック ＋ node DOMスタブで描画検証**

Run:
```bash
cd ~/work/taxi-noriba-status
node --check tools/js/arrivals-render.js && echo RENDER_OK
node --input-type=module -e '
import { buildNoribaActivity } from "./tools/js/arrivals-data.js";
import { renderNoribaActivity } from "./tools/js/arrivals-render.js";
const slots=[];for(let i=0;i<96;i++){const v3=(i>=84&&i<=94)?(i<=90?5:2):0.2;slots.push({time:String(Math.floor(i/4)).padStart(2,"0")+":"+String((i%4)*15).padStart(2,"0"),stalls:{stall1:1,stall2:0.5,stall3:v3,stall4:1}});}
const fc={slots,actualsToday:[{time:"22:00",stalls:{stall1:1,stall2:0.5,stall3:9,stall4:1}}],current:{time:"22:00",stalls:{stall1:1,stall2:0.5,stall3:9,stall4:1}},rowWidth:{stall1:8,stall2:7,stall3:8,stall4:8}};
const arr={updatedAt:"2026-06-19T22:00:00+09:00",flights:[{poolLane:3,status:"到着予定",estimatedTime:"22:20",fromName:"那覇",seatCount:335,estimatedTaxiPax:160}]};
const ps={stalls:{stall1:{occ:4},stall2:{occ:6},stall3:{occ:2},stall4:{occ:4}}};
const act=buildNoribaActivity(arr,fc,ps,new Date("2026-06-19T22:00:00+09:00"));
let html="";const stub={set innerHTML(v){html=v},get innerHTML(){return html},querySelectorAll(){return[]}};
renderNoribaActivity(stub,act,{updatedLabel:"22:00"});
const has=(re)=>re.test(html);
console.log("時点表示:",has(/時点/));
console.log("到着便ドット:",has(/ns-planes/));
console.log("待機車両セグメント:",has(/ns-segs/));
console.log("流れトラック+通常目盛り:",has(/ns-trk/)&&has(/通常/));
console.log("評価語なし(狙い目/おすすめ):",!has(/狙い目|おすすめ/));
console.log("絵文字なし:",!/[🚖⭐✈⏱]/u.test(html));
console.log("カード4枚:",(html.match(/ns-card/g)||[]).length>=4);
'
```
Expected: `RENDER_OK`、全行 true。

- [ ] **Step 4: コミット**

```bash
cd ~/work/taxi-noriba-status
git add tools/js/arrivals-render.js tools/arrivals.html
git commit -m "feat(noriba): 乗り場の状況を中立材料デザインに差し替え(到着便/待機車両/流れ+通常目盛り)"
```

---

## Task 3: 配線（pool-status読込）・SW・実機スモーク

**Files:**
- Modify: `tools/js/arrivals-app.js`
- Modify: `sw.js`

**Interfaces:**
- Consumes: `buildNoribaActivity`(Task 1), `renderNoribaActivity`(Task 2), 既存 `loadPoolStatus`(`pool-status-section.js`)。

- [ ] **Step 1: import に loadPoolStatus 追加**

`tools/js/arrivals-app.js` の `import { initForecastSection, loadAdvanceForecast } from './forecast-section.js';` の次の行（`import { initPoolStatusSection, initForecastSectionToggle } from './pool-status-section.js';`）に `loadPoolStatus` を追加。完全形:
```js
import { initPoolStatusSection, initForecastSectionToggle, loadPoolStatus } from './pool-status-section.js';
```

- [ ] **Step 2: 初期化で pool-status を読む**

`tools/js/arrivals-app.js` の `state.forecast = (await loadAdvanceForecast()).data;` の直後に追加:
```js
    state.poolStatus = (await loadPoolStatus()).data;
```

- [ ] **Step 3: render() の呼び出しに poolStatus と判断時刻を渡す**

`tools/js/arrivals-app.js` の `renderNoribaActivity(...)` 呼び出し（現行 `buildNoribaActivity(state.arrivals, state.forecast ?? null, new Date())` を含む）を置換:
```js
  renderNoribaActivity(
    document.getElementById('noriba-cards-section'),
    buildNoribaActivity(state.arrivals, state.forecast ?? null, state.poolStatus ?? null, new Date()),
    { updatedLabel: (state.arrivals && state.arrivals.updatedAt) ? new Date(state.arrivals.updatedAt).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }) : '' }
  );
```

- [ ] **Step 4: SW bump**

```bash
cd ~/work/taxi-noriba-status && grep -n "CACHE_NAME = CACHE_PREFIX" sw.js
```
現行値（例 `v294`）を +1（`v295`）に置換。

- [ ] **Step 5: 構文 ＋ 全テスト**

Run:
```bash
cd ~/work/taxi-noriba-status
node --check tools/js/arrivals-app.js && echo APP_OK
node --test tests/*.test.js > /tmp/ns-test.txt 2>&1; grep -E "^# (tests|pass|fail)" /tmp/ns-test.txt
```
Expected: `APP_OK`、`# fail 0`。

- [ ] **Step 6: コミット**

```bash
cd ~/work/taxi-noriba-status
git add tools/js/arrivals-app.js sw.js
git commit -m "feat(noriba): pool-status読込を配線+判断時刻を渡す+sw bump"
```

- [ ] **Step 7: dev 反映 ＋ 実機/実データ検証**

`!~/work/taxi-dev/dpush.sh ~/work/taxi-noriba-status` をユーザーが実行 → dev デプロイ後、**本番ライブデータ**で実コードを node DOMスタブに通し例外なし・到着便/待機車両/流れ/通常目盛り/時点が出ること、評価語/絵文字が無いことを確認（kimi-webbridge はゲートで実ページ不可なため node 検証を主とする）。
Expected: 例外なし、4カード、待機車両は pool-status.occ 由来の段数、流れに通常目盛り、号1・2薄赤/号3・4薄青、320px見切れなし。

---

## 完了条件
- 到着便ページの号別カードが「乗り場の状況（到着便・待機車両・流れ）」の中立材料カードに刷新され dev で動作。評価/おすすめ/狙い目度/％は無し、判断時刻あり。
- 待機車両は pool-status.occ から、流れは通常目盛り付き。pool-status/forecast 欠落時は該当のみ非表示で安全劣化。
- 純関数は全テスト緑、本番で見切れない。
- 本番出荷は別途（tagpush vX.Y.Z → deploy.yml rsync。relay競合なら `gh run rerun`）。
```

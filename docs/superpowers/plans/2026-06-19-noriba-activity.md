# 乗り場アクティビティ（号別の今） Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 到着便ページの号別カードを、需要(✈)・動き(バー＋通常比)・いつまで活発か(⏱＋折れ線)を一目で見せ、タップで詳細(来る便＋推移グラフ)が開くメーター型カードに刷新する。

**Architecture:** ロジックは `arrivals-data.js` の純関数 `buildNoribaActivity`（既存 `summarizeByNoriba` の需要 ＋ `advance-forecast.json` の slots/actualsToday から動き・通常比・活発until・推移カーブを算出）に集約しテストする。表示は `arrivals-render.js` の `renderNoribaActivity`(DOM, visual検証) が dumb に描く。`arrivals-app.js` で forecast を読み、既存 `renderNoribaCards` 呼び出しを置換。

**Tech Stack:** Vanilla JS ESM、テストは `node --test tests/*.test.js`（独自ハーネス `tests/run.js`：`import { test, assert } from './run.js'` / `assert.equal`）。DOMは描画ユニットテスト不可→render層はnode --check＋実機(kimi-webbridge)で検証。

## Global Constraints
- テストは `tests/*.test.js`、`import { test, assert } from './run.js'`、`assert.equal(actual, expected)`。
- 号1,2＝T1（薄い赤：背景 `#241416` / border `#5a2a2a`）、号3,4＝T2（薄い青：背景 `#10202a` / border `#2a4a5a`）。
- 裏ロジック（しきい値・手法名・係数）はユーザー表示に出さない。表示は「通常より多い/並み/静か」「活発〜◯時」等。
- 本番で見切れない：幅100%流動／グラフSVGは `viewBox`＋幅100%でスケール／時刻ラベル両端内寄せ／動き行 `flex-wrap`／長い地名は省略／横スクロール無し／最小320pxで崩れない。
- forecast 欠落/古い時は動き・通常比・活発until を非表示にし需要だけ表示（安全劣化）。
- 既存全テスト緑維持。SW `CACHE_NAME` を bump。列移動の既存セクションは残す（号別カードのみ置換）。

---

## File Structure
- `tools/js/arrivals-data.js`（拡張）— `buildNoribaActivity` / `classifyNormalRatio` / `findActiveUntil` と内部ヘルパー。需要は既存 `summarizeByNoriba` を再利用。
- `tests/noriba-activity.test.js`（新規）— 上記純関数のユニットテスト。
- `tools/js/arrivals-render.js`（拡張）— `renderNoribaActivity` / `renderMovementCurveSvg`（DOM）。
- `tools/js/arrivals-app.js`（修正）— forecast 読込 ＋ `renderNoribaCards` 呼び出しを `renderNoribaActivity` に置換。
- `tools/arrivals.html`（修正）— カード用 CSS 追加。
- `sw.js`（修正）— CACHE_NAME bump。

---

## Task 1: アクティビティ算出（純関数 ＋ テスト）

**Files:**
- Modify: `tools/js/arrivals-data.js`（末尾に追記。`summarizeByNoriba` は既存・同ファイル）
- Test: `tests/noriba-activity.test.js`

**Interfaces:**
- Consumes: 既存 `summarizeByNoriba(arrivals, nowDate, windowMin)`（同モジュール）。
- Produces:
  - `classifyNormalRatio(actual: number, baseline: number): { ratio: number|null, dir: 'up'|'eq'|'down'|null }`
  - `findActiveUntil(forward: {min:number,val:number}[], peak: number): string|null`（`'HH:MM'` / `'soon'` / `'long'` / `null`）
  - `buildNoribaActivity(arrivals, forecast, now: Date): NoribaLane[]` — 各 `{ lane, terminal:'T1'|'T2', demand:{flights60,pax60,planeIcons,morePlanes,nextFlight,lastFlight}, detailFlights, movement:{level:'強'|'中'|'弱'|null, normalRatio:number|null, ratioDir, activeUntil:string|null, sparkFuture:number[], curve:object|null} }`

- [ ] **Step 1: 失敗するテストを書く**

`tests/noriba-activity.test.js`:
```js
import { test, assert } from './run.js';
import { classifyNormalRatio, findActiveUntil, buildNoribaActivity } from '../tools/js/arrivals-data.js';

test('classifyNormalRatio: 多い/並み/静か/基準ゼロ/欠損', () => {
  assert.equal(classifyNormalRatio(5, 2.5).dir, 'up');
  assert.equal(classifyNormalRatio(2, 2).dir, 'eq');
  assert.equal(classifyNormalRatio(1, 3).dir, 'down');
  assert.equal(classifyNormalRatio(5, 0.1).dir, null);   // 基準≈0は非表示
  assert.equal(classifyNormalRatio(null, 2).dir, null);
});

test('findActiveUntil: ピーク半分を下回る時刻 / soon / long', () => {
  const peak = 4;
  // 22:00から: 4,4,4,1(<2) → 22:45で下回る
  const fwd = [{min:1320,val:4},{min:1335,val:4},{min:1350,val:4},{min:1365,val:1}];
  assert.equal(findActiveUntil(fwd, peak), '22:45');
  // 今が既に閾値未満 → soon
  assert.equal(findActiveUntil([{min:1320,val:1},{min:1335,val:1}], peak), 'soon');
  // ずっと高い → long
  assert.equal(findActiveUntil([{min:1320,val:4},{min:1335,val:4}], peak), 'long');
  assert.equal(findActiveUntil([], peak), null);
});

function fc() {
  // slots 96個(00:00..23:45)。stall3 を 22:00(bin88) ピーク5、23:30以降減衰。他は低め。
  const slots = [];
  for (let i = 0; i < 96; i++) {
    const v3 = (i >= 84 && i <= 94) ? (i <= 90 ? 5 : 2) : 0.2; // 21:00..23:30 高、以降低
    slots.push({ time: `${String(Math.floor(i/4)).padStart(2,'0')}:${String((i%4)*15).padStart(2,'0')}`, stalls: { stall1: 1, stall2: 0.5, stall3: v3, stall4: 1 } });
  }
  return { slots, actualsToday: [{ time: '22:00', stalls: { stall1:1, stall2:0.5, stall3:9, stall4:1 } }], current: { time:'22:00', stalls: { stall1:1, stall2:0.5, stall3:9, stall4:1 } } };
}
function arr() {
  return { flights: [
    { poolLane:1, status:'到着予定', scheduledTime:'22:30', estimatedTime:'22:30', fromName:'福岡', seatCount:335, estimatedTaxiPax:90 },
    { poolLane:3, status:'到着予定', scheduledTime:'22:20', estimatedTime:'22:20', fromName:'那覇', seatCount:335, estimatedTaxiPax:160 },
    { poolLane:3, status:'欠航',     scheduledTime:'22:40', estimatedTime:'22:40', fromName:'新千歳', seatCount:165 },
  ] };
}
const NOW = new Date('2026-06-19T22:00:00+09:00');

test('buildNoribaActivity: 号→T1/T2 と 需要集計', () => {
  const a = buildNoribaActivity(arr(), fc(), NOW);
  assert.equal(a.length, 4);
  assert.equal(a[0].lane, 1); assert.equal(a[0].terminal, 'T1');
  assert.equal(a[2].lane, 3); assert.equal(a[2].terminal, 'T2');
  assert.equal(a[0].demand.flights60, 1);          // 1号 次60分1便
  assert.equal(a[2].demand.flights60, 1);          // 3号 欠航除外で1便
  assert.equal(a[2].demand.pax60, 160);
});

test('buildNoribaActivity: 3号は通常比up＋活発untilが時刻', () => {
  const a = buildNoribaActivity(arr(), fc(), NOW)[2];
  assert.equal(a.movement.ratioDir, 'up');          // 実測9 / 基準5
  assert.ok(typeof a.movement.activeUntil === 'string');
  assert.equal(a.movement.level, '強');
});

test('buildNoribaActivity: forecast欠落時は動き非表示で安全劣化', () => {
  const a = buildNoribaActivity(arr(), null, NOW)[0];
  assert.equal(a.movement.level, null);
  assert.equal(a.movement.normalRatio, null);
  assert.equal(a.demand.flights60, 1);              // 需要は出る
});
```

- [ ] **Step 2: テストが落ちることを確認**

Run: `cd ~/work/taxi-noriba-map && node --test tests/noriba-activity.test.js`
Expected: FAIL（`classifyNormalRatio is not a function` 等のimportエラー）

- [ ] **Step 3: 純関数を実装**

`tools/js/arrivals-data.js` の末尾に追記:
```js
// ── 乗り場アクティビティ（号別の今） ──────────────────────────────
function minutesToHHMM(min) {
  const h = Math.floor(min / 60) % 24, m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// 通常比: 今日の実測 ÷ この時間帯の通常。基準が小さすぎる(≈0)時は非表示。
export function classifyNormalRatio(actual, baseline) {
  if (actual == null || !(baseline > 0.3)) return { ratio: null, dir: null };
  const ratio = actual / baseline;
  const dir = ratio > 1.25 ? 'up' : (ratio < 0.75 ? 'down' : 'eq');
  return { ratio, dir };
}

// 活発はいつまで: 予測がピークの50%を下回る最初の時刻。直近で下回れば 'soon'、窓内ずっと高ければ 'long'。
export function findActiveUntil(forward, peak) {
  if (!Array.isArray(forward) || forward.length === 0 || !(peak > 0)) return null;
  const thr = peak * 0.5;
  if (forward[0].val < thr) return 'soon';
  for (let i = 1; i < forward.length; i++) {
    if (forward[i].val < thr) return i === 1 ? 'soon' : minutesToHHMM(forward[i].min);
  }
  return 'long';
}

// 号別アクティビティ: 需要(summarizeByNoriba) ＋ 動き(advance-forecast slots/actualsToday)。
export function buildNoribaActivity(arrivals, forecast, now = new Date()) {
  const demand = summarizeByNoriba(arrivals, now, 60).lanes; // [lane1..4]
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const nowBin = Math.floor(nowMin / 15);
  const fc = (forecast && Array.isArray(forecast.slots) && forecast.slots.length >= 96) ? forecast : null;
  return demand.map((d) => {
    const lane = d.lane;
    const out = {
      lane,
      terminal: lane <= 2 ? 'T1' : 'T2',
      demand: {
        flights60: d.count,
        pax60: d.taxiPax,
        planeIcons: Math.min(d.count, 5),
        morePlanes: d.count > 5,
        nextFlight: d.flights[0] || null,
        lastFlight: d.lastFlight || null,
      },
      detailFlights: d.flights,
      movement: { level: null, normalRatio: null, ratioDir: null, activeUntil: null, sparkFuture: [], curve: null },
    };
    if (!fc) return out;
    const key = 'stall' + lane;
    const dayVals = fc.slots.map((s) => (s.stalls && typeof s.stalls[key] === 'number') ? s.stalls[key] : 0);
    const peak = Math.max(...dayVals, 0);
    const bn = Math.min(nowBin, dayVals.length - 1);
    const baselineNow = dayVals[bn] || 0;
    const actualNow = (fc.current && fc.current.stalls && typeof fc.current.stalls[key] === 'number')
      ? fc.current.stalls[key] : baselineNow;
    const { ratio, dir } = classifyNormalRatio(actualNow, baselineNow);
    let level = null;
    if (peak > 0) { const r = actualNow / peak; level = r >= 0.66 ? '強' : (r >= 0.33 ? '中' : '弱'); }
    const forward = [];
    for (let i = bn; i < dayVals.length; i++) forward.push({ min: i * 15, val: dayVals[i] });
    const activeUntil = findActiveUntil(forward, peak);
    // 詳細用カーブ: 過去2h〜先2h
    const cStart = Math.max(0, bn - 8), cEnd = Math.min(dayVals.length - 1, bn + 8);
    const todayMap = {};
    if (Array.isArray(fc.actualsToday)) for (const a of fc.actualsToday) {
      if (a.stalls && typeof a.stalls[key] === 'number') todayMap[a.time] = a.stalls[key];
    }
    const normal = [], today = [], forecastArr = [];
    for (let i = cStart; i <= cEnd; i++) {
      normal.push(dayVals[i]);
      const hhmm = minutesToHHMM(i * 15);
      if (i <= bn) { today.push(todayMap[hhmm] ?? null); forecastArr.push(null); }
      else { today.push(null); forecastArr.push(dayVals[i]); }
    }
    out.movement = {
      level, normalRatio: ratio, ratioDir: dir, activeUntil,
      sparkFuture: dayVals.slice(bn, bn + 6),
      curve: {
        start: minutesToHHMM(cStart * 15), now: minutesToHHMM(bn * 15), end: minutesToHHMM(cEnd * 15),
        active: (typeof activeUntil === 'string' && /^\d/.test(activeUntil)) ? activeUntil : null,
        normal, today, forecast: forecastArr, nowIndex: bn - cStart,
      },
    };
    return out;
  });
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `cd ~/work/taxi-noriba-map && node --test tests/noriba-activity.test.js`
Expected: PASS（6 tests）。続けて `node --test tests/*.test.js` で全体緑も確認。

- [ ] **Step 5: コミット**

```bash
cd ~/work/taxi-noriba-map
git add tools/js/arrivals-data.js tests/noriba-activity.test.js
git commit -m "feat(noriba): 号別アクティビティ算出(通常比/活発until/需要)純関数+テスト"
```

---

## Task 2: メーターカード描画（renderNoribaActivity）

**Files:**
- Modify: `tools/js/arrivals-render.js`（末尾に追記）
- Modify: `tools/arrivals.html`（`<style>` 内にカードCSS追加）

**Interfaces:**
- Consumes: `buildNoribaActivity` の出力 `NoribaLane[]`（Task 1）。
- Produces: `renderNoribaActivity(container: HTMLElement, activity: NoribaLane[], opts?: {poolLabel?:string, updatedLabel?:string}): void`、`renderMovementCurveSvg(curve): string`（SVG文字列）。

- [ ] **Step 1: SVGカーブとカード描画を実装**

`tools/js/arrivals-render.js` の末尾に追記:
```js
// 動きの推移カーブを SVG文字列で返す(viewBoxで幅100%スケール)。curve={normal,today,forecast,nowIndex,start,now,end,active}。
export function renderMovementCurveSvg(curve) {
  if (!curve || !Array.isArray(curve.normal) || curve.normal.length < 2) return '';
  const W = 304, H = 56, N = curve.normal.length;
  const all = curve.normal.concat(curve.today.filter(v => v != null), curve.forecast.filter(v => v != null));
  const mx = Math.max(1, ...all);
  const X = (i) => (i / (N - 1) * W).toFixed(1);
  const Y = (v) => (H - (v / mx) * (H - 8) - 4).toFixed(1);
  const poly = (arr, color, dash) => {
    const pts = arr.map((v, i) => (v == null ? null : `${X(i)},${Y(v)}`)).filter(Boolean).join(' ');
    if (!pts) return '';
    return `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="${dash ? 1.3 : 2}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`;
  };
  const nx = X(curve.nowIndex);
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="width:100%;height:56px;display:block">`
    + poly(curve.normal, '#7f8aa0', '4 3')
    + poly(curve.today, '#ff9a9a', null)
    + poly(curve.forecast, '#ff9a9a', '3 3')
    + `<line x1="${nx}" y1="2" x2="${nx}" y2="${H - 2}" stroke="#fff" stroke-width="1" stroke-dasharray="2 2"/></svg>`;
}

const _NORIBA_TERM_CLASS = { T1: 'nt-t1', T2: 'nt-t2' };
function _ratioBadge(dir, ratio) {
  if (!dir) return '';
  const txt = dir === 'up' ? '通常より多い' : (dir === 'down' ? '通常より静か' : '通常並み');
  const arrow = dir === 'up' ? '↑' : (dir === 'down' ? '↓' : '≈');
  return `<span class="nrbadge nr-${dir}">${txt}${arrow}</span>`;
}
function _untilText(activeUntil) {
  if (activeUntil == null) return '';
  if (activeUntil === 'soon') return '⏱ まもなく落ち着く';
  if (activeUntil === 'long') return '⏱ 当面 活発';
  return `⏱ 活発 〜${activeUntil}`;
}
function _esc(s) { return String(s == null ? '' : s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }

// 号別メーターカードを描画。container は #noriba-cards-section を流用。
export function renderNoribaActivity(container, activity, opts = {}) {
  if (!container) return;
  if (!Array.isArray(activity) || activity.length === 0) { container.innerHTML = ''; return; }
  const head = `<div class="nrf-head"><span>🚖 乗り場の今（号別）</span><span class="nrf-upd">${_esc(opts.updatedLabel || '')}</span></div>`
    + (opts.poolLabel ? `<div class="nrf-pool">🅿 プール在台 ${_esc(opts.poolLabel)}</div>` : '');
  const cards = activity.map((a) => {
    const tcls = _NORIBA_TERM_CLASS[a.terminal] || '';
    const planes = '✈'.repeat(Math.max(0, a.demand.planeIcons)) + (a.demand.morePlanes ? '＋' : '') || '—';
    const mvLevel = a.movement.level ? `動き ${a.movement.level}` : '動き —';
    const barW = a.movement.level === '強' ? 92 : (a.movement.level === '中' ? 55 : (a.movement.level === '弱' ? 22 : 0));
    const barColor = a.movement.level === '強' ? 'linear-gradient(90deg,#f4d35e,#ff5252)' : 'linear-gradient(90deg,#caa83a,#f4d35e)';
    const until = _untilText(a.movement.activeUntil);
    // 詳細
    const flList = (a.detailFlights || []).slice(0, 6).map((f) => {
      const pax = (typeof f.taxiPax === 'number') ? `・約${f.taxiPax}人` : '';
      const seat = (typeof f.seatCount === 'number') ? `定員${f.seatCount}` : '';
      return `<div class="nrf-fl"><span class="o">${_esc(f.time)} ${_esc(f.fromName)}</span><span class="m">${seat}${pax}</span></div>`;
    }).join('') || `<div class="nrf-fl"><span class="m">次60分の便はありません</span></div>`;
    const last = a.demand.lastFlight ? `<div class="nrf-fl" style="border:0"><span class="o">🏁 最終便</span><span class="m">${_esc(a.demand.lastFlight.time)} ${_esc(a.demand.lastFlight.fromName)}</span></div>` : '';
    const curveSvg = renderMovementCurveSvg(a.movement.curve);
    const axis = a.movement.curve ? `<div class="nrf-axis"><span style="left:0;transform:none">${_esc(a.movement.curve.start)}</span><span class="now" style="left:${(a.movement.curve.nowIndex/(a.movement.curve.normal.length-1)*100).toFixed(1)}%">│今${_esc(a.movement.curve.now)}</span><span style="left:100%;transform:translateX(-100%)">${_esc(a.movement.curve.end)}</span></div>` : '';
    const ratioTxt = (a.movement.ratioDir === 'up') ? `いま通常より活発。` : (a.movement.ratioDir === 'down' ? `いま通常より静か。` : (a.movement.ratioDir ? `いま通常並み。` : ''));
    const detail = `<div class="nrf-detail" hidden>
      <h5>来る便（次60分）</h5>${flList}
      ${curveSvg ? `<div class="nrf-curve"><div class="nrf-clab">動きの推移 ── 今日(赤実=実測/赤破=予測) ┈通常(灰)</div>${curveSvg}${axis}<div class="nrf-clab">${ratioTxt}${until ? until.replace('⏱ ', 'この活発さは ') + '頃まで' : ''}</div></div>` : ''}
      ${last}
    </div>`;
    return `<div class="nrf-card ${tcls}" data-noriba="${a.lane}">
      <div class="nrf-main">
        <div class="nrf-no">${a.lane}<span>号·${_esc(a.terminal)}</span></div>
        <div class="nrf-body">
          <div class="nrf-demand">${planes} <span class="cap">次60分 ${a.demand.flights60}便</span></div>
          <div class="nrf-move"><span class="bar"><i style="width:${barW}%;background:${barColor}"></i></span><span class="mvlab">${mvLevel}</span>${_ratioBadge(a.movement.ratioDir, a.movement.normalRatio)}</div>
          <div class="nrf-until">${until}</div>
        </div>
        <span class="nrf-chev">›</span>
      </div>
      ${detail}
    </div>`;
  }).join('');
  container.innerHTML = `<div class="nrf-wrap">${head}${cards}</div>`;
  // タップで詳細トグル
  container.querySelectorAll('.nrf-card').forEach((card) => {
    card.querySelector('.nrf-main').addEventListener('click', () => {
      const d = card.querySelector('.nrf-detail');
      if (d) { d.hidden = !d.hidden; card.classList.toggle('open', !d.hidden); }
    });
  });
}
```
（注: 活発終了の縦ラベル位置は curve.active を使わず簡略化。axis の active span は空でよい。実装時は active 表示が不要なら削ってよい。）

- [ ] **Step 2: arrivals.html にカードCSSを追加**

`tools/arrivals.html` の `<style>` 内、`.pool-notice` 定義の near に追記:
```css
    .nrf-wrap{font-family:inherit;}
    .nrf-head{display:flex;justify-content:space-between;font-size:12px;color:var(--sub);font-weight:600;margin:6px 12px 8px;}
    .nrf-pool{display:flex;align-items:center;gap:6px;background:#15151c;border:1px solid #2a2a35;border-radius:8px;padding:5px 9px;font-size:11px;color:var(--sub);margin:0 12px 9px;}
    .nrf-card{margin:0 12px 7px;border-radius:10px;border:1px solid;}
    .nrf-card.nt-t1{background:#241416;border-color:#5a2a2a;}
    .nrf-card.nt-t2{background:#10202a;border-color:#2a4a5a;}
    .nrf-main{display:flex;gap:8px;align-items:flex-start;padding:8px 9px;position:relative;cursor:pointer;}
    .nrf-no{font-size:20px;font-weight:800;width:38px;text-align:center;flex:0 0 auto;line-height:1.05;}
    .nrf-no span{font-size:9px;color:#cdd;font-weight:600;display:block;}
    .nrf-body{flex:1;min-width:0;}
    .nrf-demand{font-size:13.5px;letter-spacing:1px;}
    .nrf-demand .cap{font-size:10.5px;color:#cdd;letter-spacing:0;}
    .nrf-move{display:flex;align-items:center;gap:6px;margin-top:6px;flex-wrap:wrap;}
    .nrf-move .bar{flex:1 1 70px;min-width:60px;height:8px;border-radius:4px;background:rgba(0,0,0,.35);overflow:hidden;}
    .nrf-move .bar i{display:block;height:100%;}
    .nrf-move .mvlab{font-size:10.5px;color:#eee;white-space:nowrap;}
    .nrbadge,.nrf-move .nrbadge{font-size:9.5px;font-weight:700;padding:1px 7px;border-radius:999px;white-space:nowrap;}
    .nr-up{background:#4a1818;color:#ffb0b0;border:1px solid #8a3333;}
    .nr-eq{background:#1c2230;color:#a9c2e0;border:1px solid #3a4a60;}
    .nr-down{background:#10222a;color:#8fe0cc;border:1px solid #2a5a66;}
    .nrf-until{font-size:10.5px;color:#eee;margin-top:6px;}
    .nrf-chev{position:absolute;right:9px;top:9px;color:#cdd;font-size:13px;}
    .nrf-card.open .nrf-chev{transform:rotate(90deg);}
    .nrf-detail{padding:0 10px 9px 10px;border-top:1px dashed rgba(255,255,255,.18);}
    .nrf-detail h5{margin:8px 0 4px;font-size:10.5px;color:#cdd;font-weight:600;}
    .nrf-fl{display:flex;justify-content:space-between;gap:8px;font-size:11px;padding:2px 0;border-bottom:1px solid rgba(255,255,255,.06);}
    .nrf-fl .o{color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
    .nrf-fl .m{color:#cdd;text-align:right;white-space:nowrap;}
    .nrf-curve{background:rgba(0,0,0,.3);border-radius:6px;padding:6px 7px;margin-top:6px;}
    .nrf-clab{font-size:9.5px;color:var(--sub);line-height:1.4;}
    .nrf-axis{position:relative;height:13px;margin-top:2px;font-size:8.5px;color:var(--sub);}
    .nrf-axis span{position:absolute;transform:translateX(-50%);white-space:nowrap;}
    .nrf-axis .now{color:#fff;font-weight:700;}
```

- [ ] **Step 3: 構文チェック**

Run: `cd ~/work/taxi-noriba-map && node --check tools/js/arrivals-render.js && echo OK`
Expected: `OK`

- [ ] **Step 4: コミット**

```bash
cd ~/work/taxi-noriba-map
git add tools/js/arrivals-render.js tools/arrivals.html
git commit -m "feat(noriba): 号別メーターカード描画(通常比/活発/タップ詳細グラフ)"
```

---

## Task 3: 配線・SW・実機スモーク

**Files:**
- Modify: `tools/js/arrivals-app.js`
- Modify: `sw.js`

**Interfaces:**
- Consumes: `buildNoribaActivity`(Task 1), `renderNoribaActivity`(Task 2), 既存 `loadAdvanceForecast`（`forecast-section.js`）。

- [ ] **Step 1: import を差し替え**

`tools/js/arrivals-app.js` 1行目: `summarizeByNoriba` を `buildNoribaActivity` に置換（needed)。完全形:
```js
import { loadArrivals, loadPoolNotice, filterByTerminals, filterByTimeWindow, filterByLane, aggregateHeatmapClient, summarizeFlights, detectTopics, sortFlightsByTime, listOriginOptions, buildNoribaActivity, detectArrivalGap } from './arrivals-data.js';
```
2行目: `renderNoribaCards` を `renderNoribaActivity` に置換。完全形:
```js
import { renderHeatmap, renderFlightList, renderUpdatedAt, renderSummary, renderLegend, renderTopics, renderWeatherBanner, renderPoolNotice, renderNoribaActivity, renderArrivalGap } from './arrivals-render.js';
```
3行目に forecast ローダ import を追加:
```js
import { initForecastSection, loadAdvanceForecast } from './forecast-section.js';
```

- [ ] **Step 2: 初期化で forecast を読む**

`tools/js/arrivals-app.js` の `state.poolNotice = await loadPoolNotice();`（28-29行付近）の直後に追加:
```js
    state.forecast = (await loadAdvanceForecast()).data;
```

- [ ] **Step 3: render() の号別カード呼び出しを置換**

`tools/js/arrivals-app.js` 61-64行（`renderNoribaCards(...)`）を置換:
```js
  renderNoribaActivity(
    document.getElementById('noriba-cards-section'),
    buildNoribaActivity(state.arrivals, state.forecast ?? null, new Date()),
    { updatedLabel: state.arrivals.updatedAt ? new Date(state.arrivals.updatedAt).toLocaleTimeString('ja-JP', { hour:'2-digit', minute:'2-digit' }) : '' }
  );
```

- [ ] **Step 4: SW を bump**

`sw.js` の CACHE_NAME 行を 1 つ上げる（現行値を確認して +1）:
```bash
cd ~/work/taxi-noriba-map && grep -n "CACHE_NAME = CACHE_PREFIX" sw.js
```
例: `const CACHE_NAME = CACHE_PREFIX + 'v293';` → `'v294'`（実際の現行値+1に置換）。

- [ ] **Step 5: 構文 + 全テスト**

Run:
```bash
cd ~/work/taxi-noriba-map
node --check tools/js/arrivals-app.js && echo APP_OK
node --test tests/*.test.js 2>&1 | grep -E "^# (tests|pass|fail)"
```
Expected: `APP_OK`、`# fail 0`、号別アクティビティ分を含み全緑。

- [ ] **Step 6: コミット**

```bash
cd ~/work/taxi-noriba-map
git add tools/js/arrivals-app.js sw.js
git commit -m "feat(noriba): 号別カードをアクティビティ版に配線+forecast読込+sw bump"
```

- [ ] **Step 7: dev 反映 + 実機スモーク**

`!~/work/taxi-dev/dpush.sh ~/work/taxi-noriba-map` をユーザーが実行 → dev デプロイ後、kimi-webbridge（契約アカウント実ブラウザ）で `https://hidenaka.github.io/-taxi-daily-report-dev/tools/arrivals.html` を開く。
Expected: 号別メーターカードが表示（号1・2＝薄赤/号3・4＝薄青、需要✈・動きバー・通常比・活発〜時）、カードタップで詳細（来る便＋推移グラフ）が開く、320px幅で見切れない、JSエラー0。アクセスゲートで見えない場合は Task 1 の純関数＋デプロイ済みモジュールの動的import検証で代替。

---

## 完了条件
- 到着便ページの号別カードがメーター型（需要/動き/通常比/活発until/タップ詳細）に刷新され dev で動作。
- 純関数は全テスト緑、本番で見切れない、forecast欠落時も需要だけで安全劣化。
- 本番出荷は別途（tagpush vX.Y.Z → deploy.yml が rsync 同期。relay競合で失敗したら `gh run rerun`）。
```

// 「乗り場の動き」セクション。号ごとに、乗り場から出た台数(乗り場カメラで1台ずつ数えた数)と
// 待機所の列移動の回数を切り替えて見せる。表示は「グラフ」(号ごとに1行・写真つき)と「カード」(2列)。
// データ: data/stand-out.json(乗り場から出た台数) / data/advance-forecast.json(列移動) /
//         到着便(arrivals-app から setStandFlowFlights で受け取る) / data/stand-cam-1..4.jpg(乗り場の写真)
const LANES = [1, 2, 3, 4];
const NAME = { 1: '1号', 2: '2号', 3: '3号', 4: '4号' };
const SUB = { 1: 'T1 南', 2: 'T1 北', 3: 'T2 北', 4: 'T2 南・国際' };
const MODE_KEY = 'stand-flow-mode';
const VIEW_KEY = 'stand-flow-view';

function hm2min(s) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(s ?? ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}
function min2hm(n) {
  const v = ((n % 1440) + 1440) % 1440;
  return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`;
}

/** stand-out.json → 号ごとの {last30, lastHour, bins, hourly, since}。数えていない号は null。 */
export function standModel(data) {
  const out = { ends: Array.isArray(data?.bins30End) ? data.bins30End : null, lanes: {} };
  for (const n of LANES) {
    const s = data?.stalls?.[`stall${n}`];
    if (!s || typeof s.lastHour !== 'number') { out.lanes[n] = null; continue; }
    out.lanes[n] = {
      last30: typeof s.last30 === 'number' ? s.last30 : null,
      lastHour: s.lastHour,
      bins: Array.isArray(s.bins30) ? s.bins30 : null,
      hourly: Array.isArray(s.todayHourly) ? s.todayHourly : null,
      since: s.countingSince ? String(s.countingSince).slice(11, 16) : null,
      fc: Array.isArray(s.forecast30) ? s.forecast30 : null,
      // 見込みの外れ(直近7日・30分後の見込みの平均の差)。答え合わせが30件たまってから出す
      fcErr: (s.forecastEval && s.forecastEval['0'] && s.forecastEval['0'].n >= 30) ? s.forecastEval['0'].mae : null,
    };
  }
  return out;
}

/** advance-forecast.json の actualsToday(15分ごとの列移動回数)→ 号ごとの {last30, lastHour, bins, hourly}。 */
export function moveModel(adv, nowMin = null) {
  const bins = Array.isArray(adv?.actualsToday) ? adv.actualsToday.filter(b => hm2min(b?.time) != null) : [];
  const out = { ends: null, lanes: {} };
  if (!bins.length) { for (const n of LANES) out.lanes[n] = null; return out; }
  const last8 = bins.slice(-8);
  // 30分ずつ(古い→新しい)。端数があるときは先頭の1本を捨てる
  const pairs = [];
  for (let i = last8.length; i >= 2 && pairs.length < 4; i -= 2) pairs.unshift(last8.slice(i - 2, i));
  out.ends = pairs.map(p => min2hm(hm2min(p[p.length - 1].time) + 15));
  for (const n of LANES) {
    const k = `stall${n}`;
    const v = b => (typeof b?.stalls?.[k] === 'number' ? b.stalls[k] : 0);
    const hourly = new Array(24).fill(0);
    for (const b of bins) hourly[Math.floor(hm2min(b.time) / 60)] += v(b);
    const series = pairs.map(p => p.reduce((a, b) => a + v(b), 0));
    out.lanes[n] = {
      last30: series.length ? series[series.length - 1] : 0,
      lastHour: bins.slice(-4).reduce((a, b) => a + v(b), 0),
      bins: series,
      hourly,
      since: null,
      fc: nowMin == null ? null : moveForecast(adv, k, nowMin),
    };
  }
  return out;
}

// 列移動の見込み: advance-forecast の予測(15分ごと)を、いま〜30分後・30分後〜60分後に足す。
function moveForecast(adv, k, nowMin) {
  const slots = Array.isArray(adv?.slots) ? adv.slots : [];
  if (!slots.length) return null;
  const sum = (a, b) => slots.reduce((acc, sl) => {
    const t = hm2min(sl?.time);
    const d = t == null ? -1 : ((t - nowMin) % 1440 + 1440) % 1440;
    return (d >= a && d < b && typeof sl?.stalls?.[k] === 'number') ? acc + sl.stalls[k] : acc;
  }, 0);
  return [Math.round(sum(0, 30)), Math.round(sum(30, 60))];
}

/** 号ごとに、これから60分にロビーに出る便の座席数(15分ごと4本)と、30分以内の便数・座席数。 */
export function futureSeats(flights, lane, nowMin) {
  const bins = [0, 0, 0, 0];
  let n30 = 0, s30 = 0;
  for (const f of flights || []) {
    if (f?.poolLane !== lane || f?.status === '欠航') continue;
    const t = hm2min(f.lobbyExitTime ?? f.estimatedTime ?? f.scheduledTime);
    if (t == null) continue;
    const d = ((t - nowMin) % 1440 + 1440) % 1440;
    if (d >= 60) continue;
    const seats = typeof f.seatCount === 'number' ? f.seatCount : 0;
    bins[Math.floor(d / 15)] += seats;
    if (d < 30) { n30 += 1; s30 += seats; }
  }
  return { bins, next30: { flights: n30, seats: s30 } };
}

/** 号ごとに、これから win 分以内にロビーに出る便(早い順)。乗り場の状況カードを統合した分(2026-10-14)。 */
export function upcomingFlights(flights, lane, nowMin, win = 60) {
  const out = [];
  for (const f of flights || []) {
    if (f?.poolLane !== lane || f?.status === '欠航') continue;
    const tStr = f.lobbyExitTime ?? f.estimatedTime ?? f.scheduledTime;
    const t = hm2min(tStr);
    if (t == null) continue;
    const d = ((t - nowMin) % 1440 + 1440) % 1440;
    if (d >= win) continue;
    out.push({ d, time: min2hm(t), from: f.fromName ?? f.from ?? '', seats: typeof f.seatCount === 'number' ? f.seatCount : null });
  }
  return out.sort((a, b) => a.d - b.d);
}

function arrLine(n, list) {
  if (!list.length) return `<div class="sf-arr"><span>✈ 60分以内にロビーに出る便はありません</span></div>`;
  const nx = list[0];
  return `<div class="sf-arr" data-sf-open="${n}"><span>✈ 60分以内 <b>${list.length}便</b>・次 <b>${nx.time}</b> ${esc(nx.from)}</span><span>${state.open === n ? '閉じる▲' : '一覧›'}</span></div>`;
}

// 見込みがどれくらい外れてきたか(直近7日の答え合わせ)。2026-10-14 本人「全部推奨で」で表示。
export function errLine(d) {
  if (!d || typeof d.fcErr !== 'number') return '';
  return `<div class="sf-err">見込みの外れ：30分あたり平均 ±${d.fcErr.toFixed(1)}台（直近7日）</div>`;
}

function flightList(list) {
  return list.map(f => `<div class="sf-fl"><span>${f.time} ${esc(f.from)}から</span><span>${f.seats != null ? `${f.seats}席` : '席数不明'}</span></div>`).join('');
}

function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

// 棒の数字: 棒が数字より高ければ棒の真ん中、低ければ棒の上。
function barLabel(x, w, h, base, v, cls) {
  const c = (x + w / 2).toFixed(1);
  return h >= 17
    ? `<text x="${c}" y="${(base - h / 2 + 4).toFixed(1)}" class="sf-tv in ${cls}">${v}</text>`
    : `<text x="${c}" y="${(base - h - 3).toFixed(1)}" class="sf-tv ${cls}">${v}</text>`;
}

/** 過去2時間(30分ごと)＋これから1時間の見込み(30分ごと2本)の棒グラフ SVG。
 *  2026-10-14 本人指摘: 右側に座席数を並べると「タクシーが出た数」に見える → 右側は出る台数の見込みにした。 */
export function chartSvg(past, ends, fc, unitLabel) {
  const W = 230, top = 14, bh = 58, base = top + bh;
  const p = past && past.length ? past : [];
  const f = Array.isArray(fc) ? fc : [];
  const all = p.length + f.length;
  const mx = Math.max(1, ...p, ...f);
  const gap = f.length ? 8 : 0;
  const bw = all ? (W - gap) / all : W;
  let g = '';
  p.forEach((v, j) => {
    const h = Math.max(1.5, (v / mx) * bh), x = j * bw + 3, w = bw - 6;
    g += `<rect x="${x.toFixed(1)}" y="${(base - h).toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="2" class="${j === p.length - 1 ? 'sf-now' : 'sf-past'}"/>`;
    g += barLabel(x, w, h, base, v, '');
    g += `<text x="${(x + w / 2).toFixed(1)}" y="${base + 11}" class="sf-tl">${j === p.length - 1 ? 'いま' : (ends?.[j] ?? '')}</text>`;
  });
  if (f.length) {
    const x0 = p.length * bw + gap / 2;
    g += `<line x1="${x0.toFixed(1)}" y1="2" x2="${x0.toFixed(1)}" y2="${base + 13}" class="sf-div"/>`;
    const lab = ['+30分', '+60分'];
    f.forEach((v, j) => {
      const h = Math.max(1.5, (v / mx) * bh), x = x0 + gap / 2 + j * bw + 3, w = bw - 6;
      g += `<rect x="${x.toFixed(1)}" y="${(base - h).toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="2" class="sf-fc"/>`;
      g += barLabel(x, w, h, base, v, 'fc');
      g += `<text x="${(x + w / 2).toFixed(1)}" y="${base + 11}" class="sf-tl">${lab[j] ?? ''}</text>`;
    });
  }
  const head = f.length
    ? `<div class="sf-ch"><span>30分ごと（${unitLabel}）</span><span class="f">右の2本＝これからの見込み</span></div>`
    : `<div class="sf-ch"><span>30分ごと（${unitLabel}）</span></div>`;
  return `${head}<svg viewBox="0 0 ${W} ${base + 14}" class="sf-chart" role="img" aria-label="30分ごとの数とこれからの見込み">${g}</svg>`;
}

const state = { mode: 'out', view: 'graph', open: 0, stand: null, move: null, flights: [], camAt: 0 };
try {
  const m = localStorage.getItem(MODE_KEY); if (m === 'out' || m === 'mv') state.mode = m;
  const v = localStorage.getItem(VIEW_KEY); if (v === 'graph' || v === 'card') state.view = v;
} catch { /* ignore */ }

function nums(d, u) {
  const f = v => (typeof v === 'number' ? v : '—');
  return `<div class="sf-nums"><div><span>直近30分</span><b>${f(d?.last30)}</b><i>${u}</i></div><div><span>直近1時間</span><b>${f(d?.lastHour)}</b><i>${u}</i></div></div>`;
}

function dayCard(model, u, label, nowH) {
  let mx = 1;
  for (const n of LANES) { const h = model.lanes[n]?.hourly; if (h) mx = Math.max(mx, ...h.slice(0, nowH + 1)); }
  let rows = '';
  for (const n of LANES) {
    const d = model.lanes[n];
    const a = d?.hourly ? d.hourly.slice(0, nowH + 1) : [];
    const W = 300, bw = W / 24, bh = 34;
    let g = '';
    a.forEach((v, j) => {
      const h = Math.max(1, (v / mx) * bh), x = j * bw + 1, w = bw - 2;
      g += `<rect x="${x.toFixed(1)}" y="${(bh + 12 - h).toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="1.5" class="${j === a.length - 1 ? 'sf-now' : 'sf-past'}"/>`;
      if (v) g += h >= 13
        ? `<text x="${(x + w / 2).toFixed(1)}" y="${(bh + 12 - h / 2 + 3.5).toFixed(1)}" class="sf-tv in s">${v}</text>`
        : `<text x="${(x + w / 2).toFixed(1)}" y="${(bh + 12 - h - 2).toFixed(1)}" class="sf-tv s">${v}</text>`;
    });
    const tot = a.reduce((p, q) => p + q, 0);
    const since = d?.since && d.since > '00:59' ? `<small>${d.since}から</small>` : '';
    rows += `<div class="sf-drow"><div class="sf-dn"><b>${NAME[n]}</b><small>計${d ? tot : '—'}${u}</small>${since}</div><svg viewBox="0 0 ${W} ${bh + 14}" class="sf-chart">${g}</svg></div>`;
  }
  return `<div class="sf-day"><div class="sf-dh"><b>今日1日の${label}</b><span>1時間ごと（${u}）・0時〜いま</span></div>${rows}<div class="sf-daxis"><span>0時</span><span>6時</span><span>12時</span><span>18時</span><span>24時</span></div></div>`;
}

function render(el) {
  const out = state.mode === 'out';
  const model = out ? state.stand : state.move;
  const u = out ? '台' : '回';
  const label = out ? '乗り場から出た台数' : '列移動';
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const cb = state.camAt;
  let html = `<div class="sf-seg" role="tablist"><button type="button" data-sf-mode="out" class="${out ? 'on' : ''}">乗り場から出た台数</button><button type="button" data-sf-mode="mv" class="${out ? '' : 'on'}">待機所の列移動</button></div>
    <div class="sf-view"><button type="button" data-sf-view="graph" class="${state.view === 'graph' ? 'on' : ''}">グラフ</button><button type="button" data-sf-view="card" class="${state.view === 'card' ? 'on' : ''}">カード</button></div>
    <div class="sf-what">${out ? '数字は、その号の<b>乗り場から出ていったタクシーの台数</b>です。乗り場のカメラで1台ずつ数えています（1割ほど少なめに出ることがあります）。グラフの右の2本は、これから出る台数の見込みです（直近の出方といつもの台数から出した目安）。' : '数字は、その号の<b>待機所の列が前へ進んだ回数</b>です（実際より少なめに出ます）。グラフの右の2本は、これからの回数の見込みです。'}</div>`;
  if (!model) { el.innerHTML = html + '<div class="sf-empty">読み込み中...</div>'; return; }
  const vals = LANES.map(n => model.lanes[n]?.lastHour ?? -1);
  const top = Math.max(...vals);
  const hot = top > 0 ? LANES[vals.indexOf(top)] : 0;
  const arr = Object.fromEntries(LANES.map(n => [n, upcomingFlights(state.flights, n, nowMin)]));
  const photo = (n, cls) => `<img class="${cls}" src="data/stand-cam-${n}.jpg?t=${cb}" alt="${NAME[n]}の乗り場の写真" data-sf-zoom="${n}">`;
  const badge = n => (n === hot ? '<span class="sf-badge">いちばん多い</span>' : '');
  if (state.view === 'graph') {
    for (const n of LANES) {
      const d = model.lanes[n];
      html += `<div class="sf-lane${n === hot ? ' hot' : ''}">${badge(n)}${photo(n, 'sf-lphoto')}<div class="sf-lbody"><div class="sf-lhead"><div class="sf-lname"><b>${NAME[n]}</b><small>${SUB[n]}</small></div>${nums(d, u)}</div>${d ? chartSvg(d.bins || [], model.ends, d.fc, u) : '<div class="sf-empty">まだ数えていません</div>'}${errLine(d)}${arrLine(n, arr[n])}${state.open === n ? flightList(arr[n]) : ''}</div></div>`;
    }
  } else {
    for (const [lab, ids] of [['T1（JAL）', [1, 2]], ['T2（ANA・国際）', [3, 4]]]) {
      html += `<div class="sf-lbl">${lab}</div><div class="sf-grid">`;
      for (const n of ids) {
        const d = model.lanes[n];
        html += `<div class="sf-card${n === hot ? ' hot' : ''}" data-sf-open="${n}">${photo(n, 'sf-cphoto')}${badge(n)}<div class="sf-lname"><b>${NAME[n]}</b><small>${SUB[n]}</small></div>${nums(d, u)}<div class="sf-mini">これから30分の見込み <b>${d?.fc ? d.fc[0] : '—'}${u}</b><br>✈ 60分以内 <b>${arr[n].length}便</b>${arr[n][0] ? `・次 ${arr[n][0].time}` : ''}</div></div>`;
      }
      if (ids.includes(state.open)) {
        const n = state.open, d = model.lanes[n];
        html += `<div class="sf-detail"><b>${NAME[n]}の詳しいこと</b>${d ? chartSvg(d.bins || [], model.ends, d.fc, u) : '<div class="sf-empty">まだ数えていません</div>'}${errLine(d)}${arrLine(n, arr[n])}${flightList(arr[n])}</div>`;
      }
      html += '</div>';
    }
  }
  html += dayCard(model, u, label, now.getHours());
  el.innerHTML = html;
}

function zoom(n) {
  let z = document.getElementById('sf-zoom');
  if (!z) {
    z = document.createElement('div');
    z.id = 'sf-zoom';
    z.className = 'sf-zoom';
    z.addEventListener('click', () => { z.hidden = true; });
    document.body.appendChild(z);
  }
  z.innerHTML = `<img src="data/stand-cam-${n}.jpg?t=${state.camAt}" alt="${NAME[n]}の乗り場の写真"><div>${NAME[n]}の乗り場・押すと閉じます</div>`;
  z.hidden = false;
}

async function loadJson(path) {
  try {
    const res = await fetch(`${path}?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

let rootEl = null;

/** 到着便(号の上書き済み)を受け取って描き直す。arrivals-app の描画ごとに呼ばれる。 */
export function setStandFlowFlights(flights) {
  state.flights = Array.isArray(flights) ? flights : [];
  if (rootEl) render(rootEl);
}

export async function initStandFlow() {
  rootEl = document.getElementById('stand-flow');
  if (!rootEl) return null;
  rootEl.addEventListener('click', (e) => {
    const t = e.target;
    const z = t.closest('[data-sf-zoom]');
    if (z) { e.stopPropagation(); zoom(Number(z.dataset.sfZoom)); return; }
    const m = t.closest('[data-sf-mode]');
    if (m) { state.mode = m.dataset.sfMode; try { localStorage.setItem(MODE_KEY, state.mode); } catch { /* ignore */ } render(rootEl); return; }
    const v = t.closest('[data-sf-view]');
    if (v) { state.view = v.dataset.sfView; try { localStorage.setItem(VIEW_KEY, state.view); } catch { /* ignore */ } render(rootEl); return; }
    const o = t.closest('[data-sf-open]');
    if (o) { const n = Number(o.dataset.sfOpen); state.open = state.open === n ? 0 : n; render(rootEl); }
  });
  async function refresh() {
    const [stand, adv] = await Promise.all([loadJson('data/stand-out.json'), loadJson('data/advance-forecast.json')]);
    state.stand = standModel(stand);
    const nd = new Date();
    state.move = moveModel(adv, nd.getHours() * 60 + nd.getMinutes());
    state.camAt = Date.now();
    render(rootEl);
  }
  await refresh();
  return refresh;
}

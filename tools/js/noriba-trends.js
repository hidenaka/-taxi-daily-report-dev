// 乗り場傾向: 号ごとに「乗り場から出ていったタクシーの台数」(乗り場カメラで1台ずつ数えたもの)の
// いつもの日(過去の平均)と今日を並べる。データは data/stand-out.json(Mac mini の stand-out-tick.py)。
// 2026-10-27 本人「最新のカウントに合わせたページに」で、待機所の列移動の回数から作り替えた。

export const STALLS = [
  { key: 'stall1', label: '1号', sub: 'T1 南', tone: 'orange' },
  { key: 'stall2', label: '2号', sub: 'T1 北', tone: 'yellow' },
  { key: 'stall3', label: '3号', sub: 'T2 北', tone: 'teal' },
  { key: 'stall4', label: '4号', sub: 'T2 南・国際', tone: 'violet' },
];

const DAYPARTS = [
  { key: 'morning', label: '朝', range: '5-11時', hours: [5, 6, 7, 8, 9, 10] },
  { key: 'day', label: '昼', range: '11-16時', hours: [11, 12, 13, 14, 15] },
  { key: 'evening', label: '夕方', range: '16-21時', hours: [16, 17, 18, 19, 20] },
  { key: 'night', label: '夜', range: '21-5時', hours: [21, 22, 23, 0, 1, 2, 3, 4] },
];

function round1(value) {
  const n = Number(value) || 0;
  return Math.round(n * 10) / 10;
}

function fmt(value) {
  return String(Math.round(Number(value) || 0));
}

function hourLabel(h) {
  return `${h}時台`;
}

function hours24(arr) {
  return Array.from({ length: 24 }, (_, h) => Number(arr?.[h]) || 0);
}

/** stand-out.json → 号ごとの 24 時間(いつもの日・今日)。いつもの日がまだ無い号は typical=null。 */
export function toHourRows(stand) {
  const stalls = stand?.stalls || {};
  return STALLS.map((stall) => {
    const s = stalls[stall.key] || {};
    return {
      ...stall,
      typical: Array.isArray(s.typicalHourly) ? hours24(s.typicalHourly) : null,
      typicalDays: Number(s.typicalDays) || 0,
      today: hours24(s.todayHourly),
    };
  });
}

/** 今日ここまでの台数と、いつもの日のこの時刻までの台数(いまの時間は経った分だけ足す)。 */
export function soFar(row, now = new Date()) {
  const h = now.getHours();
  const frac = now.getMinutes() / 60;
  let today = 0;
  let typical = 0;
  for (let i = 0; i <= h; i += 1) {
    today += row.today[i];
    if (row.typical) typical += i < h ? row.typical[i] : row.typical[i] * frac;
  }
  return { today, typical: row.typical ? round1(typical) : null };
}

export function summarizeRow(row, now = new Date()) {
  const base = row.typical;
  let peak = null;
  let quiet = null;
  if (base) {
    // 多い・少ない時間は 5〜24時で見る(深夜はどの号も少ないので、比べても役に立たない)
    for (let h = 5; h < 24; h += 1) {
      if (peak === null || base[h] > base[peak]) peak = h;
      if (quiet === null || base[h] < base[quiet]) quiet = h;
    }
  }
  let rest = null;
  if (base) {
    const h = now.getHours();
    rest = base[h] * (1 - now.getMinutes() / 60);
    for (let i = h + 1; i < 24; i += 1) rest += base[i];
  }
  const sf = soFar(row, now);
  return {
    key: row.key,
    total: base ? round1(base.reduce((a, b) => a + b, 0)) : null,
    peakHour: peak,
    peakValue: peak === null ? null : base[peak],
    quietHour: quiet,
    quietValue: quiet === null ? null : base[quiet],
    todaySoFar: sf.today,
    typicalSoFar: sf.typical,
    restOfDay: rest === null ? null : Math.round(rest),
  };
}

export function buildDaypartRows(rows) {
  return DAYPARTS.map((part) => {
    const out = { key: part.key, label: part.label, range: part.range, total: 0 };
    for (const row of rows) {
      const v = row.typical ? part.hours.reduce((a, h) => a + row.typical[h], 0) : null;
      out[row.key] = v;
      out.total += v || 0;
    }
    return out;
  });
}

export function buildTimelineHourMarkers() {
  return [0, 3, 6, 9, 12, 15, 18, 21, 24].map((hour) => ({
    hour,
    label: `${hour}時`,
    position: Math.round((hour / 24) * 1000) / 10,
  }));
}

export function buildTimelineHourDividers() {
  return Array.from({ length: 25 }, (_, hour) => ({
    hour,
    position: Math.round((hour / 24) * 1000) / 10,
  }));
}

export function buildNowMarker(now = new Date()) {
  const h = now.getHours();
  const m = now.getMinutes();
  const minutes = h * 60 + m;
  return {
    label: `現在 ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`,
    position: Math.round((minutes / (24 * 60)) * 1000) / 10,
  };
}

/** 今日ここまでといつもの日の差。差が 3台未満か 1割未満なら「いつもくらい」。 */
export function compareLabel(today, typical) {
  if (typical === null || typical < 1) return null;
  const diff = Math.round(today - typical);
  if (Math.abs(diff) < Math.max(3, typical * 0.1)) return { key: 'same', text: 'いつもくらい' };
  return diff > 0
    ? { key: 'more', text: `いつもより ${diff}台 多い` }
    : { key: 'less', text: `いつもより ${-diff}台 少ない` };
}

function renderStallCards(rows, now) {
  const sums = rows.map(row => summarizeRow(row, now));
  const maxTotal = Math.max(1, ...sums.map(s => s.total || 0));
  return `<div class="trend-cards">${rows.map((row, i) => {
    const s = sums[i];
    const pct = s.total ? Math.max(4, Math.round((s.total / maxTotal) * 100)) : 0;
    const cmp = compareLabel(s.todaySoFar, s.typicalSoFar);
    return `<article class="trend-card tone-${row.tone}">
      <div class="trend-card-head"><span class="trend-stall">${row.label}</span><span class="trend-muted">${row.sub}</span></div>
      <div class="trend-main">${s.total === null ? '—' : fmt(s.total)}<span>台/日</span></div>
      <div class="trend-muted">いつもの日の1日の台数</div>
      <div class="trend-meter" aria-hidden="true"><span style="width:${pct}%"></span></div>
      <dl class="trend-kv">
        <div><dt>今日ここまで</dt><dd>${fmt(s.todaySoFar)}台</dd></div>
        <div><dt>いつもはここまで</dt><dd>${s.typicalSoFar === null ? '—' : `${fmt(s.typicalSoFar)}台`}</dd></div>
        <div><dt>24時まで</dt><dd>${s.restOfDay === null ? '—' : `あと約${s.restOfDay}台`}</dd></div>
        <div><dt>多い時間</dt><dd>${s.peakHour === null ? '—' : `${hourLabel(s.peakHour)} ${fmt(s.peakValue)}台`}</dd></div>
        <div><dt>少ない時間</dt><dd>${s.quietHour === null ? '—' : `${hourLabel(s.quietHour)} ${fmt(s.quietValue)}台`}</dd></div>
      </dl>
      ${cmp ? `<div class="trend-cmp is-${cmp.key}">${cmp.text}</div>` : ''}
    </article>`;
  }).join('')}</div>`;
}

function renderPoolCameras(now = new Date()) {
  const cb = now.getTime();
  return `<section class="trend-camera-section">
    <div class="trend-section-head">
      <h2>ライブカメラ</h2>
      <span>到着便ページと同じ画像</span>
    </div>
    <div class="trend-cameras">
      <img src="data/pool-cam-real01.jpg?t=${cb}" alt="タクシープール 第1から第4乗り場" loading="lazy">
      <img src="data/pool-cam-real02.jpg?t=${cb}" alt="タクシープール 第4待機" loading="lazy">
    </div>
  </section>`;
}

function renderTimeline(rows, now = new Date()) {
  const max = Math.max(1, ...rows.flatMap(row => [...(row.typical || []), ...row.today]));
  const markers = buildTimelineHourMarkers();
  const dividers = buildTimelineHourDividers();
  const nowMarker = buildNowMarker(now);
  const h = now.getHours();
  const H = 46;
  return `<section class="trend-section">
    <div class="trend-section-head">
      <h2>1日の流れ（1時間ごと）</h2>
      <span>${nowMarker.label} / 縦軸 台</span>
    </div>
    <div class="trend-axis-note">薄い棒がいつもの日、濃い棒が今日です。白い縦線が今の時刻です。</div>
    <div class="trend-lanes">${rows.map((row) => `<div class="trend-lane tone-${row.tone}">
      <div class="trend-lane-label">${row.label}</div>
      <div class="trend-y-axis" aria-label="縦軸">
        <span>${fmt(max)}</span>
        <span>${fmt(max / 2)}</span>
        <span>0</span>
      </div>
      <div class="trend-bars-wrap">
        <div class="trend-hour-lines" aria-hidden="true">
          ${dividers.map(divider => `<span class="trend-hour-line" style="left:${divider.position}%"></span>`).join('')}
        </div>
        <div class="trend-bars trend-bars-24">${Array.from({ length: 24 }, (_, i) => {
          const t = row.typical ? row.typical[i] : 0;
          const a = i <= h ? row.today[i] : null;
          const th = row.typical ? Math.max(2, Math.round((t / max) * H)) : 0;
          const ah = a === null ? 0 : Math.max(a > 0 ? 2 : 0, Math.round((a / max) * H));
          const tip = `${hourLabel(i)} いつも${row.typical ? fmt(t) : '—'}台${a === null ? '' : `・今日${a}台`}`;
          return `<span class="trend-hour" title="${tip}"><i style="height:${th}px"></i>${a === null ? '' : `<b style="height:${ah}px"></b>`}</span>`;
        }).join('')}</div>
        <span class="trend-now-line" style="left:${nowMarker.position}%" title="${nowMarker.label}"></span>
      </div>
    </div>`).join('')}</div>
    <div class="trend-time-axis" aria-label="時刻目盛り">
      ${markers.map(marker => `<span style="left:${marker.position}%">${marker.label}</span>`).join('')}
    </div>
  </section>`;
}

function renderDaypartTable(parts) {
  const cell = v => (v === null ? '—' : fmt(v));
  return `<section class="trend-section">
    <div class="trend-section-head">
      <h2>時間帯ごとの台数（いつもの日）</h2>
      <span>台</span>
    </div>
    <table class="trend-table">
      <thead><tr><th>時間帯</th><th>1号</th><th>2号</th><th>3号</th><th>4号</th><th>計</th></tr></thead>
      <tbody>${parts.map(row => `<tr>
        <td><span class="trend-daypart-name">${row.label}</span><span class="trend-daypart-range">${row.range}</span></td>
        <td>${cell(row.stall1)}</td>
        <td>${cell(row.stall2)}</td>
        <td>${cell(row.stall3)}</td>
        <td>${cell(row.stall4)}</td>
        <td class="trend-total">${fmt(row.total)}</td>
      </tr>`).join('')}</tbody>
    </table>
  </section>`;
}

function renderDetailTable(rows, now) {
  const h = now.getHours();
  return `<details class="trend-detail">
    <summary>1時間ごとの表（いつもの日 / 今日）</summary>
    <div class="trend-table-scroll">
      <table class="trend-table">
        <thead><tr><th>時間</th>${rows.map(r => `<th>${r.label}</th>`).join('')}</tr></thead>
        <tbody>${Array.from({ length: 24 }, (_, i) => `<tr${i === h ? ' class="is-now"' : ''}>
          <td>${hourLabel(i)}</td>
          ${rows.map(r => `<td>${r.typical ? fmt(r.typical[i]) : '—'}<span class="trend-today"> / ${i <= h ? r.today[i] : '—'}</span></td>`).join('')}
        </tr>`).join('')}</tbody>
      </table>
    </div>
  </details>`;
}

function formatGeneratedAt(value) {
  if (!value) return '—';
  return String(value).slice(0, 16).replace('T', ' ');
}

function renderPage(root, stand, now = new Date()) {
  const rows = toHourRows(stand);
  const days = rows.filter(r => r.typical).map(r => `${r.label}は${r.typicalDays}日`).join('・');
  root.innerHTML = `
    <section class="trend-hero">
      <div>
        <p class="trend-eyebrow">羽田空港 タクシー乗り場</p>
        <h1>乗り場傾向</h1>
      </div>
    </section>
    <div class="trend-meta">
      <span>更新 ${formatGeneratedAt(stand.generatedAt)}</span>
      <span>数字は乗り場から出ていったタクシーの台数（乗り場のカメラで1台ずつ数えたもの・1割ほど少なめに出ることがあります）</span>
      ${days ? `<span>いつもの日 = ${days}の平均</span>` : ''}
    </div>
    ${renderStallCards(rows, now)}
    ${renderTimeline(rows, now)}
    ${renderPoolCameras(now)}
    ${renderDaypartTable(buildDaypartRows(rows))}
    ${renderDetailTable(rows, now)}
  `;
}

export async function initNoribaTrendsPage({
  root = document.getElementById('noriba-trends-root'),
  error = document.getElementById('noriba-trends-error'),
  fetchFn = fetch,
  now = new Date(),
} = {}) {
  if (!root) return;
  let stand = null;
  try {
    const res = await fetchFn(`data/stand-out.json?t=${Date.now()}`, { cache: 'no-store' });
    if (res.ok) stand = await res.json();
  } catch { /* 下でエラー表示 */ }
  if (!stand?.stalls) {
    if (error) {
      error.hidden = false;
      error.textContent = '乗り場の台数データを取得できていません。少し待ってから開き直してください。';
    }
    root.innerHTML = '';
    return;
  }
  renderPage(root, stand, now);
}

if (typeof document !== 'undefined') {
  initNoribaTrendsPage();
}

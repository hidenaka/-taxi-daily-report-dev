import { loadAdvanceForecast } from './forecast-section.js';

export const STALLS = [
  { key: 'stall1', label: '1号', tone: 'orange' },
  { key: 'stall2', label: '2号', tone: 'yellow' },
  { key: 'stall3', label: '3号', tone: 'teal' },
  { key: 'stall4', label: '4号', tone: 'violet' },
];

const DAYPARTS = [
  { key: 'morning', label: '朝', start: 5 * 60, end: 11 * 60 },
  { key: 'day', label: '昼', start: 11 * 60, end: 16 * 60 },
  { key: 'evening', label: '夕方', start: 16 * 60, end: 21 * 60 },
  { key: 'night', label: '夜', start: 21 * 60, end: 5 * 60 },
];

const UNIT_STORAGE_KEY = 'noribaTrendsUnit';

function toMinutes(hhmm) {
  const [h, m] = String(hhmm || '').split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

function toHHMM(minutes) {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function round1(value) {
  const n = Number(value) || 0;
  return Math.round(n * 10) / 10;
}

function fmt(value) {
  const n = round1(value);
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function daypartFor(minutes) {
  return DAYPARTS.find((part) => {
    if (part.start < part.end) return minutes >= part.start && minutes < part.end;
    return minutes >= part.start || minutes < part.end;
  }) || DAYPARTS[0];
}

export function toTrendBins(slots) {
  return (slots || []).map((slot) => {
    const start = toMinutes(slot.time);
    const label = start === null ? String(slot.time || '') : `${toHHMM(start)}-${toHHMM(start + 15)}`;
    const stalls = slot.stalls || {};
    const row = { time: slot.time, label };
    for (const stall of STALLS) row[stall.key] = Number(stalls[stall.key] ?? 0);
    row.total = round1(STALLS.reduce((sum, stall) => sum + row[stall.key], 0));
    return row;
  });
}

export function toVehicleTrendBins(bins, rowWidth) {
  if (!rowWidth || !Array.isArray(bins)) return bins || [];
  return bins.map((bin) => {
    const row = { time: bin.time, label: bin.label };
    for (const stall of STALLS) {
      const width = typeof rowWidth[stall.key] === 'number' ? rowWidth[stall.key] : 1;
      row[stall.key] = Math.round((bin[stall.key] || 0) * width);
    }
    row.total = STALLS.reduce((sum, stall) => sum + row[stall.key], 0);
    return row;
  });
}

export function summarizeStallTrends(bins) {
  const rows = Array.isArray(bins) ? bins : [];
  return STALLS.map((stall) => {
    let total = 0;
    let peak = null;
    let quiet = null;
    for (const bin of rows) {
      const value = Number(bin[stall.key] || 0);
      total += value;
      if (!peak || value > peak.value) peak = { label: bin.label, value };
      if (!quiet || value < quiet.value) quiet = { label: bin.label, value };
    }
    const hours = rows.length > 0 ? rows.length / 4 : 0;
    return {
      key: stall.key,
      label: stall.label,
      tone: stall.tone,
      total: round1(total),
      averagePerHour: hours ? round1(total / hours) : 0,
      peakLabel: peak ? peak.label : '—',
      peakValue: peak ? round1(peak.value) : 0,
      quietLabel: quiet ? quiet.label : '—',
      quietValue: quiet ? round1(quiet.value) : 0,
    };
  });
}

export function buildDaypartSummaries(bins) {
  const rows = DAYPARTS.map((part) => ({
    key: part.key,
    label: part.label,
    stall1: 0,
    stall2: 0,
    stall3: 0,
    stall4: 0,
    total: 0,
  }));
  const byKey = new Map(rows.map(row => [row.key, row]));
  for (const bin of bins || []) {
    const startLabel = String(bin.label || '').split('-')[0];
    const minutes = toMinutes(startLabel);
    if (minutes === null) continue;
    const row = byKey.get(daypartFor(minutes).key);
    for (const stall of STALLS) row[stall.key] += Number(bin[stall.key] || 0);
    row.total += Number(bin.total || 0);
  }
  for (const row of rows) {
    for (const stall of STALLS) row[stall.key] = round1(row[stall.key]);
    row.total = round1(row.total);
  }
  return rows;
}

function renderUnitControls(unit) {
  return `<div class="trend-segment" role="group" aria-label="単位">
    <button type="button" class="trend-segment-btn ${unit === 'count' ? 'is-active' : ''}" data-unit="count">回数</button>
    <button type="button" class="trend-segment-btn ${unit === 'vehicles' ? 'is-active' : ''}" data-unit="vehicles">台数</button>
  </div>`;
}

function renderStallCards(summaries, todaySummaries, unitLabel) {
  const maxTotal = Math.max(1, ...summaries.map(row => row.total));
  const todayByKey = new Map((todaySummaries || []).map(row => [row.key, row]));
  return `<div class="trend-cards">${summaries.map((row) => {
    const today = todayByKey.get(row.key);
    const pct = Math.max(4, Math.round((row.total / maxTotal) * 100));
    const todayText = today ? `${fmt(today.total)}${unitLabel}` : '—';
    return `<article class="trend-card tone-${row.tone}">
      <div class="trend-card-head"><span class="trend-stall">${row.label}</span><span class="trend-muted">平均</span></div>
      <div class="trend-main">${fmt(row.total)}<span>${unitLabel}/日</span></div>
      <div class="trend-meter" aria-hidden="true"><span style="width:${pct}%"></span></div>
      <dl class="trend-kv">
        <div><dt>ピーク</dt><dd>${row.peakLabel} ${fmt(row.peakValue)}${unitLabel}</dd></div>
        <div><dt>静か</dt><dd>${row.quietLabel} ${fmt(row.quietValue)}${unitLabel}</dd></div>
        <div><dt>1時間平均</dt><dd>${fmt(row.averagePerHour)}${unitLabel}</dd></div>
        <div><dt>今日実測</dt><dd>${todayText}</dd></div>
      </dl>
    </article>`;
  }).join('')}</div>`;
}

function renderTimeline(bins, unitLabel) {
  const max = Math.max(1, ...bins.map(row => Math.max(...STALLS.map(stall => row[stall.key] || 0))));
  return `<section class="trend-section">
    <div class="trend-section-head">
      <h2>24時間の平均パターン</h2>
      <span>15分ごと / ${unitLabel}</span>
    </div>
    <div class="trend-lanes">${STALLS.map((stall) => `<div class="trend-lane tone-${stall.tone}">
      <div class="trend-lane-label">${stall.label}</div>
      <div class="trend-bars">${bins.map((bin) => {
        const height = Math.max(3, Math.round(((bin[stall.key] || 0) / max) * 28));
        return `<span title="${bin.label} ${fmt(bin[stall.key] || 0)}${unitLabel}" style="height:${height}px"></span>`;
      }).join('')}</div>
    </div>`).join('')}</div>
  </section>`;
}

function renderDaypartTable(rows, unitLabel) {
  return `<section class="trend-section">
    <div class="trend-section-head">
      <h2>時間帯別の合計</h2>
      <span>${unitLabel}</span>
    </div>
    <table class="trend-table">
      <thead><tr><th>時間帯</th><th>1号</th><th>2号</th><th>3号</th><th>4号</th><th>計</th></tr></thead>
      <tbody>${rows.map(row => `<tr>
        <td>${row.label}</td>
        <td>${fmt(row.stall1)}</td>
        <td>${fmt(row.stall2)}</td>
        <td>${fmt(row.stall3)}</td>
        <td>${fmt(row.stall4)}</td>
        <td class="trend-total">${fmt(row.total)}</td>
      </tr>`).join('')}</tbody>
    </table>
  </section>`;
}

function renderDetailTable(bins, unitLabel) {
  return `<details class="trend-detail">
    <summary>15分ごとの元データ</summary>
    <div class="trend-table-scroll">
      <table class="trend-table">
        <thead><tr><th>時間帯</th><th>1号</th><th>2号</th><th>3号</th><th>4号</th><th>計</th></tr></thead>
        <tbody>${bins.map(row => `<tr>
          <td>${row.label}</td>
          <td>${fmt(row.stall1)}</td>
          <td>${fmt(row.stall2)}</td>
          <td>${fmt(row.stall3)}</td>
          <td>${fmt(row.stall4)}</td>
          <td class="trend-total">${fmt(row.total)}</td>
        </tr>`).join('')}</tbody>
      </table>
    </div>
  </details>`;
}

function formatGeneratedAt(value) {
  if (!value) return '—';
  return String(value).slice(0, 16).replace('T', ' ');
}

function renderPage(root, data, unit) {
  const unitLabel = unit === 'vehicles' ? '台' : '回';
  const typicalBins = unit === 'vehicles'
    ? toVehicleTrendBins(toTrendBins(data.slots || []), data.rowWidth)
    : toTrendBins(data.slots || []);
  const todayBins = unit === 'vehicles'
    ? toVehicleTrendBins(toTrendBins(data.actualsToday || []), data.rowWidth)
    : toTrendBins(data.actualsToday || []);
  const summaries = summarizeStallTrends(typicalBins);
  const todaySummaries = todayBins.length ? summarizeStallTrends(todayBins) : [];
  const dayparts = buildDaypartSummaries(typicalBins);
  const trainedRows = typeof data.trainedRows === 'number' ? data.trainedRows.toLocaleString('ja-JP') : '—';

  root.innerHTML = `
    <section class="trend-hero">
      <div>
        <p class="trend-eyebrow">羽田空港 タクシープール</p>
        <h1>乗り場傾向</h1>
      </div>
      ${renderUnitControls(unit)}
    </section>
    <div class="trend-meta">
      <span>更新 ${formatGeneratedAt(data.generatedAt)}</span>
      <span>学習 ${trainedRows} 行</span>
      <span>平均は画像計測由来の列移動履歴から算出</span>
    </div>
    ${renderStallCards(summaries, todaySummaries, unitLabel)}
    ${renderTimeline(typicalBins, unitLabel)}
    ${renderDaypartTable(dayparts, unitLabel)}
    ${renderDetailTable(typicalBins, unitLabel)}
  `;
}

export async function initNoribaTrendsPage({
  root = document.getElementById('noriba-trends-root'),
  error = document.getElementById('noriba-trends-error'),
  fetchFn = fetch,
} = {}) {
  if (!root) return;
  let unit = localStorage.getItem(UNIT_STORAGE_KEY) || 'count';
  const result = await loadAdvanceForecast(fetchFn);
  if (result.error || !result.data) {
    if (error) {
      error.hidden = false;
      error.textContent = '乗り場傾向データを取得できていません。空港ツールの列移動データ更新を確認してください。';
    }
    root.innerHTML = '';
    return;
  }

  const redraw = () => {
    renderPage(root, result.data, unit);
    root.querySelectorAll('[data-unit]').forEach((button) => {
      button.addEventListener('click', () => {
        unit = button.dataset.unit === 'vehicles' ? 'vehicles' : 'count';
        localStorage.setItem(UNIT_STORAGE_KEY, unit);
        redraw();
      });
    });
  };
  redraw();
}

if (typeof document !== 'undefined') {
  initNoribaTrendsPage();
}

import { loadAdvanceForecast } from './forecast-section.js';

export const STALLS = [
  { key: 'stall1', label: '1号', tone: 'orange' },
  { key: 'stall2', label: '2号', tone: 'yellow' },
  { key: 'stall3', label: '3号', tone: 'teal' },
  { key: 'stall4', label: '4号', tone: 'violet' },
];

const DAYPARTS = [
  { key: 'morning', label: '朝', range: '5-11時', start: 5 * 60, end: 11 * 60 },
  { key: 'day', label: '昼', range: '11-16時', start: 11 * 60, end: 16 * 60 },
  { key: 'evening', label: '夕方', range: '16-21時', start: 16 * 60, end: 21 * 60 },
  { key: 'night', label: '夜', range: '21-5時', start: 21 * 60, end: 5 * 60 },
];

const UNIT_STORAGE_KEY = 'noribaTrendsUnit';
const REFERENCE_END_MINUTES = 5 * 60 + 30;

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

function confidenceFromQuality(quality) {
  if (!quality || typeof quality !== 'object') return null;
  const condition = quality.condition || '';
  const confidence = quality.confidence || '';
  const isReference = confidence === 'reference' || confidence === 'low' ||
    condition === 'night' || condition === 'rain_night' || condition === 'early';
  const isNormal = confidence === 'normal' || condition === 'day' || condition === 'rain_day';
  if (!isReference && !isNormal) return null;
  const labels = {
    day: '昼',
    rain_day: '雨昼',
    night: '夜',
    rain_night: '雨夜',
    early: '早朝',
  };
  if (isReference) {
    return {
      key: 'reference',
      label: '列移動の回数（参考）',
      shortLabel: '参考',
      note: labels[condition] ? `${labels[condition]}は参考扱い` : '画像/天候条件により参考扱い',
    };
  }
  return {
    key: 'normal',
    label: '列移動の回数',
    shortLabel: '通常',
    note: labels[condition] ? `${labels[condition]}は通常扱い` : '通常扱い',
  };
}

export function movementConfidenceForTime(timeLabel, quality = null) {
  const qualityConfidence = confidenceFromQuality(quality);
  if (qualityConfidence) return qualityConfidence;

  const startLabel = String(timeLabel || '').split('-')[0];
  const minutes = toMinutes(startLabel);
  if (minutes === null) {
    return {
      key: 'normal',
      label: '列移動の回数',
      shortLabel: '通常',
      note: '通常扱い',
    };
  }
  const isReference = minutes >= 21 * 60 || minutes < REFERENCE_END_MINUTES;
  if (isReference) {
    return {
      key: 'reference',
      label: '列移動の回数（参考）',
      shortLabel: '参考',
      note: '夜・雨夜・早朝はライト/反射/明るさ変化で精度が落ちる',
    };
  }
  return {
    key: 'normal',
    label: '列移動の回数',
    shortLabel: '通常',
    note: '昼・雨昼は通常の列移動回数として扱う',
  };
}

export function toTrendBins(slots) {
  return (slots || []).map((slot) => {
    const start = toMinutes(slot.time);
    const label = start === null ? String(slot.time || '') : `${toHHMM(start)}-${toHHMM(start + 15)}`;
    const stalls = slot.stalls || {};
    const row = { time: slot.time, label, quality: slot.quality || null };
    for (const stall of STALLS) row[stall.key] = Number(stalls[stall.key] ?? 0);
    row.total = round1(STALLS.reduce((sum, stall) => sum + row[stall.key], 0));
    return row;
  });
}

export function toVehicleTrendBins(bins, rowWidth) {
  if (!rowWidth || !Array.isArray(bins)) return bins || [];
  return bins.map((bin) => {
    const row = { time: bin.time, label: bin.label, quality: bin.quality || null };
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
    range: part.range,
    stall1: 0,
    stall2: 0,
    stall3: 0,
    stall4: 0,
    total: 0,
    normalRows: 0,
    referenceRows: 0,
    confidenceKey: 'normal',
  }));
  const byKey = new Map(rows.map(row => [row.key, row]));
  for (const bin of bins || []) {
    const startLabel = String(bin.label || '').split('-')[0];
    const minutes = toMinutes(startLabel);
    if (minutes === null) continue;
    const row = byKey.get(daypartFor(minutes).key);
    for (const stall of STALLS) row[stall.key] += Number(bin[stall.key] || 0);
    row.total += Number(bin.total || 0);
    const confidence = movementConfidenceForTime(bin.label, bin.quality);
    if (confidence.key === 'reference') row.referenceRows += 1;
    else row.normalRows += 1;
  }
  for (const row of rows) {
    for (const stall of STALLS) row[stall.key] = round1(row[stall.key]);
    row.total = round1(row.total);
    if (row.referenceRows > 0 && row.normalRows > 0) row.confidenceKey = 'mixed';
    else if (row.referenceRows > 0) row.confidenceKey = 'reference';
    else row.confidenceKey = 'normal';
  }
  return rows;
}

export function buildTimelineHourMarkers(bins) {
  const rows = Array.isArray(bins) ? bins : [];
  const count = rows.length || 96;
  return [0, 3, 6, 9, 12, 15, 18, 21, 24].map((hour) => ({
    hour,
    label: `${hour}時`,
    position: Math.round((hour / 24) * 1000) / 10,
    gridColumn: Math.min(count + 1, Math.round((hour / 24) * count) + 1),
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

function renderTimeline(bins, unitLabel, now = new Date()) {
  const max = Math.max(1, ...bins.map(row => Math.max(...STALLS.map(stall => row[stall.key] || 0))));
  const markers = buildTimelineHourMarkers(bins);
  const dividers = buildTimelineHourDividers();
  const nowMarker = buildNowMarker(now);
  const midLabel = fmt(max / 2);
  const maxLabel = fmt(max);
  return `<section class="trend-section">
    <div class="trend-section-head">
      <h2>24時間の平均パターン</h2>
      <span>${nowMarker.label} / 縦軸 ${unitLabel}</span>
    </div>
    <div class="trend-axis-note">棒1本は15分平均。縦軸は各棒の${unitLabel}、薄い縦線は1時間ごと。夜・雨夜・早朝と画像QCが弱い昼枠も参考扱い。</div>
    <div class="trend-lanes">${STALLS.map((stall) => `<div class="trend-lane tone-${stall.tone}">
      <div class="trend-lane-label">${stall.label}</div>
      <div class="trend-y-axis" aria-label="縦軸">
        <span>${maxLabel}</span>
        <span>${midLabel}</span>
        <span>0</span>
      </div>
      <div class="trend-bars-wrap">
        <div class="trend-hour-lines" aria-hidden="true">
          ${dividers.map(divider => `<span class="trend-hour-line" style="left:${divider.position}%"></span>`).join('')}
        </div>
        <div class="trend-bars">${bins.map((bin) => {
          const height = Math.max(3, Math.round(((bin[stall.key] || 0) / max) * 32));
          return `<span title="${bin.label} ${fmt(bin[stall.key] || 0)}${unitLabel}" style="height:${height}px"></span>`;
        }).join('')}</div>
        <span class="trend-now-line" style="left:${nowMarker.position}%" title="${nowMarker.label}"></span>
      </div>
    </div>`).join('')}</div>
    <div class="trend-time-axis" aria-label="時刻目盛り">
      ${markers.map(marker => `<span style="left:${marker.position}%">${marker.label}</span>`).join('')}
    </div>
  </section>`;
}

function renderDaypartTable(rows, unitLabel) {
  const confidenceByKey = {
    normal: '<span class="trend-confidence is-normal">通常</span>',
    reference: '<span class="trend-confidence is-reference">参考</span>',
    mixed: '<span class="trend-confidence is-mixed">一部参考</span>',
  };
  return `<section class="trend-section">
    <div class="trend-section-head">
      <h2>時間帯別の合計</h2>
      <span>${unitLabel}</span>
    </div>
    <table class="trend-table">
      <thead><tr><th>時間帯</th><th>扱い</th><th>1号</th><th>2号</th><th>3号</th><th>4号</th><th>計</th></tr></thead>
      <tbody>${rows.map(row => `<tr>
        <td><span class="trend-daypart-name">${row.label}</span><span class="trend-daypart-range">${row.range}</span></td>
        <td>${confidenceByKey[row.confidenceKey] || ''}</td>
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
        <thead><tr><th>時間帯</th><th>扱い</th><th>1号</th><th>2号</th><th>3号</th><th>4号</th><th>計</th></tr></thead>
        <tbody>${bins.map(row => {
          const confidence = movementConfidenceForTime(row.label, row.quality);
          return `<tr>
          <td>${row.label}</td>
          <td><span class="trend-confidence ${confidence.key === 'reference' ? 'is-reference' : 'is-normal'}" title="${confidence.note}">${confidence.shortLabel}</span></td>
          <td>${fmt(row.stall1)}</td>
          <td>${fmt(row.stall2)}</td>
          <td>${fmt(row.stall3)}</td>
          <td>${fmt(row.stall4)}</td>
          <td class="trend-total">${fmt(row.total)}</td>
        </tr>`;
        }).join('')}</tbody>
      </table>
    </div>
  </details>`;
}

function formatGeneratedAt(value) {
  if (!value) return '—';
  return String(value).slice(0, 16).replace('T', ' ');
}

function renderPage(root, data, unit, now = new Date()) {
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
      <span>昼・雨昼は列移動の回数</span>
      <span>夜・雨夜・早朝・画像QC弱は列移動の回数（参考）</span>
      <span>平均は画像計測由来の列移動履歴から算出</span>
    </div>
    ${renderStallCards(summaries, todaySummaries, unitLabel)}
    ${renderTimeline(typicalBins, unitLabel, now)}
    ${renderPoolCameras(now)}
    ${renderDaypartTable(dayparts, unitLabel)}
    ${renderDetailTable(typicalBins, unitLabel)}
  `;
}

export async function initNoribaTrendsPage({
  root = document.getElementById('noriba-trends-root'),
  error = document.getElementById('noriba-trends-error'),
  fetchFn = fetch,
  now = new Date(),
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
    renderPage(root, result.data, unit, now);
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

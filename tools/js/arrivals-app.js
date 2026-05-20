import { loadArrivals, filterByTerminals, filterByTimeWindow, aggregateHeatmapClient, summarizeFlights, detectTopics, sortFlightsByTime, listOriginOptions } from './arrivals-data.js';
import { renderHeatmap, renderFlightList, renderUpdatedAt, renderSummary, renderLegend, renderTopics, renderWeatherBanner } from './arrivals-render.js';
import { initForecastSection } from './forecast-section.js';

const TAB_TERMINALS = {
  'T1': ['T1'],
  'T2': ['T2'],
  'T1T2': ['T1', 'T2'],
  'T3': ['T3']
};

const ORIGIN_FILTER_KEY = 'arrivalsOriginFilter';
const state = { arrivals: null, tab: 'T1T2', detailMode: false, originFilter: '' };
try { state.originFilter = localStorage.getItem(ORIGIN_FILTER_KEY) || ''; } catch { /* ignore */ }

// 予測セクションの再描画関数。initForecastSection 解決後に差し替わる。
// それまでは何もしない（更新ボタンが早く押されてもエラーにしない）。
let refreshForecast = () => {};

async function refresh() {
  const errorEl = document.getElementById('arrivals-error');
  try {
    state.arrivals = await loadArrivals();
    // 成功時はエラーバナーを隠す。一時的な 404 で出たメッセージが残らないように。
    if (errorEl) { errorEl.textContent = ''; errorEl.hidden = true; }
    render();
  } catch (e) {
    if (errorEl) { errorEl.textContent = `データ取得失敗: ${e.message}`; errorEl.hidden = false; }
  }
}

function render() {
  const terminals = TAB_TERMINALS[state.tab] ?? ['T1'];
  const all = filterByTerminals(state.arrivals, terminals);
  const visible = state.detailMode ? all : filterByTimeWindow(all, new Date(), 30, 180);
  const bins = aggregateHeatmapClient(visible);
  const summaryOpts = state.detailMode
    ? { windowHours: 19, windowLabel: '今日全体' }
    : { windowHours: 3.5, windowLabel: '直近3時間' };
  const summary = summarizeFlights(visible, summaryOpts);
  const topics = detectTopics(all);
  // 出発地フィルタ select の options を visible から再構築し、選択中の出発地が
  // 現在の visible に無ければ state.originFilter を '' にリセットする。
  // フィルタ適用前に呼ぶ必要がある（reset を flightsToShow 計算に反映するため）。
  syncOriginFilterOptions(visible);
  const flightsToShow = state.originFilter
    ? visible.filter(f => f.fromName === state.originFilter)
    : visible;
  renderWeatherBanner(document.getElementById('weather-banner'), state.arrivals.weather ?? null);
  renderTopics(document.getElementById('topics'), topics);
  renderSummary(document.getElementById('summary'), summary);
  renderHeatmap(document.getElementById('heatmap'), bins);
  renderFlightList(document.getElementById('flight-list'), sortFlightsByTime(flightsToShow));
  renderUpdatedAt(
    document.getElementById('arrivals-footer'),
    state.arrivals.updatedAt,
    state.arrivals.stats.unknownAircraft
  );
  document.querySelectorAll('.terminal-tab').forEach(el => {
    el.classList.toggle('is-active', el.dataset.terminal === state.tab);
  });
  updateDetailButton();
}

// 出発地フィルタ select の options を visible 便から動的に再構築する。
// 選択中の出発地が現在の visible に無い場合は「すべて」に自動リセット。
function syncOriginFilterOptions(visible) {
  const el = document.getElementById('origin-filter');
  if (!el) return;
  const options = listOriginOptions(visible);
  const allCount = visible.length;
  const previous = state.originFilter;
  const still = options.some(o => o.fromName === previous);
  if (previous && !still) {
    state.originFilter = '';
    try { localStorage.setItem(ORIGIN_FILTER_KEY, ''); } catch { /* ignore */ }
  }
  const opts = [`<option value="">すべて (${allCount}便)</option>`]
    .concat(options.map(o => `<option value="${o.fromName}">${o.fromName} (${o.count}便)</option>`));
  el.innerHTML = opts.join('');
  el.value = state.originFilter;
}

function updateDetailButton() {
  const btn = document.getElementById('detail-toggle');
  if (!btn) return;
  btn.textContent = state.detailMode ? '▲ 直近3時間に戻す' : '▼ 今日の全便を表示';
  btn.classList.toggle('is-active', state.detailMode);
}

function setupTerminalTabs() {
  document.querySelectorAll('.terminal-tab').forEach(el => {
    el.addEventListener('click', () => {
      state.tab = el.dataset.terminal;
      if (state.arrivals) render();
    });
  });
}

function setupReload() {
  const btn = document.getElementById('arrivals-reload');
  if (btn) btn.addEventListener('click', () => {
    refresh();
    refreshForecast();
  });
}

function setupDetailToggle() {
  const btn = document.getElementById('detail-toggle');
  if (!btn) return;
  btn.addEventListener('click', () => {
    state.detailMode = !state.detailMode;
    if (state.arrivals) render();
  });
}

function setupOriginFilter() {
  const el = document.getElementById('origin-filter');
  if (!el) return;
  el.addEventListener('change', () => {
    state.originFilter = el.value;
    try { localStorage.setItem(ORIGIN_FILTER_KEY, state.originFilter); } catch { /* ignore */ }
    if (state.arrivals) render();
  });
}

renderLegend(document.getElementById('legend'));
setupTerminalTabs();
setupReload();
setupDetailToggle();
setupOriginFilter();
refresh();
initForecastSection().then(fn => { if (fn) refreshForecast = fn; });
setInterval(() => { refresh(); refreshForecast(); }, 60000);

import { loadArrivals, loadPoolNotice, filterByTerminals, filterByTimeWindow, filterByLane, aggregateHeatmapClient, summarizeFlights, detectTopics, buildDelayLaneGuide, sortFlightsByTime, listOriginOptions, buildNoribaActivity, detectArrivalGap, applyNoticeOverrides, buildLaneNoticeMap, loadLanePatterns, applyLaneActuals, splitOvernight, loadArrivalDays, loadArrivalsForDay, resolveViewDay, shiftDay, formatDayLabel, dataDayOf, dayNavRange } from './arrivals-data.js';
import { renderHeatmap, renderFlightList, renderUpdatedAt, renderSummary, renderLegend, renderDelayLaneGuide, renderWeatherBanner, renderPoolNotice, renderNoribaActivity, renderArrivalGap, renderCarriedOver, renderDaySummary } from './arrivals-render.js';
import { initForecastSection, loadAdvanceForecast } from './forecast-section.js';
import { initPoolStatusSection, initForecastSectionToggle, loadPoolStatus } from './pool-status-section.js';

const TAB_TERMINALS = {
  'T1': ['T1'],
  'T2': ['T2'],
  'T1T2': ['T1', 'T2'],
  'T3': ['T3']
};

const ORIGIN_FILTER_KEY = 'arrivalsOriginFilter';
const NORIBA_WINDOW_KEY = 'arrivalsNoribaWindow';
const LANE_FILTER_KEY = 'arrivalsLaneFilter';
// 「さっき着いた便」の畳みを開いたままにしておくか（本人が開いたらそのまま）
const CARRIED_OPEN_KEY = 'arrivalsCarriedOpen';
// viewDay: 見ている日 'YYYY-MM-DD'。null なら最新ファイルの日付に従う。
// isLive: いま画面に出ているのが最新ファイルそのものか(＝過去のスナップショットでない)。
const state = { arrivals: null, tab: 'T1T2', detailMode: false, originFilter: '', noribaWindow: 60, laneFilter: 0,
  viewDay: null, isLive: true, isToday: true, availableDays: [], liveDay: null };
try { state.originFilter = localStorage.getItem(ORIGIN_FILTER_KEY) || ''; } catch { /* ignore */ }
try { const l = parseInt(localStorage.getItem(LANE_FILTER_KEY), 10); if ([1, 2, 3, 4].includes(l)) state.laneFilter = l; } catch { /* ignore */ }
try { const w = parseInt(localStorage.getItem(NORIBA_WINDOW_KEY), 10); if ([30, 60, 120].includes(w)) state.noribaWindow = w; } catch { /* ignore */ }

// 予測セクションの再描画関数。initForecastSection 解決後に差し替わる。
// それまでは何もしない（更新ボタンが早く押されてもエラーにしない）。
let refreshForecast = () => {};

async function refresh() {
  const errorEl = document.getElementById('arrivals-error');
  try {
    const live = await loadArrivals();
    state.availableDays = (await loadArrivalDays()).days;
    // どの日を見るか。指定が無ければ最新ファイル自身の日付(0時過ぎは前日のまま来る)。
    // 最新ファイルの日。過去日を見ている間も保持し、"今日へ戻る" の上限に使う。
    state.liveDay = dataDayOf(live);
    const view = resolveViewDay({ data: live, requested: state.viewDay, now: new Date() });
    state.viewDay = view.day;
    state.isLive = view.isLive;
    state.isToday = view.isToday;
    state.arrivals = view.isLive ? live : await loadArrivalsForDay(view.day);

    // 現地掲示・列パターン・予測・プール現況は「いま」の情報。
    // 過去の日を見ているときに重ねると、その日の記録に今の状況が混ざるので付けない。
    if (state.isLive) {
      state.poolNotice = await loadPoolNotice();
      // 現地掲示(lateFlights)の実数で深夜遅延便の人数・号を上書き(現地確定が正)
      applyNoticeOverrides(state.arrivals?.flights ?? [], state.poolNotice?.lateFlights ?? null);
      // 過去の掲示から学習した「実際に着いた号」を付ける(今夜の掲示がある便は上書きしない)
      state.lanePatterns = await loadLanePatterns();
      applyLaneActuals(state.arrivals?.flights ?? [], state.lanePatterns);
      state.forecast = (await loadAdvanceForecast()).data;
      state.poolStatus = (await loadPoolStatus()).data;
    } else {
      state.poolNotice = null;
      state.forecast = null;
      state.poolStatus = null;
    }
    // 成功時はエラーバナーを隠す。一時的な 404 で出たメッセージが残らないように。
    if (errorEl) { errorEl.textContent = ''; errorEl.hidden = true; }
    render();
  } catch (e) {
    if (errorEl) { errorEl.textContent = `データ取得失敗: ${e.message}`; errorEl.hidden = false; }
  }
}

// 見ている日のバー。深夜0時を過ぎるとデータは前日のまま来るので、常に日付を出す。
function renderDayBar() {
  const bar = document.getElementById('day-bar');
  const label = document.getElementById('day-label');
  const note = document.getElementById('day-note');
  const prev = document.getElementById('day-prev');
  const next = document.getElementById('day-next');
  if (!bar || !label) return;

  const now = new Date();
  label.textContent = formatDayLabel(state.viewDay, now);
  bar.classList.toggle('is-past', !state.isLive);

  if (state.isLive && !state.isToday) {
    // 0時を過ぎたが今日ぶんがまだ配信されていない状態。ここを黙っていると
    // 前日の早朝便が「これから来る便」に見えてしまう。
    note.textContent = '今日ぶんはまだ配信されていません（表示は前日の記録）';
    note.classList.add('warn');
  } else if (!state.isLive) {
    note.textContent = 'この日の記録（乗り場の状況・予測は出ません）';
    note.classList.remove('warn');
  } else {
    const u = state.arrivals?.updatedAt;
    note.textContent = u ? `${new Date(u).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })} 時点` : '';
    note.classList.remove('warn');
  }

  // 動ける範囲: 保存してある日 + 最新ファイルの日。
  // 上限は state.liveDay(最新ファイルの日)で決める。過去日を見ている間もこれは
  // 変わらないので、いつでも今日へ戻れる。
  const nav = dayNavRange({ availableDays: state.availableDays, liveDay: state.liveDay, viewDay: state.viewDay });
  if (prev) prev.disabled = !nav.canPrev;
  if (next) next.disabled = !nav.canNext;
}

async function goDay(delta) {
  const target = shiftDay(state.viewDay, delta);
  state.viewDay = target;
  await refresh();
}

function render() {
  renderDayBar();
  const terminals = TAB_TERMINALS[state.tab] ?? ['T1'];
  const all = filterByTerminals(state.arrivals, terminals);
  // 過去の日はその日の全便を出す。「直近3時間」は"いま"を基準にした窓なので、
  // 過去日に当てても意味がない(何も出ないか、たまたま今の時刻の便だけになる)。
  const visible = (state.detailMode || !state.isLive) ? all : filterByTimeWindow(all, new Date(), 30, 180);
  const bins = aggregateHeatmapClient(visible);
  // 過去の日は全便を出しているので、集計も「その日全体」で見せる。
  // ここを「直近3時間」のままにすると、日全体の人数を3.5で割った時間あたりが出て数字が狂う。
  const summaryOpts = !state.isLive
    ? { windowHours: 19, windowLabel: 'この日全体' }
    : state.detailMode
      ? { windowHours: 19, windowLabel: '今日全体' }
      : { windowHours: 3.5, windowLabel: '直近3時間' };
  const summary = summarizeFlights(visible, summaryOpts);
  const nowT = new Date();
  // 遅延便の号ガイドはタブに依存させない(号1〜4はT1/T2をまたぐ。上の「乗り場の状況」と同じ扱い)
  const topics = detectTopics(state.arrivals.flights, nowT.getHours() * 60 + nowT.getMinutes(), { includeNotice: true });
  // 出発地フィルタ select の options を visible から再構築し、選択中の出発地が
  // 現在の visible に無ければ state.originFilter を '' にリセットする。
  // フィルタ適用前に呼ぶ必要がある（reset を flightsToShow 計算に反映するため）。
  syncOriginFilterOptions(visible);
  const originFiltered = state.originFilter
    ? visible.filter(f => f.fromName === state.originFilter)
    : visible;
  // 号(poolLane 1-4)で絞り込み。0=全部。
  const flightsToShow = filterByLane(originFiltered, state.laneFilter);
  updateLaneButtons();
  renderPoolNotice(document.getElementById('pool-notice-banner'), state.poolNotice ?? null);
  renderWeatherBanner(document.getElementById('weather-banner'), state.arrivals.weather ?? null);

  // 「これから来る便」「いまの混み具合」を出すカードは、過去の日には当てはまらない。
  // 過去日を見ているときは畳んで、その日の記録(便リスト・時間帯別・集計)だけ見せる。
  setLiveOnlySectionsVisible(state.isLive);
  if (state.isLive) { const ds = document.getElementById('day-summary'); if (ds) { ds.hidden = true; ds.innerHTML = ''; } }
  if (!state.isLive) {
    // その日どうだったか(遅れ・配車業務の終了時刻)。過去日にだけ意味がある。
    renderDaySummary(document.getElementById('day-summary'), state.arrivals.summary ?? null);
    renderSummary(document.getElementById('summary'), summary);
    renderHeatmap(document.getElementById('heatmap'), bins);
    renderFlightList(document.getElementById('flight-list'), sortFlightsByTime(flightsToShow));
    renderUpdatedAt(
      document.getElementById('arrivals-footer'),
      state.arrivals.updatedAt,
      state.arrivals.stats?.unknownAircraft
    );
    document.querySelectorAll('.terminal-tab').forEach(el => {
      el.classList.toggle('is-active', el.dataset.terminal === state.tab);
    });
    updateDetailButton();
    return;
  }

  // 深夜: 前日から持ち越した便を最上部に。0時を過ぎるとこれが一番要る情報。
  renderCarriedOver(document.getElementById("carried-over"), splitOvernight(state.arrivals.flights, new Date()), new Date(), { open: readCarriedOpen() });
  // 乗り場別 到着見込み(全ターミナル横断・タブに依存しない)
  const noribaActs = buildNoribaActivity(state.arrivals, state.forecast ?? null, state.poolStatus ?? null, new Date());
  {
    const laneNotice = buildLaneNoticeMap(state.poolNotice?.lateFlights ?? null);
    for (const a of noribaActs) a.notice = laneNotice[a.lane] ?? null;
  }
  renderNoribaActivity(
    document.getElementById('noriba-cards-section'),
    noribaActs,
    { updatedLabel: (state.arrivals && state.arrivals.updatedAt) ? new Date(state.arrivals.updatedAt).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }) : '' }
  );
  // 到着の谷間/手薄(遅延込みのロビー出が減る時間帯)。タブ非依存・全便で判定。
  const nowD = new Date();
  renderArrivalGap(
    document.getElementById('arrival-gap'),
    detectArrivalGap(state.arrivals.flights, nowD.getHours() * 60 + nowD.getMinutes())
  );
  renderDelayLaneGuide(document.getElementById('topics'), buildDelayLaneGuide(topics, state.poolStatus ?? null, { nowMinutes: nowT.getHours() * 60 + nowT.getMinutes() }));
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

// 「いま」に依存するセクションの出し入れ。過去の日を見ているときは隠す。
// (乗り場の状況・到着の谷間・遅延便ガイド・プール現況/列移動・現地掲示)
function setLiveOnlySectionsVisible(show) {
  for (const id of ['carried-over', 'noriba-cards-section', 'arrival-gap', 'topics', 'forecast-section', 'pool-notice-banner']) {
    const el = document.getElementById(id);
    if (!el) continue;
    if (show) {
      el.style.removeProperty('display');
    } else {
      el.style.display = 'none';
    }
  }
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
  // 過去の日は最初から全便を出しているので、この切り替えは効かない。隠す。
  if (state.isLive) btn.style.removeProperty('display');
  else { btn.style.display = 'none'; return; }
  btn.textContent = state.detailMode ? '▲ 直近3時間に戻す' : '▼ 今日の全便を表示';
  btn.classList.toggle('is-active', state.detailMode);
}

// 号フィルタの active ボタン表示を state に合わせる。
function updateLaneButtons() {
  document.querySelectorAll('#lane-filter .lane-btn').forEach(el => {
    el.classList.toggle('is-active', parseInt(el.dataset.lane, 10) === state.laneFilter);
  });
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
    // 更新ボタンは「いまの最新」に戻す。過去日を見たまま更新を押して
    // 何も変わらない、という迷いをなくす。
    state.viewDay = null;
    refresh();
    refreshForecast();
  });
}

function readCarriedOpen() {
  try { return localStorage.getItem(CARRIED_OPEN_KEY) === '1'; } catch { return false; }
}

// 畳みを開け閉めしたら覚える（描き直しても同じ状態で出す）
function setupCarriedFold() {
  const box = document.getElementById('carried-over');
  if (!box) return;
  box.addEventListener('toggle', (e) => {
    const d = e.target;
    if (!d || d.tagName !== 'DETAILS') return;
    try { localStorage.setItem(CARRIED_OPEN_KEY, d.open ? '1' : '0'); } catch { /* 無視 */ }
  }, true);   // toggle は伝播しないので capture で拾う
}

function setupDayNav() {
  const prev = document.getElementById('day-prev');
  const next = document.getElementById('day-next');
  if (prev) prev.addEventListener('click', () => { if (!prev.disabled) goDay(-1); });
  if (next) next.addEventListener('click', () => { if (!next.disabled) goDay(+1); });
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

function setupLaneFilter() {
  const el = document.getElementById('lane-filter');
  if (!el) return;
  el.addEventListener('click', (e) => {
    const btn = e.target.closest('.lane-btn');
    if (!btn) return;
    const lane = parseInt(btn.dataset.lane, 10);
    if (![0, 1, 2, 3, 4].includes(lane)) return;
    state.laneFilter = lane;
    try { localStorage.setItem(LANE_FILTER_KEY, String(lane)); } catch { /* ignore */ }
    if (state.arrivals) render();
  });
}

function setupNoribaWindow() {
  const el = document.getElementById('noriba-cards-section');
  if (!el) return;
  el.addEventListener('click', (e) => {
    const btn = e.target.closest('.ncw-btn');
    if (!btn) return;
    const w = parseInt(btn.dataset.win, 10);
    if (![30, 60, 120].includes(w)) return;
    state.noribaWindow = w;
    try { localStorage.setItem(NORIBA_WINDOW_KEY, String(w)); } catch { /* ignore */ }
    if (state.arrivals) render();
  });
}

renderLegend(document.getElementById('legend'));
setupTerminalTabs();
setupReload();
setupDayNav();
setupCarriedFold();
setupDetailToggle();
setupOriginFilter();
setupLaneFilter();
setupNoribaWindow();
refresh();
initForecastSection().then(fn => { if (fn) refreshForecast = fn; });
initForecastSectionToggle();
let refreshPoolStatus = () => {};
initPoolStatusSection().then(fn => { if (fn) refreshPoolStatus = fn; });
// 過去の日を見ている間は、いまの予測やプール現況を取りに行かない(画面にも出ていない)。
setInterval(() => {
  refresh();
  if (state.isLive) { refreshForecast(); refreshPoolStatus(); }
}, 60000);

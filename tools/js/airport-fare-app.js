import { loadFares, loadWardShapes, findAreasByQuery, lookupArea } from './airport-fare-data.js';
import { renderFareMap } from './airport-fare-map.js';
import { renderFareCard } from './airport-fare-card.js';

const $ = id => document.getElementById(id);

export async function initAirportFare() {
  const errEl = $('fare-error');
  let data, shapes;
  try {
    [data, shapes] = await Promise.all([loadFares(), loadWardShapes()]);
  } catch (e) {
    errEl.hidden = false;
    errEl.textContent = '料金データの読み込みに失敗しました: ' + e.message;
    return;
  }
  const areas = data.areas;

  // 検索サジェスト（datalist）に全エリア名を投入
  const list = $('fare-area-list');
  list.innerHTML = areas.map(a => `<option value="${a.name}"></option>`).join('');

  const cardEl = $('fare-card-host');
  renderFareCard(cardEl, null);

  function show(key) {
    const area = lookupArea(areas, key);
    if (area) renderFareCard(cardEl, area, new Date());
  }

  const map = renderFareMap($('fare-map-host'), areas, shapes, show);

  // 検索: 入力が区名に一致したら地図選択＋カード表示
  const input = $('fare-search');
  input.addEventListener('change', () => {
    const matches = findAreasByQuery(areas, input.value);
    const exact = matches.find(a => a.name === input.value.trim()) || matches[0];
    if (exact) { map.select(exact.key); show(exact.key); }
  });
}

// arrivals-app.js と同じく、モジュール読込時に自己初期化（HTML は <script src> でロード）。
initAirportFare();

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
  const mapHost = $('fare-map-host');
  const popup = $('fare-popup');
  renderFareCard(cardEl, null);

  function hidePopup() {
    popup.hidden = true;
    popup.classList.remove('is-show');
  }

  // タップした区のすぐ脇にポップアップを置く（上に入らなければ下、画面端でクランプ）。
  function positionPopup(key) {
    const el = mapHost.querySelector(`.fare-area[data-area="${key}"] path`);
    if (!el) return;
    const r = el.getBoundingClientRect();
    const pw = popup.offsetWidth || 230;
    const ph = popup.offsetHeight || 160;
    let left = r.left + r.width / 2 - pw / 2;
    let top = r.top - ph - 10;
    if (top < 8) top = r.bottom + 10;
    left = Math.max(8, Math.min(left, window.innerWidth - pw - 8));
    top = Math.max(8, Math.min(top, window.innerHeight - ph - 8));
    popup.style.left = left + 'px';
    popup.style.top = top + 'px';
  }

  function showPopup(area, key) {
    renderFareCard(popup, area, new Date());
    const close = document.createElement('span');
    close.className = 'pop-close';
    close.textContent = '×';
    close.setAttribute('role', 'button');
    close.setAttribute('aria-label', '閉じる');
    close.addEventListener('click', (e) => { e.stopPropagation(); hidePopup(); });
    popup.appendChild(close);
    popup.hidden = false;
    popup.classList.remove('is-show');
    void popup.offsetWidth; // アニメ再生のためリフロー
    popup.classList.add('is-show');
    positionPopup(key);
  }

  function show(key) {
    const area = lookupArea(areas, key);
    if (!area) return;
    renderFareCard(cardEl, area, new Date()); // 下のカードも同期（スクロールで全体も読める）
    showPopup(area, key);
  }

  const map = renderFareMap(mapHost, areas, shapes, show);

  // 検索: 入力が区名に一致したら地図選択＋カード＋ポップアップ表示
  const input = $('fare-search');
  input.addEventListener('change', () => {
    const matches = findAreasByQuery(areas, input.value);
    const exact = matches.find(a => a.name === input.value.trim()) || matches[0];
    if (exact) { map.select(exact.key); show(exact.key); }
  });

  // 区・ポップアップの外をタップしたら閉じる。スクロール/リサイズでも閉じる（位置ズレ防止）。
  document.addEventListener('click', (e) => {
    if (popup.hidden) return;
    if (popup.contains(e.target)) return;
    if (e.target.closest && e.target.closest('.fare-area')) return; // 区タップは show() 側で処理
    hidePopup();
  });
  window.addEventListener('scroll', hidePopup, { passive: true });
  window.addEventListener('resize', hidePopup);
}

// arrivals-app.js と同じく、モジュール読込時に自己初期化（HTML は <script src> でロード）。
initAirportFare();

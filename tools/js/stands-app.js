// tools/js/stands-app.js — 起動・会社解決・閲覧/編集切替（アダプタ）
import { createStandsMap, renderPins, drawRoute, clearLayer } from './stands-map.js';
import { loadStands, getMyCompanyId, getIsAdmin } from './stands-data.js';
import { createGeoWatcher } from './geo.js';
import { findNearestStands } from './stands-geo.js';
import { waitForAuth } from '../../js/firebase-auth.js';

const sheet = document.getElementById('stand-sheet');
const sheetName = document.getElementById('sheet-name');
const sheetNotes = document.getElementById('sheet-notes');
const sheetImages = document.getElementById('sheet-images');
const imgOverlay = document.getElementById('img-overlay');
const imgOverlayImg = document.getElementById('img-overlay-img');
document.getElementById('sheet-close').addEventListener('click', () => sheet.classList.remove('open'));
document.getElementById('img-overlay-close').addEventListener('click', () => imgOverlay.classList.remove('open'));
imgOverlay.addEventListener('click', (e) => { if (e.target === imgOverlay) imgOverlay.classList.remove('open'); });

function openImage(src) {
  imgOverlayImg.src = src;
  imgOverlay.classList.add('open');
  imgOverlay.scrollTop = 0;
}

let map, routeLayer = null;
let allStands = [];
let myPos = null;

const CAT_LABEL = { office: 'オフィス', hotel: 'ホテル', hospital: '病院', commercial: '商業', other: 'その他' };
const searchInput = document.getElementById('search-input');
const searchNear = document.getElementById('search-near');
const searchResults = document.getElementById('search-results');

function selectStand(stand) {
  if (stand.pin) map.setView([stand.pin.lat, stand.pin.lng], 18);
  showStand(stand);
  searchResults.classList.remove('open');
  searchInput.blur();
}

function renderResults(items) {
  if (!items.length) {
    searchResults.innerHTML = '<div class="empty">該当する施設がありません</div>';
    searchResults.classList.add('open');
    return;
  }
  searchResults.innerHTML = '';
  items.forEach(({ stand, distKm }) => {
    const d = document.createElement('div');
    d.className = 'r';
    const dist = (distKm != null) ? `<span class="dist">${distKm.toFixed(1)}km</span>` : '';
    d.innerHTML = `${dist}${stand.name}<span class="cat">${CAT_LABEL[stand.category] || ''}</span>`;
    d.addEventListener('click', () => selectStand(stand));
    searchResults.appendChild(d);
  });
  searchResults.classList.add('open');
}

function doTextSearch(q) {
  const query = (q || '').trim().toLowerCase();
  if (!query) { searchResults.classList.remove('open'); return; }
  const items = allStands
    .filter((s) => `${s.name} ${CAT_LABEL[s.category] || ''}`.toLowerCase().includes(query))
    .slice(0, 30)
    .map((s) => ({ stand: s }));
  renderResults(items);
}

if (searchInput) searchInput.addEventListener('input', () => doTextSearch(searchInput.value));
if (searchNear) searchNear.addEventListener('click', () => {
  if (!myPos) { alert('現在地が取得できていません。GPSを許可して少し待ってからお試しください。'); return; }
  if (searchInput) searchInput.value = '';
  renderResults(findNearestStands(myPos, allStands, 10));
});

const TURN_BADGE = { 'left-only': '左折のみ', 'right-ok': '右折可', either: '' };
// stands-map.js の APPROACH_PALETTE と同一に保つこと
const APPROACH_PALETTE = ['#1976d2', '#7b1fa2', '#388e3c', '#e64a19', '#0097a7', '#c2185b'];
function escapeHtml(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }
function buildApproachCard(stand) {
  const approaches = stand.approaches || [];
  const cautions = stand.cautions || [];
  if (!approaches.length && !cautions.length) return '';
  let html = '<div class="entry-card">';
  if (approaches.length) {
    const multi = approaches.length > 1 ? ' <span class="entry-hint">（タップで1ルートずつ表示）</span>' : '';
    html += `<div class="entry-card-h">入口ガイド${multi}</div><ul class="entry-list">`;
    approaches.forEach((a, idx) => {
      const color = APPROACH_PALETTE[idx % APPROACH_PALETTE.length];
      const swatch = `<span class="approach-swatch" style="display:inline-block;width:12px;height:12px;border-radius:6px;background:${color};margin-right:6px;vertical-align:middle"></span>`;
      const badge = TURN_BADGE[a.turn] ? `<span class="turn-badge t-${a.turn}">${TURN_BADGE[a.turn]}</span>` : '';
      const road = a.road ? `<span class="road">${escapeHtml(a.road)}</span> ` : '';
      const hint = a.hint ? `<div class="hint">${escapeHtml(a.hint)}</div>` : '';
      html += `<li class="appr-item" data-idx="${idx}" role="button" tabindex="0">${swatch}${badge}${road}<b>${escapeHtml(a.label || '')}</b>${hint}</li>`;
    });
    html += '</ul>';
  }
  if (cautions.length) {
    html += '<div class="entry-card-h sub">注意事項</div><ul class="cautions">';
    cautions.forEach((c) => { html += `<li>${escapeHtml(c)}</li>`; });
    html += '</ul>';
  }
  html += '</div>';
  return html;
}

function showStand(stand) {
  window.__activeStand = stand; // 編集モードで「タップした施設」を編集対象に引き継ぐため
  sheetName.textContent = stand.name;
  const card = buildApproachCard(stand);
  if (card) {
    sheetNotes.innerHTML = card + (stand.notes ? `<div class="raw-notes">${escapeHtml(stand.notes)}</div>` : '');
  } else {
    sheetNotes.textContent = stand.notes || '（注意事項は未登録）';
  }
  // 組合の道順図（PDF画像）を表示。タップで全画面拡大。
  sheetImages.innerHTML = '';
  (stand.images || []).forEach((file) => {
    const img = document.createElement('img');
    img.src = `data/stands-ref/${file}`;
    img.alt = `${stand.name} 道順図`;
    img.loading = 'lazy';
    img.addEventListener('click', () => openImage(img.src));
    sheetImages.appendChild(img);
  });
  sheet.classList.add('open');
  // 既定は最初の「線を持つ」approach を1本だけ強調表示（1件ずつ）。
  const firstWithLine = (stand.approaches || []).findIndex((a) => Array.isArray(a.line) && a.line.length >= 2);
  let activeIdx = firstWithLine >= 0 ? firstWithLine : null;
  clearLayer(map, routeLayer);
  routeLayer = drawRoute(map, stand, { activeIdx });
  // カード項目タップ/Enterで該当ルートだけに切替・強調。
  const items = sheetNotes.querySelectorAll('.entry-list .appr-item');
  const syncActive = (idx) => items.forEach((el) => el.classList.toggle('is-active', Number(el.dataset.idx) === idx));
  const setActive = (idx) => {
    activeIdx = idx;
    syncActive(idx);
    clearLayer(map, routeLayer);
    routeLayer = drawRoute(map, stand, { activeIdx: idx });
  };
  items.forEach((el) => {
    el.addEventListener('click', () => setActive(Number(el.dataset.idx)));
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setActive(Number(el.dataset.idx)); }
    });
  });
  if (activeIdx != null) syncActive(activeIdx);
}

async function main() {
  map = createStandsMap('stands-map');
  window.__standsMap = map; // 作図補助フック（座標取得・参照用）

  // Firebase auth は非同期復元。currentUser が確定するまで待ってから会社を解決する。
  await waitForAuth();
  const isAdmin = await getIsAdmin();
  let companyId = await getMyCompanyId();
  // 管理者は ?company=<slug> で対象会社を指定できる（自分が会社未所属でも閲覧/編集可。rulesでadminは全社read/write）。
  const override = new URLSearchParams(location.search).get('company');
  if (isAdmin && override) companyId = override;

  if (!companyId) {
    sheetName.textContent = '利用できません';
    sheetNotes.textContent = isAdmin
      ? '管理者として開くには URL に ?company=<会社slug> を付けてください（例: ?company=co-7q7ros）。'
      : 'この機能は所属会社が登録されたユーザー向けです。';
    sheet.classList.add('open');
    return;
  }

  let stands = [];
  try {
    stands = await loadStands(companyId);
  } catch (e) {
    console.error('loadStands failed', e);
    sheetName.textContent = '読み込みエラー';
    sheetNotes.textContent = 'データを取得できませんでした。通信状況をご確認ください。';
    sheet.classList.add('open');
    return;
  }
  window.__standsCount = stands.length; // smoke 検証用
  allStands = stands;
  renderPins(map, stands, showStand);
  map.on('click', () => searchResults.classList.remove('open'));

  // GPS 現在地（任意・既存パターン）
  const watcher = createGeoWatcher({
    onUpdate: (pos) => {
      myPos = pos;
      if (window.__meMarker) map.removeLayer(window.__meMarker);
      window.__meMarker = L.circleMarker([pos.lat, pos.lng], { radius: 6, color: '#3498db', fillOpacity: 0.9 }).addTo(map);
    },
  });
  watcher.start();

  // 管理者なら編集モードを動的ロード
  if (isAdmin) {
    document.getElementById('stands-editbar').classList.add('show');
    const { initEditor } = await import('./stands-editor.js');
    initEditor({ map, companyId, stands });
  }
}

main();

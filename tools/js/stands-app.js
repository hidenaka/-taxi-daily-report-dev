// tools/js/stands-app.js — 起動・会社解決・閲覧/編集切替（アダプタ）
import { createStandsMap, renderPins, drawRoute, clearLayer } from './stands-map.js';
import { loadStands, getMyCompanyId, getIsAdmin } from './stands-data.js';
import { createGeoWatcher } from './geo.js';

const sheet = document.getElementById('stand-sheet');
const sheetName = document.getElementById('sheet-name');
const sheetNotes = document.getElementById('sheet-notes');
document.getElementById('sheet-close').addEventListener('click', () => sheet.classList.remove('open'));

let map, routeLayer = null;

function showStand(stand) {
  sheetName.textContent = stand.name;
  sheetNotes.textContent = stand.notes || '（注意事項は未登録）';
  sheet.classList.add('open');
  clearLayer(map, routeLayer);
  routeLayer = drawRoute(map, stand);
}

async function main() {
  map = createStandsMap('stands-map');

  const companyId = await getMyCompanyId();
  if (!companyId) {
    sheetName.textContent = '利用できません';
    sheetNotes.textContent = 'この機能は所属会社が登録されたユーザー向けです。';
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
  renderPins(map, stands, showStand);

  // GPS 現在地（任意・既存パターン）
  const watcher = createGeoWatcher({
    onUpdate: (pos) => {
      if (window.__meMarker) map.removeLayer(window.__meMarker);
      window.__meMarker = L.circleMarker([pos.lat, pos.lng], { radius: 6, color: '#3498db', fillOpacity: 0.9 }).addTo(map);
    },
  });
  watcher.start();

  // 管理者なら編集モードを動的ロード
  if (await getIsAdmin()) {
    document.getElementById('stands-editbar').classList.add('show');
    const { initEditor } = await import('./stands-editor.js');
    initEditor({ map, companyId, stands });
  }
}

main();

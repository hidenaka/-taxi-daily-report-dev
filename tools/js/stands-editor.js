// tools/js/stands-editor.js — 管理者用 描画エディタ（アダプタ）
import { saveStand, deleteStand } from './stands-data.js';

// 編集状態: 1施設ずつ。ピン1つ＋ルート点列（1本）＋notes。
export function initEditor(ctx) {
  const { map, companyId } = ctx;
  const bar = document.getElementById('stands-editbar');
  let editing = false;
  let pinMarker = null;
  let routePts = [];
  let routeLine = null;
  let current = null; // 編集中の既存 stand（新規は null）

  const btnToggle = document.getElementById('ed-toggle');

  // 追加ボタン群を生成
  const btnNew = mkBtn('＋ 新規施設');
  const btnPin = mkBtn('📍 ピン配置');
  const btnRoute = mkBtn('〰 ルート描画');
  const btnUndo = mkBtn('↩ 1点戻す');
  const btnSave = mkBtn('💾 保存');
  const btnCancel = mkBtn('✖ やめる');
  [btnNew, btnPin, btnRoute, btnUndo, btnSave, btnCancel].forEach((b) => { b.style.display = 'none'; bar.appendChild(b); });

  function mkBtn(label) { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; return b; }
  function setEditButtons(on) { [btnNew, btnPin, btnRoute, btnUndo, btnSave, btnCancel].forEach((b) => { b.style.display = on ? '' : 'none'; }); }

  btnToggle.addEventListener('click', () => {
    editing = !editing;
    btnToggle.textContent = editing ? '👁 閲覧モード' : '✏️ 編集モード';
    setEditButtons(editing);
    if (!editing) resetDraft();
  });

  let mode = null; // 'pin' | 'route' | null
  btnNew.addEventListener('click', () => { resetDraft(); current = null; alert('新規施設: 「ピン配置」で乗り場を置き、「ルート描画」で線を引いて保存'); });
  btnPin.addEventListener('click', () => { mode = 'pin'; });
  btnRoute.addEventListener('click', () => { mode = 'route'; });
  btnUndo.addEventListener('click', () => {
    if (routePts.length) { routePts.pop(); redrawRoute(); }
  });

  map.on('click', (e) => {
    if (!editing || !mode) return;
    const { lat, lng } = e.latlng;
    if (mode === 'pin') {
      if (pinMarker) map.removeLayer(pinMarker);
      pinMarker = L.marker([lat, lng], { draggable: true }).addTo(map);
    } else if (mode === 'route') {
      routePts.push({ lat, lng });
      redrawRoute();
    }
  });

  function redrawRoute() {
    if (routeLine) map.removeLayer(routeLine);
    if (routePts.length >= 2) {
      routeLine = L.polyline(routePts.map((p) => [p.lat, p.lng]), { color: '#ffd400', weight: 5, dashArray: '6' }).addTo(map);
    }
  }

  btnSave.addEventListener('click', async () => {
    if (!pinMarker) { alert('ピンを配置してください'); return; }
    const name = prompt('施設名', current ? current.name : '');
    if (!name) return;
    const notes = prompt('注意事項（自由文）', current ? current.notes : '') || '';
    const ll = pinMarker.getLatLng();
    const stand = {
      id: current ? current.id : undefined,
      name,
      category: current ? current.category : 'other',
      pin: { lat: ll.lat, lng: ll.lng },
      routes: routePts.length >= 2 ? [{ points: routePts.slice(), label: '進入', kind: 'approach' }] : [],
      notes,
      sourcePdf: current ? current.sourcePdf : '',
    };
    try {
      const id = await saveStand(companyId, stand);
      alert('保存しました: ' + id);
      location.reload(); // 反映を確実に（ピン再描画）
    } catch (e) {
      alert('保存に失敗: ' + e.message);
    }
  });

  btnCancel.addEventListener('click', resetDraft);

  function resetDraft() {
    mode = null;
    if (pinMarker) { map.removeLayer(pinMarker); pinMarker = null; }
    if (routeLine) { map.removeLayer(routeLine); routeLine = null; }
    routePts = [];
    current = null;
  }
}

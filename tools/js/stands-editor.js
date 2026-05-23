// tools/js/stands-editor.js — 管理者用 描画エディタ（アダプタ）
import { saveStand, deleteStand } from './stands-data.js';

// 編集状態: 1施設ずつ。ピン1つ＋ルート点列（1本）＋notes。
// 既存施設は select で選んで読み込み、その場で編集（保存は同じ id を上書き）。
export function initEditor(ctx) {
  const { map, companyId, stands = [] } = ctx;
  const bar = document.getElementById('stands-editbar');
  let editing = false;
  let mode = null; // 'pin' | 'route' | null
  let pinMarker = null;
  let routePts = [];
  let routeLine = null;
  let current = null; // 編集中の既存 stand（新規は null）

  const btnToggle = document.getElementById('ed-toggle');

  function mkBtn(label) { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; return b; }

  // 新規 or 既存施設の選択
  const pick = document.createElement('select');
  pick.id = 'ed-pick';
  pick.innerHTML = '<option value="">＋ 新規施設</option>'
    + stands.map((s) => `<option value="${s.id}">${s.name}</option>`).join('');

  const btnPin = mkBtn('📍 ピン配置');
  const btnRoute = mkBtn('〰 ルート描画');
  const btnUndo = mkBtn('↩ 1点戻す');
  const btnSave = mkBtn('💾 保存');
  const btnDelete = mkBtn('🗑 削除');
  const btnCancel = mkBtn('✖ やめる');
  const controls = [pick, btnPin, btnRoute, btnUndo, btnSave, btnDelete, btnCancel];
  controls.forEach((b) => { b.style.display = 'none'; bar.appendChild(b); });

  function setEditButtons(on) { controls.forEach((b) => { b.style.display = on ? '' : 'none'; }); }

  btnToggle.addEventListener('click', () => {
    editing = !editing;
    btnToggle.textContent = editing ? '👁 閲覧モード' : '✏️ 編集モード';
    setEditButtons(editing);
    if (!editing) resetDraft();
  });

  // 既存施設を選んでドラフトに読み込む（その場編集→保存で上書き）
  pick.addEventListener('change', () => {
    resetDraftKeepPick();
    const id = pick.value;
    if (!id) { current = null; return; }
    const s = stands.find((x) => x.id === id);
    if (!s) return;
    current = s;
    if (s.pin) {
      pinMarker = L.marker([s.pin.lat, s.pin.lng], { draggable: true }).addTo(map);
      map.setView([s.pin.lat, s.pin.lng], 18);
    }
    const firstRoute = (s.routes || [])[0];
    routePts = firstRoute && Array.isArray(firstRoute.points)
      ? firstRoute.points.map((p) => ({ lat: p.lat, lng: p.lng })) : [];
    redrawRoute();
  });

  btnPin.addEventListener('click', () => { mode = 'pin'; });
  btnRoute.addEventListener('click', () => { mode = 'route'; });
  btnUndo.addEventListener('click', () => { if (routePts.length) { routePts.pop(); redrawRoute(); } });

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
    if (routeLine) { map.removeLayer(routeLine); routeLine = null; }
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
      location.reload();
    } catch (e) {
      alert('保存に失敗: ' + e.message);
    }
  });

  btnDelete.addEventListener('click', async () => {
    if (!current) { alert('削除する既存施設を選んでください'); return; }
    if (!confirm(`「${current.name}」を削除しますか？`)) return;
    try {
      await deleteStand(companyId, current.id);
      alert('削除しました');
      location.reload();
    } catch (e) {
      alert('削除に失敗: ' + e.message);
    }
  });

  btnCancel.addEventListener('click', () => { resetDraft(); });

  function resetDraftKeepPick() {
    mode = null;
    if (pinMarker) { map.removeLayer(pinMarker); pinMarker = null; }
    if (routeLine) { map.removeLayer(routeLine); routeLine = null; }
    routePts = [];
  }
  function resetDraft() {
    resetDraftKeepPick();
    current = null;
    pick.value = '';
  }
}

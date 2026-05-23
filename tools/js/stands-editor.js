// tools/js/stands-editor.js — 管理者用 描画エディタ（アダプタ）
import { saveStand, deleteStand } from './stands-data.js';
import { MARKER_KINDS } from './stands-schema.js';

// 編集モードでは衛星(参照)を重ね、実際の建物・車路を見ながらラベルマーカーをクリック配置する。
// 閲覧者は淡色地図のまま。マーカー=入口/タクシーベイ/車寄せ/降車場/レジデンス/その他。
const KIND_LABEL = {
  entry: '入口', bay: 'タクシーベイ', pickup: '車寄せ',
  dropoff: '降車場', residence: 'レジデンス車寄せ', point: 'その他',
};
const KIND_COLOR = {
  entry: '#1d6fe0', bay: '#e6007a', pickup: '#e67e22',
  dropoff: '#16a085', residence: '#8e44ad', point: '#555',
};

function lmarkIcon(label, kind) {
  const color = KIND_COLOR[kind] || KIND_COLOR.point;
  const safe = String(label).replace(/</g, '&lt;');
  return L.divIcon({
    className: 'stand-lmark-edit',
    html: `<span style="display:inline-flex;align-items:center;white-space:nowrap;font-size:12px;font-weight:600;color:#111">`
      + `<span style="width:13px;height:13px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 1px 2px rgba(0,0,0,.5);flex:0 0 auto"></span>`
      + `<span style="margin-left:3px;background:rgba(255,255,255,.9);padding:1px 4px;border-radius:4px;box-shadow:0 1px 2px rgba(0,0,0,.3)">${safe}</span>`
      + `</span>`,
    iconSize: [0, 0], iconAnchor: [7, 7],
  });
}

export function initEditor(ctx) {
  const { map, companyId, stands = [] } = ctx;
  const bar = document.getElementById('stands-editbar');
  let editing = false;
  let mode = null; // 'pin' | 'route' | 'marker' | null
  let pinMarker = null;
  let routePts = [];
  let routeLine = null;
  let markers = [];          // {lat,lng,label,kind}
  let markerLayer = null;
  let satLayer = null;
  let current = null;        // 編集中の既存 stand（新規は null）

  const btnToggle = document.getElementById('ed-toggle');
  function mkBtn(label) { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; return b; }

  // 新規 or 既存施設の選択
  const pick = document.createElement('select');
  pick.id = 'ed-pick';
  pick.innerHTML = '<option value="">＋ 新規施設</option>'
    + stands.map((s) => `<option value="${s.id}">${s.name}</option>`).join('');

  // マーカー種別の選択
  const mkKind = document.createElement('select');
  mkKind.id = 'ed-mkkind';
  mkKind.innerHTML = MARKER_KINDS.map((k) => `<option value="${k}">${KIND_LABEL[k]}</option>`).join('');

  const btnSat = mkBtn('🛰 衛星ON/OFF');
  const btnPin = mkBtn('📍 ピン(施設位置)');
  const btnMarker = mkBtn('🔖 マーカー追加');
  const btnRoute = mkBtn('〰 進入ルート');
  const btnUndo = mkBtn('↩ 1つ戻す');
  const btnSave = mkBtn('💾 保存');
  const btnDelete = mkBtn('🗑 削除');
  const btnCancel = mkBtn('✖ クリア');
  const controls = [pick, mkKind, btnSat, btnPin, btnMarker, btnRoute, btnUndo, btnSave, btnDelete, btnCancel];
  controls.forEach((b) => { b.style.display = 'none'; bar.appendChild(b); });
  function setEditButtons(on) { controls.forEach((b) => { b.style.display = on ? '' : 'none'; }); }

  function addSat() {
    if (satLayer) return;
    satLayer = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      { maxZoom: 20, attribution: 'Tiles © Esri', opacity: 0.85 },
    ).addTo(map);
  }
  function removeSat() { if (satLayer) { map.removeLayer(satLayer); satLayer = null; } }

  btnToggle.addEventListener('click', () => {
    editing = !editing;
    btnToggle.textContent = editing ? '👁 閲覧モード' : '✏️ 編集モード';
    setEditButtons(editing);
    if (editing) addSat(); else { resetDraft(); removeSat(); }
  });
  btnSat.addEventListener('click', () => { if (satLayer) removeSat(); else addSat(); });

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
    markers = Array.isArray(s.markers) ? s.markers.map((m) => ({ lat: m.lat, lng: m.lng, label: m.label, kind: m.kind })) : [];
    redrawRoute();
    redrawMarkers();
  });

  btnPin.addEventListener('click', () => { mode = 'pin'; });
  btnMarker.addEventListener('click', () => { mode = 'marker'; });
  btnRoute.addEventListener('click', () => { mode = 'route'; });
  btnUndo.addEventListener('click', () => {
    if (mode === 'marker') { if (markers.length) { markers.pop(); redrawMarkers(); } }
    else if (routePts.length) { routePts.pop(); redrawRoute(); }
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
    } else if (mode === 'marker') {
      const kind = mkKind.value || 'point';
      const label = prompt('ラベル（例: ①入口B けやき坂側 / タクシーベイ）', KIND_LABEL[kind] || '');
      if (label === null) return;
      markers.push({ lat, lng, label: label.trim() || KIND_LABEL[kind], kind });
      redrawMarkers();
    }
  });

  function redrawRoute() {
    if (routeLine) { map.removeLayer(routeLine); routeLine = null; }
    if (routePts.length >= 2) {
      routeLine = L.polyline(routePts.map((p) => [p.lat, p.lng]), { color: '#1d6fe0', weight: 5, dashArray: '6' }).addTo(map);
    }
  }
  function redrawMarkers() {
    if (markerLayer) { map.removeLayer(markerLayer); markerLayer = null; }
    markerLayer = L.layerGroup().addTo(map);
    markers.forEach((m, i) => {
      L.marker([m.lat, m.lng], { icon: lmarkIcon(m.label, m.kind), draggable: true })
        .on('dragend', (ev) => { const ll = ev.target.getLatLng(); markers[i] = { ...markers[i], lat: ll.lat, lng: ll.lng }; })
        .addTo(markerLayer);
    });
  }

  btnSave.addEventListener('click', async () => {
    if (!pinMarker) { alert('「ピン(施設位置)」を配置してください'); return; }
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
      markers: markers.slice(),
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
    if (markerLayer) { map.removeLayer(markerLayer); markerLayer = null; }
    routePts = [];
    markers = [];
  }
  function resetDraft() {
    resetDraftKeepPick();
    current = null;
    pick.value = '';
  }
}

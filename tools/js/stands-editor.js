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
  let pdfOverlay = null;     // PDF道順図の歪み補正オーバーレイ（なぞり用・保存対象外）
  let pdfOpacity = 0.4;
  let distortReady = null;

  // DistortableImage プラグインを管理者時のみ動的ロード（閲覧者には配らない）
  function loadDistortable() {
    if (distortReady) return distortReady;
    distortReady = (async () => {
      for (const href of ['../vendor/leaflet-distortable/vendor.css', '../vendor/leaflet-distortable/leaflet.distortableimage.css']) {
        const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href; document.head.appendChild(l);
      }
      const load = (src) => new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
      await load('../vendor/leaflet-distortable/vendor.js');
      await load('../vendor/leaflet-distortable/leaflet.distortableimage.js');
    })();
    return distortReady;
  }

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
  const btnPdf = mkBtn('🗺 PDF重ねる');
  const btnPdfLock = mkBtn('🔒 画像ロック');
  const btnPdfOpacity = mkBtn('🌓 濃さ');
  const btnPdfRemove = mkBtn('🗺 PDF消す');
  const btnGeoref = mkBtn('📐 PDF合わせ');
  const btnUndo = mkBtn('↩ 1つ戻す');
  const btnSave = mkBtn('💾 保存');
  const btnDelete = mkBtn('🗑 削除');
  const btnCancel = mkBtn('✖ クリア');
  const controls = [pick, mkKind, btnSat, btnPin, btnMarker, btnRoute, btnPdf, btnPdfLock, btnPdfOpacity, btnPdfRemove, btnGeoref, btnUndo, btnSave, btnDelete, btnCancel];
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
    // 編集中は下部のPDF画像パネル(閲覧用シート)を隠す（地図に重なって編集の邪魔になるため）。
    document.body.classList.toggle('stands-editing', editing);
    // 直前にタップ表示していた施設があれば、それを編集対象に自動選択（ドロップダウン選択不要に）。
    if (editing && window.__activeStand && window.__activeStand.id
        && [...pick.options].some((o) => o.value === window.__activeStand.id)) {
      pick.value = window.__activeStand.id;
      pick.dispatchEvent(new Event('change'));
    }
    // 衛星は自動で出さない（PDFは衛星写真でなく略図なので、道路名の出る淡色地図に合わせる方が見やすい）。
    // 衛星が要る時だけ🛰ボタンで出す。
    if (!editing) { resetDraft(); removeSat(); }
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

  // PDF道順図を地図に重ねる（四隅ドラッグで衛星に位置合わせ→ロックしてなぞる）
  btnPdf.addEventListener('click', async () => {
    if (!current && window.__activeStand) current = window.__activeStand; // タップ表示中の施設を採用
    const imgs = current && current.images ? current.images : [];
    if (!imgs.length) { alert('この施設にはPDF道順図がありません。上の「＋新規施設」ドロップダウンで施設を選ぶか、地図のピンをタップしてから重ねてください。'); return; }
    await loadDistortable();
    if (!L.distortableImageOverlay) { alert('オーバーレイの読込に失敗しました'); return; }
    if (pdfOverlay) { map.removeLayer(pdfOverlay); pdfOverlay = null; }
    const url = `data/stands-ref/${imgs[0]}`;
    // 画像の縦横比を取得し、今の地図表示に収まる大きさ＋正しい比率で重ねる（潰れ・サイズ違いを防ぐ）
    const im = new Image();
    im.onload = () => {
      const aspect = (im.naturalWidth || 1) / (im.naturalHeight || 1);
      const c = map.getCenter();
      const b = map.getBounds();
      const viewWidthM = b.getNorthWest().distanceTo(b.getNorthEast()); // 表示幅(m)
      const widthM = Math.max(120, viewWidthM * 0.6);
      const heightM = widthM / aspect;
      const dLat = (heightM / 2) / 111320;
      const dLng = (widthM / 2) / (111320 * Math.cos(c.lat * Math.PI / 180));
      pdfOverlay = L.distortableImageOverlay(url, {
        corners: [
          L.latLng(c.lat + dLat, c.lng - dLng), L.latLng(c.lat + dLat, c.lng + dLng),
          L.latLng(c.lat - dLat, c.lng - dLng), L.latLng(c.lat - dLat, c.lng + dLng),
        ],
      }).addTo(map);
      pdfOverlay.__locked = false;
      pdfOverlay.on('load', () => { try { pdfOverlay.setOpacity(pdfOpacity); } catch (e) {} });
      btnPdfLock.textContent = '🔒 画像ロック';
    };
    im.onerror = () => alert('PDF画像の読込に失敗: ' + url);
    im.src = url;
    alert('PDFを重ねます。角の□ハンドルで拡大縮小・回転、四隅ドラッグで歪ませて道路に合わせ→「🔒画像ロック」→「〰進入ルート」でなぞる。');
  });
  btnPdfLock.addEventListener('click', () => {
    if (!pdfOverlay || !pdfOverlay.editing) return;
    if (pdfOverlay.__locked) {
      pdfOverlay.editing.enable();
      pdfOverlay.__locked = false;
      btnPdfLock.textContent = '🔒 画像ロック';
    } else {
      pdfOverlay.editing.disable();
      pdfOverlay.__locked = true;
      btnPdfLock.textContent = '✏️ 画像編集';
    }
  });
  btnPdfOpacity.addEventListener('click', () => {
    pdfOpacity = pdfOpacity >= 0.8 ? 0.3 : pdfOpacity + 0.25;
    if (pdfOverlay) { try { pdfOverlay.setOpacity(pdfOpacity); } catch (e) {} }
  });
  btnPdfRemove.addEventListener('click', () => { if (pdfOverlay) { map.removeLayer(pdfOverlay); pdfOverlay = null; } });
  btnGeoref.addEventListener('click', async () => {
    if (!current && window.__activeStand) current = window.__activeStand;
    if (!current) { alert('施設を選択してから「📐 PDF合わせ」を押してください'); return; }
    const { initGeoref } = await import('./stands-georef-ui.js');
    initGeoref({
      stand: current,
      onSave: async (updated) => {
        try {
          await saveStand(companyId, updated);
          alert('保存しました。地図に正しい進入線が反映されます');
          location.reload();
        } catch (e) {
          alert('保存に失敗: ' + e.message);
        }
      },
    });
  });
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
    if (pdfOverlay) { map.removeLayer(pdfOverlay); pdfOverlay = null; }
    routePts = [];
    markers = [];
  }
  function resetDraft() {
    resetDraftKeepPick();
    current = null;
    pick.value = '';
  }
}

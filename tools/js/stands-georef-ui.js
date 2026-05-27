// tools/js/stands-georef-ui.js — PDF↔地図 対応点クリックジオリファレンスUI（アダプタ）
// 既存編集モードから initGeoref({stand, onSave}) で起動。完了時は onSave(updatedStand) を呼ぶ。
import { computeHomography, applyToPdfLines } from './stands-georef.js';

const TILE_CARTO = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';

export function initGeoref({ stand, onSave }) {
  if (!stand) return;
  const approachIdx = (stand.approaches || []).findIndex((a) => Array.isArray(a.pdfLines) && a.pdfLines.length >= 2);
  if (approachIdx < 0) {
    alert('この施設には PDF 進入線(pdfLines)が登録されていません。先にPhase2のデータ投入が必要です。');
    return;
  }
  const approach = stand.approaches[approachIdx];
  const imgFile = approach.pdfImageRef || (stand.images && stand.images[0]) || '';
  if (!imgFile) { alert('PDF画像が見つかりません'); return; }

  const overlay = document.getElementById('georef-overlay');
  const status = document.getElementById('g-status');
  const btnUndo = document.getElementById('g-undo');
  const btnCompute = document.getElementById('g-compute');
  const btnSave = document.getElementById('g-save');
  const btnClose = document.getElementById('g-close');
  const pdfImg = document.getElementById('g-pdf-img');
  const pdfWrap = pdfImg.parentElement;
  const mapEl = document.getElementById('g-map');

  let pairs = []; // [{pdf:{x,y}, geo:{lat,lng}}]
  let H = null;
  let previewLine = null;

  if (mapEl._leaflet_id) mapEl._leaflet_id = null;
  mapEl.innerHTML = '';
  const map = L.map(mapEl, { zoomControl: true }).setView([stand.pin.lat, stand.pin.lng], 18);
  L.tileLayer(TILE_CARTO, { maxZoom: 20, subdomains: 'abcd', attribution: '© OSM © CARTO' }).addTo(map);
  L.marker([stand.pin.lat, stand.pin.lng], { title: stand.name }).addTo(map);

  pdfImg.src = `data/stands-ref/${imgFile}`;

  let waiting = 'pdf';
  let stagedPdf = null;
  const layerPdfMarks = [];
  let layerGeo = L.layerGroup().addTo(map);

  function updateStatus() {
    status.textContent = `対応点 ${pairs.length}/4（${waiting === 'pdf' ? 'PDFをクリック' : '地図をクリック'}）`;
    btnCompute.disabled = pairs.length < 3;
    btnSave.disabled = !H;
  }

  function addPdfMark(x, y, n) {
    const el = document.createElement('div');
    el.className = 'g-marker pdf';
    el.textContent = n;
    el.style.cssText = `position:absolute;left:${x - 11}px;top:${y - 11}px;pointer-events:none;`;
    pdfWrap.appendChild(el);
    layerPdfMarks.push(el);
  }

  function addGeoMark(lat, lng, n) {
    L.marker([lat, lng], {
      icon: L.divIcon({ className: '', html: `<div class="g-marker geo">${n}</div>`, iconSize: [22, 22], iconAnchor: [11, 11] }),
      interactive: false,
    }).addTo(layerGeo);
  }

  function clearPreview() {
    if (previewLine) { map.removeLayer(previewLine); previewLine = null; }
  }

  pdfImg.addEventListener('click', (e) => {
    if (waiting !== 'pdf') return;
    const r = pdfImg.getBoundingClientRect();
    const x = (e.clientX - r.left) * (pdfImg.naturalWidth / r.width);
    const y = (e.clientY - r.top) * (pdfImg.naturalHeight / r.height);
    stagedPdf = { x, y };
    addPdfMark(e.clientX - pdfWrap.getBoundingClientRect().left, e.clientY - pdfWrap.getBoundingClientRect().top, pairs.length + 1);
    waiting = 'geo';
    updateStatus();
  });

  map.on('click', (e) => {
    if (waiting !== 'geo' || !stagedPdf) return;
    const geo = { lat: e.latlng.lat, lng: e.latlng.lng };
    pairs.push({ pdf: stagedPdf, geo });
    addGeoMark(geo.lat, geo.lng, pairs.length);
    stagedPdf = null;
    waiting = 'pdf';
    clearPreview();
    H = null;
    updateStatus();
  });

  btnUndo.addEventListener('click', () => {
    if (waiting === 'geo' && stagedPdf) {
      stagedPdf = null;
      const m = layerPdfMarks.pop();
      if (m) m.remove();
      waiting = 'pdf';
    } else if (pairs.length > 0) {
      pairs.pop();
      const m = layerPdfMarks.pop();
      if (m) m.remove();
      layerGeo.clearLayers();
      pairs.forEach((p, i) => addGeoMark(p.geo.lat, p.geo.lng, i + 1));
    }
    clearPreview();
    H = null;
    updateStatus();
  });

  btnCompute.addEventListener('click', () => {
    H = computeHomography(pairs);
    if (!H) {
      alert('対応点が不適切です（一直線上等）。目印を3方向に散らしてください。');
      updateStatus();
      return;
    }
    const line = applyToPdfLines(H, approach.pdfLines);
    clearPreview();
    if (line.length >= 2) {
      previewLine = L.polyline(line.map((p) => [p.lat, p.lng]), { className: 'g-preview-line' }).addTo(map);
      map.fitBounds(previewLine.getBounds().pad(0.3), { maxZoom: 19 });
    }
    updateStatus();
  });

  btnSave.addEventListener('click', () => {
    if (!H) return;
    const updated = JSON.parse(JSON.stringify(stand));
    updated.approaches.forEach((a) => {
      if (Array.isArray(a.pdfLines) && a.pdfLines.length >= 2 && a.pdfImageRef === imgFile) {
        a.line = applyToPdfLines(H, a.pdfLines);
      }
    });
    onSave(updated);
    close();
  });

  function close() {
    overlay.hidden = true;
    map.remove();
    layerPdfMarks.forEach((m) => m.remove());
    pdfImg.src = '';
    overlay.__cleanup && overlay.__cleanup();
  }
  btnClose.addEventListener('click', close);
  overlay.__cleanup = () => {
    overlay.hidden = true;
  };

  overlay.hidden = false;
  // overlay表示直後はDOMサイズが確定するまで地図タイルが読み込まれないため
  // invalidateSize を遅延実行する。
  setTimeout(() => { try { map.invalidateSize(); } catch (e) {} }, 50);
  updateStatus();
}

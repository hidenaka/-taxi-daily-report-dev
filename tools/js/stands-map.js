// tools/js/stands-map.js — Leaflet 地図描画（アダプタ）。global L 前提。
import { arrowMarkersForRoute } from './stands-geo.js';

const TOKYO_CENTER = [35.6655, 139.7314];
const CATEGORY_COLOR = {
  office: '#2980b9', hotel: '#8e44ad', hospital: '#c0392b',
  commercial: '#e67e22', other: '#16a085',
};

export function createStandsMap(elId) {
  const map = L.map(elId, { zoomControl: true }).setView(TOKYO_CENTER, 13);
  L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    { maxZoom: 19, attribution: 'Tiles © Esri' },
  ).addTo(map);
  // 道路名・地名ラベル（透過）
  L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
    { maxZoom: 19, opacity: 0.9 },
  ).addTo(map);
  return map;
}

function pinIcon(category) {
  const color = CATEGORY_COLOR[category] || CATEGORY_COLOR.other;
  return L.divIcon({
    className: 'stand-pin',
    html: `<span style="display:inline-block;width:18px;height:18px;border-radius:50% 50% 50% 0;`
      + `background:${color};border:2px solid #fff;transform:rotate(-45deg);box-shadow:0 1px 3px rgba(0,0,0,.5)"></span>`,
    iconSize: [22, 22], iconAnchor: [11, 22],
  });
}

// ピン群を描画。onSelect(stand) はタップ時。戻り値はレイヤ管理オブジェクト。
export function renderPins(map, stands, onSelect) {
  const layer = L.layerGroup().addTo(map);
  stands.forEach((s) => {
    if (!s.pin) return;
    L.marker([s.pin.lat, s.pin.lng], { icon: pinIcon(s.category), title: s.name })
      .on('click', () => onSelect(s))
      .addTo(layer);
  });
  return layer;
}

function arrowIcon(angleDeg) {
  return L.divIcon({
    className: 'stand-arrow',
    html: `<span style="display:inline-block;color:#ffd400;font-size:16px;`
      + `transform:rotate(${angleDeg - 90}deg);text-shadow:0 0 2px #000">▶</span>`,
    iconSize: [16, 16], iconAnchor: [8, 8],
  });
}

// 1施設のルート線＋矢印を描画。clearLayer で消す前提のレイヤを返す。
export function drawRoute(map, stand, { fit = true } = {}) {
  const layer = L.layerGroup().addTo(map);
  (stand.routes || []).forEach((r) => {
    if (!Array.isArray(r.points) || r.points.length < 2) return;
    const latlngs = r.points.map((p) => [p.lat, p.lng]);
    L.polyline(latlngs, { color: r.kind === 'onsite' ? '#1abc9c' : '#ffd400', weight: 5, opacity: 0.9 }).addTo(layer);
    arrowMarkersForRoute(r.points).forEach((a) => {
      L.marker([a.lat, a.lng], { icon: arrowIcon(a.angleDeg), interactive: false }).addTo(layer);
    });
  });
  if (fit) {
    const all = (stand.routes || []).flatMap((r) => r.points || []).map((p) => [p.lat, p.lng]);
    if (stand.pin) all.push([stand.pin.lat, stand.pin.lng]);
    if (all.length) map.fitBounds(L.latLngBounds(all).pad(0.3), { maxZoom: 18 });
  }
  return layer;
}

export function clearLayer(map, layer) {
  if (layer) map.removeLayer(layer);
}

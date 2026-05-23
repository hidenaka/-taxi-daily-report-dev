// tools/js/stands-map.js — Leaflet 地図描画（アダプタ）。global L 前提。
import { arrowMarkersForRoute } from './stands-geo.js';

const TOKYO_CENTER = [35.6655, 139.7314];
const CATEGORY_COLOR = {
  office: '#2980b9', hotel: '#8e44ad', hospital: '#c0392b',
  commercial: '#e67e22', other: '#16a085',
};

// マーカー種別ごとの色（入口/ベイ/車寄せ等を色で区別）
const MARKER_COLOR = {
  entry: '#1d6fe0', bay: '#e6007a', pickup: '#e67e22',
  dropoff: '#16a085', residence: '#8e44ad', point: '#555',
};

export function createStandsMap(elId) {
  const map = L.map(elId, { zoomControl: true }).setView(TOKYO_CENTER, 13);
  // 淡色のシンプル地図（道路名主体・余計な情報を削いだ確認用ベース）。Carto Positron。
  L.tileLayer(
    'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    {
      maxZoom: 20,
      subdomains: 'abcd',
      attribution: '© OpenStreetMap contributors © CARTO',
    },
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
    html: `<span style="display:inline-block;color:#1d6fe0;font-size:18px;font-weight:bold;`
      + `transform:rotate(${angleDeg - 90}deg);text-shadow:0 0 3px #fff,0 0 3px #fff">▶</span>`,
    iconSize: [18, 18], iconAnchor: [9, 9],
  });
}

// 入口/車寄せ等のラベル付きマーカー（淡色地図上で見やすい色ドット＋ラベル）
function labelMarkerIcon(label, kind) {
  const color = MARKER_COLOR[kind] || MARKER_COLOR.point;
  const safe = String(label).replace(/</g, '&lt;');
  return L.divIcon({
    className: 'stand-lmark',
    html: `<span style="display:inline-flex;align-items:center;white-space:nowrap;font-size:12px;font-weight:600;color:#111">`
      + `<span style="width:13px;height:13px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 1px 2px rgba(0,0,0,.4);flex:0 0 auto"></span>`
      + `<span style="margin-left:3px;background:rgba(255,255,255,.88);padding:1px 4px;border-radius:4px;box-shadow:0 1px 2px rgba(0,0,0,.2)">${safe}</span>`
      + `</span>`,
    iconSize: [0, 0], iconAnchor: [7, 7],
  });
}

// 1施設の入り方を描画: ルート線＋矢印＋入口/車寄せのラベルマーカー。clearLayer で消す前提のレイヤを返す。
export function drawRoute(map, stand, { fit = true } = {}) {
  const layer = L.layerGroup().addTo(map);
  (stand.routes || []).forEach((r) => {
    if (!Array.isArray(r.points) || r.points.length < 2) return;
    const latlngs = r.points.map((p) => [p.lat, p.lng]);
    L.polyline(latlngs, { color: r.kind === 'onsite' ? '#0a8f5b' : '#1d6fe0', weight: 5, opacity: 0.85 }).addTo(layer);
    arrowMarkersForRoute(r.points).forEach((a) => {
      L.marker([a.lat, a.lng], { icon: arrowIcon(a.angleDeg), interactive: false }).addTo(layer);
    });
  });
  (stand.markers || []).forEach((m) => {
    L.marker([m.lat, m.lng], { icon: labelMarkerIcon(m.label, m.kind) }).addTo(layer);
  });
  if (fit) {
    const all = (stand.routes || []).flatMap((r) => r.points || []).map((p) => [p.lat, p.lng]);
    (stand.markers || []).forEach((m) => all.push([m.lat, m.lng]));
    if (stand.pin) all.push([stand.pin.lat, stand.pin.lng]);
    if (all.length) map.fitBounds(L.latLngBounds(all).pad(0.3), { maxZoom: 19 });
  }
  return layer;
}

export function clearLayer(map, layer) {
  if (layer) map.removeLayer(layer);
}

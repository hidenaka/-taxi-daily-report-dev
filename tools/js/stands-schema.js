// tools/js/stands-schema.js — stand データの検証・正規化（純関数）

export const STAND_CATEGORIES = ['office', 'hotel', 'hospital', 'commercial', 'other'];
// マーカー種別: entry=入口 / bay=タクシーベイ / pickup=車寄せ / dropoff=降車場 / residence=レジデンス車寄せ / point=その他地点
export const MARKER_KINDS = ['entry', 'bay', 'pickup', 'dropoff', 'residence', 'point'];

// 東京近郊の妥当範囲（緯度経度）。範囲外は座標ミスとして弾く。
const LAT_MIN = 35.3, LAT_MAX = 36.1;
const LNG_MIN = 139.2, LNG_MAX = 140.3;

function isFiniteNum(v) { return typeof v === 'number' && Number.isFinite(v); }

function isValidLatLng(p) {
  return p && isFiniteNum(p.lat) && isFiniteNum(p.lng)
    && p.lat >= LAT_MIN && p.lat <= LAT_MAX
    && p.lng >= LNG_MIN && p.lng <= LNG_MAX;
}

export function validateStand(obj) {
  const errors = [];
  if (!obj || typeof obj !== 'object') return { valid: false, errors: ['stand: object でない'] };
  if (typeof obj.name !== 'string' || obj.name.trim() === '') errors.push('name: 必須・非空');
  if (!isValidLatLng(obj.pin)) errors.push('pin: lat/lng が必須かつ東京近郊範囲内');
  if (obj.routes !== undefined) {
    if (!Array.isArray(obj.routes)) {
      errors.push('routes: 配列でない');
    } else {
      obj.routes.forEach((r, i) => {
        if (!r || !Array.isArray(r.points) || r.points.length < 2) {
          errors.push(`route[${i}]: points は2点以上`);
        } else if (!r.points.every(isValidLatLng)) {
          errors.push(`route[${i}]: points に不正な座標`);
        }
      });
    }
  }
  if (obj.markers !== undefined) {
    if (!Array.isArray(obj.markers)) {
      errors.push('markers: 配列でない');
    } else {
      obj.markers.forEach((m, i) => {
        if (!m || !isValidLatLng(m)) errors.push(`marker[${i}]: lat/lng が必須かつ範囲内`);
        if (!m || typeof m.label !== 'string' || m.label.trim() === '') errors.push(`marker[${i}]: label 必須`);
      });
    }
  }
  return { valid: errors.length === 0, errors };
}

export function normalizeStand(obj) {
  const src = obj || {};
  const category = STAND_CATEGORIES.includes(src.category) ? src.category : 'other';
  const routes = Array.isArray(src.routes)
    ? src.routes.map((r) => ({
        points: Array.isArray(r.points) ? r.points.map((p) => ({ lat: p.lat, lng: p.lng })) : [],
        label: typeof r.label === 'string' ? r.label : '',
        kind: r.kind === 'onsite' ? 'onsite' : 'approach',
      }))
    : [];
  const markers = Array.isArray(src.markers)
    ? src.markers.map((m) => ({
        lat: m.lat,
        lng: m.lng,
        label: typeof m.label === 'string' ? m.label.trim() : '',
        kind: MARKER_KINDS.includes(m.kind) ? m.kind : 'point',
      }))
    : [];
  return {
    name: typeof src.name === 'string' ? src.name.trim() : '',
    category,
    pin: src.pin ? { lat: src.pin.lat, lng: src.pin.lng } : null,
    routes,
    markers,
    notes: typeof src.notes === 'string' ? src.notes : '',
    sourcePdf: typeof src.sourcePdf === 'string' ? src.sourcePdf : '',
  };
}

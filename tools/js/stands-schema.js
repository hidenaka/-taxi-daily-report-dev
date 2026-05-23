// tools/js/stands-schema.js — stand データの検証・正規化（純関数）

export const STAND_CATEGORIES = ['office', 'hotel', 'hospital', 'commercial', 'other'];

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
  return {
    name: typeof src.name === 'string' ? src.name.trim() : '',
    category,
    pin: src.pin ? { lat: src.pin.lat, lng: src.pin.lng } : null,
    routes,
    notes: typeof src.notes === 'string' ? src.notes : '',
    sourcePdf: typeof src.sourcePdf === 'string' ? src.sourcePdf : '',
  };
}

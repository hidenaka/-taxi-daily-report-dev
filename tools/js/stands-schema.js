// tools/js/stands-schema.js — stand データの検証・正規化（純関数）

export const STAND_CATEGORIES = ['office', 'hotel', 'hospital', 'commercial', 'other'];
// マーカー種別: entry=入口 / bay=タクシーベイ / pickup=車寄せ / dropoff=降車場 / residence=レジデンス車寄せ / point=その他地点
export const MARKER_KINDS = ['entry', 'bay', 'pickup', 'dropoff', 'residence', 'point'];
// 進入の制約: 'left-only'=左折のみ / 'right-ok'=右折可 / 'either'=どちらでも
export const APPROACH_TURNS = ['left-only', 'right-ok', 'either'];

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
  if (obj.images !== undefined && !Array.isArray(obj.images)) {
    errors.push('images: 配列でない');
  }
  if (obj.overlay !== undefined && obj.overlay !== null) {
    const c = obj.overlay.corners;
    const okc = Array.isArray(c) && c.length === 4
      && c.every((p) => Array.isArray(p) && p.length === 2 && isFiniteNum(p[0]) && isFiniteNum(p[1]));
    if (!okc) errors.push('overlay.corners: [lat,lng]×4 が必要');
  }
  if (obj.approaches !== undefined) {
    if (!Array.isArray(obj.approaches)) {
      errors.push('approaches: 配列でない');
    } else {
      obj.approaches.forEach((a, i) => {
        if (!a || typeof a !== 'object') { errors.push(`approach[${i}]: object でない`); return; }
        if (typeof a.label !== 'string' || a.label.trim() === '') errors.push(`approach[${i}]: label 必須`);
        if (a.bearing !== undefined && a.bearing !== null && !(isFiniteNum(a.bearing) && a.bearing >= 0 && a.bearing < 360))
          errors.push(`approach[${i}]: bearing は 0..<360`);
        if (a.line !== undefined) {
          if (!Array.isArray(a.line) || a.line.length < 2 || !a.line.every(isValidLatLng))
            errors.push(`approach[${i}]: line は {lat,lng} 2点以上`);
        }
        if (a.pdfLines !== undefined) {
          if (!Array.isArray(a.pdfLines)) errors.push(`approach[${i}]: pdfLines は配列`);
          else if (!a.pdfLines.every((p) => p && isFiniteNum(p.x) && isFiniteNum(p.y)))
            errors.push(`approach[${i}]: pdfLines は {x,y} の数値`);
        }
      });
    }
  }
  if (obj.cautions !== undefined && !Array.isArray(obj.cautions)) errors.push('cautions: 配列でない');
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
  const images = Array.isArray(src.images)
    ? src.images.filter((s) => typeof s === 'string' && s.trim() !== '')
    : [];
  // overlay: 組合PDFを実地図に重ねる四隅(NW,NE,SW,SE)。AI自動ジオリファレンスで算出。
  const oc = src.overlay && src.overlay.corners;
  const overlay = (Array.isArray(oc) && oc.length === 4
    && oc.every((p) => Array.isArray(p) && p.length === 2 && isFiniteNum(p[0]) && isFiniteNum(p[1])))
    ? { corners: oc.map((p) => [p[0], p[1]]), image: typeof src.overlay.image === 'string' ? src.overlay.image : (images[0] || '') }
    : null;
  // approaches: 進入方向（label/road/bearing/turn/hint/line）
  const approaches = Array.isArray(src.approaches)
    ? src.approaches.map((a) => ({
        label: typeof a.label === 'string' ? a.label.trim() : '',
        road: typeof a.road === 'string' ? a.road.trim() : '',
        bearing: isFiniteNum(a.bearing) ? a.bearing : null,
        turn: APPROACH_TURNS.includes(a.turn) ? a.turn : 'either',
        hint: typeof a.hint === 'string' ? a.hint.trim() : '',
        line: Array.isArray(a.line) && a.line.length >= 2 && a.line.every(isValidLatLng)
          ? a.line.map((p) => ({ lat: p.lat, lng: p.lng })) : [],
        pdfLines: Array.isArray(a.pdfLines)
          ? a.pdfLines
              .filter((p) => p && isFiniteNum(p.x) && isFiniteNum(p.y))
              .map((p) => ({ x: p.x, y: p.y }))
          : [],
        pdfImageRef: typeof a.pdfImageRef === 'string' ? a.pdfImageRef.trim() : '',
      }))
    : [];
  const cautions = Array.isArray(src.cautions)
    ? src.cautions.filter((s) => typeof s === 'string' && s.trim() !== '').map((s) => s.trim())
    : [];
  return {
    name: typeof src.name === 'string' ? src.name.trim() : '',
    category,
    pin: src.pin ? { lat: src.pin.lat, lng: src.pin.lng } : null,
    routes,
    approaches,
    cautions,
    markers,
    images,
    overlay,
    notes: typeof src.notes === 'string' ? src.notes : '',
    sourcePdf: typeof src.sourcePdf === 'string' ? src.sourcePdf : '',
  };
}

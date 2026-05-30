// 深夜割増の時間帯: 22:00〜翌4:59（5:00から昼）
export function isLateNight(date) {
  const h = date.getHours();
  return h >= 22 || h < 5;
}

// 区名の部分一致。空クエリは全件。
export function findAreasByQuery(areas, query) {
  const q = (query || '').trim();
  if (!q) return areas.slice();
  return areas.filter(a => a.name.includes(q) || a.key.includes(q));
}

export function lookupArea(areas, key) {
  return areas.find(a => a.key === key) || null;
}

export function computeBounds(areas) {
  const lats = areas.map(a => a.lat);
  const lngs = areas.map(a => a.lng);
  return {
    minLat: Math.min(...lats), maxLat: Math.max(...lats),
    minLng: Math.min(...lngs), maxLng: Math.max(...lngs)
  };
}

// 緯度経度を SVG 座標へ。経度→x（東が右）、緯度→y（北が上＝小さいy）。pad は内側余白。
export function projectLatLng(pt, bounds, size, pad = 0) {
  const { minLat, maxLat, minLng, maxLng } = bounds;
  const wSpan = (maxLng - minLng) || 1;
  const hSpan = (maxLat - minLat) || 1;
  const x = pad + ((pt.lng - minLng) / wSpan) * (size.w - 2 * pad);
  const y = pad + ((maxLat - pt.lat) / hSpan) * (size.h - 2 * pad);
  return { x, y };
}

export function formatFare(v) {
  return (v == null) ? '—' : '¥' + Number(v).toLocaleString('ja-JP');
}

// 料金カード描画用の純データ。now で深夜判定。
export function buildCardModel(area, now) {
  return {
    key: area.key,
    name: area.name,
    haneda: { day: area.haneda?.day ?? null, night: area.haneda?.night ?? null },
    narita: { day: area.narita?.day ?? null, night: area.narita?.night ?? null },
    isLate: isLateNight(now)
  };
}

// データ整合: 25件・各エリアに haneda/narita の day/night（number か null）。
export function validateFares(data) {
  const areas = data?.areas;
  if (!Array.isArray(areas) || areas.length !== 25) {
    throw new Error(`airport-fixed-fares: areas は25件必須（実際 ${areas?.length}）`);
  }
  const okVal = v => v === null || typeof v === 'number';
  for (const a of areas) {
    for (const ap of ['haneda', 'narita']) {
      for (const t of ['day', 'night']) {
        if (a[ap] === undefined || a[ap][t] === undefined || !okVal(a[ap][t])) {
          throw new Error(`airport-fixed-fares: ${a.key} の ${ap}.${t} が不正`);
        }
      }
    }
  }
  return true;
}

// ページから使う読込（fetch）。tools/ からの相対パス。
export async function loadFares() {
  const data = await (await fetch('./data/airport-fixed-fares.json')).json();
  validateFares(data);
  return data;
}

// 区境ポリゴン（地図描画用）。tools/ からの相対パス。
export async function loadWardShapes() {
  return await (await fetch('./data/tokyo-ward-shapes.json')).json();
}

// js/area-geo.js — 町の代表座標を使った「近さ」の計算
//
// 近隣エリアの判定はもともと「過去に25分以内で行き来した実績」だけで決めている。
// その決め方は理にかなっている（川の向こう・高速の反対側など「近いのに行けない町」が
// 自動的に外れる。実測でも実績ペアの95%は3km以内に収まっていた）が、裏返すと
// 過去に自分が動いた範囲の外は永久に候補に入らない。
//
// 実績があった＝そこが良かった、ではない。本番345乗務で測ると、距離2km以内で
// 新しく近所になる町201件のうち73件(36%)が、いまの近所の平均単価を上回っていた。
// このモジュールは、その「近いのに候補にすら入っていない町」を割り出すためにある。
//
// 座標は町の代表地点(公開データ geolonia/japanese-addresses の町丁目座標の平均)で、
// 乗務員やお客様の位置を記録するものではない。

const EARTH_KM = 6371;
const rad = (d) => d * Math.PI / 180;

// 2点間の距離(km)。点は [lat, lng]。
export function distanceKm(a, b) {
  if (!a || !b) return null;
  const [lat1, lng1] = a, [lat2, lng2] = b;
  const dLat = rad(lat2 - lat1), dLng = rad(lng2 - lng1);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.sqrt(h));
}

// 表記ゆれを吸収するキー。日報の写真から読んだ住所は「千駄ヶ谷/千駄ケ谷」のように
// 揺れるため、そのままでは辞書を引けない(実測で77件が引けていなかった)。
function normKey(s) {
  return String(s || '')
    .replace(/[ヶヵガ]/g, 'ケ')
    .replace(/濤/g, '涛').replace(/嶋/g, '島').replace(/邊|邉/g, '辺')
    .replace(/[・\s　]/g, '');
}

let _aliasCache = null;
let _aliasSource = null;
function aliasOf(coords) {
  if (_aliasCache && _aliasSource === coords) return _aliasCache;
  const m = {};
  for (const k of Object.keys(coords)) m[normKey(k)] = k;
  _aliasCache = m; _aliasSource = coords;
  return m;
}

// エリア名から座標を引く。完全一致 → 表記ゆれ吸収の順。無ければ null。
export function lookupCoord(area, coords) {
  if (!area || !coords) return null;
  if (coords[area]) return coords[area];
  const hit = aliasOf(coords)[normKey(area)];
  return hit ? coords[hit] : null;
}

// 起点エリアの近くにあるのに、いまの近隣(実績ベース)に入っていない町を返す。
//
// area:        起点エリア（降ろした場所）
// originPoint: 起点の座標 [lat, lng]。GPSでいまいる場所が分かっているときはこちらを使う
//              （町名が過去データに無くても効く）。省略時は area から座標を引く。
// neighbors:   いまの近隣 Set（実績ベース）
// coords:      { エリア名: [lat, lng] }
// boardStats:  { エリア名: { count, avgSales } } — その町で「乗せた」実績
// radiusKm:    近いとみなす半径。既定2km。
//              実績で「近所」とされたペアの実距離は中央値1.28km・79%が2km以内だったので、
//              実績ベースの近所と同じ感覚の広さに合わせてある。
//              (2.5kmまで広げると出る率は83%→92%になるが、実績ペアの89%を超えて広すぎる)
// minBoardCount: 乗せた実績がこれ未満の町は出さない（数字を出せないため）
// limit:       最大件数
//
// 戻り値: [{ area, km, count, avgSales }] を単価の高い順に
export function nearbyUnexploredAreas({
  area, originPoint, neighbors, coords, boardStats,
  radiusKm = 2, minBoardCount = 3, limit = 8,
}) {
  const origin = originPoint || lookupCoord(area, coords);
  if (!origin || !boardStats) return [];
  const known = neighbors || new Set();
  const out = [];
  for (const [name, stat] of Object.entries(boardStats)) {
    if (name === area || known.has(name)) continue;
    if (!stat || (stat.count || 0) < minBoardCount) continue;
    const p = lookupCoord(name, coords);
    if (!p) continue;
    const d = distanceKm(origin, p);
    if (d == null || d > radiusKm) continue;
    out.push({ area: name, km: d, count: stat.count, avgSales: stat.avgSales });
  }
  out.sort((a, b) => b.avgSales - a.avgSales);
  return out.slice(0, limit);
}

// いまいる座標から半径内にある「実績のある場所」を近い順に返す。
//
// GPS の緯度経度をそのまま起点にする。これまでは座標を町名の文字に変えてから
// 過去データの町名と文字くらべしており、町名が過去データに無いと
// 「同じ区で名前が似ている町」を起点にしていた。実測ではその選び方は
// あてずっぽう(同じ区からランダムに選ぶ)と同じ15%しか当たっていなかった。
//
// point:     [lat, lng]（いまいる場所。記録はせず、この場で使うだけ）
// coords:    { エリア名: [lat, lng] }
// areaStats: { エリア名: { count } } — そのエリアの実績件数
// 戻り値: [{ area, km, count }] を近い順に
export function areasNearPoint(point, coords, areaStats, { radiusKm = 2, minCount = 3, limit = 30 } = {}) {
  if (!point || !coords || !areaStats) return [];
  const out = [];
  for (const [name, stat] of Object.entries(areaStats)) {
    if (!stat || (stat.count || 0) < minCount) continue;
    const p = lookupCoord(name, coords);
    if (!p) continue;
    const d = distanceKm(point, p);
    if (d == null || d > radiusKm) continue;
    out.push({ area: name, km: d, count: stat.count });
  }
  out.sort((a, b) => a.km - b.km);
  return out.slice(0, limit);
}

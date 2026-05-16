import { haversineKm } from './util.js';
import { buildAdjacency, shortestPath, shortestPathVia } from './shutoko-graph.js';

// ============================================================================
// 設計: 「総距離」は入口IC→出口ICの単一グラフ経路から導く（単一の真実の源）。
//   - 物理距離  = shutoko_graph.json のグラフ探索（経路詳細と同一の経路）
//   - 控除距離  = deduction.json（社内「有料道路控除距離表」）由来。物理距離とは別系統。
//   judgeRoute は1本の経路を求め、それを区間分割して segments を作るため、
//   segments の distanceKm 合計は必ず総距離（経路の実距離）に一致する。
// ============================================================================

let _cachedAdj = null;
let _cachedAdjGraph = null;
function getAdj(graph) {
  if (_cachedAdjGraph !== graph) {
    _cachedAdj = graph ? buildAdjacency(graph) : null;
    _cachedAdjGraph = graph;
  }
  return _cachedAdj;
}

// 外側高速 outerRoute → グラフ route コード（強制経由探索 shortestPathVia に使う）
export const OUTER_ROUTE_TO_GRAPH = {
  yokohane_route: 'K1', wangan_route: 'B', hodogaya_route: 'third_keihin',
  kariba_route: 'K3', hokuseisen_route: 'K7_hokusei', kitasen_route: 'K7',
  yokoyoko: 'yokoyoko', third_keihin: 'third_keihin',
  tomei: 'tomei', chuo: 'chuo', kanetsu: 'kanetsu', tohoku: 'tohoku',
  joban: 'joban', keiyo: 'keiyo', tokan: 'tokan', aqua: 'aqua', tateyama: 'tateyama',
};

export const OUTER_TRUNK_ROUTES = new Set([
  'tomei', 'chuo', 'kanetsu', 'tohoku', 'joban',
  'keiyo', 'tokan', 'aqua', 'tateyama',
  'third_keihin', 'yokoyoko', 'yokohane_route', 'kariba_route', 'wangan_route',
  'hodogaya_route', 'hokuseisen_route', 'kitasen_route',
]);

// グラフ edge.route のうち外側高速本線のもの（区間カテゴリ分類用）
const OUTER_GRAPH_ROUTES = new Set([
  'tomei', 'chuo', 'kanetsu', 'tohoku', 'joban', 'keiyo', 'tokan', 'aqua',
  'tateyama', 'third_keihin', 'yokoyoko',
]);

// 路線コード → 表示ラベル（セグメント名用）
const ROUTE_LABEL = {
  '1': '1号羽田', '2': '2号目黒', '3': '3号渋谷', '4': '4号新宿', '5': '5号池袋',
  '6': '6号向島', '6_misato': '6号三郷', '6_mukojima': '6号向島', '7': '7号小松川',
  '9': '9号深川', '10': '10号晴海', '11': '11号台場',
  'C1': 'C1', 'C2': 'C2', 'C3': 'C3', 'B': '湾岸線', 'Y': '八重洲線',
  'K1': '横羽線', 'K2': '三ツ沢線', 'K3': '狩場線', 'K5': '大黒線', 'K6': '川崎線',
  'K7': '横浜北線', 'K7_hokusei': '横浜北西線', 'S1': '川口線',
  'tomei': '東名', 'chuo': '中央道', 'kanetsu': '関越道', 'tohoku': '東北道',
  'joban': '常磐道', 'keiyo': '京葉道', 'tokan': '東関東道', 'aqua': 'アクアライン',
  'tateyama': '館山道', 'third_keihin': '第三京浜', 'yokoyoko': '横浜横須賀道路',
  'gaikan': '外環道',
};

const SHUTOKO_DETOUR_FACTOR = 1.3;

/**
 * deduction.json でIC→控除距離を検索する。
 * directionId 指定時はその direction に限定。baseline IC は km=0 を返す。
 */
export function lookupDeduction(deductionData, icId, directionId = null) {
  const directions = directionId
    ? deductionData.directions.filter(d => d.id === directionId)
    : deductionData.directions;

  for (const dir of directions) {
    if (dir.baseline.ic_id === icId) {
      return { direction: dir.id, name: dir.baseline.ic_name, km: 0, note: null };
    }
    const entry = dir.entries.find(e => e.ic_id === icId);
    if (entry) {
      return { direction: dir.id, name: entry.name, km: entry.km, note: entry.note ?? null };
    }
  }
  return null;
}

/**
 * outerRoute での控除距離（片道）を求める。deduction.json 由来の制度値で、
 * 物理走行距離とは一致しないことがある（社内「有料道路控除距離表」）。
 * - 入口・出口が同じ direction の entries にある → 差分の絶対値
 * - 片方のみ → その値（baseline までの控除距離）
 * - どちらも無い（首都高内のみ等） → 0
 */
export function computeDeduction({ outerRoute, entryIc, exitIc, deduction }) {
  const dir = outerRoute && outerRoute !== 'none' ? outerRoute : null;
  const entryDed = dir ? lookupDeduction(deduction, entryIc.id, dir) : null;
  const exitDed = dir ? lookupDeduction(deduction, exitIc.id, dir) : null;
  let km = 0;
  let note = null;
  if (entryDed && exitDed) {
    km = Math.abs(entryDed.km - exitDed.km);
    note = entryDed.note ?? exitDed.note ?? null;
  } else if (entryDed) {
    km = entryDed.km;
    note = entryDed.note ?? null;
  } else if (exitDed) {
    km = exitDed.km;
    note = exitDed.note ?? null;
  }
  return { km: Math.round(km * 10) / 10, note };
}

/**
 * 首都高セグメントの支払い区分（会社負担/自己負担）。
 * 外側高速経由なら会社負担。首都高内のみは入口ICの boundary_tag 次第。
 */
function computeShutokoPay({ outerRoute, entryIc, isOuter }) {
  if (isOuter) return 'company';
  if (outerRoute === 'gaikan_direct') return 'self';
  return entryIc.boundary_tag === 'company_pay_entry' ? 'company' : 'self';
}

/**
 * グラフ経路(path)を edge.route のカテゴリ（outer/gaikan/shutoko）で
 * 連続区間に分割し、segments[] を返す。各セグメントの distanceKm は
 * 区間内エッジ km の合計なので、全セグメント合計は経路の実距離に一致する。
 */
function splitPathToSegments(path, graph, { outerRoute, entryIc, ics }) {
  const edgeInfo = new Map();
  for (const e of graph.edges) {
    edgeInfo.set(`${e.from}|${e.to}`, { route: e.route, km: e.km });
    edgeInfo.set(`${e.to}|${e.from}`, { route: e.route, km: e.km });
  }
  const icById = new Map(ics.map(i => [i.id, i]));
  const nameOf = (id) => icById.get(id)?.name?.replace(/（[^）]*）/g, '').trim() ?? id;
  const isOuter = OUTER_TRUNK_ROUTES.has(outerRoute);

  const catOf = (route) => {
    if (route === 'gaikan') return 'gaikan';
    if (OUTER_GRAPH_ROUTES.has(route)) return 'outer';
    return 'shutoko';
  };

  const raw = [];
  for (let i = 0; i < path.length - 1; i++) {
    const info = edgeInfo.get(`${path[i]}|${path[i + 1]}`) ?? { route: null, km: 0 };
    const cat = catOf(info.route);
    const last = raw[raw.length - 1];
    if (last && last.category === cat) {
      last.km += info.km;
      last.toId = path[i + 1];
      last.nodes.push(path[i + 1]);
      last.routeCounts.set(info.route, (last.routeCounts.get(info.route) || 0) + 1);
    } else {
      raw.push({
        category: cat, km: info.km, fromId: path[i], toId: path[i + 1],
        nodes: [path[i], path[i + 1]],
        routeCounts: new Map([[info.route, 1]]),
      });
    }
  }

  return raw.map((s) => {
    let domRoute = null;
    let domN = -1;
    for (const [r, n] of s.routeCounts) {
      if (n > domN) { domRoute = r; domN = n; }
    }
    let pay;
    let name;
    let routeId;
    if (s.category === 'outer') {
      pay = 'company';
      name = ROUTE_LABEL[domRoute] ?? domRoute ?? '高速';
      routeId = domRoute;
    } else if (s.category === 'gaikan') {
      pay = isOuter ? 'company' : 'self';
      name = '外環道';
      routeId = 'gaikan';
    } else {
      pay = computeShutokoPay({ outerRoute, entryIc, isOuter });
      name = domRoute ? `首都高（${ROUTE_LABEL[domRoute] ?? domRoute}）` : '首都高';
      routeId = 'shutoko';
    }
    return {
      name,
      route: routeId,
      pay,
      deductionKm: 0,
      distanceKm: Math.round(s.km * 10) / 10,
      note: null,
      path: s.nodes,
      fromName: nameOf(s.fromId),
      toName: nameOf(s.toId),
    };
  });
}

function aggregate(segments, roundTrip) {
  const r1 = (n) => Math.round(n * 10) / 10;
  const totalDed = r1(segments.reduce((a, s) => a + s.deductionKm, 0));
  const totalDist = r1(segments.reduce((a, s) => a + s.distanceKm, 0));
  const pays = new Set(segments.map(s => s.pay));
  const paySummary = pays.size <= 1
    ? (pays.has('self') ? 'all_self' : 'all_company')
    : 'mixed';
  const notes = segments.map(s => s.note).filter(Boolean);
  return {
    paySummary,
    deductionKmOneway: totalDed,
    deductionKmRoundtrip: roundTrip ? r1(totalDed * 2) : totalDed,
    distanceKmOneway: totalDist,
    distanceKmRoundtrip: roundTrip ? r1(totalDist * 2) : totalDist,
    notes,
  };
}

/**
 * 入口IC×出口IC×外側高速ルートの経路判定。
 * 1本のグラフ経路を求め、区間分割で segments を作り、控除を別系統で算出する。
 *
 * @param pathOverride 明示的なグラフ経路（node id配列）。指定時は探索をスキップ。
 *                     app.js の variant（都心経路）展開で使用。
 * @returns {{ segments, path, totals }}
 */
export function judgeRoute({ outerRoute, entryIc, exitIc, roundTrip, pathOverride = null }, deps) {
  const { deduction, shutokoGraph, ics } = deps;
  const adj = getAdj(shutokoGraph);

  // 1. 経路（path）を決定: 明示指定 > ルート強制経由 > 通常最短
  let path = pathOverride;
  if ((!path || path.length < 2) && adj) {
    const via = OUTER_ROUTE_TO_GRAPH[outerRoute];
    let sp = via ? shortestPathVia(adj, shutokoGraph, entryIc.id, exitIc.id, via) : null;
    if (!sp || !sp.path || sp.path.length < 2) {
      sp = shortestPath(adj, entryIc.id, exitIc.id);
    }
    path = (sp && sp.path && sp.path.length >= 2) ? sp.path : null;
  }

  // 2. segments を生成（経路の区間分割）
  let segments;
  if (path && path.length >= 2) {
    segments = splitPathToSegments(path, shutokoGraph, { outerRoute, entryIc, ics });
  } else {
    // フォールバック: グラフにノードが無い等 → haversine 概算
    const isOuter = OUTER_TRUNK_ROUTES.has(outerRoute);
    let km = 0;
    if (entryIc.gps && exitIc.gps) {
      km = haversineKm(entryIc.gps, exitIc.gps) * SHUTOKO_DETOUR_FACTOR;
    }
    segments = [{
      name: '経路（概算）', route: 'shutoko',
      pay: computeShutokoPay({ outerRoute, entryIc, isOuter }),
      deductionKm: 0, distanceKm: Math.round(km * 10) / 10,
      note: '経路を直線距離から概算しています',
      path: null, fromName: entryIc.name, toName: exitIc.name,
    }];
  }

  // 3. 控除距離（deduction.json由来）を算出し、外側高速セグメントに載せる。
  //    控除は経路全体で1値。物理区間に按分しない（制度値のため）。
  const ded = computeDeduction({ outerRoute, entryIc, exitIc, deduction });
  if (ded.km > 0 && segments.length > 0) {
    const target = segments.find(s => s.route !== 'shutoko' && s.route !== 'gaikan')
      ?? segments.find(s => s.pay === 'company')
      ?? segments[0];
    target.deductionKm = ded.km;
    if (ded.note && !target.note) target.note = ded.note;
  }

  // 4. wangan_kanpachi 降車の特例（company-pay.json rule_wangan_kanpachi）:
  //    アクア/館山/横浜方面から戻って湾岸環八ICで降りる場合、最終区間は会社負担。
  if (exitIc.id === 'wangan_kanpachi' && [
    'aqua', 'tateyama', 'third_keihin', 'yokoyoko', 'yokohane_route',
    'kariba_route', 'wangan_route', 'hodogaya_route', 'hokuseisen_route', 'kitasen_route',
  ].includes(outerRoute) && segments.length > 0) {
    segments[segments.length - 1].pay = 'company';
  }

  return { segments, path, totals: aggregate(segments, roundTrip) };
}

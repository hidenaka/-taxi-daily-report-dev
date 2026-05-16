// judgeRoute の「総距離」がグラフ探索の物理距離と一致することの回帰テスト。
// 設計不変条件: judgeRoute が返す totals.distanceKmOneway は、
// その outerRoute をグラフ上で探索した経路距離と一致しなければならない
// （総距離と経路詳細が単一のグラフ経路から導かれる）。
import { test, assert } from './run.js';
import { readFileSync } from 'node:fs';
import { judgeRoute, OUTER_ROUTE_TO_GRAPH } from '../tools/js/judge.js';
import { getOuterRouteOptionsForIc } from '../tools/js/route-options.js';
import { buildAdjacency, shortestPath, shortestPathVia } from '../tools/js/shutoko-graph.js';
import { haversineKm } from '../tools/js/util.js';

const J = (p) => JSON.parse(readFileSync(p, 'utf-8'));
const deduction = J('tools/data/deduction.json');
const shutokoDist = J('tools/data/shutoko_distances.json');
const shutokoRoutes = J('tools/data/shutoko_routes.json');
const shutokoGraph = J('tools/data/shutoko_graph.json');
const gaikanDist = J('tools/data/gaikan_distances.json');
const routes = J('tools/data/routes.json');
const icsData = J('tools/data/ics.json');
const ics = icsData.ics;
const byId = new Map(ics.map((i) => [i.id, i]));
const deps = { deduction, shutokoDist, shutokoRoutes, shutokoGraph, gaikanDist, routes, ics };
const adj = buildAdjacency(shutokoGraph);

// renderJctDetails(app.js) と同じ探索: 強制経由 → ダメなら通常最短
// OUTER_ROUTE_TO_GRAPH は judge.js から import（定義の二重管理を避ける）
function graphDist(entryId, exitId, outerRoute) {
  const via = OUTER_ROUTE_TO_GRAPH[outerRoute];
  let sp = via ? shortestPathVia(adj, shutokoGraph, entryId, exitId, via) : null;
  if (!sp || !sp.path || sp.path.length < 2) sp = shortestPath(adj, entryId, exitId);
  return sp;
}

function checkPair(entryId, exitId) {
  const entry = byId.get(entryId);
  const exit = byId.get(exitId);
  assert.ok(entry && exit, `IC missing: ${entryId} / ${exitId}`);
  const opts = getOuterRouteOptionsForIc({ ic: entry, exitIc: exit, deduction });
  const violations = [];
  for (const opt of opts) {
    if (opt === 'none') continue;
    const r = judgeRoute(
      { outerRoute: opt, entryIc: entry, exitIc: exit, roundTrip: false }, deps);
    const sp = graphDist(entryId, exitId, opt);
    const total = r.totals.distanceKmOneway;
    console.log(`[${entryId}→${exitId} ${opt}] 総距離=${total}km / グラフ=${sp.km}km`);
    if (sp.km === null) continue;
    if (Math.abs(total - sp.km) > 1.5) {
      violations.push(`${opt}: 総距離${total}km ≠ グラフ${sp.km}km`);
    }
  }
  return violations;
}

test('総距離=グラフ探索: 川上IC→空港中央 の全候補', () => {
  const v = checkPair('kawakami', 'kukou_chuou');
  assert.equal(v.length, 0, '総距離が経路と乖離:\n' + v.join('\n'));
});

test('総距離=グラフ探索: 舞浜→空港中央（首都高内のみ）', () => {
  const v = checkPair('maihama', 'kukou_chuou');
  assert.equal(v.length, 0, '総距離が経路と乖離:\n' + v.join('\n'));
});

test('総距離=グラフ探索: 港北IC→玉川IC（第三京浜内完結）', () => {
  const v = checkPair('kohoku', 'tamagawa_ic');
  assert.equal(v.length, 0, '総距離が経路と乖離:\n' + v.join('\n'));
});

test('総距離=グラフ探索: 横浜方面の代表ペア', () => {
  const pairs = [
    ['totsuka', 'kukou_chuou'],   // 横浜新道→羽田
    ['imai', 'ginza'],            // 第三京浜→銀座
    ['yokosuka', 'kukou_chuou'],  // 横須賀方面→羽田
    ['sugita', 'ginza'],          // 湾岸線南部→銀座
  ];
  const allV = [];
  for (const [e, x] of pairs) {
    if (!byId.get(e) || !byId.get(x)) continue;
    allV.push(...checkPair(e, x));
  }
  assert.equal(allV.length, 0, '総距離が経路と乖離:\n' + allV.join('\n'));
});

test('総距離=グラフ探索: 関越方面（外環経由を含む）', () => {
  const v = checkPair('tsurugashima', 'ginza');
  assert.equal(v.length, 0, '総距離が経路と乖離:\n' + v.join('\n'));
});

// 全方面（東名/中央/関越/東北/常磐/京葉/東関東/アクア/館山/横浜/外環/首都高内）を
// 網羅し、judgeRoute の総距離が常にグラフ探索距離と一致し、かつ物理的に破綻
// （総距離 < 直線距離）しないことを保証する。
test('全エリア網羅: 全 entryable IC×代表出口で総距離=グラフ・物理破綻なし', () => {
  const exits = ['kukou_chuou', 'ginza', 'tokyo_ic', 'kasumigaseki'];
  const entryable = ics.filter((i) => i.entry_type === 'both');
  let checked = 0;
  const violations = [];
  for (const entry of entryable) {
    for (const exitId of exits) {
      const exit = byId.get(exitId);
      if (!exit || exit.id === entry.id) continue;
      const opts = getOuterRouteOptionsForIc({ ic: entry, exitIc: exit, deduction });
      const straight = (entry.gps && exit.gps) ? haversineKm(entry.gps, exit.gps) : 0;
      for (const opt of opts) {
        if (opt === 'none') continue;
        checked++;
        const r = judgeRoute(
          { outerRoute: opt, entryIc: entry, exitIc: exit, roundTrip: false }, deps);
        const total = r.totals.distanceKmOneway;
        const sp = graphDist(entry.id, exitId, opt);
        if (sp.km !== null && Math.abs(total - sp.km) > 1.5) {
          violations.push(`総距離≠グラフ: ${entry.id}→${exitId} ${opt}: ${total} vs ${sp.km.toFixed(1)}`);
        }
        if (straight > 0 && total > 0 && total < straight - 0.5) {
          violations.push(`直線より短い: ${entry.id}→${exitId} ${opt}: ${total} < ${straight.toFixed(1)}`);
        }
      }
    }
  }
  console.log(`[全エリア網羅] ${checked}件チェック, 違反${violations.length}`);
  if (violations.length) console.log('  ' + violations.slice(0, 10).join('\n  '));
  assert.equal(violations.length, 0, '総距離の一貫性/物理整合の違反');
});

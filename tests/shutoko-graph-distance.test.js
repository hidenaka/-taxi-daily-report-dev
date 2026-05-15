import { test, assert } from './run.js';
import { readFileSync } from 'node:fs';
import { buildAdjacency, shortestPath } from '../tools/js/shutoko-graph.js';

const graph = JSON.parse(readFileSync('tools/data/shutoko_graph.json', 'utf-8'));
const adj = buildAdjacency(graph);

test('graph: ichinohashi_jct ノードが存在する', () => {
  const node = graph.nodes.find((n) => n.id === 'ichinohashi_jct');
  assert.ok(node, 'ichinohashi_jct missing');
  assert.deepEqual(node.routes.sort(), ['2', 'C1'].sort());
});

test('graph: 2号目黒線本線が ichinohashi_jct を起点に再構成されている', () => {
  // 旧 shibaura→togoshi の代用edgeは削除されているはず
  const oldEdge = graph.edges.find((e) =>
    (e.from === 'shibaura' && e.to === 'togoshi') ||
    (e.from === 'togoshi' && e.to === 'shibaura'));
  assert.equal(oldEdge, undefined, '旧 shibaura↔togoshi edge が残存');

  // 新 edges (Wikipedia公式km値)
  const needed = [
    { from: 'ichinohashi_jct', to: 'meguro', km: 3.6 },
    { from: 'meguro', to: 'ebara', km: 2.2 },
    { from: 'ebara', to: 'togoshi', km: 0.1 },
    { from: 'ichinohashi_jct', to: 'iikura', km: 0.6 },
  ];
  for (const n of needed) {
    const found = graph.edges.find((e) =>
      (e.from === n.from && e.to === n.to && e.km === n.km) ||
      (e.from === n.to && e.to === n.from && e.km === n.km));
    assert.ok(found, `missing edge: ${n.from}↔${n.to} ${n.km}km`);
  }
});

test('distance: 目黒→空港中央 が 戸越→空港中央 より短い', () => {
  const t = shortestPath(adj, 'togoshi', 'kukou_chuou');
  const m = shortestPath(adj, 'meguro', 'kukou_chuou');
  console.log(`[distance] togoshi→kukou_chuou: ${t.km}km / meguro→kukou_chuou: ${m.km}km`);
  assert.ok(m.km < t.km, `目黒(${m.km}) が戸越(${t.km})以上`);
});

test('distance: 一ノ橋JCT までの距離順 (Wikipedia公式) と一致', () => {
  // Wikipedia: 一ノ橋JCT 0.0 / 目黒 3.6 / 荏原 5.8 / 戸越 5.9
  const expected = { meguro: 3.6, ebara: 5.8, togoshi: 5.9 };
  for (const [icId, exp] of Object.entries(expected)) {
    const r = shortestPath(adj, icId, 'ichinohashi_jct');
    assert.ok(Math.abs(r.km - exp) < 0.05, `${icId} → ichinohashi_jct: 期待 ${exp}km, 実際 ${r.km}km`);
  }
});

test('distance: 目黒→空港中央 の経路が一ノ橋JCT を経由する', () => {
  const r = shortestPath(adj, 'meguro', 'kukou_chuou');
  assert.ok(r.path.includes('ichinohashi_jct'), `経路に一ノ橋JCTが含まれない: ${r.path.join('→')}`);
});

test('distance: meguro→kukou_chuou が物理的に妥当な範囲 (20-30km)', () => {
  const r = shortestPath(adj, 'meguro', 'kukou_chuou');
  assert.ok(r.km >= 20 && r.km <= 30, `${r.km}km は範囲外`);
});

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

  // 新 edges (Wikipedia公式km値): 戸越と荏原は分岐 (本線を共有しない)
  const needed = [
    { from: 'ichinohashi_jct', to: 'meguro', km: 3.6 },
    { from: 'meguro', to: 'ebara', km: 2.2 },
    { from: 'togoshi', to: 'meguro', km: 2.3 },
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

test('distance: meguro→kukou_chuou が物理的に妥当な範囲 (15-30km)', () => {
  const r = shortestPath(adj, 'meguro', 'kukou_chuou');
  console.log(`[meguro→kukou_chuou] ${r.km}km path: ${r.path.join('→')}`);
  assert.ok(r.km >= 15 && r.km <= 30, `${r.km}km は範囲外`);
});

test('graph: 第三京浜の主要IC が node 登録されている', () => {
  const ids = ['keihin_kawasaki', 'tsuzuki', 'kohoku', 'hodogaya'];
  for (const id of ids) {
    const n = graph.nodes.find((x) => x.id === id);
    assert.ok(n, `node missing: ${id}`);
  }
});

test('graph: yokohama_kohoku が 3路線(K7/K7_hokusei/third_keihin) 接続', () => {
  const n = graph.nodes.find((x) => x.id === 'yokohama_kohoku');
  for (const r of ['K7', 'K7_hokusei', 'third_keihin']) {
    assert.ok(n.routes.includes(r), `route ${r} missing on yokohama_kohoku`);
  }
});

test('distance: 第三京浜本線 (玉川IC→保土ヶ谷IC) が Wikipedia 公式値と±1km以内で一致', () => {
  const r = shortestPath(adj, 'tamagawa_ic', 'hodogaya');
  // Wikipedia: 玉川IC 0.0km → 保土ヶ谷IC 16.0km
  // 整備値合計: 2.2+5.4+3.1+0+5.3 = 16.0km
  console.log(`[third_keihin trunk] tamagawa_ic→hodogaya: ${r.km}km`);
  assert.ok(Math.abs(r.km - 16.0) < 1.0, `${r.km}km は Wikipedia 16.0km から1km以上乖離`);
});

test('distance: yokohama_aoba → kohoku (北西線→第三京浜) で 横浜港北JCT 経由経路が成立', () => {
  const r = shortestPath(adj, 'yokohama_aoba', 'kohoku');
  console.log(`[k7_hokusei→third_keihin via kohoku_jct] yokohama_aoba→kohoku: ${r.km}km path: ${r.path.join('→')}`);
  assert.ok(r.path.includes('yokohama_kohoku'), '横浜港北JCT経由してない');
  // 期待: 7.1 (北西線) + 0 (JCT) = 7.1km
  assert.ok(Math.abs(r.km - 7.1) < 0.5);
});

test('graph: 大泉JCT (oizumi_jct) が node 登録、関越+外環 接続', () => {
  const n = graph.nodes.find((x) => x.id === 'oizumi_jct');
  assert.ok(n, 'oizumi_jct missing');
  for (const r of ['kanetsu', 'gaikan']) {
    assert.ok(n.routes.includes(r), `route ${r} missing on oizumi_jct`);
  }
});

test('distance: 練馬IC → 美女木JCT (関越→外環) が 大泉JCT 経由', () => {
  const r = shortestPath(adj, 'nerima', 'bijogi_jct');
  console.log(`[kanetsu→gaikan via oizumi_jct] nerima→bijogi_jct: ${r.km}km path: ${r.path.join('→')}`);
  assert.ok(r.path.includes('oizumi_jct'), '大泉JCT経由してない');
  assert.ok(Math.abs(r.km - 8.5) < 0.5, `${r.km}km, 期待は 8.5km前後`);
});

test('graph: 浜崎橋JCT + 芝公園 が node 登録されている', () => {
  for (const id of ['hamazakibashi_jct', 'shibakoen']) {
    const n = graph.nodes.find((x) => x.id === id);
    assert.ok(n, `node missing: ${id}`);
  }
});

test('distance: 汐留JCT→飯倉 (C1経由) が Wikipedia 公式合計 3.8km と一致', () => {
  const r = shortestPath(adj, 'shiodome_jct', 'iikura');
  // 0.9 + 0.9 + 1.4 + 0.6 = 3.8km
  console.log(`[C1 trunk] shiodome_jct→iikura: ${r.km}km path: ${r.path.join('→')}`);
  assert.ok(Math.abs(r.km - 3.8) < 0.2, `${r.km}km, Wikipedia 3.8km から乖離`);
  assert.ok(r.path.includes('hamazakibashi_jct'), '浜崎橋JCT経由してない');
  assert.ok(r.path.includes('ichinohashi_jct'), '一ノ橋JCT経由してない');
});

test('distance: shibaura(1号羽田線) → C1 経路が浜崎橋JCT経由', () => {
  const r = shortestPath(adj, 'shibaura', 'shiodome_jct');
  console.log(`[1→C1 via hamazakibashi_jct] shibaura→shiodome_jct: ${r.km}km path: ${r.path.join('→')}`);
  assert.ok(r.path.includes('hamazakibashi_jct'));
  // 芝浦→芝浦JCT(1.2) + 芝浦JCT→浜崎橋JCT(0.5) + 浜崎橋JCT→汐留JCT(0.9) = 2.6km
  assert.ok(Math.abs(r.km - 2.6) < 0.5, `${r.km}km, 期待2.6km前後`);
});

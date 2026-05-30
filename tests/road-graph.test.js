import { test, assert } from './run.js';
import { routeOnGraph, extendToArterial } from '../scripts/lib/road-graph.mjs';

// L字の道路網: wayA(水平) と wayB(垂直) が角 (35.660,139.732) で接続。
const wayA = { geometry: [
  { lat: 35.660, lng: 139.730 }, { lat: 35.660, lng: 139.731 }, { lat: 35.660, lng: 139.732 },
] };
const wayB = { geometry: [
  { lat: 35.660, lng: 139.732 }, { lat: 35.659, lng: 139.732 }, { lat: 35.658, lng: 139.732 },
] };

test('routeOnGraph: L字を角で曲がって辿る(直線でショートカットしない)', () => {
  const a = { lat: 35.660, lng: 139.730 };
  const b = { lat: 35.658, lng: 139.732 };
  const path = routeOnGraph(a, b, [wayA, wayB]);
  assert.ok(path && path.length >= 4, 'path should bend through the corner');
  // 角(35.660,139.732)を通る
  const hasCorner = path.some((p) => Math.abs(p.lat - 35.660) < 1e-6 && Math.abs(p.lng - 139.732) < 1e-6);
  assert.ok(hasCorner, 'path must pass the L corner');
  // 端点は実a,b
  assert.ok(Math.abs(path[0].lat - a.lat) < 1e-9 && Math.abs(path[0].lng - a.lng) < 1e-9);
  assert.ok(Math.abs(path[path.length - 1].lat - b.lat) < 1e-9);
});

test('routeOnGraph: 連結なしは null', () => {
  const far = { geometry: [{ lat: 35.700, lng: 139.800 }, { lat: 35.701, lng: 139.800 }] };
  const path = routeOnGraph({ lat: 35.660, lng: 139.730 }, { lat: 35.700, lng: 139.800 }, [wayA, far]);
  assert.equal(path, null);
});

test('routeOnGraph: 道路から遠い点は null (呼び出し側が直線にフォールバック)', () => {
  const a = { lat: 35.660, lng: 139.730 };
  const bFar = { lat: 35.670, lng: 139.745 }; // 道路から1km以上
  const path = routeOnGraph(a, bFar, [wayA, wayB], 35);
  assert.equal(path, null);
});

test('routeOnGraph: ways空なら null', () => {
  assert.equal(routeOnGraph({ lat: 35.66, lng: 139.73 }, { lat: 35.66, lng: 139.74 }, []), null);
});

// 幹線(primary)が東西に走り、線は (139.730) から西へ→南へ入口。
// 外側=東。extendToArterial は東へ幹線上を延長して起点を 139.731 側にする。
const arterialPrimary = {
  tags: { highway: 'primary' },
  geometry: [
    { lat: 35.6605, lng: 139.728 }, { lat: 35.6605, lng: 139.729 },
    { lat: 35.6605, lng: 139.730 }, { lat: 35.6605, lng: 139.731 },
  ],
};
const localRoad = {
  tags: { highway: 'residential' },
  geometry: [{ lat: 35.6605, lng: 139.729 }, { lat: 35.660, lng: 139.729 }],
};

test('extendToArterial: 起点を外側方向の幹線へ延長する', () => {
  const line = [
    { lat: 35.6605, lng: 139.730 }, { lat: 35.6605, lng: 139.729 }, { lat: 35.660, lng: 139.729 },
  ];
  const pin = { lat: 35.660, lng: 139.729 };
  const out = extendToArterial(line, [arterialPrimary, localRoad], pin);
  assert.ok(out.length > line.length, '延長で点が増える');
  // 起点が東へ移動（139.731 側）
  assert.ok(out[0].lng > 139.7305, `延長後の起点が東へ: ${out[0].lng}`);
  // 元の入口(終点)は保持
  const end = out[out.length - 1];
  assert.ok(Math.abs(end.lat - 35.660) < 1e-6 && Math.abs(end.lng - 139.729) < 1e-6);
});

test('routeOnGraph: 一方通行(oneway=yes)を尊重する', () => {
  // 西→東(139.730→139.731)のみ通行可。
  const oneway = {
    tags: { highway: 'residential', oneway: 'yes' },
    geometry: [{ lat: 35.660, lng: 139.730 }, { lat: 35.660, lng: 139.731 }],
  };
  const a = { lat: 35.660, lng: 139.730 };
  const b = { lat: 35.660, lng: 139.731 };
  assert.ok(routeOnGraph(a, b, [oneway]), '順方向(西→東)は通れる');
  assert.equal(routeOnGraph(b, a, [oneway]), null, '逆走(東→西)は不可→null');
});

test('extendToArterial: 幹線が無ければ元のline', () => {
  const line = [{ lat: 35.6605, lng: 139.730 }, { lat: 35.660, lng: 139.729 }];
  const out = extendToArterial(line, [localRoad], { lat: 35.660, lng: 139.729 });
  assert.deepEqual(out, line);
});

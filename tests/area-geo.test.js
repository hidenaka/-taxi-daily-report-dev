// 町の代表座標を使った「近いのに候補に入っていない町」の割り出し
//
// なぜ要るか: 近隣の判定は「過去に25分以内で行き来した実績」だけで決めていた。
// 実績がある＝そこが良かった、ではないし、実績が無い＝悪い、でもない。
// 実測(本番345乗務)では、距離2km以内で新しく近所になる町201件のうち36%が、
// いまの近所の平均単価を上回っていた。つまり「近いのに候補にすら入らない町」があった。
import { test } from 'node:test';
import assert from 'node:assert';
import { distanceKm, lookupCoord, nearbyUnexploredAreas } from '../js/area-geo.js';

// 東京の実在する町のおおよその代表点
const COORDS = {
  '港区赤坂': [35.6726, 139.7371],
  '港区六本木': [35.6641, 139.7315],      // 赤坂から約1.0km
  '千代田区内幸町': [35.6706, 139.7565],  // 赤坂から約1.8km
  '千代田区麹町': [35.6857, 139.7383],    // 赤坂から約1.5km
  '世田谷区成城': [35.6404, 139.5979],    // 赤坂から約13km
  '渋谷区千駄ケ谷': [35.6807, 139.7106],
};

test('2点間の距離をkmで返す', () => {
  const d = distanceKm(COORDS['港区赤坂'], COORDS['港区六本木']);
  assert.ok(d > 0.8 && d < 1.3, `赤坂-六本木 は約1km のはず (実際 ${d})`);
  const far = distanceKm(COORDS['港区赤坂'], COORDS['世田谷区成城']);
  assert.ok(far > 10, `赤坂-成城 は10km超のはず (実際 ${far})`);
});

test('同じ地点なら0km', () => {
  assert.strictEqual(Math.round(distanceKm(COORDS['港区赤坂'], COORDS['港区赤坂'])), 0);
});

test('座標が引けない町は null', () => {
  assert.strictEqual(lookupCoord('架空区どこか町', COORDS), null);
  assert.strictEqual(lookupCoord('', COORDS), null);
  assert.strictEqual(lookupCoord(null, COORDS), null);
});

test('「ヶ」「ケ」の書き分けを吸収して引ける', () => {
  assert.deepStrictEqual(lookupCoord('渋谷区千駄ヶ谷', COORDS), COORDS['渋谷区千駄ケ谷']);
  assert.deepStrictEqual(lookupCoord('渋谷区千駄ケ谷', COORDS), COORDS['渋谷区千駄ケ谷']);
});

// --- 近いのに候補に入っていない町 ---
const boardStats = {
  '港区六本木':     { count: 40, avgSales: 3300 },
  '千代田区内幸町': { count: 27, avgSales: 4954 },
  '千代田区麹町':   { count: 25, avgSales: 3580 },
  '世田谷区成城':   { count: 10, avgSales: 6000 },
};

test('近くにあって、いまの近所に入っていない町だけを返す', () => {
  const r = nearbyUnexploredAreas({
    area: '港区赤坂',
    neighbors: new Set(['港区六本木']),   // 六本木は既に近所として入っている
    coords: COORDS,
    boardStats,
    radiusKm: 2,
  });
  const names = r.map(x => x.area);
  assert.ok(!names.includes('港区六本木'), '既に近所の町は出さない');
  assert.ok(!names.includes('港区赤坂'), '自分自身は出さない');
  assert.ok(names.includes('千代田区内幸町'));
  assert.ok(names.includes('千代田区麹町'));
  assert.ok(!names.includes('世田谷区成城'), '2kmより遠い町は出さない');
});

test('乗せた実績が少ない町は出さない(評価できないため)', () => {
  const r = nearbyUnexploredAreas({
    area: '港区赤坂',
    neighbors: new Set(),
    coords: COORDS,
    boardStats: { ...boardStats, '千代田区麹町': { count: 2, avgSales: 3580 } },
    radiusKm: 2,
    minBoardCount: 3,
  });
  assert.ok(!r.some(x => x.area === '千代田区麹町'));
});

test('単価の高い順に並び、距離も返す', () => {
  const r = nearbyUnexploredAreas({
    area: '港区赤坂', neighbors: new Set(), coords: COORDS, boardStats, radiusKm: 2,
  });
  assert.strictEqual(r[0].area, '千代田区内幸町');
  assert.ok(r[0].avgSales > r[1].avgSales);
  assert.ok(r[0].km > 0 && r[0].km < 2);
});

test('座標が無い起点なら空配列(落ちない)', () => {
  const r = nearbyUnexploredAreas({
    area: '架空区どこか町', neighbors: new Set(), coords: COORDS, boardStats, radiusKm: 2,
  });
  assert.deepStrictEqual(r, []);
});

test('件数を絞れる', () => {
  const r = nearbyUnexploredAreas({
    area: '港区赤坂', neighbors: new Set(), coords: COORDS, boardStats, radiusKm: 2, limit: 1,
  });
  assert.strictEqual(r.length, 1);
});

// --- いまいる座標を起点に、実績のある場所を探す ---
// これまでは GPS の緯度経度を町名の文字に変えてから、過去データの町名と
// 文字くらべしていた。町名が過去データに無いと「同じ区で名前が似ている町」を
// 起点にしており、実測ではあてずっぽう(15%)と同じ精度だった。
// 座標を持っているのだから、そのまま距離で探すのが正しい。
import { areasNearPoint } from '../js/area-geo.js';

const AREA_STATS = {
  '港区六本木':     { count: 40 },
  '千代田区内幸町': { count: 27 },
  '千代田区麹町':   { count: 25 },
  '世田谷区成城':   { count: 10 },
  '港区元赤坂':     { count: 2 },   // 実績が薄い
};

test('いまいる座標から近い順に、実績のある場所を返す', () => {
  const here = [35.6726, 139.7371];   // 港区赤坂あたり
  const r = areasNearPoint(here, COORDS, AREA_STATS, { radiusKm: 2 });
  const names = r.map(x => x.area);
  assert.ok(names.includes('港区六本木'));
  assert.ok(names.includes('千代田区麹町'));
  assert.ok(!names.includes('世田谷区成城'), '2kmより遠い場所は出さない');
  // 近い順
  for (let i = 1; i < r.length; i++) assert.ok(r[i].km >= r[i - 1].km, '近い順に並ぶ');
});

test('実績が薄い場所は出さない', () => {
  const r = areasNearPoint([35.6726, 139.7371], COORDS, AREA_STATS, { radiusKm: 2, minCount: 3 });
  assert.ok(!r.some(x => x.area === '港区元赤坂'));
});

test('座標が無い/半径内に何も無いなら空配列', () => {
  assert.deepStrictEqual(areasNearPoint(null, COORDS, AREA_STATS), []);
  assert.deepStrictEqual(areasNearPoint([0, 0], COORDS, AREA_STATS, { radiusKm: 2 }), []);
});

test('半径を広げれば遠い場所も入る', () => {
  const here = [35.6726, 139.7371];
  const near = areasNearPoint(here, COORDS, AREA_STATS, { radiusKm: 2 });
  const wide = areasNearPoint(here, COORDS, AREA_STATS, { radiusKm: 20 });
  assert.ok(wide.length > near.length);
  assert.ok(wide.some(x => x.area === '世田谷区成城'));
});

test('件数を絞れる', () => {
  const r = areasNearPoint([35.6726, 139.7371], COORDS, AREA_STATS, { radiusKm: 20, limit: 2 });
  assert.strictEqual(r.length, 2);
});

test('起点の座標を直接渡せる(GPSで町名が引けないときのため)', () => {
  const here = [35.6726, 139.7371];   // 港区赤坂あたり。この町名は coords に無くてもよい
  const r = nearbyUnexploredAreas({
    area: '存在しない町', originPoint: here,
    neighbors: new Set(), coords: COORDS, boardStats, radiusKm: 2,
  });
  assert.ok(r.some(x => x.area === '千代田区内幸町'));
  assert.ok(!r.some(x => x.area === '世田谷区成城'));
});

test('起点の座標を渡した場合も、既に近所の場所は出さない', () => {
  const r = nearbyUnexploredAreas({
    area: '存在しない町', originPoint: [35.6726, 139.7371],
    neighbors: new Set(['千代田区内幸町']), coords: COORDS, boardStats, radiusKm: 2,
  });
  assert.ok(!r.some(x => x.area === '千代田区内幸町'));
});

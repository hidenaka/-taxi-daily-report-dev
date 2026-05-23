import { test, assert } from './run.js';
import { bearingDeg, findNearestStands, arrowMarkersForRoute } from '../tools/js/stands-geo.js';

test('bearingDeg: 真東は約90度', () => {
  const b = bearingDeg({ lat: 35.7, lng: 139.7 }, { lat: 35.7, lng: 139.8 });
  assert.ok(Math.abs(b - 90) < 1, `got ${b}`);
});

test('bearingDeg: 真北は約0度', () => {
  const b = bearingDeg({ lat: 35.7, lng: 139.7 }, { lat: 35.8, lng: 139.7 });
  assert.ok(b < 1 || b > 359, `got ${b}`);
});

test('findNearestStands: pin が近い順に n 件', () => {
  const here = { lat: 35.66, lng: 139.73 };
  const stands = [
    { id: 'far', pin: { lat: 35.80, lng: 139.90 } },
    { id: 'near', pin: { lat: 35.661, lng: 139.731 } },
    { id: 'mid', pin: { lat: 35.70, lng: 139.75 } },
  ];
  const r = findNearestStands(here, stands, 2);
  assert.equal(r.length, 2);
  assert.equal(r[0].stand.id, 'near');
  assert.ok(r[0].distKm < r[1].distKm);
});

test('findNearestStands: pos が null なら空配列', () => {
  assert.deepEqual(findNearestStands(null, [{ id: 'a', pin: { lat: 35.7, lng: 139.7 } }], 3), []);
});

test('arrowMarkersForRoute: 各セグメント中点に向き付きで返る', () => {
  const pts = [{ lat: 35.70, lng: 139.70 }, { lat: 35.70, lng: 139.72 }, { lat: 35.71, lng: 139.72 }];
  const arrows = arrowMarkersForRoute(pts);
  assert.equal(arrows.length, 2);
  assert.ok(Math.abs(arrows[0].angleDeg - 90) < 2);
  assert.ok('lat' in arrows[0] && 'lng' in arrows[0]);
});

test('arrowMarkersForRoute: 点が1個以下なら空', () => {
  assert.deepEqual(arrowMarkersForRoute([{ lat: 35.7, lng: 139.7 }]), []);
  assert.deepEqual(arrowMarkersForRoute([]), []);
});

import { test, assert } from './run.js';
import { routeOnRoadsBetween } from '../scripts/lib/road-router.mjs';

// 東西の道路 (5点)
const eastWest = {
  geometry: [
    { lat: 35.66, lng: 139.72 }, { lat: 35.66, lng: 139.725 },
    { lat: 35.66, lng: 139.73 }, { lat: 35.66, lng: 139.735 }, { lat: 35.66, lng: 139.74 },
  ],
};
// 南北の道路
const northSouth = {
  geometry: [
    { lat: 35.665, lng: 139.73 }, { lat: 35.66, lng: 139.73 },
    { lat: 35.655, lng: 139.73 }, { lat: 35.65, lng: 139.73 },
  ],
};

test('routeOnRoadsBetween: 同じ道路上の2点を道路polyで繋ぐ', () => {
  // A,Bは道路頂点(lng=139.725, 139.735)から数mズレているだけ
  const A = { lat: 35.66001, lng: 139.7251 };
  const B = { lat: 35.66001, lng: 139.7349 };
  const line = routeOnRoadsBetween(A, B, [eastWest, northSouth]);
  assert.ok(line, 'line is not null');
  assert.equal(line[0].lat, A.lat);
  assert.equal(line[0].lng, A.lng);
  assert.equal(line[line.length - 1].lng, B.lng);
  assert.ok(line.length >= 3);
});

test('routeOnRoadsBetween: 道路から遠い2点は null', () => {
  const A = { lat: 35.70, lng: 139.72 };  // 道路から遠い
  const B = { lat: 35.70, lng: 139.74 };
  const r = routeOnRoadsBetween(A, B, [eastWest, northSouth]);
  assert.equal(r, null);
});

test('routeOnRoadsBetween: 片方だけ近い場合も null', () => {
  const A = { lat: 35.66, lng: 139.722 };
  const B = { lat: 35.70, lng: 139.722 };
  assert.equal(routeOnRoadsBetween(A, B, [eastWest]), null);
});

test('routeOnRoadsBetween: ways 空なら null', () => {
  const A = { lat: 35.66, lng: 139.722 };
  const B = { lat: 35.66, lng: 139.738 };
  assert.equal(routeOnRoadsBetween(A, B, []), null);
});

test('routeOnRoadsBetween: 同じ点なら長さ2の[A,A]を返す', () => {
  const A = { lat: 35.66, lng: 139.7251 };
  const line = routeOnRoadsBetween(A, A, [eastWest]);
  assert.ok(line);
  assert.equal(line.length, 2);
});

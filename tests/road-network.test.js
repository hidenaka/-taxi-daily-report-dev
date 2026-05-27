import { test, assert } from './run.js';
import {
  mergeWaysToPolyline, nearestPointOnPolyline, directionalEndpoint,
} from '../scripts/lib/road-network.mjs';

const ways = [
  { geometry: [{ lat: 35.66, lng: 139.72 }, { lat: 35.66, lng: 139.73 }] },
  { geometry: [{ lat: 35.66, lng: 139.73 }, { lat: 35.66, lng: 139.74 }] },
  { geometry: [{ lat: 35.66, lng: 139.74 }, { lat: 35.66, lng: 139.75 }] },
];

test('mergeWaysToPolyline: 端点共有のways3本を1本のpolylineに結合', () => {
  const poly = mergeWaysToPolyline(ways);
  assert.equal(poly.length, 4);
  assert.equal(poly[0].lng, 139.72);
  assert.equal(poly[3].lng, 139.75);
});

test('mergeWaysToPolyline: 逆向きwayも吸収（端点でマージ）', () => {
  const reversed = [
    { geometry: [{ lat: 35.66, lng: 139.73 }, { lat: 35.66, lng: 139.72 }] },
    { geometry: [{ lat: 35.66, lng: 139.73 }, { lat: 35.66, lng: 139.74 }] },
  ];
  const poly = mergeWaysToPolyline(reversed);
  assert.equal(poly.length, 3);
});

test('mergeWaysToPolyline: 空配列なら空', () => {
  assert.deepEqual(mergeWaysToPolyline([]), []);
});

test('nearestPointOnPolyline: pinに最も近い点を返す', () => {
  const poly = [{ lat: 35.66, lng: 139.72 }, { lat: 35.66, lng: 139.73 }, { lat: 35.66, lng: 139.74 }];
  const r = nearestPointOnPolyline(poly, { lat: 35.66, lng: 139.7305 });
  assert.equal(r.index, 1);
  assert.ok(Math.abs(r.point.lng - 139.7305) < 0.001);
});

test('directionalEndpoint: east 指定で polyline の東端を返す', () => {
  const poly = [{ lat: 35.66, lng: 139.72 }, { lat: 35.66, lng: 139.75 }];
  const p = directionalEndpoint(poly, { lat: 35.66, lng: 139.735 }, 'east');
  assert.equal(p.lng, 139.75);
});

test('directionalEndpoint: north 指定で polyline の北端を返す', () => {
  const poly = [{ lat: 35.65, lng: 139.73 }, { lat: 35.67, lng: 139.73 }];
  const p = directionalEndpoint(poly, { lat: 35.66, lng: 139.73 }, 'north');
  assert.equal(p.lat, 35.67);
});

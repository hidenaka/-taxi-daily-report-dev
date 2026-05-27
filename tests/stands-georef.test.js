import { test, assert } from './run.js';
import { computeHomography, applyHomography, applyToPdfLines } from '../tools/js/stands-georef.js';

// 既知の変換: pdf(100,100)→geo(35.66,139.73), 平行移動＋スケール
const simplePairs = [
  { pdf: { x: 0,   y: 0   }, geo: { lat: 35.670, lng: 139.720 } },
  { pdf: { x: 100, y: 0   }, geo: { lat: 35.670, lng: 139.730 } },
  { pdf: { x: 0,   y: 100 }, geo: { lat: 35.660, lng: 139.720 } },
  { pdf: { x: 100, y: 100 }, geo: { lat: 35.660, lng: 139.730 } },
];

test('computeHomography: 4点の既知変換を正しく解ける', () => {
  const H = computeHomography(simplePairs);
  assert.ok(H, 'H is non-null');
  const out = applyHomography(H, [{ x: 0, y: 0 }, { x: 100, y: 100 }]);
  assert.ok(Math.abs(out[0].lat - 35.670) < 1e-4, `lat0 got ${out[0].lat}`);
  assert.ok(Math.abs(out[0].lng - 139.720) < 1e-4, `lng0 got ${out[0].lng}`);
  assert.ok(Math.abs(out[1].lat - 35.660) < 1e-4, `lat1 got ${out[1].lat}`);
  assert.ok(Math.abs(out[1].lng - 139.730) < 1e-4, `lng1 got ${out[1].lng}`);
});

test('computeHomography: 中点も正しく補間される', () => {
  const H = computeHomography(simplePairs);
  const mid = applyHomography(H, [{ x: 50, y: 50 }])[0];
  assert.ok(Math.abs(mid.lat - 35.665) < 1e-4, `mid lat ${mid.lat}`);
  assert.ok(Math.abs(mid.lng - 139.725) < 1e-4, `mid lng ${mid.lng}`);
});

test('computeHomography: 3点（アフィン）でも解ける', () => {
  const H = computeHomography(simplePairs.slice(0, 3));
  assert.ok(H, '3点で H 取得できる');
  const out = applyHomography(H, [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 100 }]);
  assert.ok(Math.abs(out[0].lat - 35.670) < 1e-4);
  assert.ok(Math.abs(out[2].lat - 35.660) < 1e-4);
});

test('computeHomography: 2点以下は null', () => {
  assert.equal(computeHomography(simplePairs.slice(0, 2)), null);
  assert.equal(computeHomography([]), null);
});

test('computeHomography: 一直線上の3点は null（特異）', () => {
  const colinear = [
    { pdf: { x: 0, y: 0 }, geo: { lat: 35.66, lng: 139.72 } },
    { pdf: { x: 1, y: 0 }, geo: { lat: 35.66, lng: 139.73 } },
    { pdf: { x: 2, y: 0 }, geo: { lat: 35.66, lng: 139.74 } },
  ];
  assert.equal(computeHomography(colinear), null);
});

test('applyToPdfLines: pdfLines → line(lat,lng) 配列', () => {
  const H = computeHomography(simplePairs);
  const pdfLines = [{ x: 0, y: 0 }, { x: 100, y: 100 }];
  const line = applyToPdfLines(H, pdfLines);
  assert.equal(line.length, 2);
  assert.ok(Math.abs(line[0].lat - 35.670) < 1e-4);
  assert.ok(Math.abs(line[1].lng - 139.730) < 1e-4);
});

test('applyToPdfLines: H が null なら空配列', () => {
  assert.deepEqual(applyToPdfLines(null, [{ x: 0, y: 0 }]), []);
});

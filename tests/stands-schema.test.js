import { test, assert } from './run.js';
import {
  STAND_CATEGORIES, validateStand, normalizeStand,
} from '../tools/js/stands-schema.js';

const valid = {
  name: '六本木ヒルズ',
  category: 'commercial',
  pin: { lat: 35.6605, lng: 139.7292 },
  routes: [{ points: [{ lat: 35.6612, lng: 139.7305 }, { lat: 35.6605, lng: 139.7292 }], label: '進入', kind: 'approach' }],
  notes: 'けやき坂側から進入。',
};

test('validateStand: 正常データは valid', () => {
  const r = validateStand(valid);
  assert.equal(r.valid, true);
  assert.deepEqual(r.errors, []);
});

test('validateStand: name 空は invalid', () => {
  const r = validateStand({ ...valid, name: '  ' });
  assert.equal(r.valid, false);
  assert.ok(r.errors.some(e => e.includes('name')));
});

test('validateStand: pin 範囲外(東京外)は invalid', () => {
  const r = validateStand({ ...valid, pin: { lat: 10, lng: 10 } });
  assert.equal(r.valid, false);
  assert.ok(r.errors.some(e => e.includes('pin')));
});

test('validateStand: routes の points が1点は invalid', () => {
  const r = validateStand({ ...valid, routes: [{ points: [{ lat: 35.66, lng: 139.73 }] }] });
  assert.equal(r.valid, false);
  assert.ok(r.errors.some(e => e.includes('route')));
});

test('validateStand: routes 省略は valid（ピンのみ可）', () => {
  const { routes, ...noRoutes } = valid;
  assert.equal(validateStand(noRoutes).valid, true);
});

test('normalizeStand: 不正categoryは既定(other)・notes/routes欠落は補完', () => {
  const n = normalizeStand({ name: 'X', pin: { lat: 35.7, lng: 139.7 }, category: 'zzz' });
  assert.equal(n.category, 'other');
  assert.equal(n.notes, '');
  assert.deepEqual(n.routes, []);
  assert.equal(n.name, 'X');
});

test('normalizeStand: name 前後空白をtrim', () => {
  assert.equal(normalizeStand({ name: '  泉ガーデン ', pin: { lat: 35.7, lng: 139.7 } }).name, '泉ガーデン');
});

test('STAND_CATEGORIES に other を含む', () => {
  assert.ok(STAND_CATEGORIES.includes('other'));
});

test('validateStand: overlay.corners が[lat,lng]×4なら valid', () => {
  const ov = { corners: [[35.66, 139.72], [35.66, 139.73], [35.65, 139.72], [35.65, 139.73]] };
  assert.equal(validateStand({ ...valid, overlay: ov }).valid, true);
});

test('validateStand: overlay.corners が3点は invalid', () => {
  const r = validateStand({ ...valid, overlay: { corners: [[35.66, 139.72], [35.66, 139.73], [35.65, 139.72]] } });
  assert.equal(r.valid, false);
  assert.ok(r.errors.some(e => e.includes('overlay')));
});

test('normalizeStand: overlay 無しは null', () => {
  assert.equal(normalizeStand({ name: 'X', pin: { lat: 35.7, lng: 139.7 } }).overlay, null);
});

test('validateStand: markers 正常（lat/lng+label）は valid', () => {
  const r = validateStand({ ...valid, markers: [{ lat: 35.6605, lng: 139.7292, label: 'タクシーベイ', kind: 'bay' }] });
  assert.equal(r.valid, true);
});

test('validateStand: marker に label 無しは invalid', () => {
  const r = validateStand({ ...valid, markers: [{ lat: 35.6605, lng: 139.7292 }] });
  assert.equal(r.valid, false);
  assert.ok(r.errors.some(e => e.includes('marker')));
});

test('normalizeStand: images は文字列のみ通す・欠落は空配列', () => {
  const n = normalizeStand({ name: 'X', pin: { lat: 35.7, lng: 139.7 }, images: ['a-1.jpg', '', 3, 'b-2.jpg'] });
  assert.deepEqual(n.images, ['a-1.jpg', 'b-2.jpg']);
  assert.deepEqual(normalizeStand({ name: 'X', pin: { lat: 35.7, lng: 139.7 } }).images, []);
});

test('normalizeStand: markers の不正kindは point・labelをtrim・欠落は空配列', () => {
  const n = normalizeStand({ name: 'X', pin: { lat: 35.7, lng: 139.7 }, markers: [{ lat: 35.7, lng: 139.7, label: ' 入口 ', kind: 'zzz' }] });
  assert.equal(n.markers[0].kind, 'point');
  assert.equal(n.markers[0].label, '入口');
  assert.deepEqual(normalizeStand({ name: 'X', pin: { lat: 35.7, lng: 139.7 } }).markers, []);
});

test('validateStand: approaches 正常(label+bearing+line)は valid', () => {
  const r = validateStand({ ...valid, approaches: [{
    label: '六本木通り側から', bearing: 180, road: '六本木通り', turn: 'left-only', hint: '左折のみ',
    line: [{ lat: 35.6612, lng: 139.7291 }, { lat: 35.6605, lng: 139.7292 }],
  }] });
  assert.equal(r.valid, true);
});

test('validateStand: approach label 空は invalid', () => {
  assert.equal(validateStand({ ...valid, approaches: [{ label: '' }] }).valid, false);
});

test('validateStand: approach bearing 範囲外は invalid', () => {
  assert.equal(validateStand({ ...valid, approaches: [{ label: 'a', bearing: 400 }] }).valid, false);
});

test('normalizeStand: approach turn 不正は either・line 短すぎは空', () => {
  const n = normalizeStand({ name: 'X', pin: { lat: 35.7, lng: 139.7 }, approaches: [{
    label: 'a', turn: 'zzz', line: [{ lat: 35.7, lng: 139.7 }],
  }] });
  assert.equal(n.approaches[0].turn, 'either');
  assert.deepEqual(n.approaches[0].line, []);
});

test('normalizeStand: cautions 文字列のみ通す・欠落は空配列', () => {
  const n = normalizeStand({ name: 'X', pin: { lat: 35.7, lng: 139.7 }, cautions: ['a', '', 3, ' b '] });
  assert.deepEqual(n.cautions, ['a', 'b']);
  assert.deepEqual(normalizeStand({ name: 'X', pin: { lat: 35.7, lng: 139.7 } }).cautions, []);
});

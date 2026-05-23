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

import { test, assert } from './run.js';
import {
  filterDrivesByVehicle,
  pickDefaultVehicleType,
  isValidVehicleType,
} from '../js/vehicle-filter.js';

// --- isValidVehicleType ---
test('isValidVehicleType: 有効な値を受け入れる', () => {
  assert.equal(isValidVehicleType('all'), true);
  assert.equal(isValidVehicleType('japantaxi'), true);
  assert.equal(isValidVehicleType('premium'), true);
});

test('isValidVehicleType: 無効な値を拒否する', () => {
  assert.equal(isValidVehicleType('regular'), false);
  assert.equal(isValidVehicleType(''), false);
  assert.equal(isValidVehicleType(null), false);
  assert.equal(isValidVehicleType(undefined), false);
  assert.equal(isValidVehicleType('JT'), false);
});

// --- filterDrivesByVehicle ---
const sampleDrives = [
  { date: '2026-05-01', vehicleType: 'japantaxi' },
  { date: '2026-05-02', vehicleType: 'premium' },
  { date: '2026-05-03', vehicleType: '' },
  { date: '2026-05-04', vehicleType: 'regular' }, // 旧値
  { date: '2026-05-05' },                         // フィールドなし
];

test('filterDrivesByVehicle: all は全件返す', () => {
  const result = filterDrivesByVehicle(sampleDrives, 'all');
  assert.equal(result.length, 5);
});

test('filterDrivesByVehicle: japantaxi はJTのみ + regularも含む', () => {
  const result = filterDrivesByVehicle(sampleDrives, 'japantaxi');
  assert.equal(result.length, 2);
  assert.deepEqual(result.map(d => d.date), ['2026-05-01', '2026-05-04']);
});

test('filterDrivesByVehicle: premium はプレミアムのみ', () => {
  const result = filterDrivesByVehicle(sampleDrives, 'premium');
  assert.equal(result.length, 1);
  assert.equal(result[0].date, '2026-05-02');
});

test('filterDrivesByVehicle: 空/未定義の vehicleType は all のみで含まれる', () => {
  const all = filterDrivesByVehicle(sampleDrives, 'all');
  assert.equal(all.filter(d => !d.vehicleType).length, 2);
  const jt = filterDrivesByVehicle(sampleDrives, 'japantaxi');
  assert.equal(jt.filter(d => !d.vehicleType).length, 0);
  const pr = filterDrivesByVehicle(sampleDrives, 'premium');
  assert.equal(pr.filter(d => !d.vehicleType).length, 0);
});

test('filterDrivesByVehicle: 無効な type は all 扱い', () => {
  const result = filterDrivesByVehicle(sampleDrives, 'unknown');
  assert.equal(result.length, 5);
});

test('filterDrivesByVehicle: drives が null/undefined でも空配列を返す', () => {
  assert.deepEqual(filterDrivesByVehicle(null, 'all'), []);
  assert.deepEqual(filterDrivesByVehicle(undefined, 'premium'), []);
});

// --- pickDefaultVehicleType ---
test('pickDefaultVehicleType: 今日のドライブのvehicleTypeを優先', () => {
  const today = { vehicleType: 'premium' };
  const config = { defaults: { vehicleType: 'japantaxi' } };
  assert.equal(pickDefaultVehicleType(today, config), 'premium');
});

test('pickDefaultVehicleType: 今日なし → configを使う', () => {
  const config = { defaults: { vehicleType: 'premium' } };
  assert.equal(pickDefaultVehicleType(null, config), 'premium');
});

test('pickDefaultVehicleType: 今日のvehicleTypeが空 → configにフォールバック', () => {
  const today = { vehicleType: '' };
  const config = { defaults: { vehicleType: 'japantaxi' } };
  assert.equal(pickDefaultVehicleType(today, config), 'japantaxi');
});

test('pickDefaultVehicleType: 両方なし → all', () => {
  assert.equal(pickDefaultVehicleType(null, null), 'all');
  assert.equal(pickDefaultVehicleType(null, {}), 'all');
  assert.equal(pickDefaultVehicleType(null, { defaults: {} }), 'all');
});

test('pickDefaultVehicleType: 不正値（today=taxi, config=foo）→ allにフォールバック', () => {
  assert.equal(pickDefaultVehicleType({ vehicleType: 'taxi' }, { defaults: { vehicleType: 'foo' } }), 'all');
});

test('pickDefaultVehicleType: regular値はjapantaxiにマップ', () => {
  assert.equal(pickDefaultVehicleType({ vehicleType: 'regular' }, null), 'japantaxi');
});

// === Adapter behavior tests (in-memory state, no DOM) ===

import {
  setActiveVehicleType,
  getActiveVehicleType,
} from '../js/vehicle-filter.js';

// Mock localStorage and window for node test environment
globalThis.localStorage = {
  _data: {},
  getItem(k) { return this._data[k] ?? null; },
  setItem(k, v) { this._data[k] = String(v); },
  removeItem(k) { delete this._data[k]; },
  clear() { this._data = {}; },
};
globalThis.window = {
  _listeners: {},
  dispatchEvent(e) {
    const ls = this._listeners[e.type] || [];
    ls.forEach(fn => fn(e));
  },
  addEventListener(type, fn) {
    (this._listeners[type] = this._listeners[type] || []).push(fn);
  },
  removeEventListener(type, fn) {
    if (this._listeners[type]) this._listeners[type] = this._listeners[type].filter(x => x !== fn);
  },
};
globalThis.CustomEvent = class CustomEvent {
  constructor(type, init = {}) {
    this.type = type;
    this.detail = init.detail;
  }
};

test('setActiveVehicleType: 有効値で localStorage に保存される', () => {
  globalThis.localStorage.clear();
  const ok = setActiveVehicleType('premium');
  assert.equal(ok, true);
  assert.equal(globalThis.localStorage.getItem('activeVehicleType'), 'premium');
});

test('setActiveVehicleType: 無効値は false を返し localStorage に保存しない', () => {
  globalThis.localStorage.clear();
  const ok = setActiveVehicleType('invalid');
  assert.equal(ok, false);
  assert.equal(globalThis.localStorage.getItem('activeVehicleType'), null);
});

test('getActiveVehicleType: 保存値があればそれを返す', () => {
  globalThis.localStorage.clear();
  setActiveVehicleType('japantaxi');
  assert.equal(getActiveVehicleType(), 'japantaxi');
});

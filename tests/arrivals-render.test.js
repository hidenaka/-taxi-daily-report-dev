import { test, assert } from './run.js';
import { weatherCodeToLabel } from '../tools/js/arrivals-render.js';

test('weatherCodeToLabel: 雨 (61-67) は advisory あり', () => {
  const r = weatherCodeToLabel(61);
  assert.equal(r.label, '雨');
  assert.equal(r.icon, '☔');
  assert.ok(r.advisory, 'advisory should be set');
});

test('weatherCodeToLabel: 雷雨 (95+) は advisory あり', () => {
  const r = weatherCodeToLabel(95);
  assert.equal(r.label, '雷雨');
  assert.ok(r.advisory);
});

test('weatherCodeToLabel: にわか雨 (80-82)', () => {
  assert.equal(weatherCodeToLabel(80).label, 'にわか雨');
  assert.equal(weatherCodeToLabel(82).label, 'にわか雨');
});

test('weatherCodeToLabel: 雪 (71-77)', () => {
  assert.equal(weatherCodeToLabel(73).label, '雪');
});

test('weatherCodeToLabel: 霧 (45/48)', () => {
  assert.equal(weatherCodeToLabel(45).label, '霧');
  assert.equal(weatherCodeToLabel(48).label, '霧');
});

test('weatherCodeToLabel: 曇り (低 code) は advisory なし', () => {
  const r = weatherCodeToLabel(2);
  assert.equal(r.advisory, null);
});

test('weatherCodeToLabel: null/非数値は null', () => {
  assert.equal(weatherCodeToLabel(null), null);
  assert.equal(weatherCodeToLabel(undefined), null);
  assert.equal(weatherCodeToLabel('61'), null);
});

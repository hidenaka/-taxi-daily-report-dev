// encodeValue / decodeValue のラウンドトリップテスト（Firestore接続不要）
import { test } from 'node:test';
import assert from 'node:assert';
import { encodeValue, decodeValue } from '../worker/src/group-pool.js';

function roundtrip(v) {
  return decodeValue(encodeValue(v));
}

test('null はラウンドトリップで null', () => {
  assert.strictEqual(roundtrip(null), null);
});

test('undefined はラウンドトリップで null', () => {
  assert.strictEqual(roundtrip(undefined), null);
});

test('boolean true/false', () => {
  assert.strictEqual(roundtrip(true), true);
  assert.strictEqual(roundtrip(false), false);
});

test('integer はラウンドトリップで number', () => {
  assert.strictEqual(roundtrip(42), 42);
  assert.strictEqual(roundtrip(0), 0);
  assert.strictEqual(roundtrip(-7), -7);
});

test('double（非整数）はラウンドトリップで double', () => {
  assert.ok(Math.abs(roundtrip(3.14) - 3.14) < 1e-9);
  assert.ok(Math.abs(roundtrip(-0.5) - (-0.5)) < 1e-9);
});

test('string はラウンドトリップで string', () => {
  assert.strictEqual(roundtrip('hello'), 'hello');
  assert.strictEqual(roundtrip(''), '');
});

test('空配列はラウンドトリップで空配列', () => {
  assert.deepStrictEqual(roundtrip([]), []);
});

test('数値配列はラウンドトリップで保持', () => {
  assert.deepStrictEqual(roundtrip([1, 2, 3]), [1, 2, 3]);
});

test('混合配列（null/bool/int/string）はラウンドトリップで保持', () => {
  assert.deepStrictEqual(roundtrip([null, true, 5, 'abc']), [null, true, 5, 'abc']);
});

test('map（object）はラウンドトリップで保持', () => {
  const obj = { a: 1, b: 'x', c: true, d: null };
  assert.deepStrictEqual(roundtrip(obj), obj);
});

test('ネストした map + 配列はラウンドトリップで保持', () => {
  const obj = { items: [{ pickupArea: '中央区銀座', amount: 3000, isPickup: false }], memberCount: 2 };
  assert.deepStrictEqual(roundtrip(obj), obj);
});

test('encodeValue: integer は integerValue(文字列)', () => {
  assert.deepStrictEqual(encodeValue(100), { integerValue: '100' });
});

test('encodeValue: double は doubleValue(数値)', () => {
  assert.deepStrictEqual(encodeValue(1.5), { doubleValue: 1.5 });
});

test('encodeValue: 配列は arrayValue.values', () => {
  const result = encodeValue([1, 'a']);
  assert.ok(result.arrayValue);
  assert.strictEqual(result.arrayValue.values.length, 2);
  assert.deepStrictEqual(result.arrayValue.values[0], { integerValue: '1' });
  assert.deepStrictEqual(result.arrayValue.values[1], { stringValue: 'a' });
});

test('encodeValue: object は mapValue.fields', () => {
  const result = encodeValue({ x: true });
  assert.ok(result.mapValue);
  assert.deepStrictEqual(result.mapValue.fields.x, { booleanValue: true });
});

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { generateToken, hashToken } from '../worker/src/setup-request/token.js';

test('generateToken: 64文字のランダム文字列を返す', () => {
  const t = generateToken();
  assert.equal(t.length, 64);
  assert.match(t, /^[a-z0-9]+$/);
});

test('generateToken: 連続呼出で異なる値', () => {
  const a = generateToken();
  const b = generateToken();
  assert.notEqual(a, b);
});

test('hashToken: 同じ入力で同じ hash', async () => {
  const t = 'sample-token';
  const a = await hashToken(t);
  const b = await hashToken(t);
  assert.equal(a, b);
});

test('hashToken: SHA-256 16進数64文字', async () => {
  const h = await hashToken('sample');
  assert.equal(h.length, 64);
  assert.match(h, /^[0-9a-f]{64}$/);
});

test('hashToken: 異なる入力で異なる hash', async () => {
  const a = await hashToken('a');
  const b = await hashToken('b');
  assert.notEqual(a, b);
});

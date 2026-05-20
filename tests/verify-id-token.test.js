import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { parseJwtUnsafe, isAdminUid } from '../worker/src/auth/verify-id-token.js';

test('parseJwtUnsafe: 正常な JWT を分解できる', () => {
  // payload: {"sub":"abc","iat":1,"exp":2}
  const header = btoa(JSON.stringify({ alg: 'RS256' })).replace(/=+$/, '');
  const payload = btoa(JSON.stringify({ sub: 'abc', iat: 1, exp: 2 })).replace(/=+$/, '');
  const fake = `${header}.${payload}.signature`;
  const parsed = parseJwtUnsafe(fake);
  assert.equal(parsed.payload.sub, 'abc');
});

test('parseJwtUnsafe: 不正な形式なら null', () => {
  assert.equal(parseJwtUnsafe('not-a-jwt'), null);
  assert.equal(parseJwtUnsafe('a.b'), null);
  assert.equal(parseJwtUnsafe(''), null);
});

test('isAdminUid: 含まれていれば true', () => {
  assert.equal(isAdminUid('uid_a', ['uid_a', 'uid_b']), true);
});

test('isAdminUid: 含まれていなければ false', () => {
  assert.equal(isAdminUid('uid_x', ['uid_a', 'uid_b']), false);
});

test('isAdminUid: ADMIN_UIDS が空配列なら false', () => {
  assert.equal(isAdminUid('uid_a', []), false);
});

test('isAdminUid: ADMIN_UIDS が null/undefined でも false', () => {
  assert.equal(isAdminUid('uid_a', null), false);
  assert.equal(isAdminUid('uid_a', undefined), false);
});

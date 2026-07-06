import { test, assert } from './run.js';
import { isValidUserId, normalizeUserId, DEFAULT_USER_ID } from '../js/userid.js';

test('isValidUserId: 英小文字+数字+_ で先頭が英字または数字 → true', () => {
  assert.equal(isValidUserId('user_self'), true);
  assert.equal(isValidUserId('user_a'), true);
  assert.equal(isValidUserId('a1'), true);
  assert.equal(isValidUserId('1user'), true);
  assert.equal(isValidUserId('12345'), true);
  assert.equal(isValidUserId('1_user'), true);
});

test('isValidUserId: 大文字・記号・空文字 → false', () => {
  assert.equal(isValidUserId('User_A'), false);
  assert.equal(isValidUserId('user-a'), false);
  assert.equal(isValidUserId(''), false);
  assert.equal(isValidUserId('_user'), false);
  assert.equal(isValidUserId('user.a'), false);
  assert.equal(isValidUserId(null), false);
  assert.equal(isValidUserId(undefined), false);
});

test('normalizeUserId: 前後空白除去 + 小文字化', () => {
  assert.equal(normalizeUserId('  user_A  '), 'user_a');
  assert.equal(normalizeUserId('USER_SELF'), 'user_self');
});

test('DEFAULT_USER_ID は user_self', () => {
  assert.equal(DEFAULT_USER_ID, 'user_self');
});

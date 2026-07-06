import { test } from 'node:test';
import assert from 'node:assert';
import { isValidSignupNotifyUserId } from '../worker/src/signup-notify/handler.js';

test('isValidSignupNotifyUserId: 英小文字または数字始まりのuserIdを受理する', () => {
  assert.equal(isValidSignupNotifyUserId('driver_a'), true);
  assert.equal(isValidSignupNotifyUserId('1driver'), true);
  assert.equal(isValidSignupNotifyUserId('12345'), true);
});

test('isValidSignupNotifyUserId: 大文字・記号・アンダースコア始まりは拒否する', () => {
  assert.equal(isValidSignupNotifyUserId('Driver_A'), false);
  assert.equal(isValidSignupNotifyUserId('driver-a'), false);
  assert.equal(isValidSignupNotifyUserId('_driver'), false);
  assert.equal(isValidSignupNotifyUserId(''), false);
});

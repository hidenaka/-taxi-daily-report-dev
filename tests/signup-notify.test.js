import { test, assert } from './run.js';
import { validateSignupFields, buildNotifyPayload } from '../js/signup-notify.js';

test('validateSignupFields: 同意なしは不可', () => {
  const r = validateSignupFields({ name: '山田太郎', phone: '09012345678', consent: false });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => e.includes('同意')));
});

test('validateSignupFields: 氏名/電話 空は不可', () => {
  assert.equal(validateSignupFields({ name: '', phone: '090', consent: true }).ok, false);
  assert.equal(validateSignupFields({ name: '山田', phone: '', consent: true }).ok, false);
});

test('validateSignupFields: 長すぎは不可', () => {
  assert.equal(validateSignupFields({ name: 'あ'.repeat(51), phone: '090', consent: true }).ok, false);
  assert.equal(validateSignupFields({ name: '山田', phone: '0'.repeat(31), consent: true }).ok, false);
});

test('validateSignupFields: 正常はok', () => {
  assert.deepEqual(validateSignupFields({ name: '山田太郎', phone: '090-1234-5678', consent: true }),
    { ok: true, errors: [] });
});

test('buildNotifyPayload: 必要キーのみ（会社名/consentは含めない）', () => {
  const p = buildNotifyPayload({ idToken: 'tok', userId: 'driver_a', name: ' 山田 ', phone: ' 090 ' });
  assert.deepEqual(p, { idToken: 'tok', userId: 'driver_a', name: '山田', phone: '090' });
  assert.equal('companyName' in p, false);
  assert.equal('consent' in p, false);
});

import { test, assert } from './run.js';
import { validateSignupFields, buildNotifyPayload } from '../js/signup-notify.js';

test('validateSignupFields: 同意なしは不可', () => {
  const r = validateSignupFields({ name: '山田太郎', consent: false });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => e.includes('同意')));
});

test('validateSignupFields: 氏名 空は不可', () => {
  assert.equal(validateSignupFields({ name: '', consent: true }).ok, false);
});

test('validateSignupFields: 氏名 長すぎは不可', () => {
  assert.equal(validateSignupFields({ name: 'あ'.repeat(51), consent: true }).ok, false);
});

test('validateSignupFields: 電話番号は要求しない（氏名+同意でok）', () => {
  assert.deepEqual(validateSignupFields({ name: '山田太郎', consent: true }),
    { ok: true, errors: [] });
});

test('buildNotifyPayload: 必要キーのみ（電話/会社名/consentは含めない）', () => {
  const p = buildNotifyPayload({ idToken: 'tok', userId: 'driver_a', name: ' 山田 ' });
  assert.deepEqual(p, { idToken: 'tok', userId: 'driver_a', name: '山田' });
  assert.equal('phone' in p, false);
  assert.equal('companyName' in p, false);
  assert.equal('consent' in p, false);
});

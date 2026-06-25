import { test, assert } from './run.js';
import { buildSignupNotificationBody } from '../worker/src/signup-notify/body.js';

test('buildSignupNotificationBody: ログインID/氏名/会社スラッグが本文に出る・DB非保存注記入り・電話は出さない', () => {
  const t = buildSignupNotificationBody({
    userId: 'driver_a', companyId: 'co-swyg3o',
    name: '山田太郎', submittedAt: '2026-05-30T12:00:00Z',
  });
  assert.ok(t.includes('ログインID'));        // ラベルが明示されている
  assert.ok(t.includes('driver_a'));          // 登録したログインIDが正確に出る
  assert.ok(t.includes('co-swyg3o'));
  assert.ok(t.includes('山田太郎'));
  assert.equal(t.includes('電話'), false);
  assert.ok(t.includes('Firestoreには保存していません'));
  assert.ok(t.includes('削除してください'));
});

test('buildSignupNotificationBody: companyId 無しは代替表記', () => {
  const t = buildSignupNotificationBody({
    userId: 'driver_b', companyId: null, name: '佐藤', submittedAt: 'x',
  });
  assert.ok(t.includes('取得できず') || t.includes('(なし)'));
});

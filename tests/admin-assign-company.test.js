import { test, assert } from './run.js';
import { buildAssignActions, formatAssignConfirm, adminSubStatusBadge } from '../js/admin-assign-company.js';

const LABEL = (s) => ({ active: '有効', trial: 'お試し', past_due: '支払い遅延', canceled: '退会済み' }[s] || s);

test('adminSubStatusBadge: grandfathered な sub は無償(G)/free', () => {
  assert.deepEqual(adminSubStatusBadge({ status: 'active', grandfathered: true }, { statusLabel: LABEL }),
    { label: '無償(G)', tone: 'free' });
});

test('adminSubStatusBadge: active/trial は active トーン', () => {
  assert.equal(adminSubStatusBadge({ status: 'active' }, { statusLabel: LABEL }).tone, 'active');
  assert.equal(adminSubStatusBadge({ status: 'trial' }, { statusLabel: LABEL }).tone, 'active');
  assert.equal(adminSubStatusBadge({ status: 'active' }, { statusLabel: LABEL }).label, '有効');
});

test('adminSubStatusBadge: その他status(past_due等)は warn', () => {
  const r = adminSubStatusBadge({ status: 'past_due' }, { statusLabel: LABEL });
  assert.equal(r.tone, 'warn');
  assert.equal(r.label, '支払い遅延');
});

test('adminSubStatusBadge: sub無し＋grandfathered判定true → 無償(G)', () => {
  assert.deepEqual(adminSubStatusBadge(null, { grandfathered: true, statusLabel: LABEL }),
    { label: '無償(G)', tone: 'free' });
});

test('adminSubStatusBadge: sub無し＋非grandfathered → 未申込/none', () => {
  assert.deepEqual(adminSubStatusBadge(null, { grandfathered: false, statusLabel: LABEL }),
    { label: '未申込', tone: 'none' });
});

const USER = { uid: 'AbCdEf1234567', userId: 'user_self', companyId: null };

test('buildAssignActions: slug + freeForInvited:true → companyId設定・grantFree:true', () => {
  const a = buildAssignActions(USER, 'co-7q7ros', { id: 'co-7q7ros', freeForInvited: true });
  assert.equal(a.companyId, 'co-7q7ros');
  assert.equal(a.grantFree, true);
  assert.equal(a.cleared, false);
  assert.equal(a.uid, 'AbCdEf1234567');
  assert.equal(a.userId, 'user_self');
});

test('buildAssignActions: slug だが無償でない/companyDoc無し → grantFree:false', () => {
  assert.equal(buildAssignActions(USER, 'co-abc', { id: 'co-abc' }).grantFree, false);
  assert.equal(buildAssignActions(USER, 'co-abc', null).grantFree, false);
});

test('buildAssignActions: __none__/空/null はクリア', () => {
  for (const v of ['__none__', '', null, undefined]) {
    const a = buildAssignActions(USER, v, null);
    assert.equal(a.companyId, null);
    assert.equal(a.grantFree, false);
    assert.equal(a.cleared, true);
  }
});

test('formatAssignConfirm: 割当・無償・クリアで文言が変わる', () => {
  const assign = buildAssignActions(USER, 'co-7q7ros', { id: 'co-7q7ros', freeForInvited: true });
  const tAssign = formatAssignConfirm(USER, assign);
  assert.ok(tAssign.includes('co-7q7ros'), '会社slugを含む');
  assert.ok(tAssign.includes('無償'), '無償付与の注記を含む');

  const plain = buildAssignActions(USER, 'co-abc', { id: 'co-abc' });
  assert.ok(!formatAssignConfirm(USER, plain).includes('無償'), '無償でない時は注記なし');

  const cleared = buildAssignActions(USER, '__none__', null);
  assert.ok(formatAssignConfirm(USER, cleared).includes('解除'), 'クリアは解除文言');
});

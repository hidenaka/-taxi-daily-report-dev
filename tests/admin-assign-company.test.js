import { test, assert } from './run.js';
import { buildAssignActions, formatAssignConfirm } from '../js/admin-assign-company.js';

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

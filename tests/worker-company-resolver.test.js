import { test, assert } from './run.js';
import * as workerIndex from '../worker/src/index.js';

function row({ companyId, isAnonymous }) {
  const fields = { userId: { stringValue: 'test20260706' } };
  if (companyId !== undefined) fields.companyId = { stringValue: companyId };
  if (isAnonymous !== undefined) fields.isAnonymous = { booleanValue: isAnonymous };
  return { document: { fields } };
}

test('resolveCompanyIdFromUserQueryRows: 匿名strayが複数あっても本登録ユーザーのcompanyIdを返す', () => {
  const rows = [
    row({ companyId: 'co-old-anon', isAnonymous: true }),
    row({ companyId: 'co-free', isAnonymous: false }),
    row({ companyId: 'co-another-anon', isAnonymous: true }),
  ];
  assert.equal(workerIndex.resolveCompanyIdFromUserQueryRows?.(rows), 'co-free');
});

test('resolveCompanyIdFromUserQueryRows: isAnonymous欠落の旧docは本登録扱いでcompanyIdを返す', () => {
  assert.equal(workerIndex.resolveCompanyIdFromUserQueryRows?.([row({ companyId: 'co-legacy' })]), 'co-legacy');
});

test('resolveCompanyIdFromUserQueryRows: 本登録候補が複数なら安全側でnull', () => {
  const rows = [
    row({ companyId: 'co-a', isAnonymous: false }),
    row({ companyId: 'co-b', isAnonymous: false }),
  ];
  assert.equal(workerIndex.resolveCompanyIdFromUserQueryRows?.(rows), null);
});

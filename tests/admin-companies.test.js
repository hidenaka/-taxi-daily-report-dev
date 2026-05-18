import { test } from 'node:test';
import assert from 'node:assert';
import { buildCompanyDoc } from '../js/admin-companies.js';
import { COMPANY_LEVEL_KEYS } from '../js/company-config.js';

function validForm(over = {}) {
  return {
    slug: 'keiho', name: '恵豊', plan: 'partner', active: true,
    payrollMode: 'step_rate',
    takeHomeRate: '0.75', responsibilityShifts: '11', paidLeaveAmount: '39340',
    fixedRate: '0.55', premiumThreshold: '80000', premiumAmount: '2000',
    rateTable: { '4': [], '12_13rate': 0.5 },
    ...over,
  };
}

test('buildCompanyDoc: 正常系 — number 化と premiumIncentive ネスト', () => {
  const { doc, error } = buildCompanyDoc(validForm());
  assert.strictEqual(error, undefined);
  assert.strictEqual(doc.takeHomeRate, 0.75);
  assert.strictEqual(doc.responsibilityShifts, 11);
  assert.deepStrictEqual(doc.premiumIncentive,
    { thresholdSalesExclTax: 80000, amountPerShift: 2000 });
  assert.strictEqual(doc.active, true);
  assert.strictEqual(doc.slug, 'keiho');
});

test('buildCompanyDoc: COMPANY_LEVEL_KEYS を全て含む', () => {
  const { doc } = buildCompanyDoc(validForm());
  for (const k of COMPANY_LEVEL_KEYS) {
    assert.ok(doc[k] !== undefined, `${k} が欠落`);
  }
});

test('buildCompanyDoc: 不正な slug でエラー', () => {
  assert.ok(buildCompanyDoc(validForm({ slug: 'Keiho' })).error);  // 大文字
  assert.ok(buildCompanyDoc(validForm({ slug: '1abc' })).error);   // 数字始まり
  assert.ok(buildCompanyDoc(validForm({ slug: 'a-b' })).error);    // 記号
  assert.ok(buildCompanyDoc(validForm({ slug: 'a' })).error);      // 短すぎ
});

test('buildCompanyDoc: 会社名欠落でエラー', () => {
  assert.ok(buildCompanyDoc(validForm({ name: '  ' })).error);
});

test('buildCompanyDoc: plan が不正でエラー', () => {
  assert.ok(buildCompanyDoc(validForm({ plan: 'gold' })).error);
});

test('buildCompanyDoc: 数値項目が非数値でエラー', () => {
  assert.ok(buildCompanyDoc(validForm({ takeHomeRate: '' })).error);
  assert.ok(buildCompanyDoc(validForm({ paidLeaveAmount: 'abc' })).error);
});

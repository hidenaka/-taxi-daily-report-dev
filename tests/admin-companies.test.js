import { test } from 'node:test';
import assert from 'node:assert';
import { buildCompanyDoc } from '../js/admin-companies.js';

function stepForm(over = {}) {
  return {
    slug: 'keiho', name: '恵豊', plan: 'partner', active: true,
    payrollMode: 'step_rate',
    takeHomeRate: '0.75', responsibilityShifts: '11', paidLeaveAmount: '39340',
    fixedRate: '0.55', premiumThreshold: '80000', premiumAmount: '2000',
    rateTable: { '4': [], '12_13rate': 0.5 },
    ...over,
  };
}

function fixedForm(over = {}) {
  return { ...stepForm(), payrollMode: 'fixed_rate', ...over };
}

test('buildCompanyDoc: step_rate 正常系 — number 化と premiumIncentive ネスト', () => {
  const { doc, error } = buildCompanyDoc(stepForm());
  assert.strictEqual(error, undefined);
  assert.strictEqual(doc.takeHomeRate, 0.75);
  assert.strictEqual(doc.responsibilityShifts, 11);
  assert.deepStrictEqual(doc.premiumIncentive,
    { thresholdSalesExclTax: 80000, amountPerShift: 2000 });
  assert.strictEqual(doc.active, true);
  assert.strictEqual(doc.slug, 'keiho');
});

test('buildCompanyDoc: step_rate の doc は rateTable を含み fixedRate を含まない', () => {
  const { doc } = buildCompanyDoc(stepForm());
  assert.notStrictEqual(doc.rateTable, undefined);
  assert.strictEqual(doc.fixedRate, undefined);
});

test('buildCompanyDoc: fixed_rate の doc は fixedRate を含み rateTable を含まない', () => {
  const { doc, error } = buildCompanyDoc(fixedForm());
  assert.strictEqual(error, undefined);
  assert.strictEqual(doc.fixedRate, 0.55);
  assert.strictEqual(doc.rateTable, undefined);
});

test('buildCompanyDoc: fixed_rate で fixedRate 未入力／非数値ならエラー', () => {
  assert.ok(buildCompanyDoc(fixedForm({ fixedRate: '' })).error);
  assert.ok(buildCompanyDoc(fixedForm({ fixedRate: 'abc' })).error);
});

test('buildCompanyDoc: fixed_rate は rateTable 不正でもエラーにならない', () => {
  assert.strictEqual(buildCompanyDoc(fixedForm({ rateTable: null })).error, undefined);
});

test('buildCompanyDoc: step_rate で rateTable が非オブジェクトならエラー', () => {
  assert.ok(buildCompanyDoc(stepForm({ rateTable: null })).error);
  assert.ok(buildCompanyDoc(stepForm({ rateTable: 'x' })).error);
});

test('buildCompanyDoc: 不正な slug でエラー', () => {
  assert.ok(buildCompanyDoc(stepForm({ slug: 'Keiho' })).error);  // 大文字
  assert.ok(buildCompanyDoc(stepForm({ slug: '1abc' })).error);   // 数字始まり
  assert.ok(buildCompanyDoc(stepForm({ slug: 'a-b' })).error);    // 記号
  assert.ok(buildCompanyDoc(stepForm({ slug: 'a' })).error);      // 短すぎ
});

test('buildCompanyDoc: 会社名欠落でエラー', () => {
  assert.ok(buildCompanyDoc(stepForm({ name: '  ' })).error);
});

test('buildCompanyDoc: plan が不正でエラー', () => {
  assert.ok(buildCompanyDoc(stepForm({ plan: 'gold' })).error);
});

test('buildCompanyDoc: payrollMode が空ならエラー', () => {
  assert.ok(buildCompanyDoc(stepForm({ payrollMode: '' })).error);
});

test('buildCompanyDoc: 共通数値項目が非数値なら両モードでエラー', () => {
  assert.ok(buildCompanyDoc(stepForm({ takeHomeRate: '' })).error);
  assert.ok(buildCompanyDoc(stepForm({ paidLeaveAmount: 'abc' })).error);
  assert.ok(buildCompanyDoc(fixedForm({ takeHomeRate: '' })).error);
});

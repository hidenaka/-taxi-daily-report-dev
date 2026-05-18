import { test } from 'node:test';
import assert from 'node:assert';
import { COMPANY_LEVEL_KEYS, mergeCompanyConfig } from '../js/company-config.js';

test('COMPANY_LEVEL_KEYS に rateTable と takeHomeRate を含む', () => {
  assert.ok(COMPANY_LEVEL_KEYS.includes('rateTable'));
  assert.ok(COMPANY_LEVEL_KEYS.includes('takeHomeRate'));
});

test('mergeCompanyConfig: 会社レベル項目は会社プロファイルが優先', () => {
  const company = { takeHomeRate: 0.70, rateTable: { '11': [] } };
  const user = { takeHomeRate: 0.99, displayName: '田中', takeHomeTarget: 500000 };
  const merged = mergeCompanyConfig(company, user);
  assert.strictEqual(merged.takeHomeRate, 0.70);          // 会社優先
  assert.deepStrictEqual(merged.rateTable, { '11': [] });  // 会社優先
  assert.strictEqual(merged.displayName, '田中');          // 個人は保持
  assert.strictEqual(merged.takeHomeTarget, 500000);       // 個人は保持
});

test('mergeCompanyConfig: 会社プロファイルが null なら userConfig をそのまま返す', () => {
  const user = { takeHomeRate: 0.99, displayName: '田中' };
  assert.deepStrictEqual(mergeCompanyConfig(null, user), user);
});

test('mergeCompanyConfig: 会社プロファイルに無い会社レベル項目は個人値を維持', () => {
  const company = { takeHomeRate: 0.70 }; // rateTable 無し
  const user = { takeHomeRate: 0.99, rateTable: { '11': [1] } };
  const merged = mergeCompanyConfig(company, user);
  assert.strictEqual(merged.takeHomeRate, 0.70);
  assert.deepStrictEqual(merged.rateTable, { '11': [1] }); // 会社に無いので個人値
});

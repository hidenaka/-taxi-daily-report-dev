import { test } from 'node:test';
import assert from 'node:assert';
import { buildKeihoProfile } from '../js/company-profiles.js';
import { DEFAULT_CONFIG } from '../js/default-config.js';
import { COMPANY_LEVEL_KEYS, mergeCompanyConfig } from '../js/company-config.js';

test('buildKeihoProfile: 会社レベル項目を DEFAULT_CONFIG と等価に持つ', () => {
  const p = buildKeihoProfile();
  assert.strictEqual(p.takeHomeRate, DEFAULT_CONFIG.takeHomeRate);
  assert.strictEqual(p.responsibilityShifts, DEFAULT_CONFIG.responsibilityShifts);
  assert.deepStrictEqual(p.rateTable, DEFAULT_CONFIG.rateTable);
  assert.deepStrictEqual(p.premiumIncentive, DEFAULT_CONFIG.premiumIncentive);
  assert.strictEqual(p.paidLeaveAmount, DEFAULT_CONFIG.paidLeaveAmount);
});

test('恵豊プロファイルでマージしても DEFAULT_CONFIG 由来の会社レベル値は不変', () => {
  // 既存ユーザーの userConfig（DEFAULT_CONFIG のコピー）に恵豊プロファイルを
  // マージしても会社レベル値が一致するため実効設定は変わらない
  const userConfig = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  userConfig.payrollMode = 'step_rate';
  userConfig.fixedRate = 0.55;
  const merged = mergeCompanyConfig(buildKeihoProfile(), userConfig);
  for (const k of COMPANY_LEVEL_KEYS) {
    assert.deepStrictEqual(merged[k], userConfig[k], `${k} が変化した`);
  }
});

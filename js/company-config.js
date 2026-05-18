// js/company-config.js — 会社プロファイルと個人設定のマージ（純関数）

// 会社レベル設定の項目。これらは会社プロファイルが優先される。
// それ以外（shifts, weatherLocation, 各種target, displayName, defaults, privacy）は
// 個人レベルとして userConfigs/{userId} に残す。
export const COMPANY_LEVEL_KEYS = [
  'rateTable',
  'takeHomeRate',
  'responsibilityShifts',
  'premiumIncentive',
  'paidLeaveAmount',
  'payrollMode',
  'fixedRate',
];

// 会社プロファイル＋個人設定 → 実効設定。
// 会社レベル項目は companyProfile に値があれば優先。それ以外は userConfig。
export function mergeCompanyConfig(companyProfile, userConfig) {
  const merged = { ...userConfig };
  if (companyProfile) {
    for (const key of COMPANY_LEVEL_KEYS) {
      if (companyProfile[key] !== undefined) {
        merged[key] = companyProfile[key];
      }
    }
  }
  return merged;
}

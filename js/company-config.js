// js/company-config.js — 会社プロファイルと個人設定のマージ（純関数）

// 会社レベル設定の項目。これらは会社プロファイルが優先される。
// それ以外（shifts, weatherLocation, 各種target, displayName, defaults, privacy）は
// 個人レベルとして userConfigs/{userId} に残す。
// 注: rateTable と fixedRate は payrollMode に応じて片方のみ会社プロファイルに
// 入る（変動部立=rateTable / 固定部立=fixedRate）。全キーが常に揃うとは限らない。
export const COMPANY_LEVEL_KEYS = [
  'rateTable',
  'takeHomeRate',
  'responsibilityShifts',
  'premiumIncentive',
  'paidLeaveAmount',
  'payrollMode',
  'fixedRate',
  // 営業地検索のデフォルト初期エリア（任意）。未設定なら丸の内フォールバック。
  // 例: keiho なら '千代田区丸の内'
  'defaultRecArea',
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

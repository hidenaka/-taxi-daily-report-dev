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
  'freeForInvited',
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

// Phase 3a: 期間内の日報群から「その期の会社」を1つ決める（最頻の companyId、無ければ null）。
// 会社をまたいでも、過去の給与をその期に在籍した会社の設定で計算するための判定。純関数。
export function derivePeriodCompanyId(drives) {
  const counts = {};
  for (const d of (drives || [])) {
    const c = d && d.companyId;
    if (c) counts[c] = (counts[c] || 0) + 1;
  }
  let best = null;
  let bestN = 0;
  for (const c of Object.keys(counts)) {
    if (counts[c] > bestN) { best = c; bestN = counts[c]; }
  }
  return best;
}

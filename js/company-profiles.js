// js/company-profiles.js — 会社プロファイルの seed 定義
import { DEFAULT_CONFIG } from './default-config.js';
import { COMPANY_LEVEL_KEYS } from './company-config.js';

// 恵豊プロファイル: 現 DEFAULT_CONFIG の会社レベル項目を抜き出したもの。
// payrollMode / fixedRate は getConfig 初期化時に付与される既定値に合わせる。
export function buildKeihoProfile() {
  const base = { ...DEFAULT_CONFIG, payrollMode: 'step_rate', fixedRate: 0.55 };
  const profile = {
    slug: 'keiho',
    plan: 'partner',
    active: true,
  };
  for (const key of COMPANY_LEVEL_KEYS) {
    if (base[key] !== undefined) {
      profile[key] = JSON.parse(JSON.stringify(base[key]));
    }
  }
  return profile;
}

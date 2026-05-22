// js/company-profiles.js — 会社プロファイルの seed 定義
import { DEFAULT_CONFIG } from './default-config.js';
import { COMPANY_LEVEL_KEYS } from './company-config.js';
import { generateSlug } from './slug-gen.js';

// 会社プロファイル: 現 DEFAULT_CONFIG の会社レベル項目を抜き出したもの。
// payrollMode / fixedRate は getConfig 初期化時に付与される既定値に合わせる。
// slug は匿名化形式(co-xxxxxx)。漏洩時に会社を特定されないため平文の会社名は使わない(decisions 7)。
// slug を渡さない場合は安全のため必ず匿名 slug を自動生成する(平文 slug を作らない)。
export function buildKeihoProfile(slug = generateSlug()) {
  const base = { ...DEFAULT_CONFIG, payrollMode: 'step_rate', fixedRate: 0.55 };
  const profile = {
    slug,
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

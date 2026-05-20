// 会社識別 slug の匿名化生成（decisions 7）。
// 会社名ローマ字を slug に使うと漏洩時に会社特定可能になるため、ランダム base32 で発行する。
//
// 形式: `co-XXXXXX` （prefix + Crockford base32 lowercase 文字列）
// Crockford base32 = 0123456789abcdefghjkmnpqrstvwxyz （i / l / o / u を除外して視認性向上）

const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';
const DEFAULT_PREFIX = 'co-';
const DEFAULT_LENGTH = 6;

// ランダム slug を生成する純関数。
// prefix: slug の頭につける接頭辞（デフォルト `co-`）
// length: 接頭辞を除いた body 文字数（デフォルト 6 = 32^6 ≈ 10億通り、実用上ほぼ衝突しない）
// rng: 乱数生成器（テスト用に依存注入可、デフォルト Math.random）
export function generateSlug(prefix = DEFAULT_PREFIX, length = DEFAULT_LENGTH, rng = Math.random) {
  if (length < 4) throw new Error('slug length must be >= 4');
  let body = '';
  for (let i = 0; i < length; i++) {
    body += ALPHABET[Math.floor(rng() * ALPHABET.length)];
  }
  return prefix + body;
}

// 匿名化形式 (`co-XXXXXX`) かを判定する。レガシー `keiho` 等のローマ字 slug と区別する用途。
export function isAnonymizedSlug(slug) {
  if (!slug || typeof slug !== 'string') return false;
  return /^co-[0-9a-hjkmnp-tv-z]{6,}$/.test(slug);
}

// レガシー slug（ローマ字会社名ベース）かを判定する。
// 匿名化形式ではなく、形式バリデーション (`^[a-z][a-z0-9_-]*$`) は通る slug を「レガシー」と扱う。
export function isLegacySlug(slug) {
  if (!slug || typeof slug !== 'string') return false;
  if (!/^[a-z][a-z0-9_-]*$/.test(slug)) return false;
  return !isAnonymizedSlug(slug);
}

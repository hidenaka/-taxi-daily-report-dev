// drive-cache.js — ページ切り替え高速化用の小さな TTL キャッシュ（純粋・storage 注入式）。
//
// 目的: getConfig / getDrivesForMonth が毎ページ Firestore へ往復していたのを、
//       TTL 以内ならキャッシュ即返しにして「画面切り替え＝即表示」にする。
//       データを書き換えた時は clearByPrefix で無効化し、古い数字が残らないようにする。
//
// storage は localStorage 互換オブジェクト（getItem/setItem/removeItem/length/key）。
// 引数で受け取るのは Node でのユニットテストを可能にするため（firebase-init を読み込まない）。
//
// レコード形式: { data: <value>, timestamp: <epoch ms> }

// TTL 以内なら data を返す。無い/壊れている/期限切れなら null。
export function readFresh(storage, key, ttlMs, now) {
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const { data, timestamp } = JSON.parse(raw);
    if (typeof timestamp === 'number' && now - timestamp < ttlMs) return data;
  } catch (e) { /* JSON 破損・容量制限などは黙ってキャッシュ無効扱い */ }
  return null;
}

// data を timestamp 付きで保存。容量制限等で失敗しても例外を投げない（キャッシュは best-effort）。
export function writeCache(storage, key, data, now) {
  try {
    storage.setItem(key, JSON.stringify({ data, timestamp: now }));
  } catch (e) { /* QuotaExceeded 等は無視（キャッシュ無しで動作継続） */ }
}

// prefix で始まるキーだけ削除（書き込み後の無効化用）。他のキーは触らない。
export function clearByPrefix(storage, prefix) {
  try {
    const keys = [];
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k && k.startsWith(prefix)) keys.push(k);
    }
    keys.forEach(k => storage.removeItem(k));
  } catch (e) { /* 列挙失敗時も握る */ }
}

// ── キャッシュキーの単一の真実（userId で名前空間化）──
// drives は `taxi_drives_<userId>_<period>`、config は `taxi_config_cache_<userId>`。
// userId を含めることで、アカウント切替後に別ユーザーのキャッシュを「絶対に読まない」
// （クロスユーザーのデータ漏れを構造的に防ぐ）。clearByPrefix(DRIVES_CACHE_PREFIX) で
// 全ユーザーぶんまとめて無効化できるよう、接頭辞は userId の手前に置く。
export const DRIVES_CACHE_PREFIX = 'taxi_drives_';
export const CONFIG_CACHE_PREFIX = 'taxi_config_cache_';
// v1.86 以前の非名前空間キャッシュキー（移行用に一掃する対象）。
export const LEGACY_CONFIG_CACHE_KEY = 'taxi_config_cache';

// ユーザー別キャッシュキーを組み立てる純関数。userId 未確定時は 'anon' にフォールバック。
// suffix を渡すと `<prefix><userId>_<suffix>`（drives の period 用）、無ければ `<prefix><userId>`。
export function userScopedKey(prefix, userId, suffix = '') {
  const uid = userId || 'anon';
  return suffix ? `${prefix}${uid}_${suffix}` : `${prefix}${uid}`;
}

// ログアウト/アカウント切替時に、この端末の全ユーザーぶんの drives/config キャッシュと
// 旧・非名前空間キーを一掃する。端末に他人のデータを残さないため（プライバシー）。
export function clearDataCaches(storage) {
  if (!storage) return;
  clearByPrefix(storage, DRIVES_CACHE_PREFIX);   // 旧 taxi_drives_<period> も接頭辞一致で消える
  clearByPrefix(storage, CONFIG_CACHE_PREFIX);   // 名前空間化された config キー
  try { storage.removeItem(LEGACY_CONFIG_CACHE_KEY); } catch (e) { /* 握る */ }
}

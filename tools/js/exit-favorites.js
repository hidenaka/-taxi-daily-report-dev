// 出口IC お気に入りの永続化（localStorage）。純関数 + 薄いI/Oラッパ。
// storage 引数でテスト時にフェイクを注入できる（既定は globalThis.localStorage）。

export const EXIT_FAVORITES_KEY = 'cabis.exitFavorites';

// 呼び出し時に評価する（モジュール読込時に localStorage 未定義な環境でも落ちないため。
// 定数化すると注入パターンが壊れるので変更しないこと）。
const defaultStorage = () => globalThis.localStorage;

// defaults(ic_id配列) を保存して配列を返す。保存失敗(iOSプライベート等)は無視。
export function seedFavorites(defaults, storage = defaultStorage()) {
  const list = Array.isArray(defaults) ? defaults.filter(x => typeof x === 'string') : [];
  try { storage.setItem(EXIT_FAVORITES_KEY, JSON.stringify(list)); } catch { /* ignore */ }
  return list;
}

// localStorage優先で読む。未存在/破損/非配列/読取失敗なら defaults でseed
export function loadFavorites(defaults, storage = defaultStorage()) {
  let raw = null;
  try { raw = storage.getItem(EXIT_FAVORITES_KEY); } catch { raw = null; }
  if (raw == null) return seedFavorites(defaults, storage);
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter(x => typeof x === 'string');
    return seedFavorites(defaults, storage);
  } catch {
    return seedFavorites(defaults, storage);
  }
}

// 重複なく末尾追加した新配列を返す（純関数）
export function addFavorite(list, icId) {
  if (!icId) return list;
  if (list.includes(icId)) return list;
  return [...list, icId];
}

// 除去した新配列を返す（純関数）
export function removeFavorite(list, icId) {
  return list.filter(id => id !== icId);
}

// localStorage へ永続化して配列を返す。保存失敗は無視。
export function saveFavorites(list, storage = defaultStorage()) {
  try { storage.setItem(EXIT_FAVORITES_KEY, JSON.stringify(list)); } catch { /* ignore */ }
  return list;
}

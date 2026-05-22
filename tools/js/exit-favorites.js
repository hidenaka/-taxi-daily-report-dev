// 出口IC お気に入りの永続化（localStorage）。純関数 + 薄いI/Oラッパ。
// storage 引数でテスト時にフェイクを注入できる（既定は globalThis.localStorage）。

export const EXIT_FAVORITES_KEY = 'cabis.exitFavorites';

const defaultStorage = () => globalThis.localStorage;

// defaults(ic_id配列) を保存して配列を返す
export function seedFavorites(defaults, storage = defaultStorage()) {
  const list = Array.isArray(defaults) ? defaults.filter(x => typeof x === 'string') : [];
  storage.setItem(EXIT_FAVORITES_KEY, JSON.stringify(list));
  return list;
}

// localStorage優先で読む。未存在/破損/非配列なら defaults でseed
export function loadFavorites(defaults, storage = defaultStorage()) {
  const raw = storage.getItem(EXIT_FAVORITES_KEY);
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

// localStorage へ永続化して配列を返す
export function saveFavorites(list, storage = defaultStorage()) {
  storage.setItem(EXIT_FAVORITES_KEY, JSON.stringify(list));
  return list;
}

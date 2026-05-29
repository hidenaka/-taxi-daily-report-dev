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

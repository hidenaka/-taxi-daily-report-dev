// 場所文字列を「区+町名」に正規化（丁目・末尾数字を除去）。
// 目的: GPS逆ジオの町名を、過去データの extractArea 表記（例 "港区六本木"）に揃える。

export function normalizePlace(s) {
  if (!s) return '';
  return String(s)
    .replace(/[0-9０-９一二三四五六七八九十百]+丁目$/, '')
    .replace(/[0-9０-９]+$/, '')
    .trim();
}

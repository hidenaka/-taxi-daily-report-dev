// 営業サポート「次の営業先 推奨検索」の初期エリア選択ロジック
// 純粋関数のみ。DOM・Firestore・GPS は support.html 側で扱う。

// 初期選択エリアを優先順位に従って決定する
// 優先順位: 1.gpsArea → 2.lastArea → 3.companyDefault → 4.fallback → 5.availableAreas[0]
// 各値が availableAreas に含まれていなければ次の候補へ繰り下げる
export function chooseInitialRecArea({
  gpsArea = null,
  lastArea = null,
  companyDefault = null,
  fallback = null,
  availableAreas = [],
} = {}) {
  if (!availableAreas || availableAreas.length === 0) return '';
  const set = new Set(availableAreas);
  const candidates = [gpsArea, lastArea, companyDefault, fallback];
  for (const c of candidates) {
    if (c && set.has(c)) return c;
  }
  return availableAreas[0];
}

// dropoffAreaAnalysis 等の {area, dropoffs} 配列から
// OFFICE_AREA（出庫営業所の仮想降車先）と minDropoffs 未満を除外し
// dropoffs 降順で返す
export function filterRecAreaCandidates(items, officeArea, minDropoffs = 5) {
  if (!Array.isArray(items) || items.length === 0) return [];
  return items
    .filter(it => it && it.area !== officeArea && (it.dropoffs ?? 0) >= minDropoffs)
    .slice()
    .sort((a, b) => (b.dropoffs ?? 0) - (a.dropoffs ?? 0));
}

const HANEDA_EXIT_IDS = new Set(['kukou_chuou', 'wangan_kanpachi']);
const HANEDA_KANAGAWA_PRIORITY = [
  'hokuseisen_route',
  'kitasen_route',
  'wangan_route',
  'yokohane_route',
  'hodogaya_route',
  'third_keihin',
  'yokoyoko',
  'tomei',
];

function priorityIndex(list, routeId) {
  const idx = list.indexOf(routeId);
  return idx === -1 ? Number.POSITIVE_INFINITY : idx;
}

let outerIdsCache = null;
let outerIdsCacheKey = null;
function getOuterDirectionIds(deduction) {
  if (outerIdsCacheKey !== deduction) {
    outerIdsCache = new Set(deduction.directions.map((d) => d.id));
    outerIdsCacheKey = deduction;
  }
  return outerIdsCache;
}

/**
 * 指定ICが物理的に乗っている外側高速 direction の集合を返す。
 *
 * 判定ルール（OR）:
 * 1. ic.route が外側高速 direction id と一致 → そのdirection（主たる物理所属）
 * 2. dir.baseline.ic_id === ic.id → そのdirection（複数路線の起点ICを許容: 例 tamagawa_ic = third_keihin + yokoyoko）
 *
 * dir.entries の登録は **控除計算用メタデータ** として deduction.json に保持されており、
 * 「そのIC自身が物理的にそのdirection上にある」を意味しないため、UI候補生成からは除外する。
 * 例: tokyo_ic は kitasen_route の entries に km=13.3 で登録されているが、
 *     これは「北線経由で来た人が tokyo_ic で控除される距離」を意味する控除メタで、
 *     tokyo_ic 自体は kitasen_route 上にはない。
 *
 * @returns {Array<{id: string, km: number}>}
 */
// 神奈川3方向ルート (横須賀方面ICから「保土ヶ谷BP経由」「横羽線経由」「湾岸線経由」等
// 複数の現実的経由ルートが選べる路線群)。これらの direction は架空baseline
// (kariba_shutoko/wangan_shutoko) を持ち、 物理経路の重複表現のため、 entries (km>0) を
// 候補に含めても tokyo_ic等の実在baseline IC には影響しない (横須賀方面entriesに無いため)。
// kitasen_route/hokuseisen_route は実在baseline (tokyo_ic) を持つため entries は除外
// (tokyo_ic→kitasen_route混入バグ再発防止)。
const KANAGAWA_BRANCH_ROUTES = new Set([
  'yokohane_route', 'wangan_route', 'hodogaya_route',
]);

function getIcMatchedRoutes(ic, deduction) {
  if (!ic) return [];
  const map = new Map();
  const outerIds = getOuterDirectionIds(deduction);

  if (outerIds.has(ic.route)) {
    map.set(ic.route, 0);
  }

  for (const dir of deduction.directions) {
    if (dir.baseline.ic_id === ic.id && !map.has(dir.id)) {
      map.set(dir.id, 0);
    }
    // 神奈川5方向ルートでは entries (km>0) も候補に (複数経由ルートの提示)
    if (KANAGAWA_BRANCH_ROUTES.has(dir.id)) {
      const entry = dir.entries.find((e) => e.ic_id === ic.id);
      if (entry && entry.km > 0 && !map.has(dir.id)) {
        map.set(dir.id, entry.km);
      }
    }
  }

  return [...map.entries()].map(([id, km]) => ({ id, km }));
}

/**
 * 出口ICが entries に km>0 で存在する direction IDセットを返す。ソート優先順位の判定に使用。
 */
function getExitRouteIds(exitIc, deduction) {
  if (!exitIc) return new Set();
  const ids = new Set();
  for (const dir of deduction.directions) {
    if (dir.entries.some((e) => e.ic_id === exitIc.id && e.km > 0)) {
      ids.add(dir.id);
    }
  }
  return ids;
}

function sortAndMapRoutes(matched, { isHanedaBound, directRoute, exitRouteIds, wanganFirst }) {
  matched.sort((a, b) => {
    if (isHanedaBound) {
      const ap = priorityIndex(HANEDA_KANAGAWA_PRIORITY, a.id);
      const bp = priorityIndex(HANEDA_KANAGAWA_PRIORITY, b.id);
      if (ap !== bp) return ap - bp;
    } else if (exitRouteIds) {
      const aInExit = exitRouteIds.has(a.id);
      const bInExit = exitRouteIds.has(b.id);
      if (aInExit !== bInExit) return aInExit ? -1 : 1;
    }

    if (directRoute !== undefined) {
      const ad = a.id === directRoute;
      const bd = b.id === directRoute;
      if (ad !== bd) return ad ? -1 : 1;
    }

    const aw = wanganFirst.has(a.id);
    const bw = wanganFirst.has(b.id);
    if (aw !== bw) return aw ? -1 : 1;

    return a.km - b.km;
  });
  return matched.map((m) => m.id);
}

/**
 * 入口IC × 出口IC の組み合わせに対し、物理的に意味のある外側高速 direction 候補を返す。
 *
 * 候補集合 = (入口ICの所属外側高速) ∪ (出口ICの所属外側高速)
 * 両方とも空 (両ICが首都高内) → ['none']
 *
 * 旧実装の BASELINE_ROUTE_OPTIONS テーブルが入口路線によらず固定値を返していた問題
 * (例: 東京IC + 空港中央 で kitasen_route が候補に混入) を、所属集合ベースの判定で解消。
 */
export function getOuterRouteOptionsForIc({ ic, exitIc = null, deduction }) {
  if (!ic) return ['none'];

  const entryMatched = getIcMatchedRoutes(ic, deduction);
  const exitMatched = getIcMatchedRoutes(exitIc, deduction);

  const merged = new Map();
  for (const m of entryMatched) merged.set(m.id, m.km);
  for (const m of exitMatched) {
    if (!merged.has(m.id)) merged.set(m.id, m.km);
  }

  if (merged.size === 0) return ['none'];

  const matched = [...merged.entries()].map(([id, km]) => ({ id, km }));
  const wanganFirst = new Set(['tokan', 'wangan_route', 'aqua']);
  const isHanedaBound = HANEDA_EXIT_IDS.has(exitIc?.id);
  const directRoute = ic.route;
  const exitRouteIds = getExitRouteIds(exitIc, deduction);

  return sortAndMapRoutes(matched, { isHanedaBound, directRoute, exitRouteIds, wanganFirst });
}

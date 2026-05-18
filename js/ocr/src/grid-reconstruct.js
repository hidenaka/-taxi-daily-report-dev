// js/ocr/src/grid-reconstruct.js
// PP-OCR の {text, boxes:[{text,bbox:[x1,y1,x2,y2],confidence}]} を
// 営業明細の明細行（構造データ）に復元する。
//
// ocr-spike/grid-reconstruct.js ＋ ocr-spike/keiho-columns.js のブラウザ移植版。
// 純粋なJS処理でDOM非依存。ロジックはハーネス版と完全に一致させること
// （決定論的なため同一入力で同一の rows を返す）。
//
// 処理段:
//   findHeaderRow(boxes)            … 営業明細のヘッダー行 box 群を見つける
//   deriveColumns(headerBoxes)      … ヘッダーから列ごとの x 帯を導出
//   clusterRows(boxes, headerY, ..) … ヘッダーより下の box を行にクラスタリング
//   assignCells(rowBoxes, columns)  … 各 box を列帯に割り当てセル化
//   normalizeCell(text, type)       … 列タイプ別に正規化＋低信頼フラグ

// =============================================================================
// 恵豊様式・営業明細の列定義（旧 keiho-columns.js）
// ピクセル座標は持たない — 列の x 帯はヘッダー行から実行時に導出する。
//
// type:
//   int     … 整数（No / 男 / 女）。ただし No は "休" 等の文字も入る特例扱い
//   time    … 時刻（乗車 / 降車 / 時間）。H:MM へ正規化
//   decimal … 小数（営Km）。NN.N へ正規化
//   fare    … 金額（合計 / 料金 / 現収 / 未収 / 立替）。カンマ除去し整数へ
//   flag    … 真偽（迎）。それらしき文字があれば "迎"
//   text    … 自由文（乗車地 / 降車地 / 備考）
// =============================================================================

const KEIHO_COLUMNS = [
  { name: 'No',    type: 'int'     },
  { name: '乗車',  type: 'time'    },
  { name: '降車',  type: 'time'    },
  { name: '時間',  type: 'time'    },
  { name: '迎',    type: 'flag'    },
  { name: '乗車地', type: 'text'    },
  { name: '降車地', type: 'text'    },
  { name: '営Km',  type: 'decimal' },
  { name: '男',    type: 'int'     },
  { name: '女',    type: 'int'     },
  { name: '合計',  type: 'fare'    },
  { name: '料金',  type: 'fare'    },
  { name: '現収',  type: 'fare'    },
  { name: '未収',  type: 'fare'    },
  { name: '立替',  type: 'fare'    },
  { name: '備考',  type: 'text'    },
];

// ヘッダー行検出に使う「列名 box の表記ゆれ」マップ。
// OCR は同義／崩れた字を返すので、検出時はこの候補集合で当てる。
// 値は正規化後の列名。
const HEADER_ALIASES = {
  'No': 'No', 'No.': 'No', 'N.': 'No', 'N0': 'No', 'no': 'No',
  '乗車': '乗車', '麟車': '乗車', '乘車': '乗車',
  '降車': '降車', '降单': '降車',
  '時間': '時間',
  '迎': '迎', '週': '迎', '迅': '迎',
  '乗車地': '乗車地', '降車地': '降車地',
  '営Km': '営Km', 'Km': '営Km', '営km': '営Km',
  '男': '男', '女': '女',
  '合計': '合計', '料金': '料金', '現収': '現収',
  '未収': '未収', '立替': '立替', '立巻': '立替',
  '備考': '備考',
};

// ---- box ヘルパ ------------------------------------------------------------
const cx = (b) => (b.bbox[0] + b.bbox[2]) / 2;
const cy = (b) => (b.bbox[1] + b.bbox[3]) / 2;
const bh = (b) => b.bbox[3] - b.bbox[1];
const bw = (b) => b.bbox[2] - b.bbox[0];

// =============================================================================
// findHeaderRow / deriveColumns
// =============================================================================

// 列名 box のテキストを正規化列名へ。当たらなければ null。
function matchHeaderLabel(text) {
  const t = String(text || '').trim();
  if (HEADER_ALIASES[t]) return HEADER_ALIASES[t];
  // 部分一致（"営業明組" のような連結や前後ノイズに保険）
  for (const [alias, name] of Object.entries(HEADER_ALIASES)) {
    if (alias.length >= 2 && t.includes(alias)) return name;
  }
  return null;
}

// 営業明細のヘッダー行を見つける。
// ヘッダー語に一致する box が同じ y 帯に複数並ぶ箇所を探す。
// 上部サマリーや ETC 明細のヘッダーと混同しないよう、
// 「降車地・乗車地・営Km・合計 等の本表特有の列名」が多く揃う帯を選ぶ。
function findHeaderRow(boxes) {
  // ラベル候補 box（列名にマッチしたもの）
  const labeled = [];
  for (const b of boxes) {
    const name = matchHeaderLabel(b.text);
    if (name) labeled.push({ box: b, name, y: cy(b) });
  }
  if (!labeled.length) return null;

  // y で近いものをまとめてヘッダー候補帯を作る（ラベルは y が staggered なので広め）
  labeled.sort((a, b) => a.y - b.y);
  const bands = [];
  const TOL = 80; // ヘッダーラベルの y ばらつき許容
  for (const l of labeled) {
    let band = bands.find((bd) => Math.abs(bd.yMean - l.y) <= TOL);
    if (!band) {
      band = { items: [], yMean: l.y };
      bands.push(band);
    }
    band.items.push(l);
    band.yMean = band.items.reduce((s, it) => s + it.y, 0) / band.items.length;
  }

  // 営業明細ヘッダーの「本表特有」な列名
  const CORE = new Set(['乗車地', '降車地', '営Km', '合計', '乗車', '降車', '時間']);
  let best = null;
  for (const band of bands) {
    const names = new Set(band.items.map((it) => it.name));
    const coreHits = [...names].filter((n) => CORE.has(n)).length;
    const score = coreHits * 10 + names.size;
    if (coreHits >= 3 && (!best || score > best.score)) {
      best = { band, score };
    }
  }
  if (!best) return null;

  // 1 列名につき 1 box（最も信頼が高いもの）。x も保持。
  const byName = new Map();
  for (const it of best.band.items) {
    const prev = byName.get(it.name);
    if (!prev || (it.box.confidence || 0) > (prev.box.confidence || 0)) {
      byName.set(it.name, it);
    }
  }
  const headerBoxes = [...byName.values()].map((it) => ({
    name: it.name,
    x: cx(it.box),
    y: cy(it.box),
    box: it.box,
  }));
  // ヘッダー行の下端 y（本文クラスタの開始判定に使う）
  const headerBottom = Math.max(...best.band.items.map((it) => it.box.bbox[3]));
  return { y: best.band.yMean, bottom: headerBottom, boxes: headerBoxes };
}

// ヘッダー box 群から列ごとの x 帯を導出する。
// KEIHO_COLUMNS の列順と突き合わせ、取れた列の x 中心を使い、
// 取りこぼした列は前後の取れた列から等間隔補間で埋める。
function deriveColumns(headerBoxes) {
  const order = KEIHO_COLUMNS;
  // 列順インデックス → 検出 x 中心
  const known = new Map();
  for (const hb of headerBoxes) {
    const idx = order.findIndex((c) => c.name === hb.name);
    if (idx >= 0) known.set(idx, hb.x);
  }
  if (known.size < 2) return [];

  // 補間: known 列の (idx, x) を線形にして全列の x 中心を推定
  const idxs = [...known.keys()].sort((a, b) => a - b);
  const centers = new Array(order.length);
  for (let i = 0; i < order.length; i++) {
    if (known.has(i)) {
      centers[i] = known.get(i);
      continue;
    }
    // i を挟む known 二点を探す
    let lo = null, hi = null;
    for (const k of idxs) {
      if (k < i) lo = k;
      if (k > i && hi === null) hi = k;
    }
    if (lo !== null && hi !== null) {
      const t = (i - lo) / (hi - lo);
      centers[i] = known.get(lo) + t * (known.get(hi) - known.get(lo));
    } else if (lo !== null) {
      // 右端外挿: 直近 2 known の傾き
      const prev = idxs[idxs.indexOf(lo) - 1];
      const slope = prev != null ? (known.get(lo) - known.get(prev)) / (lo - prev) : 80;
      centers[i] = known.get(lo) + slope * (i - lo);
    } else if (hi !== null) {
      const next = idxs[idxs.indexOf(hi) + 1];
      const slope = next != null ? (known.get(next) - known.get(hi)) / (next - hi) : 80;
      centers[i] = known.get(hi) - slope * (hi - i);
    }
  }

  // x 帯の境界 = 隣接列の中点
  const columns = [];
  for (let i = 0; i < order.length; i++) {
    if (centers[i] == null) continue;
    const c = centers[i];
    let xMin, xMax;
    const prevC = i > 0 ? centers[i - 1] : null;
    const nextC = i < order.length - 1 ? centers[i + 1] : null;
    xMin = prevC != null ? (prevC + c) / 2 : c - (nextC != null ? (nextC - c) / 2 : 60);
    xMax = nextC != null ? (nextC + c) / 2 : c + (prevC != null ? (c - prevC) / 2 : 60);
    columns.push({ name: order[i].name, type: order[i].type, center: c, xMin, xMax });
  }
  return columns;
}

// =============================================================================
// clusterRows / assignCells
// =============================================================================

// 明細表の打ち切り判定: 別表のヘッダー語が現れたらそこで本表終了。
const TABLE_END_MARKERS = ['ETC明細', 'ＥＴＣ明細', 'ETC明組', '入口', '出口'];
function isTableEndBox(b) {
  const t = String(b.text || '').trim();
  return TABLE_END_MARKERS.some((m) => t.includes(m));
}

// ヘッダーより下の box を明細行にクラスタリングする。
//
// 重要な観察: 営業明細では右側の数値列（営Km/合計/料金/現収/未収/立替）が
// 取引終了時に印字されるため、行の主要列（No/乗車/降車/時間/乗車地）より
// 数十px 上にずれて出る。単純な y クラスタでは右側数値が上の行に吸われる。
//
// そこで:
//   1. 「アンカー列」(No/乗車/降車/時間/乗車地) の box だけで行を確定する
//      （これらは行の真の y にある）。
//   2. 残りの box は、アンカー行群に対する最適 y オフセットを推定してから
//      最寄りのアンカー行へ割り当てる。
//
// 戻り値: { rows: [box[]], cutoffY }
function clusterRows(boxes, headerBottom, columns) {
  const xLo = Math.min(...columns.map((c) => c.xMin));
  const xHi = Math.max(...columns.map((c) => c.xMax));

  // 打ち切り y
  let cutoffY = Infinity;
  for (const b of boxes) {
    if (b.bbox[1] <= headerBottom) continue;
    if (cx(b) < xLo - 40 || cx(b) > xHi + 40) continue;
    if (isTableEndBox(b)) cutoffY = Math.min(cutoffY, b.bbox[1]);
  }

  const body = boxes.filter((b) => {
    if (b.bbox[1] < headerBottom - 2) return false;
    if (cy(b) >= cutoffY) return false;
    const c = cx(b);
    if (c < xLo - 30 || c > xHi + 30) return false;
    if (!String(b.text || '').trim()) return false;
    return true;
  });
  if (!body.length) return { rows: [], cutoffY };

  const heights = body.map(bh).sort((a, b) => a - b);
  const medianH = heights[Math.floor(heights.length / 2)] || 28;

  // --- アンカー列の x 範囲 ---
  // 帳票の回転で No 列は下に行くほど左へ大きくドリフトするため、
  // 左マージンを広めに取ってドリフト後の No box も拾えるようにする。
  const anchorNames = ['No', '乗車', '降車', '時間', '乗車地'];
  const anchorCols = columns.filter((c) => anchorNames.includes(c.name));
  const aLo = Math.min(...anchorCols.map((c) => c.xMin));
  const aHi = Math.max(...anchorCols.map((c) => c.xMax));
  const inAnchorZone = (b) => {
    const c = cx(b);
    return c >= aLo - 95 && c <= aHi + 30;
  };
  const anchorBoxes = body.filter(inAnchorZone);

  // --- アンカー box を y でクラスタリングして行を確定 ---
  const tol = medianH * 0.6;
  const sorted = [...anchorBoxes].sort((a, b) => cy(a) - cy(b));
  const anchorClusters = [];
  for (const b of sorted) {
    const y = cy(b);
    let cl = anchorClusters[anchorClusters.length - 1];
    if (!cl || y - cl.yMean > tol) {
      cl = { items: [], yMean: y };
      anchorClusters.push(cl);
    }
    cl.items.push(b);
    cl.yMean = cl.items.reduce((s, it) => s + cy(it), 0) / cl.items.length;
  }
  if (!anchorClusters.length) return { rows: [], cutoffY };
  const rowCenters = anchorClusters.map((c) => c.yMean);

  // シアー推定用の暫定クラスタ: 全 body box を最寄り行へ素朴に割り当てる。
  const prelim = anchorClusters.map((c) => [...c.items]);
  for (const b of body) {
    if (inAnchorZone(b)) continue; // アンカーは既に入っている
    const y = cy(b);
    let vi = 0, vd = Infinity;
    for (let i = 0; i < rowCenters.length; i++) {
      const d = Math.abs(y - rowCenters[i]);
      if (d < vd) { vd = d; vi = i; }
    }
    prelim[vi].push(b);
  }
  const shear = detectShear(prelim, columns, headerBottom - medianH);

  // --- 非アンカー box の行割り当て ---
  // 重要な観察（実データで確認）:
  //   営業明細の「取引終了時に確定する数値列」（営Km/男/女/合計/料金/現収/
  //   未収/立替/備考）は、行の真の y より上にずれて印字される。
  //   ずれ量は一定でなく、上端で大（〜1 行ぶん）下端で小と y 依存する。
  //   さらにこれらの列は休行には印字されず、取引行（No=数字）にだけ出る。
  //   → 固定の +1 行シフトでは休行付近でズレるため、
  //     各列の box を y 順に並べ、取引行へ「順序保存・近傍」割り当てする。
  //   降車地は数値列よりやや下に出て最寄り行で正しく当たるため通常割り当て。
  const restBoxes = body.filter((b) => !inAnchorZone(b));
  const pitches = [];
  for (let i = 1; i < rowCenters.length; i++) pitches.push(rowCenters[i] - rowCenters[i - 1]);
  pitches.sort((a, b) => a - b);
  const pitch = pitches[Math.floor(pitches.length / 2)] || medianH * 1.1;

  // 取引終了系の列（順序保存で取引行へ割り当てる）
  const SHIFTED_COLS = new Set(['営Km', '男', '女', '合計', '料金', '現収', '未収', '立替', '備考']);

  // box の x からどの列かを判定。シアー補正済みの列中心（box 自身の y）を使う。
  const colOfBox = (b) => {
    const c = cx(b);
    const y = cy(b);
    let best = null, bd = Infinity;
    for (const col of columns) {
      const center = col.center + shear.slopeAt(col.center) * (y - shear.headerY);
      const d = Math.abs(c - center);
      if (d < bd) { bd = d; best = col; }
    }
    return best;
  };

  // 休行判定（No box テキスト）
  const isBreakRow = anchorClusters.map((cl) => {
    const noBoxes = cl.items
      .filter((b) => /^[0-9休保㈱]{1,3}$/.test(String(b.text || '').trim()) && bw(b) < 90)
      .sort((a, b) => cx(a) - cx(b));
    const t = noBoxes.length ? String(noBoxes[0].text || '').trim() : '';
    // 休/保（㈱ は "休" の誤認）なら休行。No が読めない行は取引行とみなす
    // （休行は "休" が高信頼で読めるため。空判定で休に倒すと取引行を落とす）。
    if (/[休保㈱]/.test(t)) return true;
    if (/[0-9]/.test(t)) return false;
    // No box が読めなかった: 数値列 box の有無で取引行を推定（あれば取引行）
    return false;
  });
  const tripRowIdx = [];
  for (let i = 0; i < rowCenters.length; i++) if (!isBreakRow[i]) tripRowIdx.push(i);

  const rowItems = anchorClusters.map((c) => [...c.items]);

  // box を列ごとに振り分け
  const shiftedByCol = new Map();
  for (const b of restBoxes) {
    const col = colOfBox(b);
    if (!col) continue;
    if (SHIFTED_COLS.has(col.name)) {
      if (!shiftedByCol.has(col.name)) shiftedByCol.set(col.name, []);
      shiftedByCol.get(col.name).push(b);
    } else {
      // 非シフト列（降車地など）は最寄り行へ
      const y = cy(b);
      let vi = 0, vd = Infinity;
      for (let i = 0; i < rowCenters.length; i++) {
        const d = Math.abs(y - rowCenters[i]);
        if (d < vd) { vd = d; vi = i; }
      }
      rowItems[vi].push(b);
    }
  }

  // 順序保存・近傍割り当て:
  //   y 昇順に並べた box[] を、取引行 y 昇順 tripRowIdx[] へ、
  //   各取引行に高々 1 box・順序を保ったまま、総ズレ最小で対応づける。
  //   box は真の行より上にずれて出るので、box は対応行と同じか上に来る。
  const assignOrdered = (boxesIn) => {
    const bs = [...boxesIn].sort((a, b) => cy(a) - cy(b));
    const m = bs.length;
    const tRows = tripRowIdx;
    const k = tRows.length;
    if (!m) return;
    if (m > k) {
      // box が多すぎる → 余りは最寄り行へフォールバック（誤検出 box 想定）
    }
    // DP: cost[i][j] = box i..(末尾) を 取引行 j..(末尾) に割り当てる最小コスト
    // box i は行 j に置くか、行 j をスキップ。box は必ず置く。
    const cost = (bi, rj) => {
      const d = rowCenters[tRows[rj]] - cy(bs[bi]); // 行が box より下＝正
      // box は行より上に出る前提。下に出る（負）のは強めにペナルティ。
      const dist = d >= 0 ? d : -d * 2.2;
      return dist * dist;
    };
    const INF = Infinity;
    const dp = Array.from({ length: m + 1 }, () => new Array(k + 1).fill(INF));
    const choice = Array.from({ length: m + 1 }, () => new Array(k + 1).fill(0));
    for (let j = 0; j <= k; j++) dp[m][j] = 0;
    for (let i = m - 1; i >= 0; i--) {
      for (let j = k - 1; j >= 0; j--) {
        // box i を行 j に置く
        const place = cost(i, j) + dp[i + 1][j + 1];
        // 行 j をスキップ
        const skip = dp[i][j + 1];
        if (place <= skip) { dp[i][j] = place; choice[i][j] = 1; }
        else { dp[i][j] = skip; choice[i][j] = 0; }
      }
    }
    // 経路復元
    let i = 0, j = 0;
    while (i < m && j < k) {
      if (choice[i][j] === 1) {
        rowItems[tRows[j]].push(bs[i]);
        i++; j++;
      } else {
        j++;
      }
    }
    // 余った box は最寄り行へ
    for (; i < m; i++) {
      const y = cy(bs[i]);
      let vi = 0, vd = INF;
      for (let r = 0; r < rowCenters.length; r++) {
        const d = Math.abs(y - rowCenters[r]);
        if (d < vd) { vd = d; vi = r; }
      }
      rowItems[vi].push(bs[i]);
    }
  };
  for (const [, boxesForCol] of shiftedByCol) assignOrdered(boxesForCol);

  return { rows: rowItems, cutoffY, rowCenters, pitch, isBreakRow, shear };
}

// 帳票のシアー（回転/台形ゆがみ）を推定する。
// 列の x 位置は y とともにずれる。No 列（各行 1 box・最も信頼できる）と
// 右側の列を使い、列中心の y 依存スロープ slope(x) を線形モデルで求める。
// 戻り値: { headerY, slopeAt(x) -> number }（x 位置における 1y あたりの x ドリフト量）
function detectShear(rowClusters, columns, headerY) {
  // 帳票は軽く回転しており、列の x 位置は y とともに線形にずれる。
  // 左端（No 列）と右端寄り（合計 列）の 2 列を各行で追跡し、
  // それぞれの x-vs-y スロープを最小二乗で求める。
  // この 2 点から slope(x)=a+b*x を一意に決める。
  const fitXY = (pts) => {
    if (pts.length < 5) return null;
    const n = pts.length;
    const sy = pts.reduce((s, p) => s + p.y, 0);
    const sx = pts.reduce((s, p) => s + p.x, 0);
    const syy = pts.reduce((s, p) => s + p.y * p.y, 0);
    const sxy = pts.reduce((s, p) => s + p.x * p.y, 0);
    const denom = n * syy - sy * sy;
    if (Math.abs(denom) < 1e-6) return null;
    return { slope: (n * sxy - sx * sy) / denom, meanX: sx / n };
  };

  // No 列: 各行で最も左の box（テキストが 休/保/数字）。回転で大きく
  // ドリフトしても「行内で最も左」という性質は保たれるため追跡が安定。
  const trackNo = () => {
    const pts = [];
    for (const rb of rowClusters) {
      const cand = rb
        .filter((b) => /^[0-9休保㈱]{1,3}$/.test(String(b.text || '').trim()) && bw(b) < 90)
        .sort((a, b) => cx(a) - cx(b));
      if (cand.length) pts.push({ x: cx(cand[0]), y: cy(cand[0]) });
    }
    return pts;
  };
  // 合計列: 各行で右半分にあるカンマ付き金額 box のうち最も信頼の高いもの。
  const trackSum = (near, tol) => {
    const pts = [];
    for (const rb of rowClusters) {
      let best = null, bd = Infinity;
      for (const b of rb) {
        const t = String(b.text || '').trim();
        if (!/[0-9]/.test(t)) continue;
        const d = Math.abs(cx(b) - near);
        if (d < bd && d <= tol) { bd = d; best = b; }
      }
      if (best) pts.push({ x: cx(best), y: cy(best) });
    }
    return pts;
  };

  const sumCol = columns.find((c) => c.name === '合計');
  const left = fitXY(trackNo());
  const right = sumCol ? fitXY(trackSum(sumCol.center, 110)) : null;

  if (!left || !right || Math.abs(right.meanX - left.meanX) < 1) {
    const only = left || right;
    return { headerY, slopeAt: () => (only ? only.slope : 0) };
  }
  const b = (right.slope - left.slope) / (right.meanX - left.meanX);
  const a = left.slope - b * left.meanX;
  return {
    headerY,
    slopeAt: (x) => a + b * x,
    _samples: [
      { x: left.meanX, slope: left.slope },
      { x: right.meanX, slope: right.slope },
    ],
  };
}

// 行の y における列中心。シアー補正を適用。
function rowColumnCenter(col, rowY, shear) {
  return col.center + shear.slopeAt(col.center) * (rowY - shear.headerY);
}

// 各行 box を x 中心が入る列帯へ割り当てる。
// シアー補正済みの行ローカル列帯を使う。
// 同一セルに複数 box があれば x 順に連結。
// 1行 = { セル名: {text, confidence} }
function assignCells(rowBoxes, columns, shear) {
  const cells = {};
  if (!rowBoxes.length) return cells;
  const rowY = rowBoxes.reduce((s, b) => s + cy(b), 0) / rowBoxes.length;
  // この行ローカルの列中心
  const local = columns.map((c) => ({
    col: c,
    center: shear ? rowColumnCenter(c, rowY, shear) : c.center,
  }));
  local.sort((a, b) => a.center - b.center);
  // 行ローカル境界 = 隣接中心の中点
  for (let i = 0; i < local.length; i++) {
    const c = local[i].center;
    const prevC = i > 0 ? local[i - 1].center : null;
    const nextC = i < local.length - 1 ? local[i + 1].center : null;
    local[i].xMin = prevC != null ? (prevC + c) / 2 : -Infinity;
    local[i].xMax = nextC != null ? (nextC + c) / 2 : Infinity;
  }
  const buckets = new Map(columns.map((c) => [c.name, []]));
  for (const b of rowBoxes) {
    const c = cx(b);
    let slot = local.find((l) => c >= l.xMin && c < l.xMax);
    if (!slot) {
      slot = local.reduce((best, l) => {
        const d = Math.abs(c - l.center);
        return !best || d < best.d ? { ...l, d } : best;
      }, null);
    }
    buckets.get(slot.col.name).push(b);
  }
  for (const col of columns) {
    const bs = buckets.get(col.name).sort((a, b) => cx(a) - cx(b));
    if (!bs.length) continue;
    const text = bs.map((b) => String(b.text || '').trim()).join(' ').trim();
    const conf = bs.reduce((s, b) => s + (b.confidence || 0), 0) / bs.length;
    cells[col.name] = { text, confidence: conf };
  }
  return cells;
}

// =============================================================================
// normalizeCell / finalizeRow
// =============================================================================

// 全角数字・記号を半角へ
const Z2H = {
  '０': '0', '１': '1', '２': '2', '３': '3', '４': '4',
  '５': '5', '６': '6', '７': '7', '８': '8', '９': '9',
  'Ｏ': '0', 'ｏ': '0', 'O': '0', 'o': '0', 'Ｉ': '1', 'ｌ': '1',
  '：': ':', '．': '.', '，': ',', '　': ' ',
};
function toHalf(s) {
  return String(s || '').replace(/[０-９ＯｏOoＩｌ：．，　]/g, (c) => Z2H[c] || c);
}

// 信頼度しきい値（これ未満の box 由来セルは低信頼）
const CONF_THRESHOLD = 0.55;

// セルの生テキストを列 type で正規化する。
// 戻り値 { text, lowConfidence }
function normalizeCell(rawText, type, confidence) {
  const raw = toHalf(rawText).trim();
  let text = raw;
  let lowConfidence = false;

  if (type === 'time') {
    // 数字を抽出。区切り(, . 月 等)を : とみなし H:MM へ。
    const digits = raw.replace(/[^0-9]/g, '');
    if (digits.length >= 3 && digits.length <= 4) {
      const mm = digits.slice(-2);
      const hh = digits.slice(0, -2);
      text = `${parseInt(hh, 10)}:${mm}`;
    } else if (digits.length === 2) {
      // "35" のような分のみ → 0:35 とみなす
      text = `0:${digits}`;
    } else if (digits.length === 1) {
      text = `0:0${digits}`;
      lowConfidence = true;
    } else {
      text = digits ? digits : '';
      if (raw) lowConfidence = true;
    }
  } else if (type === 'decimal') {
    // 営Km: 数字を抽出し NN.N（小数1桁）へ
    const digits = raw.replace(/[^0-9]/g, '');
    if (digits.length >= 2) {
      const d1 = digits.slice(-1);
      const intp = digits.slice(0, -1);
      text = `${parseInt(intp, 10)}.${d1}`;
    } else if (digits.length === 1) {
      text = `0.${digits}`;
    } else {
      text = '';
    }
  } else if (type === 'fare') {
    const digits = raw.replace(/[^0-9]/g, '');
    text = digits ? String(parseInt(digits, 10)) : '';
  } else if (type === 'int') {
    // No 列は "休"/"保" 等の文字も許容
    const digits = raw.replace(/[^0-9]/g, '');
    if (digits) {
      text = String(parseInt(digits, 10));
    } else if (raw) {
      text = raw; // 休 等そのまま
    } else {
      text = '';
    }
  } else if (type === 'flag') {
    text = /[迎連週迅迅]/.test(raw) ? '迎' : '';
  } else {
    // text
    text = raw;
  }

  // 低信頼判定: OCR confidence 低 / 正規化で空になった（元は非空）
  if (confidence != null && confidence < CONF_THRESHOLD) lowConfidence = true;
  if (!text && rawText && String(rawText).trim()) lowConfidence = true;
  return { text, lowConfidence };
}

// assignCells の結果（{セル名:{text,confidence}}）を列タイプで正規化し、
// 1 行のフラットなオブジェクト { セル名: 値, _flags: {...}, _raw: {...} } にする。
function finalizeRow(cells, columns) {
  const row = {};
  const flags = {};
  const raw = {};
  for (const col of columns) {
    const cell = cells[col.name];
    const rawText = cell ? cell.text : '';
    const conf = cell ? cell.confidence : null;
    const norm = normalizeCell(rawText, col.type, conf);
    row[col.name] = norm.text;
    raw[col.name] = rawText;
    if (norm.lowConfidence) flags[col.name] = true;
  }
  row._flags = flags;
  row._raw = raw;
  return row;
}

// =============================================================================
// 全段結線
// =============================================================================

/**
 * PP-OCR の {text, boxes} を営業明細の構造化行に復元する。
 * @param {{text?:string, boxes?:Array<{text:string,bbox:number[],confidence:number}>}} ocrOutput
 * @returns {{rows:Array<Object>, header:{y:number,columns:Array}|null}}
 */
export function reconstructRows(ocrOutput) {
  const boxes = (ocrOutput && ocrOutput.boxes) || [];
  const header = findHeaderRow(boxes);
  if (!header) return { rows: [], header: null };
  const columns = deriveColumns(header.boxes);
  if (!columns.length) return { rows: [], header: null };
  const { rows: rowClusters, shear } = clusterRows(boxes, header.bottom, columns);
  const rawRows = rowClusters.map((rb) => assignCells(rb, columns, shear));
  const rows = rawRows.map((cells) => finalizeRow(cells, columns));
  return { rows, header: { y: header.y, columns } };
}

export {
  KEIHO_COLUMNS,
  HEADER_ALIASES,
  findHeaderRow,
  deriveColumns,
  clusterRows,
  detectShear,
  assignCells,
  normalizeCell,
  finalizeRow,
};

export async function loadArrivals() {
  // GitHub Pages の CDN キャッシュもバイパスするため URL に時刻クエリを付与
  const res = await fetch(`./data/arrivals.json?t=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return normalizeArrivals(data);
}

// ODPT が時刻未確定便で返す "to be determined" を null に正規化する。
// nullish coalescing (`??`) のフォールバックは文字列を素通しするため、ここで吸収する。
// あわせて status="不明" を時刻情報から「到着」「飛行中」に振り分ける。
export function normalizeArrivals(data, now = new Date()) {
  if (!data || !Array.isArray(data.flights)) return data;
  const nowMin = now.getHours() * 60 + now.getMinutes();
  for (const f of data.flights) {
    if (f.estimatedTime === 'to be determined') f.estimatedTime = null;
    if (f.scheduledTime === 'to be determined') f.scheduledTime = null;
    if (f.actualTime === 'to be determined') f.actualTime = null;
    // ODPT が flightStatus を返さない便は status="不明" として渡される。
    // 長距離国際線で多い。判定:
    //  1) actualTime あり → 「到着」（既に着陸記録あり）
    //  2) estimatedTime/scheduledTime が現在時刻より前 → 「到着」（時刻を過ぎたものは着いている）
    //  3) それ以外 → 「飛行中」
    if (f.status === '不明') {
      if (f.actualTime) {
        f.status = '到着';
      } else {
        const t = f.estimatedTime ?? f.scheduledTime;
        if (t && typeof t === 'string') {
          const [h, m] = t.split(':').map(Number);
          const tMin = h * 60 + m;
          f.status = (tMin < nowMin) ? '到着' : '飛行中';
        } else {
          f.status = '飛行中';
        }
      }
    }
  }
  return data;
}

export function filterByTerminals(arrivals, terminals) {
  const set = new Set(terminals);
  return arrivals.flights.filter(f => set.has(f.terminal));
}

// poolLane(乗り場号 1-4) で便を絞る。lane が 0/falsy なら全件(フィルタ無し)。
export function filterByLane(flights, lane) {
  if (!lane) return flights || [];
  return (flights || []).filter(f => f.poolLane === lane);
}

// 「到着の谷間」検出: ロビーに出る時刻(遅延込み=lobbyExitTime優先)を15分ビンで並べ、
// ロビー客がぐっと減る区間(=次にタクシー需要が手薄になる時間帯)を返す。
// 遅延で便が後ろにずれてできた空白も lobbyExitTime で見るので自動的に拾える。
// 判定: ビンのロビー出 pax が「直近の中央値×lowRatio」と下限 lowFloor の大きい方を下回る or 便0 → 手薄。
//       手薄が連続し、その後に通常の到着が戻る(末尾の本日終了は除外)区間を「谷間/手薄」とする。
// 返り値: { kind:'gap'(>=minGapMin) | 'lull', startMin, endMin, durationMin } または null。
export function detectArrivalGap(flights, nowMin, opts = {}) {
  const BIN = opts.binMin ?? 15;
  const lookahead = opts.lookaheadMin ?? 240;
  const minGap = opts.minGapMin ?? 30;
  const lowRatio = opts.lowRatio ?? 0.4;
  const lowFloor = opts.lowFloor ?? 350;
  const t2m = (t) => {
    if (!t || String(t).length < 4) return null;
    const a = String(t).split(':'); const h = +a[0], m = +a[1];
    return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
  };
  const upcoming = [];
  for (const f of (flights || [])) {
    if (f.status === '欠航') continue;
    const tm = t2m(f.lobbyExitTime ?? f.estimatedTime ?? f.scheduledTime);
    if (tm == null || tm < nowMin || tm > nowMin + lookahead) continue;
    upcoming.push({ tm, pax: typeof f.estimatedPax === 'number' ? f.estimatedPax : 0 });
  }
  if (upcoming.length === 0) return null;
  const lastMin = Math.max(...upcoming.map((u) => u.tm));
  const bins = new Map();
  for (const u of upcoming) {
    const b = Math.floor(u.tm / BIN) * BIN;
    const cur = bins.get(b) || { pax: 0, count: 0 };
    cur.pax += u.pax; cur.count += 1; bins.set(b, cur);
  }
  const paxVals = [...bins.values()].map((b) => b.pax).sort((a, b) => a - b);
  const ref = paxVals.length ? paxVals[Math.floor(paxVals.length / 2)] : 0;
  const threshold = Math.max(lowFloor, ref * lowRatio);
  const isLull = (slot) => { const b = bins.get(slot); return !b || b.count === 0 || b.pax < threshold; };
  const startSlot = Math.floor(nowMin / BIN) * BIN;
  const lastSlot = Math.floor(lastMin / BIN) * BIN;
  for (let slot = startSlot; slot <= lastSlot; slot += BIN) {
    if (!isLull(slot)) continue;
    let run = slot;
    while (run + BIN <= lastSlot && isLull(run + BIN)) run += BIN;
    if (run < lastSlot) { // run の後に通常の到着が戻る(=末尾の本日終了ではない)
      const durationMin = (run + BIN) - slot;
      return { kind: durationMin >= minGap ? 'gap' : 'lull', startMin: slot, endMin: run + BIN, durationMin };
    }
    break; // 末尾の空白(以降便なし)は谷間にしない
  }
  return null;
}

export function filterByTimeWindow(flights, nowDate, pastMinutes = 30, futureMinutes = 180) {
  const nowMin = nowDate.getHours() * 60 + nowDate.getMinutes();
  return flights.filter(f => {
    const t = f.estimatedTime ?? f.scheduledTime;
    if (!t) return false;
    const [h, m] = t.split(':').map(Number);
    const fMin = h * 60 + m;
    return fMin >= nowMin - pastMinutes && fMin <= nowMin + futureMinutes;
  });
}

const DENSITY_HIGH = 600;
const DENSITY_MID = 300;

function classifyDensity(value) {
  if (value >= DENSITY_HIGH) return 'high';
  if (value >= DENSITY_MID) return 'mid';
  return 'low';
}

export function aggregateHeatmapClient(flights) {
  const bins = new Map();
  for (const f of flights) {
    const t = f.estimatedTime ?? f.scheduledTime;
    if (!t) continue;
    const [h, m] = t.split(':').map(Number);
    const binMin = m < 30 ? '00' : '30';
    const key = `${String(h).padStart(2, '0')}:${binMin}`;
    if (!bins.has(key)) {
      bins.set(key, {
        bin: key, totalPax: 0, internationalPax: 0,
        flightCount: 0, unknownCount: 0, delayedCount: 0, internationalCount: 0,
        reachNoneCount: 0, cancelledCount: 0
      });
    }
    const b = bins.get(key);
    // 欠航便は降客をもたらさない。降客数には含めず別計上する。
    if (f.status === '欠航') { b.cancelledCount += 1; continue; }
    b.flightCount += 1;
    if (f.estimatedPax === null) b.unknownCount += 1;
    else {
      b.totalPax += f.estimatedPax;
      if (f.isInternational) b.internationalPax += f.estimatedPax;
    }
    if (f.isInternational) b.internationalCount += 1;
    if (f.status === '遅延') b.delayedCount += 1;
    if (f.reachTier === 'none') b.reachNoneCount += 1;
  }
  const arr = Array.from(bins.values()).sort((a, b) => a.bin.localeCompare(b.bin));
  return arr.map(b => ({
    ...b,
    densityTier: classifyDensity(b.totalPax)
  }));
}

export function summarizeFlights(flights, opts = {}) {
  const windowHours = opts.windowHours ?? 3.5;
  const windowLabel = opts.windowLabel ?? '直近3時間';
  // 欠航便は降客をもたらさないので集計から除外し、別途 cancelledCount で数える。
  const cancelledCount = flights.filter(f => f.status === '欠航').length;
  const operating = flights.filter(f => f.status !== '欠航');
  const totalPax = operating.reduce((s, f) => s + (f.estimatedPax ?? 0), 0);
  const internationalPax = operating
    .filter(f => f.isInternational)
    .reduce((s, f) => s + (f.estimatedPax ?? 0), 0);
  const totalFlights = operating.length;
  const internationalCount = operating.filter(f => f.isInternational).length;
  const delayedCount = operating.filter(f => f.status === '遅延').length;
  const unknownCount = operating.filter(f => f.estimatedPax === null).length;
  const hourlyAvg = totalFlights > 0 ? Math.round(totalPax / windowHours) : 0;
  const reachNoneCount = operating.filter(f => f.reachTier === 'none').length;
  return {
    totalPax, internationalPax,
    totalFlights, internationalCount,
    delayedCount, unknownCount, hourlyAvg,
    windowLabel,
    reachNoneCount, cancelledCount
  };
}

function timeToMinutes(hhmm) {
  if (!hhmm) return null;
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

export function sortFlightsByTime(flights) {
  return [...flights].sort((a, b) => {
    const ta = timeToMinutes(a.estimatedTime ?? a.scheduledTime) ?? Infinity;
    const tb = timeToMinutes(b.estimatedTime ?? b.scheduledTime) ?? Infinity;
    return ta - tb;
  });
}

// 乗り場(号)別 到着見込み。これから windowMin 分以内にロビー出口へ出てくる便を号別に集計。
// 欠航は除外。時刻は lobbyExitTime 優先(無ければ estimatedTime/scheduledTime)。
// poolLane(1-4) が未確定の便(出口未割当)は undetermined として別数える。
export const NORIBA_LABELS = { 1: 'T1 南', 2: 'T1 北', 3: 'T2 北', 4: 'T2 南・国際' };

// 21時以降は「最終便」を明確に出すための基準時刻(JST 時)。
export const LATE_NIGHT_FROM_HOUR = 21;

export function summarizeByNoriba(arrivals, nowDate, windowMin) {
  const lanes = {};
  for (const n of [1, 2, 3, 4]) {
    lanes[n] = { lane: n, label: NORIBA_LABELS[n], count: 0, taxiPax: 0, seatSum: 0, seatUnknown: 0, flights: [], lastFlight: null, _lastDiff: -1 };
  }
  let undetermined = 0;
  const isLateNight = nowDate.getHours() >= LATE_NIGHT_FROM_HOUR;
  if (!arrivals || !Array.isArray(arrivals.flights)) {
    return { lanes: [lanes[1], lanes[2], lanes[3], lanes[4]], undetermined, windowMin, isLateNight };
  }
  const nowMin = nowDate.getHours() * 60 + nowDate.getMinutes();
  for (const f of arrivals.flights) {
    if (f.status === '欠航') continue;
    const t = f.lobbyExitTime ?? f.estimatedTime ?? f.scheduledTime;
    const fMin = timeToMinutes(t);
    if (fMin === null) continue;
    // arrivals.json は当日分の時刻表。過去の便(diff<0)は対象外。
    // 日付またぎ補正は入れない(過去の早朝便を翌日と誤判定し「最終便」が壊れるため)。
    const diff = fMin - nowMin;
    if (diff < 0) continue; // 既に過ぎた便は対象外
    if (!Number.isInteger(f.poolLane) || f.poolLane < 1 || f.poolLane > 4) {
      if (diff <= windowMin) undetermined++;
      continue;
    }
    const lane = lanes[f.poolLane];
    const seat = (typeof f.seatCount === 'number' && f.seatCount > 0) ? f.seatCount : null;
    // 最終便: これから到着する便のうち最も遅い到着(窓に関係なく当日全体)
    if (diff > lane._lastDiff) {
      lane._lastDiff = diff;
      lane.lastFlight = { time: f.estimatedTime ?? f.scheduledTime ?? t, fromName: f.fromName, flightNumber: f.flightNumber, seatCount: seat };
    }
    // 窓内の集計
    if (diff <= windowMin) {
      lane.count += 1;
      lane.taxiPax += (typeof f.estimatedTaxiPax === 'number' ? f.estimatedTaxiPax : 0);
      if (seat !== null) lane.seatSum += seat; else lane.seatUnknown += 1;
      lane.flights.push({ time: t, fromName: f.fromName, flightNumber: f.flightNumber, taxiPax: f.estimatedTaxiPax ?? null, seatCount: seat });
    }
  }
  for (const n of [1, 2, 3, 4]) {
    lanes[n].flights.sort((a, b) => (timeToMinutes(a.time) ?? 0) - (timeToMinutes(b.time) ?? 0));
    delete lanes[n]._lastDiff;
  }
  return { lanes: [lanes[1], lanes[2], lanes[3], lanes[4]], undetermined, windowMin, isLateNight };
}

// 大幅遅延とみなす遅延分数の下限。
export const BIG_DELAY_MIN = 30;

// 到着予定がこの分数より過去の便は「大幅遅延」枠に出さない
// (羽田APIが国際便のstatusを「到着」に更新しないまま何時間も残る実例があり、
//  とっくに着いた便が到着予定として居座って下の便リストとズレる 2026-08-08報告)。
export const TOPIC_PAST_GRACE_MIN = 30;

// 日またぎ補正: HH:MM同士の引き算を [-720, 720) 分に正規化する。
// 例) 定刻23:50→予定0:40 は -1390 ではなく +50分遅延。
function wrapHalfDay(diffMin) {
  if (diffMin < -720) return diffMin + 1440;
  if (diffMin >= 720) return diffMin - 1440;
  return diffMin;
}

// 大幅遅延便（予定より BIG_DELAY_MIN 分以上遅れている未到着便）を抽出する。
// nowMinutes (0:00からの分) を渡すと、到着予定が TOPIC_PAST_GRACE_MIN 分より
// 過去の便を除外し、並び順も「今から近い順」(日またぎ考慮) になる。
export function detectTopics(flights, nowMinutes = null) {
  const topics = [];
  for (const f of flights) {
    if (f.status === '到着' || f.status === '欠航') continue;
    const sched = timeToMinutes(f.scheduledTime);
    const est = timeToMinutes(f.estimatedTime ?? f.scheduledTime);
    const delayMin = (sched !== null && est !== null)
      ? Math.max(0, wrapHalfDay(est - sched))
      : 0;
    if (delayMin < BIG_DELAY_MIN) continue;
    if (nowMinutes !== null && est !== null) {
      const rel = wrapHalfDay(est - nowMinutes);
      if (rel < -TOPIC_PAST_GRACE_MIN) continue; // 30分以上過去=表示しない
    }
    topics.push({
      flightNumber: f.flightNumber,
      fromName: f.fromName,
      terminal: f.terminal,
      poolLane: f.poolLane ?? null,
      scheduledTime: f.scheduledTime,
      estimatedTime: f.estimatedTime ?? f.scheduledTime,
      delayMin,
      estimatedPax: f.estimatedPax ?? null,
      paxSource: f.paxSource ?? null,
      laneActual: f.laneActual ?? null,
      laneActualDiffers: f.laneActualDiffers ?? false
    });
  }
  const sortKey = (t) => {
    const m = timeToMinutes(t.estimatedTime);
    if (m === null) return Infinity;
    return nowMinutes !== null ? wrapHalfDay(m - nowMinutes) : m;
  };
  topics.sort((a, b) => sortKey(a) - sortKey(b));
  return topics;
}

export function minutesSince(isoString) {
  const t = new Date(isoString);
  return Math.floor((Date.now() - t.getTime()) / 60000);
}

const STALENESS_WARN_MIN = 30;
const STALENESS_CRITICAL_MIN = 90;
const SUPPRESS_BEFORE_JST_HOUR = 5;

function jstHour(date) {
  const jstStr = date.toLocaleString('en-US', { timeZone: 'Asia/Tokyo', hour: 'numeric', hour12: false });
  return parseInt(jstStr, 10);
}

// 便配列から「出発地別の便数」リストを返す純関数。
// 便数降順、同点は fromName 昇順。
// fromName が無い便は除外。
export function listOriginOptions(flights) {
  if (!Array.isArray(flights) || flights.length === 0) return [];
  const map = new Map();
  for (const f of flights) {
    if (!f.fromName) continue;
    map.set(f.fromName, (map.get(f.fromName) || 0) + 1);
  }
  return [...map.entries()]
    .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))
    .map(([fromName, count]) => ({ fromName, count }));
}

export function classifyStaleness(updatedAtIso, now) {
  if (!updatedAtIso) return { level: 'suppressed', ageMinutes: null };
  if (jstHour(now) < SUPPRESS_BEFORE_JST_HOUR) {
    return { level: 'suppressed', ageMinutes: null };
  }
  const ageMinutes = Math.floor((now.getTime() - new Date(updatedAtIso).getTime()) / 60000);
  if (ageMinutes < STALENESS_WARN_MIN) return { level: 'fresh', ageMinutes };
  if (ageMinutes <= STALENESS_CRITICAL_MIN) return { level: 'warn', ageMinutes };
  return { level: 'critical', ageMinutes };
}

// 乗り場(号)の実績パターン(lane-patterns.json)を取得。失敗時は null(実績表示なしで安全劣化)。
export async function loadLanePatterns() {
  try {
    const res = await fetch(`./data/lane-patterns.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// --- 実績パターンの適用 (2026-08-14) ---------------------------------------
// 遅延便は通常と違う号に着くことがある。現地掲示で確定した過去の実績から
// 「この便・この時間帯なら実際はこの号」を出す。推定と食い違うときだけ意味を持つ。
// 判定順: 便×時間帯 → 便 → 時間帯×航空会社。実績が無ければ何も言わない。

const LANE_DECISIVE_SHARE = 0.7;

/** "0:48"/"23:59" → 時間帯バンド。深夜は翌日側に送る(計測側 lane-actuals.mjs と同じ規則)。 */
export function laneTimeBand(text) {
  const m = String(text ?? '').match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return 'unknown';
  const h = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  if (h > 29 || mm > 59) return 'unknown';
  const min = (h < 12 ? h + 24 : h) * 60 + mm;
  if (min < 22 * 60) return 'day';
  if (min < 23 * 60) return 'late22';
  if (min < 24 * 60) return 'late23';
  if (min < 25 * 60) return 'mid00';
  return 'mid01+';
}

const laneNormFn = (s) => {
  const m = String(s ?? '').replace(/\s/g, '').toUpperCase().match(/^([A-Z0-9]{2})0*(\d+)$/);
  return m ? m[1] + m[2] : null;
};

function lanePick(entry, basis) {
  const decisive = entry.share >= LANE_DECISIVE_SHARE;
  return {
    stall: decisive ? entry.stall : (entry.recentStall ?? entry.stall),
    share: entry.share,
    n: entry.n,
    basis,
    recent: !decisive,
  };
}

/** 1便に実績パターンを当てる。無ければ null。 */
export function lookupLaneActual(flight, patterns) {
  if (!flight || !patterns) return null;
  const fno = laneNormFn(flight.flightNumber);
  if (!fno) return null;
  const band = laneTimeBand(flight.estimatedTime ?? flight.scheduledTime ?? null);
  const fb = patterns.byFlightBand?.[`${fno}|${band}`];
  if (fb) return lanePick(fb, 'flight-band');
  const f = patterns.byFlight?.[fno];
  if (f) return lanePick(f, 'flight');
  const p = patterns.byPattern?.[`${band}|${fno.slice(0, 2)}`];
  if (p) return lanePick(p, 'pattern');
  return null;
}

/**
 * 便配列に実績を付ける。推定号(poolLane)と実績が違う便には laneActual を持たせる。
 * 現地掲示で既に確定済み(laneSource==='notice')の便は上書きしない(掲示が最優先)。
 * @returns 付与した件数
 */
export function applyLaneActuals(flights, patterns) {
  if (!Array.isArray(flights) || !patterns) return 0;
  let n = 0;
  for (const f of flights) {
    if (f.laneSource === 'notice') continue;   // 今夜の掲示が出ていればそちらが正
    if (f.status === '到着' || f.status === '欠航') continue;
    const hit = lookupLaneActual(f, patterns);
    if (!hit) continue;
    f.laneActual = hit;
    if (f.poolLane != null && hit.stall !== f.poolLane) {
      f.laneActualDiffers = true;   // 推定と食い違う=乗務員に伝える価値がある
      n += 1;
    }
  }
  return n;
}

// 羽田プール現地案内(pool-notice.json)を取得。失敗時は null(バナー非表示で安全劣化)。
export async function loadPoolNotice() {
  try {
    const res = await fetch(`./data/pool-notice.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// 号(乗り場)の表示文字列。確定号があり推定と異なれば "4→3"、同じなら確定号、確定なしは推定号。
export function formatLaneDisplay(estimate, confirmed) {
  if (confirmed == null) return estimate != null ? String(estimate) : '';
  if (estimate != null && Number(estimate) !== Number(confirmed)) return `${estimate}→${confirmed}`;
  return `${confirmed}`;
}

// ── 乗り場アクティビティ（号別の今） ──────────────────────────────
function minutesToHHMM(min) {
  const h = Math.floor(min / 60) % 24, m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// 通常比: 今日の実測 ÷ この時間帯の通常。基準が小さすぎる(≈0)時は非表示。
export function classifyNormalRatio(actual, baseline) {
  if (actual == null || !(baseline > 0.3)) return { ratio: null, dir: null };
  const ratio = actual / baseline;
  const dir = ratio > 1.25 ? 'up' : (ratio < 0.75 ? 'down' : 'eq');
  return { ratio, dir };
}

// 活発はいつまで: 予測がピークの50%を下回る最初の時刻。直近で下回れば 'soon'、窓内ずっと高ければ 'long'。
export function findActiveUntil(forward, peak) {
  if (!Array.isArray(forward) || forward.length === 0 || !(peak > 0)) return null;
  const thr = peak * 0.5;
  if (forward[0].val < thr) return 'soon';
  for (let i = 1; i < forward.length; i++) {
    if (forward[i].val < thr) return i === 1 ? 'soon' : minutesToHHMM(forward[i].min);
  }
  return 'long';
}

// 号別の待機スロット総数（占有→段数スケールの容量。前列台数rowWidthではなく実スロット数）。
export const STALL_CAPACITY = { 1: 16, 2: 14, 3: 16, 4: 12 };
// 占有(待機車両数)→0..5段。容量(その号の実スロット総数)比でスケール。
export function occupancySegments(occ, capacity) {
  if (typeof occ !== 'number' || !(capacity > 0)) return 0;
  return Math.max(0, Math.min(5, Math.round((occ / capacity) * 5)));
}
// 全レーン埋まり率(0-1)→0..5段。前列のみのoccでなく、後列まで含む全レーンの埋まり具合を反映。
export function fillRateSegments(ratio) {
  if (typeof ratio !== 'number' || ratio < 0) return 0;
  return Math.max(0, Math.min(5, Math.round(ratio * 5)));
}
// 段数→短い量の言葉(評価でなく量の目安)。
export function occupancyLabel(segments) {
  if (segments == null) return null;
  return segments <= 1 ? '少なめ' : (segments <= 3 ? '並程度' : '多め');
}

// 今の埋まり率と「その号・その時間帯の普段」を比べた言葉。
// 差(パーセントポイント)で判定する — 比率だと普段が小さい号(4号)で過敏になるため。
export function compareToTypical(fillRate, typical) {
  if (typeof fillRate !== 'number' || typeof typical !== 'number' || typical <= 0) return null;
  const diff = (fillRate - typical) * 100;
  if (diff >= 15) return 'いつもより多い';
  if (diff <= -15) return 'いつもより少ない';
  return 'いつもどおり';
}

// 号別アクティビティ: 需要(summarizeByNoriba) ＋ 待機車両(pool-status) ＋ 動き(advance-forecast)。
export function buildNoribaActivity(arrivals, forecast, poolStatus, now = new Date()) {
  const demand = summarizeByNoriba(arrivals, now, 60).lanes; // [lane1..4]
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const nowBin = Math.floor(nowMin / 15);
  const fc = (forecast && Array.isArray(forecast.slots) && forecast.slots.length >= 96) ? forecast : null;
  return demand.map((d) => {
    const lane = d.lane;
    const out = {
      lane,
      terminal: lane <= 2 ? 'T1' : 'T2',
      demand: {
        flights60: d.count,
        pax60: d.taxiPax,
        planeIcons: Math.min(d.count, 5),
        morePlanes: d.count > 5,
        nextFlight: d.flights[0] || null,
        lastFlight: d.lastFlight || null,
      },
      detailFlights: d.flights,
      occupancy: { segments: 0, label: null, vehicles: null },
      movement: { level: null, normalRatio: null, ratioDir: null, activeUntil: null, sparkFuture: [], curve: null },
    };
    // 待機車両(占有): pool-status の stallN.fillRate(全レーン埋まり率0-1)を段数化。
    // 旧 occ/実スロット数は前列のみで遠景の満車を過小評価していた(満車でも「並」)。後列まで含む
    // 全レーン学習計測の fillRate を主系にし、fillRate 無いデータは従来 occ にフォールバック。
    const psStall = poolStatus && poolStatus.stalls ? poolStatus.stalls['stall' + lane] : null;
    if (psStall && typeof psStall.fillRate === 'number') {
      const seg = fillRateSegments(psStall.fillRate);
      out.occupancy = { segments: seg, label: occupancyLabel(seg), vehicles: psStall.occ, fillPct: Math.round(psStall.fillRate * 100) };
      // 「その号・その時間帯の普段」の目盛りと相対ラベル。号ごとに普段の埋まり具合が
      // 大きく違う(昼 2号0.87 vs 4号0.50)ため、絶対量だけでは同じ見た目の意味が逆になる。
      if (typeof psStall.typicalFillRate === 'number' && psStall.typicalFillRate > 0) {
        out.occupancy.typicalPct = Math.round(psStall.typicalFillRate * 100);
        out.occupancy.vsTypical = compareToTypical(psStall.fillRate, psStall.typicalFillRate);
      }
    } else if (psStall && typeof psStall.occ === 'number') {
      const cap = STALL_CAPACITY[lane] || 16;
      const seg = occupancySegments(psStall.occ, cap);
      out.occupancy = { segments: seg, label: occupancyLabel(seg), vehicles: psStall.occ };
    }
    if (!fc) return out;
    const key = 'stall' + lane;
    const dayVals = fc.slots.map((s) => (s.stalls && typeof s.stalls[key] === 'number') ? s.stalls[key] : 0);
    const peak = Math.max(...dayVals, 0);
    const bn = Math.min(nowBin, dayVals.length - 1);
    const baselineNow = dayVals[bn] || 0;
    const actualNow = (fc.current && fc.current.stalls && typeof fc.current.stalls[key] === 'number')
      ? fc.current.stalls[key] : baselineNow;
    const { ratio, dir } = classifyNormalRatio(actualNow, baselineNow);
    let level = null;
    if (peak > 0) { const r = actualNow / peak; level = r >= 0.66 ? '速い' : (r >= 0.33 ? '普通' : '遅い'); }
    const forward = [];
    for (let i = bn; i < dayVals.length; i++) forward.push({ min: i * 15, val: dayVals[i] });
    let activeUntil = findActiveUntil(forward, peak);
    // 活発untilは「今活発な時」だけ意味がある。弱い/不明の時は出さない(閑散時に「まもなく落ち着く」と誤解させない)。
    if (level !== '速い' && level !== '普通') activeUntil = null;
    const cStart = Math.max(0, bn - 8), cEnd = Math.min(dayVals.length - 1, bn + 8);
    const todayMap = {};
    if (Array.isArray(fc.actualsToday)) for (const a of fc.actualsToday) {
      if (a.stalls && typeof a.stalls[key] === 'number') todayMap[a.time] = a.stalls[key];
    }
    const normal = [], today = [], forecastArr = [];
    for (let i = cStart; i <= cEnd; i++) {
      normal.push(dayVals[i]);
      const hhmm = minutesToHHMM(i * 15);
      if (i <= bn) { today.push(todayMap[hhmm] ?? null); forecastArr.push(null); }
      else { today.push(null); forecastArr.push(dayVals[i]); }
    }
    const fillPct = peak > 0 ? Math.max(0, Math.min(100, Math.round((actualNow / peak) * 100))) : 0;
    const normalMarkerPct = (peak > 0 && baselineNow > 0.3) ? Math.max(0, Math.min(100, Math.round((baselineNow / peak) * 100))) : null;
    out.movement = {
      level, normalRatio: ratio, ratioDir: dir, activeUntil, fillPct, normalMarkerPct,
      sparkFuture: dayVals.slice(bn, bn + 6),
      curve: {
        start: minutesToHHMM(cStart * 15), now: minutesToHHMM(bn * 15), end: minutesToHHMM(cEnd * 15),
        active: (typeof activeUntil === 'string' && /^\d/.test(activeUntil)) ? activeUntil : null,
        normal, today, forecast: forecastArr, nowIndex: bn - cStart,
      },
    };
    return out;
  });
}


// ── 現地掲示(lateFlights)による便情報の上書き ─────────────────────────
// pool-notice.json の lateFlights (タクシーセンター掲示の自動構造化・2026-08-08〜) を
// 到着便データに突き合わせる。深夜遅延便は静的推定より現地掲示が正:
// 実測35便で推定搭乗人数のMAEは97人(振替集約/分散で±200人級のズレ)、号も掲示が確定情報。

const NOTICE_CARRIER_TO_IATA = {
  'JAL': 'JL', '日本航空': 'JL',
  'ANA': 'NH', '全日空': 'NH',
  'SKY': 'BC', 'スカイマーク': 'BC',
  'ADO': 'HD', 'エアドゥ': 'HD',
  'SFJ': '7G', 'スターフライヤー': '7G',
  'ソラシド': '6J', 'SNA': '6J',
};

// 掲示の便名 ("ANA84 札幌便"/"JAL920 沖縄便"/"ソラシド26 沖縄便") → IATA便名 ("NH84")。
// 便番号が無い名前 ("全日空 深圳便") は null。
export function noticeNameToFlightNumber(name) {
  const m = String(name ?? '').match(/(JAL|日本航空|ANA|全日空|SKY|スカイマーク|ADO|エアドゥ|SFJ|スターフライヤー|ソラシド|SNA)\s*(\d{1,4})/);
  if (!m) return null;
  const iata = NOTICE_CARRIER_TO_IATA[m[1]];
  return iata ? iata + String(parseInt(m[2], 10)) : null;
}

const normalizeFlightNumber = (s) => {
  const m = String(s ?? '').replace(/\s/g, '').match(/^([A-Z0-9]{2})0*(\d+)$/);
  return m ? m[1] + m[2] : null;
};

// 掲示の未着便を便番号でマッチさせ、搭乗人数(f.estimatedPax)と号(f.poolLane)を上書きする。
// 上書きした便には f.paxSource='notice' / f.noticeEta を付け、元の値は f.estimatedPaxModel /
// f.poolLaneModel に退避する(表示側が「現地掲示」バッジと差分表示に使う)。到着済み掲示は無視。
// 返り値: 上書きした便数。
export function applyNoticeOverrides(flights, lateFlights) {
  if (!Array.isArray(flights) || !lateFlights || !Array.isArray(lateFlights.flights)) return 0;
  const byNumber = new Map();
  for (const nf of lateFlights.flights) {
    if (nf.arrived) continue;
    const fno = noticeNameToFlightNumber(nf.name);
    if (fno) byNumber.set(fno, nf);
  }
  if (byNumber.size === 0) return 0;
  let count = 0;
  for (const f of flights) {
    if (f.status === '到着' || f.status === '欠航') continue;
    const fno = normalizeFlightNumber(f.flightNumber);
    const nf = fno ? byNumber.get(fno) : null;
    if (!nf) continue;
    if (typeof nf.pax === 'number' && nf.pax > 0) {
      f.estimatedPaxModel = f.estimatedPax ?? null;
      f.estimatedPax = nf.pax;
      f.paxSource = 'notice';
    }
    if (Number.isInteger(nf.stall) && nf.stall >= 1 && nf.stall <= 4 && f.poolLane !== nf.stall) {
      f.poolLaneModel = f.poolLane ?? null;
      f.poolLane = nf.stall;
      f.laneSource = 'notice';
    }
    if (nf.eta && nf.eta.text) f.noticeEta = nf.eta.text;
    count += 1;
  }
  return count;
}

// 号別カードに出す現地掲示サマリ {1..4: {pendingPax, pendingFlights, nextEta, queue}}。
// 掲示が無ければ {}。summary.byStall(未着集計) と queue(客列人数) を号別にまとめる。
export function buildLaneNoticeMap(lateFlights) {
  const out = {};
  const summary = lateFlights && lateFlights.summary;
  if (!summary) return out;
  for (const [k, v] of Object.entries(summary.byStall || {})) {
    const lane = parseInt(k, 10);
    if (!Number.isInteger(lane) || lane < 1 || lane > 4) continue;
    out[lane] = {
      pendingPax: v.pendingPax || 0,
      pendingFlights: v.pendingFlights || 0,
      nextEta: v.nextEta || null,
      queue: null,
    };
  }
  for (const [k, q] of Object.entries(summary.queue || {})) {
    const lane = parseInt(k, 10);
    if (!Number.isInteger(lane) || lane < 1 || lane > 4) continue;
    if (!out[lane]) out[lane] = { pendingPax: 0, pendingFlights: 0, nextEta: null, queue: null };
    out[lane].queue = q;
  }
  return out;
}

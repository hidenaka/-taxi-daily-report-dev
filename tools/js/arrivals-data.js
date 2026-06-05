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

// 大幅遅延便（予定より BIG_DELAY_MIN 分以上遅れている未到着便）を抽出する。
export function detectTopics(flights) {
  const topics = [];
  for (const f of flights) {
    if (f.status === '到着') continue;
    const sched = timeToMinutes(f.scheduledTime);
    const est = timeToMinutes(f.estimatedTime ?? f.scheduledTime);
    const delayMin = (sched !== null && est !== null) ? Math.max(0, est - sched) : 0;
    if (delayMin < BIG_DELAY_MIN) continue;
    topics.push({
      flightNumber: f.flightNumber,
      fromName: f.fromName,
      terminal: f.terminal,
      poolLane: f.poolLane ?? null,
      scheduledTime: f.scheduledTime,
      estimatedTime: f.estimatedTime ?? f.scheduledTime,
      delayMin,
      estimatedPax: f.estimatedPax ?? null
    });
  }
  topics.sort((a, b) => timeToMinutes(a.estimatedTime) - timeToMinutes(b.estimatedTime));
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


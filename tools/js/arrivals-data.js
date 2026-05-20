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
        reachNoneCount: 0
      });
    }
    const b = bins.get(key);
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
  const totalPax = flights.reduce((s, f) => s + (f.estimatedPax ?? 0), 0);
  const internationalPax = flights
    .filter(f => f.isInternational)
    .reduce((s, f) => s + (f.estimatedPax ?? 0), 0);
  const totalFlights = flights.length;
  const internationalCount = flights.filter(f => f.isInternational).length;
  const delayedCount = flights.filter(f => f.status === '遅延').length;
  const unknownCount = flights.filter(f => f.estimatedPax === null).length;
  const hourlyAvg = totalFlights > 0 ? Math.round(totalPax / windowHours) : 0;
  const reachNoneCount = flights.filter(f => f.reachTier === 'none').length;
  return {
    totalPax, internationalPax,
    totalFlights, internationalCount,
    delayedCount, unknownCount, hourlyAvg,
    windowLabel,
    reachNoneCount
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

// 当日全便を fromName 単位で集計し、totalEstimatedTaxiPax 降順で返す純関数。
// 各グループには「該当する全便」を flights 配列として保持し、便ごとに時刻順
// (estimatedTime || scheduledTime 昇順) でソートする。
// 欠航便・fromName 無し便は除外。estimatedTaxiPax の null/undefined は 0 扱い。
// グループの並びは totalEstimatedTaxiPax 降順、同点は fromName 昇順で安定化。
export function aggregateByOrigin(flights) {
  if (!Array.isArray(flights) || flights.length === 0) return [];
  const map = new Map();
  for (const f of flights) {
    if (f.status === '欠航') continue;
    if (!f.fromName) continue;
    const key = f.fromName;
    if (!map.has(key)) {
      map.set(key, { fromName: key, flightCount: 0, totalEstimatedTaxiPax: 0, flights: [] });
    }
    const g = map.get(key);
    g.flightCount += 1;
    g.totalEstimatedTaxiPax += (f.estimatedTaxiPax || 0);
    g.flights.push(f);
  }
  for (const g of map.values()) {
    g.flights.sort((a, b) => {
      const ta = a.estimatedTime ?? a.scheduledTime ?? '99:99';
      const tb = b.estimatedTime ?? b.scheduledTime ?? '99:99';
      return ta.localeCompare(tb);
    });
  }
  return [...map.values()].sort((a, b) => {
    if (b.totalEstimatedTaxiPax !== a.totalEstimatedTaxiPax) {
      return b.totalEstimatedTaxiPax - a.totalEstimatedTaxiPax;
    }
    return a.fromName.localeCompare(b.fromName);
  });
}

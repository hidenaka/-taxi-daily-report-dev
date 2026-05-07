// "HH:MM" → 分
export function timeToMinutes(t) {
  if (!t) return 0;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

// 1乗務の時間配分を分単位で返す（実車/休憩/空車）
export function calcTimeBreakdown(drive) {
  const dep = timeToMinutes(drive.departureTime);
  let ret = timeToMinutes(drive.returnTime);
  if (ret < dep) ret += 24 * 60; // 翌日にまたがる
  const totalMin = ret - dep;

  const tripMin = (drive.trips || [])
    .filter(t => !t.isCancel)
    .reduce((s, t) => {
      let dur = timeToMinutes(t.alightTime) - timeToMinutes(t.boardTime);
      if (dur < 0) dur += 24 * 60;
      return s + dur;
    }, 0);

  const restMin = (drive.rests || []).reduce((s, r) => {
    let dur = timeToMinutes(r.endTime) - timeToMinutes(r.startTime);
    if (dur < 0) dur += 24 * 60;
    return s + dur;
  }, 0);

  const idleMin = Math.max(0, totalMin - tripMin - restMin);
  return { totalMin, tripMin, restMin, idleMin };
}

// 1時間ごとの売上配列（24要素、000-2300）
export function salesByHour(drive) {
  const hours = Array(24).fill(0);
  for (const t of (drive.trips || [])) {
    if (t.isCancel) continue;
    const start = timeToMinutes(t.boardTime);
    const h = Math.floor(start / 60);
    if (h >= 0 && h < 24) hours[h] += t.amount;
  }
  return hours;
}

// 1時間ごとの実車時間(分)配列。tripが時間境界をまたぐ場合は分割
export function tripMinByHour(drive) {
  const mins = Array(24).fill(0);
  for (const t of (drive.trips || [])) {
    if (t.isCancel) continue;
    let start = timeToMinutes(t.boardTime);
    let end = timeToMinutes(t.alightTime);
    if (end < start) end += 24 * 60;
    let m = start;
    while (m < end) {
      const h = Math.floor(m / 60) % 24;
      const nextHourMark = (Math.floor(m / 60) + 1) * 60;
      const segEnd = Math.min(end, nextHourMark);
      mins[h] += (segEnd - m);
      m = segEnd;
    }
  }
  return mins;
}

// 1時間ごとの休憩時間(分)配列
export function restMinByHour(drive) {
  const mins = Array(24).fill(0);
  for (const r of (drive.rests || [])) {
    let start = timeToMinutes(r.startTime);
    let end = timeToMinutes(r.endTime);
    if (end < start) end += 24 * 60;
    let m = start;
    while (m < end) {
      const h = Math.floor(m / 60) % 24;
      const nextHourMark = (Math.floor(m / 60) + 1) * 60;
      const segEnd = Math.min(end, nextHourMark);
      mins[h] += (segEnd - m);
      m = segEnd;
    }
  }
  return mins;
}

// 7時スタート(または指定)の順序で {hour, sales, tripMin, restMin} を返す
export function hourlyActivity(drive, startHour = 7) {
  const sales = salesByHour(drive);
  const tripMins = tripMinByHour(drive);
  const restMins = restMinByHour(drive);
  return Array.from({ length: 24 }, (_, i) => {
    const h = (startHour + i) % 24;
    return { hour: h, sales: sales[h], tripMin: tripMins[h], restMin: restMins[h] };
  });
}

// summary-only な drive: 詳細trip単位のデータがなく合計のみ
export function isSummaryOnly(drive) {
  if (drive._importedFrom === 'spreadsheet') return true;
  return (drive.trips || []).some(t => t._periodCount);
}

// 時間帯キー: 朝(13時まで)/昼(13〜18時)/夜(18〜23時)/深夜(23時〜)
export function getPeriodKey(timeStr) {
  const m = timeToMinutes(timeStr);
  if (m >= 23 * 60 || m < 7 * 60) return 'night';
  if (m < 13 * 60) return 'morning';
  if (m < 18 * 60) return 'noon';
  return 'evening';
}

export const PERIOD_LABELS = {
  morning: '朝(13時まで)',
  noon: '昼(13〜18時)',
  evening: '夜(18〜23時)',
  night: '深夜(23時〜)'
};

// ====== ゾーン定義（support.html / review.html 共通） ======
export const ZONE_PRESETS = {
  human: {
    label: '人の動き別',
    zones: [
      { key: 'morning', label: '早朝〜午前', start: 5, end: 12, color: '#1565c0' },
      { key: 'noon', label: '昼', start: 12, end: 18, color: '#2e7d32' },
      { key: 'evening', label: '夕方〜夜', start: 18, end: 22, color: '#e65100' },
      { key: 'lateNight', label: '夜更け', start: 22, end: 24, color: '#37474f' },
      { key: 'dawn', label: '未明', start: 0, end: 5, color: '#455a64' },
    ]
  },
  shift: {
    label: 'シフト別',
    zones: [
      { key: 'morning', label: '早朝', start: 7, end: 12, color: '#1565c0' },
      { key: 'noon', label: '昼', start: 12, end: 17, color: '#2e7d32' },
      { key: 'evening', label: '夕方〜夜', start: 17, end: 22, color: '#e65100' },
      { key: 'night', label: '深夜', start: 22, end: 3, color: '#37474f' },
    ]
  }
};

export function getZoneAt(hour, preset) {
  const zones = ZONE_PRESETS[preset].zones;
  for (const z of zones) {
    if (z.start < z.end) {
      if (hour >= z.start && hour < z.end) return z;
    } else {
      if (hour >= z.start || hour < z.end) return z;
    }
  }
  return zones[zones.length - 1];
}

export function getZoneForElapsed(elapsedMin, depHour, preset) {
  const totalMin = depHour * 60 + elapsedMin;
  const h = Math.floor(totalMin / 60) % 24;
  return getZoneAt(h, preset);
}

export function formatZoneRange(z) {
  if (z.start < z.end) {
    return `${z.start}-${z.end}時`;
  }
  return `${z.start}-${z.end}時(翌)`;
}

export function getZoneKey(timeStr, zones) {
  const m = timeToMinutes(timeStr);
  const h = Math.floor(m / 60) % 24;
  for (const z of zones) {
    if (z.start < z.end) {
      if (h >= z.start && h < z.end) return z.key;
    } else {
      if (h >= z.start || h < z.end) return z.key;
    }
  }
  return zones[zones.length - 1].key;
}

// 曜日 × ゾーン 平均売上マトリックス
export function dowZoneMatrix(drives, zones) {
  const keys = zones.map(z => z.key);
  const sumMap = Array.from({length: 7}, () => {
    const o = {};
    for (const k of keys) o[k] = 0;
    return o;
  });
  const countMap = Array.from({length: 7}, () => {
    const o = {};
    for (const k of keys) o[k] = 0;
    return o;
  });
  for (const d of drives) {
    if (isSummaryOnly(d)) continue;
    const dow = dowOf(d.date);
    for (const t of (d.trips || [])) {
      if (t.isCancel) continue;
      const k = getZoneKey(t.boardTime, zones);
      sumMap[dow][k] += (t.amount || 0);
      countMap[dow][k]++;
    }
  }
  const matrix = sumMap.map((row, i) => {
    const r = {};
    for (const k of keys) {
      r[k] = countMap[i][k] > 0 ? sumMap[i][k] / countMap[i][k] : 0;
    }
    return r;
  });
  return { matrix, count: countMap, zones };
}

// 曜日 × ゾーン 平均時間単価（¥/h）マトリックス
// workingMinベースで計算（= 乗務時間 - 休憩時間）
export function dowZoneEfficiency(drives, zones) {
  const hourly = hourlyDowEfficiency(drives);
  const keys = zones.map(z => z.key);
  const dowDays = Array(7).fill(0);
  for (const d of drives) {
    if (isSummaryOnly(d) || !d.date) continue;
    dowDays[dowOf(d.date)]++;
  }
  const sumMap = Array.from({length: 7}, () => {
    const o = {};
    for (const k of keys) o[k] = { sales: 0, workingMin: 0 };
    return o;
  });
  for (let dow = 0; dow < 7; dow++) {
    for (let h = 0; h < 24; h++) {
      const c = hourly[dow][h];
      if (c.workingMin <= 0) continue;
      const k = getZoneKey(String(h).padStart(2, '0') + ':00', zones);
      sumMap[dow][k].sales += c.sales;
      sumMap[dow][k].workingMin += c.workingMin;
    }
  }
  const matrix = sumMap.map((row) => {
    const r = {};
    for (const k of keys) {
      const s = row[k];
      r[k] = s.workingMin > 0 ? s.sales / (s.workingMin / 60) : 0;
    }
    return r;
  });
  return { matrix, days: dowDays, zones };
}

// 1乗務の出庫〜帰庫を時間帯ごとに分割 (分単位)
export function periodMinutesInDrive(drive) {
  const result = { morning: 0, noon: 0, evening: 0, night: 0 };
  if (!drive.departureTime || !drive.returnTime) return result;
  const dep = timeToMinutes(drive.departureTime);
  let ret = timeToMinutes(drive.returnTime);
  if (ret < dep) ret += 24 * 60;
  // 1分刻みで時間帯判定
  for (let m = dep; m < ret; m++) {
    const h = Math.floor(m / 60) % 24;
    let k;
    if (h >= 23 || h < 7) k = 'night';
    else if (h < 13) k = 'morning';
    else if (h < 18) k = 'noon';
    else k = 'evening';
    result[k]++;
  }
  return result;
}

// 出庫時刻から5時間ずつ4ゾーンを生成（review.html と同じロジックを共有）
export function getShiftZones(departureTime) {
  const dep = parseInt((departureTime || '07:00').split(':')[0]);
  const raw = [];
  let start = dep;
  for (let i = 0; i < 4; i++) {
    const end = (start + 5) % 24;
    raw.push({ start, end, idx: i });
    start = end;
  }
  const normal = raw.filter(z => z.start < z.end);
  const wrap = raw.filter(z => z.start > z.end);
  const colors = ['#1565c0', '#2e7d32', '#e65100', '#37474f'];
  return [...normal, ...wrap].map(z => ({
    key: `z${z.idx + 1}`,
    label: `${z.start}-${z.end}時${z.start > z.end ? '(翌)' : ''}`,
    start: z.start,
    end: z.end,
    color: colors[z.idx]
  }));
}

// 1乗務をゾーン配列でグループ集計（review/detail で共通利用）
// zones: getShiftZones() などの { key, start, end } 配列
export function calcZoneBreakdown(drive, zones) {
  const empty = () => ({ sales: 0, count: 0, tripMin: 0, restMin: 0, periodMin: 0 });
  const result = {};
  for (const z of zones) result[z.key] = empty();
  for (const t of (drive.trips || [])) {
    if (t.isCancel) continue;
    const k = getZoneKey(t.boardTime, zones);
    result[k].sales += (t.amount || 0);
    result[k].count++;
    let dur = timeToMinutes(t.alightTime) - timeToMinutes(t.boardTime);
    if (dur < 0) dur += 24 * 60;
    result[k].tripMin += dur;
  }
  for (const r of (drive.rests || [])) {
    const k = getZoneKey(r.startTime, zones);
    let dur = timeToMinutes(r.endTime) - timeToMinutes(r.startTime);
    if (dur < 0) dur += 24 * 60;
    result[k].restMin += dur;
  }
  // 各ゾーンの滞在時間 (出庫〜帰庫をゾーンで分割)
  if (drive.departureTime && drive.returnTime) {
    const dep = timeToMinutes(drive.departureTime);
    let ret = timeToMinutes(drive.returnTime);
    if (ret < dep) ret += 24 * 60;
    for (let m = dep; m < ret; m++) {
      const k = getZoneKey(String(Math.floor(m / 60) % 24).padStart(2, '0') + ':00', zones);
      result[k].periodMin++;
    }
  }
  return result;
}

// 1乗務を時間帯別に集計
export function calcPeriodBreakdown(drive) {
  const empty = () => ({ sales: 0, count: 0, tripMin: 0, restMin: 0, periodMin: 0 });
  const result = { morning: empty(), noon: empty(), evening: empty(), night: empty() };
  for (const t of (drive.trips || [])) {
    if (t.isCancel) continue;
    const k = getPeriodKey(t.boardTime);
    result[k].sales += (t.amount || 0);
    result[k].count++;
    let dur = timeToMinutes(t.alightTime) - timeToMinutes(t.boardTime);
    if (dur < 0) dur += 24 * 60;
    result[k].tripMin += dur;
  }
  for (const r of (drive.rests || [])) {
    const k = getPeriodKey(r.startTime);
    let dur = timeToMinutes(r.endTime) - timeToMinutes(r.startTime);
    if (dur < 0) dur += 24 * 60;
    result[k].restMin += dur;
  }
  // 各時間帯の滞在時間 (出庫〜帰庫を時間帯で分割)
  const pm = periodMinutesInDrive(drive);
  for (const k of Object.keys(result)) result[k].periodMin = pm[k];
  return result;
}

// 複数乗務の時間帯別集計を合算
export function aggregatePeriodBreakdowns(drives) {
  const empty = () => ({ sales: 0, count: 0, tripMin: 0, restMin: 0, periodMin: 0 });
  const total = { morning: empty(), noon: empty(), evening: empty(), night: empty() };
  for (const d of drives) {
    const b = calcPeriodBreakdown(d);
    for (const k of Object.keys(total)) {
      total[k].sales += b[k].sales;
      total[k].count += b[k].count;
      total[k].tripMin += b[k].tripMin;
      total[k].restMin += b[k].restMin;
      total[k].periodMin += b[k].periodMin;
    }
  }
  return total;
}

export function formatMin(min) {
  const total = Math.round(min);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${h}:${String(m).padStart(2, '0')}`;
}

// ====== 振り返り分析関数 ======

// dateOfWeek (0=日, 1=月, ... 6=土)
export function dowOf(isoDate) {
  return new Date(isoDate + 'T00:00:00+09:00').getDay();
}

// 曜日 × 時間帯 平均売上マトリックス
// returns { matrix: [7][4] = avgSales, count: [7][4] = 日数 }
export function dowPeriodMatrix(drives) {
  const sumMap = Array.from({length: 7}, () => ({morning:0, noon:0, evening:0, night:0}));
  const countMap = Array.from({length: 7}, () => ({morning:0, noon:0, evening:0, night:0}));
  for (const d of drives) {
    if (isSummaryOnly(d)) continue;
    const dow = dowOf(d.date);
    const pb = calcPeriodBreakdown(d);
    for (const k of ['morning','noon','evening','night']) {
      sumMap[dow][k] += pb[k].sales;
      if (pb[k].count > 0) countMap[dow][k]++;
    }
  }
  const matrix = sumMap.map((row, i) => {
    const r = {};
    for (const k of ['morning','noon','evening','night']) {
      r[k] = countMap[i][k] > 0 ? sumMap[i][k] / countMap[i][k] : 0;
    }
    return r;
  });
  return { matrix, count: countMap };
}

// 日別売上一覧 → ベスト/ワースト
export function rankDrivesBySales(drives, n = 10) {
  const detailed = drives.filter(d => !isSummaryOnly(d)).map(d => {
    const valid = (d.trips || []).filter(t => !t.isCancel);
    const sales = valid.reduce((s,t) => s + (t.amount || 0), 0);
    return {
      date: d.date,
      sales,
      count: valid.length,
      dow: dowOf(d.date),
      weather: d.weather,
      vehicleType: d.vehicleType,
    };
  }).filter(d => d.sales > 0);
  const sorted = [...detailed].sort((a,b) => b.sales - a.sales);
  return {
    best: sorted.slice(0, n),
    worst: sorted.slice(-n).reverse()
  };
}

// 天気別売上集計 (主に日中の天気で判定)
export function weatherSalesAggregation(drives) {
  const buckets = { sunny: [], cloudy: [], rainy: [], snowy: [] };
  for (const d of drives) {
    if (isSummaryOnly(d)) continue;
    if (!d.weather) continue;
    const w = d.weather.noon || d.weather.morning;
    if (!w) continue;
    const code = w.code;
    let bucket;
    if (code >= 71 && code <= 77) bucket = 'snowy';
    else if (code >= 51 && code <= 67) bucket = 'rainy';
    else if (code >= 80) bucket = 'rainy';
    else if (code >= 2) bucket = 'cloudy';
    else bucket = 'sunny';
    const valid = (d.trips || []).filter(t => !t.isCancel);
    const sales = valid.reduce((s,t) => s + (t.amount || 0), 0);
    if (sales > 0) buckets[bucket].push(sales);
  }
  const result = {};
  for (const k of Object.keys(buckets)) {
    const arr = buckets[k];
    result[k] = {
      days: arr.length,
      avg: arr.length > 0 ? arr.reduce((s,v)=>s+v,0) / arr.length : 0,
      total: arr.reduce((s,v)=>s+v,0)
    };
  }
  return result;
}

export const WEATHER_LABELS = { sunny: '晴れ', cloudy: '曇り', rainy: '雨', snowy: '雪' };
export const DOW_LABELS = ['日','月','火','水','木','金','土'];

// 出庫時刻基準で時刻文字列→minutes (0=出庫、出庫前は翌日扱い)
function minsFromDep(timeStr, depHour) {
  if (!timeStr) return null;
  const parts = timeStr.split(':');
  if (parts.length < 2) return null;
  const h = parseInt(parts[0]), m = parseInt(parts[1]);
  if (isNaN(h) || isNaN(m)) return null;
  let mins = h * 60 + m;
  if (mins < depHour * 60) mins += 24 * 60;
  return mins - depHour * 60;
}

// 出庫時刻別+任意の経過分単位での平均/最大/最小累積
// depHour: 数値 or 数値配列(複数許容、例: [7,8,9])
// dowFilter: null=全曜日, 0-6=その曜日のみ
export function calcPaceAtElapsed(drives, depHour, elapsedMin, dowFilter = null) {
  const allowedHours = Array.isArray(depHour) ? depHour : [depHour];
  const matched = drives.filter(d => {
    if (isSummaryOnly(d)) return false;
    if (!d.departureTime) return false;
    const h = parseInt(d.departureTime.split(':')[0]);
    if (!allowedHours.includes(h)) return false;
    if (dowFilter != null && dowOf(d.date) !== dowFilter) return false;
    return true;
  });
  if (matched.length === 0 || elapsedMin <= 0) return { days: 0, totalDays: matched.length, samples: [] };
  const samples = [];
  for (const d of matched) {
    const dh = parseInt(d.departureTime.split(':')[0]);
    let s = 0, tm = 0, rm = 0, cnt = 0, active = false;
    for (const t of (d.trips || [])) {
      if (t.isCancel) continue;
      const bm = minsFromDep(t.boardTime, dh);
      if (bm == null || bm >= elapsedMin) continue;
      s += (t.amount || 0);
      cnt++;
      const am = minsFromDep(t.alightTime, dh);
      if (am != null) {
        let dur = am - bm;
        if (dur < 0) dur += 24 * 60;
        if (bm + dur > elapsedMin) dur = elapsedMin - bm;
        tm += Math.max(0, dur);
      }
      active = true;
    }
    for (const r of (d.rests || [])) {
      const sm = minsFromDep(r.startTime, dh);
      if (sm == null || sm >= elapsedMin) continue;
      const em = minsFromDep(r.endTime, dh);
      if (em != null) {
        let dur = em - sm;
        if (dur < 0) dur += 24 * 60;
        if (sm + dur > elapsedMin) dur = elapsedMin - sm;
        rm += Math.max(0, dur);
      }
      active = true;
    }
    if (active) samples.push({ date: d.date, sales: s, count: cnt, tripMin: tm, restMin: rm });
  }
  if (samples.length === 0) return { days: 0, totalDays: matched.length, samples };

  // 外れ値除外: IQR方式で異常に高い単価の日を除外
  const salesValues = samples.map(v => v.sales).sort((a, b) => a - b);
  const q1Index = Math.floor(salesValues.length * 0.25);
  const q3Index = Math.floor(salesValues.length * 0.75);
  const q1 = salesValues[q1Index];
  const q3 = salesValues[q3Index];
  const iqr = q3 - q1;
  const upperBound = q3 + 1.5 * iqr;
  const filteredSamples = samples.filter(v => v.sales <= upperBound);

  // 除外された日数が多すぎる場合は元のデータを使用（全てが外れ値の場合の保険）
  const finalSamples = filteredSamples.length >= samples.length * 0.5 ? filteredSamples : samples;

  const sumSales = finalSamples.reduce((s,v) => s + v.sales, 0);
  const sumRest = finalSamples.reduce((s,v) => s + v.restMin, 0);
  const sumTrip = finalSamples.reduce((s,v) => s + v.tripMin, 0);
  const sumCount = finalSamples.reduce((s,v) => s + v.count, 0);
  const maxSamp = finalSamples.reduce((a,b) => a.sales >= b.sales ? a : b);
  const minSamp = finalSamples.reduce((a,b) => a.sales <= b.sales ? a : b);
  const restVals = finalSamples.map(v => v.restMin);
  const countVals = finalSamples.map(v => v.count);
  return {
    days: finalSamples.length,
    totalDays: matched.length,
    excludedDays: samples.length - finalSamples.length,
    avgSales: sumSales / finalSamples.length,
    avgRest: sumRest / finalSamples.length,
    avgTrip: sumTrip / finalSamples.length,
    avgCount: sumCount / finalSamples.length,
    maxSales: maxSamp.sales,
    maxDate: maxSamp.date,
    minSales: minSamp.sales,
    minDate: minSamp.date,
    maxRest: Math.max(...restVals),
    minRest: Math.min(...restVals),
    maxCount: Math.max(...countVals),
    minCount: Math.min(...countVals),
  };
}

// drives中に存在する出庫時刻のhour一覧 (件数付き)
export function depHourDistribution(drives) {
  const counts = {};
  for (const d of drives) {
    if (isSummaryOnly(d)) continue;
    if (!d.departureTime) continue;
    const h = parseInt(d.departureTime.split(':')[0]);
    if (!isNaN(h)) counts[h] = (counts[h] || 0) + 1;
  }
  return counts;
}

// 曜日別の集計 (各日数/平均営収/平均件数/平均時間単価/平均乗務時間/ベスト日)
// 曜日(0-6) × 時間(0-23) × 効率 マトリクス
// 各セル: { sales, activeMin, presentMin, restMin, workingMin, count, days, hourlyA }
//   sales: その時間バケットに発生した売上 (時間按分)
//   activeMin: 実車中だった合計分
//   presentMin: 乗務中(出庫〜帰庫)だった合計分 (=空車+実車+休憩 全て含む)
//   restMin: 休憩していた合計分
//   workingMin: 実稼働時間 = presentMin - restMin
//   count: その時間バケット開始のtrip数
//   days: その時間バケットに乗務していた日数
//   hourlyA: 実稼働時間効率 sales / (workingMin/60)  ← 「その時間に実稼働している時、1hあたりいくら稼げるか」
export function hourlyDowEfficiency(drives) {
  const matrix = Array.from({length: 7}, () =>
    Array.from({length: 24}, () => ({ sales: 0, activeMin: 0, presentMin: 0, restMin: 0, workingMin: 0, count: 0, days: 0 }))
  );
  for (const d of drives) {
    if (isSummaryOnly(d)) continue;
    if (!d.date) continue;
    const dow = dowOf(d.date);
    if (d.departureTime && d.returnTime) {
      const dep = timeToMinutes(d.departureTime);
      let ret = timeToMinutes(d.returnTime);
      if (ret < dep) ret += 24 * 60;
      // 各時間バケットに乗務範囲が重なる分数を集計
      const startBucket = Math.floor(dep / 60);
      const endBucket = Math.floor((ret - 1) / 60);
      const seen = new Set();
      for (let bi = startBucket; bi <= endBucket; bi++) {
        const bucketStart = bi * 60;
        const bucketEnd = bucketStart + 60;
        const overlap = Math.max(0, Math.min(bucketEnd, ret) - Math.max(bucketStart, dep));
        if (overlap <= 0) continue;
        const h = bi % 24;
        matrix[dow][h].presentMin += overlap;
        if (!seen.has(h)) { seen.add(h); matrix[dow][h].days++; }
      }
      // 休憩区間を各時間バケットから引く
      for (const r of (d.rests || [])) {
        let rs = timeToMinutes(r.startTime);
        let re = timeToMinutes(r.endTime);
        if (re < rs) re += 24 * 60;
        // 出庫前または帰庫後の休憩は対象外
        if (re <= dep || rs >= ret) continue;
        rs = Math.max(rs, dep);
        re = Math.min(re, ret);
        const rStartBucket = Math.floor(rs / 60);
        const rEndBucket = Math.floor((re - 1) / 60);
        for (let bi = rStartBucket; bi <= rEndBucket; bi++) {
          const bucketStart = bi * 60;
          const bucketEnd = bucketStart + 60;
          const overlap = Math.max(0, Math.min(bucketEnd, re) - Math.max(bucketStart, rs));
          if (overlap <= 0) continue;
          const h = bi % 24;
          matrix[dow][h].restMin += overlap;
        }
      }
    }
    for (const t of (d.trips || [])) {
      if (t.isCancel) continue;
      const start = timeToMinutes(t.boardTime);
      let end = timeToMinutes(t.alightTime);
      if (end < start) end += 24 * 60;
      const dur = Math.max(1, end - start);
      let cur = start;
      while (cur < end) {
        const h = Math.floor(cur / 60) % 24;
        const next = Math.min(end, (Math.floor(cur / 60) + 1) * 60);
        const slice = next - cur;
        matrix[dow][h].activeMin += slice;
        matrix[dow][h].sales += (t.amount || 0) * (slice / dur);
        cur = next;
      }
      const bh = Math.floor(start / 60) % 24;
      matrix[dow][bh].count++;
    }
  }
  for (let dow = 0; dow < 7; dow++) {
    for (let h = 0; h < 24; h++) {
      const c = matrix[dow][h];
      c.workingMin = Math.max(0, c.presentMin - c.restMin);
      c.hourlyA = c.workingMin > 0 ? c.sales / (c.workingMin / 60) : 0;
    }
  }
  return matrix;
}

// 場所文字列から区+町名 (丁目番号を除いた地名) を抽出
// 例: "大田区羽田空港3" → "大田区羽田空港", "新宿区霞ヶ丘町" → "新宿区霞ヶ丘町"
export function extractArea(place) {
  if (!place) return '';
  return place.replace(/\d+$/, '').trim();
}

// 過去データから近隣エリアを自動推定
// 「降車→短時間(maxWaitMin以内)で次乗車」のペアが minPairs 件以上発生したエリア同士を近隣と判定
// 戻り値: { area: Set<neighborArea> }
export function buildNeighborMap(drives, { minPairs = 2, maxWaitMin = 25 } = {}) {
  const pairs = {};
  for (const d of drives) {
    if (isSummaryOnly(d)) continue;
    const trips = withOfficeStart(d);
    for (let i = 0; i < trips.length - 1; i++) {
      const t = trips[i];
      const next = trips[i + 1];
      const a = extractArea(t.alightPlace);
      const b = extractArea(next.boardPlace);
      if (!a || !b || a === b) continue;
      let wait = timeToMinutes(next.boardTime) - timeToMinutes(t.alightTime);
      if (wait < 0) wait += 24 * 60;
      if (wait > maxWaitMin) continue;
      const key = a < b ? `${a}|${b}` : `${b}|${a}`;
      pairs[key] = (pairs[key] || 0) + 1;
    }
  }
  const neighbors = {};
  for (const [key, count] of Object.entries(pairs)) {
    if (count < minPairs) continue;
    const [a, b] = key.split('|');
    if (!neighbors[a]) neighbors[a] = new Set();
    if (!neighbors[b]) neighbors[b] = new Set();
    neighbors[a].add(b);
    neighbors[b].add(a);
  }
  return neighbors;
}

// 営業所エリア (出庫直後のtripを「営業所降車後の次乗車」として扱うための仮想エリア)
export const OFFICE_AREA = '大田区北馬込';

// 出庫直後を仮想「営業所降車」trip として trips の先頭に追加した配列を返す
function withOfficeStart(drive) {
  const trips = (drive.trips || []).filter(t => !t.isCancel);
  if (!drive.departureTime) return trips;
  return [{
    alightTime: drive.departureTime,
    alightPlace: OFFICE_AREA,
    boardTime: drive.departureTime,
    boardPlace: OFFICE_AREA,
    amount: 0,
    _virtual: true,
  }, ...trips];
}

// 配列の中央値
function median(arr) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// エリア × 時刻(0-23時) 別の実労働時間効率マップ
// cycleMin = (前trip降車から今trip乗車までの待ち) + 実車時間
// 待ちは「乗務中の空車待ち」を含めるため上限を4時間に拡大(4時間超は休憩・帰庫扱いで除外)
// 戻り値: Map<"area|hour", { sales, cycleMin, count }>
export function areaTimeHourly(drives) {
  const groups = {};
  for (const d of drives) {
    if (isSummaryOnly(d)) continue;
    const trips = (d.trips || []).filter(t => !t.isCancel);
    for (let i = 0; i < trips.length; i++) {
      const t = trips[i];
      if (!t.amount || t.amount <= 0) continue;
      const area = extractArea(t.boardPlace);
      if (!area) continue;
      const hour = parseInt(t.boardTime.split(':')[0]);
      let dur = timeToMinutes(t.alightTime) - timeToMinutes(t.boardTime);
      if (dur < 0) dur += 24 * 60;
      let waitBefore = 0;
      if (i > 0) {
        const prev = trips[i - 1];
        let w = timeToMinutes(t.boardTime) - timeToMinutes(prev.alightTime);
        if (w < 0) w += 24 * 60;
        if (w <= 4 * 60) waitBefore = w; // 4時間以内の待ちは実労働時間に含める
      }
      const cycleMin = waitBefore + dur;
      const key = `${area}|${hour}`;
      if (!groups[key]) groups[key] = { sales: 0, cycleMin: 0, count: 0 };
      groups[key].sales += t.amount;
      groups[key].cycleMin += cycleMin;
      groups[key].count++;
    }
  }
  return groups;
}
// hour ± window (例: hour=13, window=1 → 12, 13, 14時 を合算)
export function getAreaHourly(map, area, hour, window = 1) {
  let sales = 0, cycle = 0;
  for (let off = -window; off <= window; off++) {
    const h = (hour + off + 24) % 24;
    const v = map[`${area}|${h}`];
    if (v) { sales += v.sales; cycle += v.cycleMin; }
  }
  return cycle > 0 ? sales / (cycle / 60) : 0;
}
// エリア全時間平均 (時間帯フィルタなし)
export function getAreaHourlyAll(map, area) {
  let sales = 0, cycle = 0;
  for (let h = 0; h < 24; h++) {
    const v = map[`${area}|${h}`];
    if (v) { sales += v.sales; cycle += v.cycleMin; }
  }
  return cycle > 0 ? sales / (cycle / 60) : 0;
}

// 時刻範囲判定: hour が center ± window 内にあるか (24時間ループ対応)
function hourInWindow(hour, center, window) {
  for (let off = -window; off <= window; off++) {
    if (((center + off + 24) % 24) === hour) return true;
  }
  return false;
}

// 特定の降車エリアで降ろした後、次にどのエリアで乗車した時の効率が良かったか
// 降車時刻が hourCenter ± hourWindow 内 かつ 待ち30分以内 かつ 次運賃 > 0 のみ集計
// hourCenter=null なら全時間帯
// dropoffArea: 文字列(単一エリア) or 配列(複数エリア) を受け付ける
// 各row.samples: 根拠データ最大10件 (新しい順)
export function nextBoardBreakdown(drives, dropoffArea, hourCenter = null, hourWindow = 1, neighbors = null) {
  const baseAreas = Array.isArray(dropoffArea) ? dropoffArea : [dropoffArea];
  const targetAreas = new Set(baseAreas);
  if (neighbors) {
    for (const a of baseAreas) {
      if (neighbors[a]) for (const n of neighbors[a]) targetAreas.add(n);
    }
  }
  const groups = {};
  let totalDropoffs = 0;
  let totalNextWithin30 = 0;
  for (const d of drives) {
    if (isSummaryOnly(d)) continue;
    const trips = withOfficeStart(d);
    for (let i = 0; i < trips.length - 1; i++) {
      const t = trips[i];
      if (!targetAreas.has(extractArea(t.alightPlace))) continue;
      if (hourCenter !== null) {
        const ah = parseInt(t.alightTime.split(':')[0]);
        if (!hourInWindow(ah, hourCenter, hourWindow)) continue;
      }
      totalDropoffs++;
      const next = trips[i + 1];
      const nextArea = extractArea(next.boardPlace);
      if (!nextArea) continue;
      const nextAmount = next.amount || 0;
      if (nextAmount <= 0) continue;
      let wait = timeToMinutes(next.boardTime) - timeToMinutes(t.alightTime);
      if (wait < 0) wait += 24 * 60;
      if (wait > 30) continue;
      let nd = timeToMinutes(next.alightTime) - timeToMinutes(next.boardTime);
      if (nd < 0) nd += 24 * 60;
      totalNextWithin30++;
      if (!groups[nextArea]) groups[nextArea] = { count: 0, count15: 0, totalWait: 0, totalSales: 0, salesList: [], samples: [] };
      groups[nextArea].count++;
      if (wait <= 15) groups[nextArea].count15++;
      groups[nextArea].totalWait += wait;
      groups[nextArea].totalSales += nextAmount;
      groups[nextArea].salesList.push(nextAmount);
      groups[nextArea].samples.push({
        date: d.date,
        dow: d.date ? dowOf(d.date) : null,
        alightTime: t.alightTime,
        dropoffPlace: t._virtual ? OFFICE_AREA + '(出庫)' : t.alightPlace,
        nextBoardTime: next.boardTime,
        nextBoardPlace: next.boardPlace,
        nextAlightTime: next.alightTime,
        nextAlightPlace: next.alightPlace,
        wait, dur: nd, amount: nextAmount,
      });
    }
  }
  const rows = Object.entries(groups).map(([area, g]) => {
    const avgWait = g.totalWait / g.count;
    const avgSales = g.totalSales / g.count;
    const medianSales = median(g.salesList);
    const ratio15 = totalDropoffs > 0 ? g.count15 / totalDropoffs : 0;
    const ratio30 = totalDropoffs > 0 ? g.count / totalDropoffs : 0;
    // 新しい順に最大10件
    const samples = g.samples.sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, 10);
    return { area, count: g.count, count15: g.count15, avgWait, avgSales, medianSales, ratio15, ratio30, samples };
  });
  return { rows, includedAreas: Array.from(targetAreas), totalDropoffs, totalNextWithin30 };
}

// 全trip の平均単価 (全期間・キャンセル除外)
export function avgTripSales(drives) {
  let sum = 0, count = 0;
  for (const d of drives) {
    if (isSummaryOnly(d)) continue;
    for (const t of (d.trips || [])) {
      if (t.isCancel) continue;
      sum += (t.amount || 0);
      count++;
    }
  }
  return count > 0 ? sum / count : 0;
}

// 目標時給(¥/h) = 手取り目標 ÷ 控除前必要売上比 ÷ 月乗務数 ÷ 平均乗務時間
// config: { takeHomeTarget, takeHomeRate, responsibilityShifts }
export function calcTargetHourly(drives, config) {
  const target = config.takeHomeTarget || 500000;
  const rate = config.takeHomeRate || 0.75;
  const shifts = config.responsibilityShifts || 12;
  const requiredSales = target / rate;
  // 平均乗務時間 (過去データから算出。データなしなら18h想定)
  const detailed = drives.filter(d => !isSummaryOnly(d) && d.departureTime && d.returnTime);
  let totalMin = 0;
  for (const d of detailed) totalMin += calcTimeBreakdown(d).totalMin;
  const avgShiftHours = detailed.length > 0 ? (totalMin / detailed.length / 60) : 18;
  return requiredSales / shifts / avgShiftHours;
}

// 推奨スコア化: 1行を評価
// efficiency, avgSales を targetHourly, avgSalesBaseline に対する比率で評価
// ratio30 = 取得率(0-1)
// 戻り値: { score, mark, effRatio, salesRatio }
//   mark: ◎(両方優秀) / ○(平均的) / △(片方が著しく低い) / ✕(両方低い=移動推奨)
export function evaluateRecommendRow({ efficiency, avgSales, ratio30 }, targetHourly, avgSalesBaseline) {
  const effRatio = targetHourly > 0 ? efficiency / targetHourly : 0;
  const salesRatio = avgSalesBaseline > 0 ? avgSales / avgSalesBaseline : 0;
  // スコア: 効率55% + 単価30% + 取得率15%
  const score = effRatio * 0.55 + salesRatio * 0.30 + (ratio30 || 0) * 0.15;
  let mark;
  if (effRatio < 0.7 && salesRatio < 0.7) mark = '✕';
  else if (effRatio < 0.7 || salesRatio < 0.65) mark = '△';
  else if (effRatio >= 1.3 && salesRatio >= 1.1) mark = '◎';
  else mark = '○';
  return { score, mark, effRatio, salesRatio };
}

// 検索ヒットなし時のフォールバック: そのエリア×時刻でどう動いていたかの履歴
// 待ち時間制限なし、運賃¥0でも含める。新しい順 max 30件
// 待ち時間分布の統計も同時に返す
export function dropoffHistoryAtArea(drives, area, hourCenter = null, hourWindow = 1, neighbors = null, maxEntries = 30) {
  const targetAreas = new Set([area]);
  if (neighbors && neighbors[area]) {
    for (const n of neighbors[area]) targetAreas.add(n);
  }
  const entries = [];
  for (const d of drives) {
    if (isSummaryOnly(d)) continue;
    const trips = withOfficeStart(d);
    for (let i = 0; i < trips.length; i++) {
      const t = trips[i];
      if (!targetAreas.has(extractArea(t.alightPlace))) continue;
      if (hourCenter !== null) {
        const ah = parseInt(t.alightTime.split(':')[0]);
        if (!hourInWindow(ah, hourCenter, hourWindow)) continue;
      }
      const next = trips[i + 1];
      let wait = null, dur = null, amount = null;
      let nextBoardTime = null, nextBoardPlace = null, nextAlightTime = null, nextAlightPlace = null;
      if (next) {
        wait = timeToMinutes(next.boardTime) - timeToMinutes(t.alightTime);
        if (wait < 0) wait += 24 * 60;
        dur = timeToMinutes(next.alightTime) - timeToMinutes(next.boardTime);
        if (dur < 0) dur += 24 * 60;
        amount = next.amount || 0;
        nextBoardTime = next.boardTime;
        nextBoardPlace = next.boardPlace;
        nextAlightTime = next.alightTime;
        nextAlightPlace = next.alightPlace;
      }
      entries.push({
        date: d.date,
        dow: d.date ? dowOf(d.date) : null,
        userId: d._userId || null,
        alightTime: t.alightTime,
        dropoffPlace: t._virtual ? OFFICE_AREA + '(出庫)' : t.alightPlace,
        nextBoardTime, nextBoardPlace, nextAlightTime, nextAlightPlace,
        wait, dur, amount,
      });
    }
  }
  entries.sort((a, b) => {
    const dc = (b.date || '').localeCompare(a.date || '');
    if (dc !== 0) return dc;
    return (b.alightTime || '').localeCompare(a.alightTime || '');
  });
  // 待ち分布(4h以下のみ統計対象)
  const waits = entries.filter(e => e.wait != null && e.wait < 4 * 60).map(e => e.wait);
  const stats = {
    totalDropoffs: entries.length,
    waitsKnown: waits.length,
    avgWait: waits.length > 0 ? waits.reduce((a,b)=>a+b,0) / waits.length : null,
    medianWait: waits.length > 0 ? median(waits) : null,
    within15: waits.filter(w => w <= 15).length,
    within30: waits.filter(w => w <= 30).length,
    within60: waits.filter(w => w <= 60).length,
    over60: waits.filter(w => w > 60).length,
  };
  return { entries: entries.slice(0, maxEntries), stats, includedAreas: Array.from(targetAreas) };
}

// 特定エリア × 時間帯で乗車した過去trip履歴
// period: 'morning'/'noon'/'evening'/'night' (boardTime基準)、null=全時間帯
// 各 entry: { date, dow, boardTime, boardPlace, alightTime, alightPlace, dur, amount, waitBefore }
export function boardHistoryAtArea(drives, area, period = null, maxEntries = 30) {
  const entries = [];
  for (const d of drives) {
    if (isSummaryOnly(d)) continue;
    const trips = (d.trips || []).filter(t => !t.isCancel);
    for (let i = 0; i < trips.length; i++) {
      const t = trips[i];
      if (extractArea(t.boardPlace) !== area) continue;
      if (period && getPeriodKey(t.boardTime) !== period) continue;
      let dur = timeToMinutes(t.alightTime) - timeToMinutes(t.boardTime);
      if (dur < 0) dur += 24 * 60;
      let waitBefore = null;
      if (i > 0) {
        const prev = trips[i - 1];
        let w = timeToMinutes(t.boardTime) - timeToMinutes(prev.alightTime);
        if (w < 0) w += 24 * 60;
        waitBefore = w;
      }
      entries.push({
        date: d.date,
        dow: d.date ? dowOf(d.date) : null,
        userId: d._userId || null,
        boardTime: t.boardTime,
        boardPlace: t.boardPlace,
        alightTime: t.alightTime,
        alightPlace: t.alightPlace,
        dur, amount: t.amount || 0, waitBefore,
      });
    }
  }
  entries.sort((a, b) => {
    const dc = (b.date || '').localeCompare(a.date || '');
    if (dc !== 0) return dc;
    return (b.boardTime || '').localeCompare(a.boardTime || '');
  });
  return { entries: entries.slice(0, maxEntries), totalCount: entries.length };
}

// 高期待値エリア × 時間帯
// 各trip(乗車)を boardPlace × 時間帯(4区切り) で集計、中央単価が高い順
// 中央値ベースで並べることでイジャパンタクシー案件の影響を排除
// 戻り値: [{ area, period, count, avgSales, medianSales, avgDur }]
export function highValueAreas(drives, { minSamples = 5 } = {}) {
  const groups = {};
  for (const d of drives) {
    if (isSummaryOnly(d)) continue;
    for (const t of (d.trips || [])) {
      if (t.isCancel) continue;
      if (!t.amount || t.amount <= 0) continue;
      const area = extractArea(t.boardPlace);
      if (!area) continue;
      const period = getPeriodKey(t.boardTime);
      let dur = timeToMinutes(t.alightTime) - timeToMinutes(t.boardTime);
      if (dur < 0) dur += 24 * 60;
      const key = `${area}|${period}`;
      if (!groups[key]) groups[key] = { count: 0, sumSales: 0, sumDur: 0, salesList: [] };
      groups[key].count++;
      groups[key].sumSales += t.amount;
      groups[key].sumDur += dur;
      groups[key].salesList.push(t.amount);
    }
  }
  const rows = [];
  for (const [key, g] of Object.entries(groups)) {
    if (g.count < minSamples) continue;
    const [area, period] = key.split('|');
    const avgSales = g.sumSales / g.count;
    const medianSales = median(g.salesList);
    const avgDur = g.sumDur / g.count;
    rows.push({ area, period, count: g.count, avgSales, medianSales, avgDur });
  }
  rows.sort((a, b) => b.medianSales - a.medianSales);
  return rows;
}

// 高期待値エリアの「期間内 実労働時間効率」を引く
// period: morning/noon/evening/night → 該当する時間帯を合算
const PERIOD_HOURS = {
  morning: [7, 8, 9, 10, 11, 12],
  noon: [13, 14, 15, 16, 17],
  evening: [18, 19, 20, 21, 22],
  night: [23, 0, 1, 2, 3, 4, 5, 6],
};
// 高期待値エリア × ゾーン（support.html 用）
export function highValueAreasByZone(drives, zones, { minSamples = 5 } = {}) {
  const groups = {};
  for (const d of drives) {
    if (isSummaryOnly(d)) continue;
    for (const t of (d.trips || [])) {
      if (t.isCancel) continue;
      if (!t.amount || t.amount <= 0) continue;
      const area = extractArea(t.boardPlace);
      if (!area) continue;
      const zoneKey = getZoneKey(t.boardTime, zones);
      let dur = timeToMinutes(t.alightTime) - timeToMinutes(t.boardTime);
      if (dur < 0) dur += 24 * 60;
      const key = `${area}|${zoneKey}`;
      if (!groups[key]) groups[key] = { count: 0, sumSales: 0, sumDur: 0, salesList: [] };
      groups[key].count++;
      groups[key].sumSales += t.amount;
      groups[key].sumDur += dur;
      groups[key].salesList.push(t.amount);
    }
  }
  const rows = [];
  for (const [key, g] of Object.entries(groups)) {
    if (g.count < minSamples) continue;
    const [area, zoneKey] = key.split('|');
    const avgSales = g.sumSales / g.count;
    const medianSales = median(g.salesList);
    const avgDur = g.sumDur / g.count;
    rows.push({ area, zoneKey, count: g.count, avgSales, medianSales, avgDur });
  }
  rows.sort((a, b) => b.medianSales - a.medianSales);
  return rows;
}

// 特定エリア × ゾーンで乗車した過去trip履歴（support.html 用）
export function boardHistoryAtAreaByZone(drives, area, zoneKey, zones, maxEntries = 30) {
  const entries = [];
  for (const d of drives) {
    if (isSummaryOnly(d)) continue;
    const trips = (d.trips || []).filter(t => !t.isCancel);
    for (let i = 0; i < trips.length; i++) {
      const t = trips[i];
      if (extractArea(t.boardPlace) !== area) continue;
      if (zoneKey && getZoneKey(t.boardTime, zones) !== zoneKey) continue;
      let dur = timeToMinutes(t.alightTime) - timeToMinutes(t.boardTime);
      if (dur < 0) dur += 24 * 60;
      let waitBefore = null;
      if (i > 0) {
        const prev = trips[i - 1];
        let w = timeToMinutes(t.boardTime) - timeToMinutes(prev.alightTime);
        if (w < 0) w += 24 * 60;
        waitBefore = w;
      }
      entries.push({
        date: d.date,
        dow: d.date ? dowOf(d.date) : null,
        userId: d._userId || null,
        boardTime: t.boardTime,
        boardPlace: t.boardPlace,
        alightTime: t.alightTime,
        alightPlace: t.alightPlace,
        dur, amount: t.amount || 0, waitBefore,
      });
    }
  }
  entries.sort((a, b) => {
    const dc = (b.date || '').localeCompare(a.date || '');
    if (dc !== 0) return dc;
    return (b.boardTime || '').localeCompare(a.boardTime || '');
  });
  return { entries: entries.slice(0, maxEntries), totalCount: entries.length };
}

export function getAreaPeriodHourly(map, area, period) {
  const hours = PERIOD_HOURS[period] || [];
  let sales = 0, cycle = 0;
  for (const h of hours) {
    const v = map[`${area}|${h}`];
    if (v) { sales += v.sales; cycle += v.cycleMin; }
  }
  return cycle > 0 ? sales / (cycle / 60) : 0;
}

// 降車エリア別 効率分析
// 各trip 直後 (同日内) のwait時間と次trip売上を集計
// 「次の乗車エリア」分布も記録 → 降ろしたあとどこで次が取れる傾向かが分かる
export function dropoffAreaAnalysis(drives) {
  const areas = {};
  for (const d of drives) {
    if (isSummaryOnly(d)) continue;
    const trips = withOfficeStart(d);
    for (let i = 0; i < trips.length; i++) {
      const t = trips[i];
      const area = extractArea(t.alightPlace);
      if (!area) continue;
      if (!areas[area]) areas[area] = {
        dropoffs: 0,
        totalWaitMin: 0, waitCount: 0,
        totalNextSales: 0, nextCount: 0,
        totalNextDur: 0,
        nextBoards: {},
        nextSalesList: [], waitList: [],
      };
      const a = areas[area];
      a.dropoffs++;
      const next = trips[i + 1];
      if (next) {
        let wait = timeToMinutes(next.boardTime) - timeToMinutes(t.alightTime);
        if (wait < 0) wait += 24 * 60;
        if (wait < 4 * 60) {
          a.totalWaitMin += wait;
          a.waitCount++;
          a.waitList.push(wait);
        }
        const nextAmt = next.amount || 0;
        a.totalNextSales += nextAmt;
        a.nextCount++;
        if (nextAmt > 0) a.nextSalesList.push(nextAmt);
        let nd = timeToMinutes(next.alightTime) - timeToMinutes(next.boardTime);
        if (nd < 0) nd += 24 * 60;
        a.totalNextDur += nd;
        const nextBoardArea = extractArea(next.boardPlace);
        if (nextBoardArea) a.nextBoards[nextBoardArea] = (a.nextBoards[nextBoardArea] || 0) + 1;
      }
    }
  }
  const result = [];
  for (const [area, v] of Object.entries(areas)) {
    const avgWait = v.waitCount > 0 ? v.totalWaitMin / v.waitCount : null;
    const medianWait = v.waitList.length > 0 ? median(v.waitList) : null;
    const avgNextSales = v.nextCount > 0 ? v.totalNextSales / v.nextCount : null;
    const medianNextSales = v.nextSalesList.length > 0 ? median(v.nextSalesList) : null;
    const avgNextDur = v.nextCount > 0 ? v.totalNextDur / v.nextCount : null;
    const topNextBoards = Object.entries(v.nextBoards)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([area, count]) => ({ area, count, pct: count / v.nextCount }));
    result.push({ area, dropoffs: v.dropoffs, avgWait, medianWait, avgNextSales, medianNextSales, avgNextDur, nextCount: v.nextCount, topNextBoards });
  }
  return result;
}

export function dowAggregation(drives) {
  const empty = () => ({ days: 0, totalSales: 0, totalCount: 0, totalTripMin: 0, totalShiftMin: 0, bestSales: 0, bestDate: null, dates: [] });
  const result = Array.from({length: 7}, empty);
  for (const d of drives) {
    if (isSummaryOnly(d)) continue;
    const dow = dowOf(d.date);
    const valid = (d.trips || []).filter(t => !t.isCancel);
    const sales = valid.reduce((s,t) => s + (t.amount || 0), 0);
    if (sales === 0) continue;
    const bd = calcTimeBreakdown(d);
    result[dow].days++;
    result[dow].totalSales += sales;
    result[dow].totalCount += valid.length;
    result[dow].totalTripMin += bd.tripMin;
    result[dow].totalShiftMin += bd.totalMin;
    result[dow].dates.push({ date: d.date, sales, count: valid.length, shiftMin: bd.totalMin, tripMin: bd.tripMin, restMin: bd.restMin });
    if (sales > result[dow].bestSales) {
      result[dow].bestSales = sales;
      result[dow].bestDate = d.date;
    }
  }
  // 各曜日の日付リストを新しい順にソート
  for (let i = 0; i < 7; i++) {
    result[i].dates.sort((a, b) => b.date.localeCompare(a.date));
  }
  return result;
}

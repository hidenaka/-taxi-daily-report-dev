// js/planned-shifts.js — 予定シフトの状態・車種を扱う純粋関数群
const VALID_VEHICLES = ['japantaxi', 'premium'];

export function isValidVehicle(v) {
  return VALID_VEHICLES.includes(v);
}

function fallbackVehicle(config) {
  const def = config?.defaults?.vehicleType;
  return isValidVehicle(def) ? def : 'japantaxi';
}

export function getPlannedVehicle(date, config) {
  const planned = config?.shifts?.expandedDates;
  if (!Array.isArray(planned) || !planned.includes(date)) return null;
  const explicit = config?.shifts?.plannedVehicles?.[date];
  if (isValidVehicle(explicit)) return explicit;
  return fallbackVehicle(config);
}

export function getShiftStateForDate(date, config) {
  const planned = config?.shifts?.expandedDates?.includes(date) ?? false;
  const paid = config?.shifts?.paidLeaveDates?.includes(date) ?? false;
  const vehicle = planned ? getPlannedVehicle(date, config) : null;
  return { planned, vehicle, paid };
}

// hidePremium=true のときはプレミアムを循環から除外し、
// 未 → ジャパンタクシー予定 → 有給 → 未 の3状態で回す（defaultは強制的にjapantaxi扱い）。
export function cycleShiftState(current, defaultType, hidePremium = false) {
  if (hidePremium) {
    if (!current.planned && !current.paid) {
      return { planned: true, vehicle: 'japantaxi', paid: false };
    }
    if (current.planned) {
      return { planned: false, vehicle: null, paid: true };
    }
    if (current.paid) {
      return { planned: false, vehicle: null, paid: false };
    }
    return { planned: false, vehicle: null, paid: false };
  }
  const def = isValidVehicle(defaultType) ? defaultType : 'japantaxi';
  const other = def === 'japantaxi' ? 'premium' : 'japantaxi';
  if (!current.planned && !current.paid) {
    return { planned: true, vehicle: def, paid: false };
  }
  if (current.planned && current.vehicle === def) {
    return { planned: true, vehicle: other, paid: false };
  }
  if (current.planned && current.vehicle === other) {
    return { planned: false, vehicle: null, paid: true };
  }
  if (current.paid) {
    return { planned: false, vehicle: null, paid: false };
  }
  return { planned: false, vehicle: null, paid: false };
}

function removeFromArray(arr, v) {
  const i = arr.indexOf(v);
  if (i >= 0) arr.splice(i, 1);
}

export function applyShiftState(config, date, next) {
  config.shifts = config.shifts || {};
  config.shifts.expandedDates = config.shifts.expandedDates || [];
  config.shifts.paidLeaveDates = config.shifts.paidLeaveDates || [];
  config.shifts.plannedVehicles = config.shifts.plannedVehicles || {};
  removeFromArray(config.shifts.expandedDates, date);
  removeFromArray(config.shifts.paidLeaveDates, date);
  delete config.shifts.plannedVehicles[date];
  if (next.planned && isValidVehicle(next.vehicle)) {
    config.shifts.expandedDates.push(date);
    config.shifts.expandedDates.sort();
    config.shifts.plannedVehicles[date] = next.vehicle;
  } else if (next.paid) {
    config.shifts.paidLeaveDates.push(date);
    config.shifts.paidLeaveDates.sort();
  }
  return config;
}

export function pruneOrphanVehicles(config) {
  if (!config?.shifts?.plannedVehicles) return config;
  const planned = new Set(config.shifts.expandedDates || []);
  for (const d of Object.keys(config.shifts.plannedVehicles)) {
    if (!planned.has(d)) delete config.shifts.plannedVehicles[d];
  }
  return config;
}

// 指定月度の総出番数 = 予定日(expandedDates)と実績日(driveDates)の和集合の件数。
// 実績入力は expandedDates を更新しないため、両方の和集合で数える必要がある
// （expandedDates の生件数では、予定登録せず実績入力した日が数え落ちる）。
export function countMonthlyShifts(driveDates, expandedDates, start, end) {
  const set = new Set();
  for (const d of (expandedDates || [])) {
    if (d >= start && d <= end) set.add(d);
  }
  for (const d of (driveDates || [])) {
    if (d >= start && d <= end) set.add(d);
  }
  return set.size;
}

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function parseIsoDate(date) {
  if (typeof date !== 'string' || !ISO_DATE_PATTERN.test(date)) return null;
  const [year, month, day] = date.split('-').map(Number);
  const value = new Date(0);
  value.setUTCFullYear(year, month - 1, day);
  value.setUTCHours(0, 0, 0, 0);
  if (value.getUTCFullYear() !== year || value.getUTCMonth() !== month - 1 || value.getUTCDate() !== day) {
    return null;
  }
  return value;
}

function collectValidIsoDates(...collections) {
  const dates = new Set();
  for (const collection of collections) {
    if (collection == null || typeof collection[Symbol.iterator] !== 'function') continue;
    for (const date of collection) {
      if (parseIsoDate(date)) dates.add(date);
    }
  }
  return [...dates].sort();
}

export function isRosterDayOff(date, driveDates = [], plannedDates = [], today = null) {
  const target = parseIsoDate(date);
  if (!target) return false;

  const cutoff = parseIsoDate(today);
  const activePlannedDates = cutoff
    ? collectValidIsoDates(plannedDates).filter(plannedDate => plannedDate >= today)
    : plannedDates;
  const shiftDates = collectValidIsoDates(driveDates, activePlannedDates);
  if (shiftDates.includes(date)) return false;

  const targetDay = target.getTime() / MS_PER_DAY;
  let previousDay = null;
  let nextDay = null;
  for (const shiftDate of shiftDates) {
    const shiftDay = parseIsoDate(shiftDate).getTime() / MS_PER_DAY;
    if (shiftDay < targetDay) {
      previousDay = shiftDay;
    } else if (shiftDay > targetDay) {
      nextDay = shiftDay;
      break;
    }
  }

  return previousDay !== null && nextDay !== null && targetDay - previousDay >= 2;
}

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

export function cycleShiftState(current, defaultType) {
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

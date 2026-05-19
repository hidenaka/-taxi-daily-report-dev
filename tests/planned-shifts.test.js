import { test, assert } from './run.js';
import {
  isValidVehicle,
  getPlannedVehicle,
  getShiftStateForDate,
  cycleShiftState,
  applyShiftState,
  pruneOrphanVehicles,
  countMonthlyShifts,
} from '../js/planned-shifts.js';

// --- isValidVehicle ---
test('isValidVehicle: 有効値を受け入れる', () => {
  assert.equal(isValidVehicle('japantaxi'), true);
  assert.equal(isValidVehicle('premium'), true);
});

test('isValidVehicle: 無効値を拒否する', () => {
  assert.equal(isValidVehicle('all'), false);
  assert.equal(isValidVehicle(''), false);
  assert.equal(isValidVehicle(null), false);
  assert.equal(isValidVehicle(undefined), false);
});

// --- getPlannedVehicle ---
function makeConfig({ planned = [], paid = [], vehicles = {}, defaultVehicle = 'japantaxi' } = {}) {
  return {
    shifts: { expandedDates: planned.slice(), paidLeaveDates: paid.slice(), plannedVehicles: { ...vehicles } },
    defaults: { vehicleType: defaultVehicle },
  };
}

test('getPlannedVehicle: 明示済の値を返す', () => {
  const cfg = makeConfig({ planned: ['2026-05-12'], vehicles: { '2026-05-12': 'premium' } });
  assert.equal(getPlannedVehicle('2026-05-12', cfg), 'premium');
});

test('getPlannedVehicle: expandedDates にあり明示なし → defaults.vehicleType', () => {
  const cfg = makeConfig({ planned: ['2026-05-12'], defaultVehicle: 'premium' });
  assert.equal(getPlannedVehicle('2026-05-12', cfg), 'premium');
});

test('getPlannedVehicle: defaults.vehicleType が不正 → japantaxi にフォールバック', () => {
  const cfg = makeConfig({ planned: ['2026-05-12'], defaultVehicle: '' });
  assert.equal(getPlannedVehicle('2026-05-12', cfg), 'japantaxi');
});

test('getPlannedVehicle: expandedDates に無い → null', () => {
  const cfg = makeConfig({ planned: [] });
  assert.equal(getPlannedVehicle('2026-05-12', cfg), null);
});

// --- getShiftStateForDate ---
test('getShiftStateForDate: 未', () => {
  const cfg = makeConfig();
  assert.deepEqual(getShiftStateForDate('2026-05-12', cfg), { planned: false, vehicle: null, paid: false });
});

test('getShiftStateForDate: 予定(明示)', () => {
  const cfg = makeConfig({ planned: ['2026-05-12'], vehicles: { '2026-05-12': 'premium' } });
  assert.deepEqual(getShiftStateForDate('2026-05-12', cfg), { planned: true, vehicle: 'premium', paid: false });
});

test('getShiftStateForDate: 有給', () => {
  const cfg = makeConfig({ paid: ['2026-05-12'] });
  assert.deepEqual(getShiftStateForDate('2026-05-12', cfg), { planned: false, vehicle: null, paid: true });
});

// --- cycleShiftState (defaultType='japantaxi') ---
test('cycleShiftState JT: 未 → JT予定', () => {
  const next = cycleShiftState({ planned: false, vehicle: null, paid: false }, 'japantaxi');
  assert.deepEqual(next, { planned: true, vehicle: 'japantaxi', paid: false });
});

test('cycleShiftState JT: JT予定 → プレ予定', () => {
  const next = cycleShiftState({ planned: true, vehicle: 'japantaxi', paid: false }, 'japantaxi');
  assert.deepEqual(next, { planned: true, vehicle: 'premium', paid: false });
});

test('cycleShiftState JT: プレ予定 → 有給', () => {
  const next = cycleShiftState({ planned: true, vehicle: 'premium', paid: false }, 'japantaxi');
  assert.deepEqual(next, { planned: false, vehicle: null, paid: true });
});

test('cycleShiftState JT: 有給 → 未', () => {
  const next = cycleShiftState({ planned: false, vehicle: null, paid: true }, 'japantaxi');
  assert.deepEqual(next, { planned: false, vehicle: null, paid: false });
});

// --- cycleShiftState (defaultType='premium') ---
test('cycleShiftState プレ: 未 → プレ予定', () => {
  const next = cycleShiftState({ planned: false, vehicle: null, paid: false }, 'premium');
  assert.deepEqual(next, { planned: true, vehicle: 'premium', paid: false });
});

test('cycleShiftState プレ: プレ予定 → JT予定', () => {
  const next = cycleShiftState({ planned: true, vehicle: 'premium', paid: false }, 'premium');
  assert.deepEqual(next, { planned: true, vehicle: 'japantaxi', paid: false });
});

// --- applyShiftState ---
test('applyShiftState: 未 → 予定 で expandedDates と plannedVehicles に追加', () => {
  const cfg = makeConfig();
  applyShiftState(cfg, '2026-05-12', { planned: true, vehicle: 'premium', paid: false });
  assert.deepEqual(cfg.shifts.expandedDates, ['2026-05-12']);
  assert.equal(cfg.shifts.plannedVehicles['2026-05-12'], 'premium');
  assert.deepEqual(cfg.shifts.paidLeaveDates, []);
});

test('applyShiftState: 予定 → 有給 で expandedDates/plannedVehicles から削除し paidLeaveDates に追加', () => {
  const cfg = makeConfig({ planned: ['2026-05-12'], vehicles: { '2026-05-12': 'japantaxi' } });
  applyShiftState(cfg, '2026-05-12', { planned: false, vehicle: null, paid: true });
  assert.deepEqual(cfg.shifts.expandedDates, []);
  assert.equal(cfg.shifts.plannedVehicles['2026-05-12'], undefined);
  assert.deepEqual(cfg.shifts.paidLeaveDates, ['2026-05-12']);
});

test('applyShiftState: 有給 → 未 で paidLeaveDates から削除', () => {
  const cfg = makeConfig({ paid: ['2026-05-12'] });
  applyShiftState(cfg, '2026-05-12', { planned: false, vehicle: null, paid: false });
  assert.deepEqual(cfg.shifts.paidLeaveDates, []);
});

test('applyShiftState: 予定 → 別車種予定 で plannedVehicles 上書き', () => {
  const cfg = makeConfig({ planned: ['2026-05-12'], vehicles: { '2026-05-12': 'japantaxi' } });
  applyShiftState(cfg, '2026-05-12', { planned: true, vehicle: 'premium', paid: false });
  assert.deepEqual(cfg.shifts.expandedDates, ['2026-05-12']);
  assert.equal(cfg.shifts.plannedVehicles['2026-05-12'], 'premium');
});

test('applyShiftState: 重複追加が起きない（既に予定の日に再度予定）', () => {
  const cfg = makeConfig({ planned: ['2026-05-12'], vehicles: { '2026-05-12': 'japantaxi' } });
  applyShiftState(cfg, '2026-05-12', { planned: true, vehicle: 'japantaxi', paid: false });
  assert.deepEqual(cfg.shifts.expandedDates, ['2026-05-12']);
});

// --- pruneOrphanVehicles ---
test('pruneOrphanVehicles: expandedDates に無い plannedVehicles のキーを削除', () => {
  const cfg = makeConfig({ planned: ['2026-05-12'], vehicles: { '2026-05-12': 'premium', '2026-04-01': 'japantaxi' } });
  pruneOrphanVehicles(cfg);
  assert.deepEqual(Object.keys(cfg.shifts.plannedVehicles).sort(), ['2026-05-12']);
});

test('pruneOrphanVehicles: plannedVehicles が無い config でも例外を出さない', () => {
  const cfg = { shifts: { expandedDates: ['2026-05-12'] } };
  pruneOrphanVehicles(cfg);
  assert.equal(cfg.shifts.plannedVehicles, undefined);
});

// --- countMonthlyShifts ---
// 月度の総出番数 = 予定日(expandedDates)と実績日(driveDates)の和集合。
// 実績入力は expandedDates を更新しないため、和集合で数える必要がある。
test('countMonthlyShifts: 予定日と実績日の和集合を数える', () => {
  const expandedDates = ['2026-05-17', '2026-05-19', '2026-05-21'];
  const driveDates = ['2026-05-23', '2026-05-25'];
  assert.equal(countMonthlyShifts(driveDates, expandedDates, '2026-05-16', '2026-06-15'), 5);
});

test('countMonthlyShifts: 実績日が expandedDates に残っていても二重計上しない', () => {
  const expandedDates = ['2026-05-17', '2026-05-19', '2026-05-21'];
  const driveDates = ['2026-05-17', '2026-05-23']; // 05-17 は予定にも実績にも
  assert.equal(countMonthlyShifts(driveDates, expandedDates, '2026-05-16', '2026-06-15'), 4);
});

test('countMonthlyShifts: expandedDates に無い実績日も総出番に数える', () => {
  // バグ再現: 実績日が予定に登録されていないと旧ロジックでは数え落ちた
  const expandedDates = ['2026-05-17', '2026-05-19'];
  const driveDates = ['2026-05-21']; // 実績日は expandedDates に無い
  assert.equal(countMonthlyShifts(driveDates, expandedDates, '2026-05-16', '2026-06-15'), 3);
});

test('countMonthlyShifts: 月度範囲外の日付を除外する', () => {
  const expandedDates = ['2026-05-10', '2026-05-17', '2026-06-20'];
  const driveDates = ['2026-05-19', '2026-07-01'];
  assert.equal(countMonthlyShifts(driveDates, expandedDates, '2026-05-16', '2026-06-15'), 2);
});

test('countMonthlyShifts: 空・null を安全に扱う', () => {
  assert.equal(countMonthlyShifts([], [], '2026-05-16', '2026-06-15'), 0);
  assert.equal(countMonthlyShifts(null, null, '2026-05-16', '2026-06-15'), 0);
});

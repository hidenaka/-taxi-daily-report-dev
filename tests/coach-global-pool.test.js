import { describe, it } from 'node:test';
import assert from 'node:assert';
import { buildGlobalPool } from '../js/coach/global-pool.js';

function trip(amount, bt, at, bp, ap) {
  return { amount, boardTime: bt, alightTime: at, boardPlace: bp, alightPlace: ap, isCancel: false };
}
const drivesPremium = [
  { _userId: 'uA', date: '2026-05-01', vehicleType: 'premium', departureTime: '07:00', returnTime: '22:00',
    trips: [ trip(2000, '19:10', '19:25', '港区六本木6', '渋谷区恵比寿1'), trip(2600, '19:40', '19:55', '港区西麻布2', '目黒区中目黒1') ] },
  { _userId: 'uB', date: '2026-05-08', vehicleType: 'premium', departureTime: '07:00', returnTime: '22:00',
    trips: [ trip(2400, '19:15', '19:30', '港区六本木6', '渋谷区渋谷2') ] },
];
const drivesJpn = [
  { _userId: 'uC', date: '2026-05-02', vehicleType: 'japantaxi', departureTime: '07:00', returnTime: '22:00',
    trips: [ trip(1500, '19:20', '19:35', '新宿区西新宿1', '中野区中野2') ] },
];

describe('buildGlobalPool', () => {
  it('車種別にセグメントして byVehicleType を返す', () => {
    const gp = buildGlobalPool([...drivesPremium, ...drivesJpn], { nowIso: '2026-05-10T00:00:00.000Z' });
    assert.ok(gp.byVehicleType.premium);
    assert.ok(gp.byVehicleType.japantaxi);
    assert.strictEqual(gp.builtAt, '2026-05-10T00:00:00.000Z');
  });
  it('2ユーザーのpremiumセグメントは memberCount=2', () => {
    const gp = buildGlobalPool(drivesPremium, { nowIso: '2026-05-10T00:00:00.000Z' });
    assert.strictEqual(gp.byVehicleType.premium.memberCount, 2);
  });
  it('1ユーザーのみの japantaxi セグメントは memberCount<2 で空集計', () => {
    const gp = buildGlobalPool(drivesJpn, { nowIso: '2026-05-10T00:00:00.000Z' });
    assert.strictEqual(gp.byVehicleType.japantaxi.memberCount, 1);
    assert.deepStrictEqual(gp.byVehicleType.japantaxi.heatmap, []);
    assert.deepStrictEqual(gp.byVehicleType.japantaxi.areas, []);
  });
  it('heatmapは per-cell k≥2（days>=2）のみ残す', () => {
    const gp = buildGlobalPool(drivesPremium, { nowIso: '2026-05-10T00:00:00.000Z' });
    for (const cell of gp.byVehicleType.premium.heatmap) {
      assert.ok(cell.days >= 2, 'cell days=' + cell.days + ' <2');
    }
  });
  it('vehicleType未指定のdriveは japantaxi 扱い', () => {
    const noType = [{ _userId: 'uX', date: '2026-05-01', departureTime: '07:00', returnTime: '22:00', trips: [trip(1000,'19:10','19:20','A','B')] }];
    const gp = buildGlobalPool(noType, { nowIso: '2026-05-10T00:00:00.000Z' });
    assert.ok(gp.byVehicleType.japantaxi);
  });
  it('空入力は byVehicleType 空', () => {
    const gp = buildGlobalPool([], { nowIso: '2026-05-10T00:00:00.000Z' });
    assert.deepStrictEqual(gp.byVehicleType, {});
  });
  it('heatmapセルに個人特定可能な peerValues を含めない（匿名化）', () => {
    const gp = buildGlobalPool(drivesPremium, { nowIso: '2026-05-10T00:00:00.000Z' });
    for (const cell of gp.byVehicleType.premium.heatmap) {
      assert.ok(!('peerValues' in cell), 'peerValues が残存');
      assert.ok(typeof cell.hourlyA === 'number' && typeof cell.days === 'number');
    }
  });
});

import { test, assert } from './run.js';
import { RESP_CAP, splitDrives, salesAggregate, requiredToRespCap } from '../js/home-metrics.js';
import { DEFAULT_CONFIG } from '../js/default-config.js';

const mk = (n, amount) => Array.from({ length: n }, (_, i) => ({
  date: `2026-06-${String(i + 1).padStart(2, '0')}`, vehicleType: 'japantaxi',
  trips: [{ amount, isCancel: false }]
}));

test('RESP_CAP は 11（責任出番上限）', () => {
  assert.equal(RESP_CAP, 11);
});

test('splitDrives: 1〜11=責任, 12以降=公出', () => {
  const d = mk(13, 100000);
  const { resp, kosyutsu } = splitDrives(d);
  assert.equal(resp.length, 11);
  assert.equal(kosyutsu.length, 2);
});

test('splitDrives: 9出番なら責任9・公出0', () => {
  const { resp, kosyutsu } = splitDrives(mk(9, 100000));
  assert.equal(resp.length, 9);
  assert.equal(kosyutsu.length, 0);
});

test('salesAggregate: 合計税込/税抜と平均（出番数で割る）', () => {
  const agg = salesAggregate(mk(4, 100000)); // 税込40万
  assert.equal(agg.count, 4);
  assert.equal(agg.totalIncl, 400000);
  assert.equal(Math.round(agg.totalExcl), Math.round(400000 / 1.1));
  assert.equal(agg.avgIncl, 100000);
  assert.equal(Math.round(agg.avgExcl), Math.round((400000 / 1.1) / 4));
});

test('salesAggregate: 空配列は全て0（ゼロ除算しない）', () => {
  const agg = salesAggregate([]);
  assert.equal(agg.count, 0);
  assert.equal(agg.totalIncl, 0);
  assert.equal(agg.avgIncl, 0);
  assert.equal(agg.avgExcl, 0);
});

test('requiredToRespCap: 責任11まで残りで必要な均等売上(税込/税抜)と総額', () => {
  const cfg = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  cfg.responsibilityShifts = 11;
  cfg.takeHomeTarget = 500000;
  const drives = mk(9, 100000); // 9出番済
  const r = requiredToRespCap(drives, cfg, '2026-05-16', '2026-06-15');
  assert.equal(r.remaining, 2);           // 11-9
  assert.ok(r.perShiftIncl > 0);
  assert.equal(Math.round(r.perShiftExcl), Math.round(r.perShiftIncl / 1.1));
  assert.equal(Math.round(r.totalIncl), Math.round(r.perShiftIncl * 2));
});

test('requiredToRespCap: 11出番以上なら remaining=0・達成扱い', () => {
  const cfg = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  cfg.responsibilityShifts = 11;
  const r = requiredToRespCap(mk(11, 100000), cfg, '2026-05-16', '2026-06-15');
  assert.equal(r.remaining, 0);
  assert.equal(r.perShiftIncl, 0);
  assert.equal(r.totalIncl, 0);
});

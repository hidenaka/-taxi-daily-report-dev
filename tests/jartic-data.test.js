import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toRecord, mergeHistory, latestOf, compareLabel, addHours, jstHourKey, hourLabel, day24, validate, deadDirection } from '../tools/js/jartic-data.js';

const perm = (o = {}) => ({
  常時観測点コード: '3110010', 時間コード: 202610240800,
  '上り・小型交通量': 1000, '上り・大型交通量': 300, '上り・車種判別不能交通量': 5, '上り・欠測': 0, '上り・停電': 0, '上り・ループ異常': 0, '上り・超音波異常': 0,
  '下り・小型交通量': 800, '下り・大型交通量': 200, '下り・車種判別不能交通量': 0, '下り・欠測': 0, '下り・停電': 0, '下り・ループ異常': 0, '下り・超音波異常': 0, ...o,
});

test('常設の観測点: 小型＋大型＋見分けられない車。欠測・異常が立った向きは null', () => {
  assert.deepEqual(toRecord(perm(), 'perm'), { hour: '2026102408', code: '3110010', up: 1305, dn: 1000 });
  assert.equal(toRecord(perm({ '下り・ループ異常': 1 }), 'perm').dn, null);
  assert.equal(toRecord(perm({ '上り・小型交通量': null }), 'perm').up, null);
});

test('CCTV の観測点: 自動車交通量を使い、null は 0 にしない', () => {
  const r = toRecord({ 常時観測点コード: 3811350, 時間コード: 202610240800, '上り・自動車交通量': 1500, '下り・自動車交通量': null }, 'cctv');
  assert.deepEqual(r, { hour: '2026102408', code: '3811350', up: 1500, dn: null });
});

test('時刻: JST の時間と、日をまたぐ足し引き', () => {
  assert.equal(jstHourKey(new Date('2026-10-24T01:10:00Z')), '2026102410');
  assert.equal(addHours('2026103123', 1), '2026110100');
  assert.equal(addHours('2026110100', -168), '2026102500');
  assert.equal(hourLabel('2026102408'), '10月24日 8時台');
});

function sample() {
  // 8日分、毎時 上り1000・下り800。いちばん新しい時間だけ上り1300
  const now = '2026102408';
  const recs = [];
  for (let i = 0; i < 192; i++) recs.push({ kind: 'perm', code: '1', c: [139.7, 35.6], hour: addHours(now, -i), up: i === 0 ? 1300 : 1000, dn: 800 });
  return mergeHistory(null, recs, now, { nameOf: () => '第二京浜' });
}

test('ためる: 8日分にそろえ、古い分は落とし、新しい時間を足す', () => {
  const d = sample();
  assert.equal(d.meta.hours.length, 192);
  assert.equal(d.points[0].name, '第二京浜');
  const next = mergeHistory(d, [{ kind: 'perm', code: '1', c: [139.7, 35.6], hour: '2026102409', up: 900, dn: 900 }], '2026102409');
  assert.equal(next.meta.hours.at(-1), '2026102409');
  assert.deepEqual(next.points[0].v.at(-1), [900, 900]);
  assert.deepEqual(next.points[0].v.at(-2), [1300, 800]);
  assert.deepEqual(validate(next), []);
});

test('先週の同じ時間と比べる（10%以上で多い・少ない）', () => {
  const d = sample();
  const l = latestOf(d, d.points[0]);
  assert.equal(l.hour, '2026102408');
  assert.equal(l.total, 2100);
  assert.equal(l.weekTotal, 1800);
  assert.equal(compareLabel(l.ratio).key, 'more');
  assert.equal(compareLabel(1.05).key, 'same');
  assert.equal(compareLabel(0.85).text, '先週より 15% 少ない');
  assert.equal(compareLabel(null).key, 'none');
  assert.equal(day24(d, d.points[0], l.hour).length, 24);
});

test('数えられていない向き（昼もほぼ0・値なし）は使わず、片方の向きだけで比べる', () => {
  const hours = ['2026102408', '2026102412', '2026102418'];
  assert.equal(deadDirection([0, 1, 0], hours), true);
  assert.equal(deadDirection([null, null, null], hours), true);
  assert.equal(deadDirection([500, 600, 700], hours), false);
  const now = '2026102408'; const recs = [];
  for (let i = 0; i < 192; i++) recs.push({ kind: 'cctv', code: '2', c: [139.7, 35.6], hour: addHours(now, -i), up: 1000, dn: i % 2 ? 0 : 1 });
  const d = mergeHistory(null, recs, now);
  assert.deepEqual(d.points[0].off, [false, true]);
  assert.equal(latestOf(d, d.points[0]).total, 1000);
});

test('tools/data/jartic-traffic.json の形', async () => {
  const { readFileSync } = await import('node:fs');
  const d = JSON.parse(readFileSync(new URL('../tools/data/jartic-traffic.json', import.meta.url), 'utf8'));
  assert.deepEqual(validate(d), []);
  assert.equal(d.meta.hours.length, 192);
  assert.ok(d.points.length >= 20);
  assert.match(d.meta.notice, /国土交通省によって保証されたものではありません/);
});

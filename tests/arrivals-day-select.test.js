// 到着便ページの日付切り替え
//
// 背景: tools/data/arrivals.json は1日ぶんの上書きで、更新は毎日 23:45 JST が最後。
// つまり 0時を過ぎてもデータは前日のまま。それを「今日」として扱っていたため、
// 深夜勤務中に見ると前日の早朝便が「これから来る便」に見えていた。
// また前日ぶんはどこにも残らず、日付をまたぐと見返せなかった。
//
// 直し方: 日付別スナップショット(tools/data/arrivals-days/<date>.json)を持ち、
// 「そのデータが何日ぶんか」を updatedAt から決めて、画面に出す・選べるようにする。
import { test } from 'node:test';
import assert from 'node:assert';
import { dataDayOf, isStaleForToday, resolveViewDay, shiftDay, formatDayLabel } from '../tools/js/arrivals-data.js';

// --- そのデータが何日ぶんか ---

test('updatedAt からデータの日付を取る（JSTのまま）', () => {
  assert.equal(dataDayOf({ updatedAt: '2026-09-08T23:45:39+09:00' }), '2026-09-08');
  assert.equal(dataDayOf({ updatedAt: '2026-09-08T00:10:00+09:00' }), '2026-09-08');
});

test('updatedAt が無いデータは日付不明', () => {
  assert.equal(dataDayOf({}), null);
  assert.equal(dataDayOf(null), null);
});

// --- 今日のデータか、前日のまま残っているのか ---

test('0時を過ぎたら「今日ぶんはまだ来ていない」と分かる', () => {
  const data = { updatedAt: '2026-09-08T23:45:39+09:00' };
  // 9/9 の 0:30 に見ている
  assert.equal(isStaleForToday(data, new Date('2026-09-09T00:30:00+09:00')), true);
});

test('同じ日のうちは「今日ぶん」として扱う', () => {
  const data = { updatedAt: '2026-09-08T23:45:39+09:00' };
  assert.equal(isStaleForToday(data, new Date('2026-09-08T23:50:00+09:00')), false);
});

// --- どの日を見せるか ---

test('指定が無ければ、データ自身の日付を見る', () => {
  const data = { updatedAt: '2026-09-08T23:45:39+09:00' };
  const r = resolveViewDay({ data, requested: null, now: new Date('2026-09-09T00:30:00+09:00') });
  assert.equal(r.day, '2026-09-08');
  assert.equal(r.isLive, true, '最新ファイルをそのまま見ている');
  assert.equal(r.isToday, false, '実際の今日(9/9)ではない');
});

test('過去日を指定したらその日を見る（最新ファイルではない）', () => {
  const data = { updatedAt: '2026-09-08T23:45:39+09:00' };
  const r = resolveViewDay({ data, requested: '2026-09-05', now: new Date('2026-09-09T00:30:00+09:00') });
  assert.equal(r.day, '2026-09-05');
  assert.equal(r.isLive, false);
  assert.equal(r.isToday, false);
});

test('最新ファイルと同じ日を指定したら、最新ファイルを使う（重複取得しない）', () => {
  const data = { updatedAt: '2026-09-08T23:45:39+09:00' };
  const r = resolveViewDay({ data, requested: '2026-09-08', now: new Date('2026-09-08T20:00:00+09:00') });
  assert.equal(r.day, '2026-09-08');
  assert.equal(r.isLive, true);
  assert.equal(r.isToday, true);
});

// --- 日付の前後移動 ---

test('前日・翌日へ動かせる（月をまたいでも正しい）', () => {
  assert.equal(shiftDay('2026-09-08', -1), '2026-09-07');
  assert.equal(shiftDay('2026-09-08', +1), '2026-09-09');
  assert.equal(shiftDay('2026-09-01', -1), '2026-08-31');
  assert.equal(shiftDay('2026-08-31', +1), '2026-09-01');
  assert.equal(shiftDay('2027-01-01', -1), '2026-12-31');
});

test('うるう年の2月をまたげる', () => {
  assert.equal(shiftDay('2028-03-01', -1), '2028-02-29');
});

// --- 表示ラベル ---

test('日付ラベルは曜日つきで出す（今日・昨日より前）', () => {
  assert.equal(formatDayLabel('2026-09-05', new Date('2026-09-09T00:30:00+09:00')), '9/5(土)');
});

test('実際の今日なら「今日」と分かるようにする', () => {
  assert.equal(formatDayLabel('2026-09-09', new Date('2026-09-09T10:00:00+09:00')), '今日 9/9(水)');
});

test('実際の前日なら「昨日」と分かるようにする', () => {
  assert.equal(formatDayLabel('2026-09-08', new Date('2026-09-09T10:00:00+09:00')), '昨日 9/8(火)');
});

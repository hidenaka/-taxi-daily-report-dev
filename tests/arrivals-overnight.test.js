// 日付をまたぐ深夜の到着便
//
// 背景: 到着便データは前日23:45が最終更新で、遅れた便は「24:33」のように
// 24時を超えた表記で入る(実データ: 9/8 の NH4738 千歳 定刻22:40 → 24:33)。
// 0時を過ぎるとその便こそが乗務員の欲しい情報なのに、"24:33" を 1473分と
// 解釈していたため「23時間後の便」に化けて埋もれていた。
// 逆に当日朝の便(4:25 等)は、深夜0時台の乗務中には要らない。
import { test } from 'node:test';
import assert from 'node:assert';
import { minutesOfDay, minutesFromNow, splitOvernight } from '../tools/js/arrivals-data.js';

// --- 24時を超えた表記 ---

test('24:33 は翌日の0:33として読む', () => {
  assert.equal(minutesOfDay('24:33'), 33);
  assert.equal(minutesOfDay('25:10'), 70);
});

test('ふつうの時刻はそのまま', () => {
  assert.equal(minutesOfDay('23:45'), 23 * 60 + 45);
  assert.equal(minutesOfDay('04:25'), 4 * 60 + 25);
  assert.equal(minutesOfDay(null), null);
});

// --- 「いまから何分後か」 ---

test('0時40分に見たとき、24:33の便は7分前(過ぎたばかり)', () => {
  // 24:33 = 0:33。0:40 の 7分前
  assert.equal(minutesFromNow('24:33', 40), -7);
});

test('0時40分に見たとき、当日朝4:25の便は約3.7時間後', () => {
  assert.equal(minutesFromNow('04:25', 40), 4 * 60 + 25 - 40);
});

test('23時50分に見たとき、24:33の便は43分後', () => {
  // 23:50 = 1430分。24:33 は日付をまたぐので +43分
  assert.equal(minutesFromNow('24:33', 23 * 60 + 50), 43);
});

test('23時50分に見たとき、当日朝4:25の便は「もう過ぎた便」扱いにしない', () => {
  // 4:25 は前の話(その日の朝)。深夜に見ても「4時間半後」ではない。
  // 日またぎ補正は 24時超え表記の便にだけ効かせる。
  assert.ok(minutesFromNow('04:25', 23 * 60 + 50) < 0);
});

// --- 深夜の並べ替え ---

const flights = [
  { flightNumber: 'NH4738', scheduledTime: '22:40', estimatedTime: '24:33', poolLane: 3, status: '不明' },
  { flightNumber: 'NH988', scheduledTime: '23:30', estimatedTime: '23:41', poolLane: 3, status: '到着' },
  { flightNumber: 'JL003', scheduledTime: '04:50', estimatedTime: '04:50', poolLane: 4, status: '到着' },
  { flightNumber: 'NH107', scheduledTime: '04:25', estimatedTime: '04:00', poolLane: 4, status: '到着' },
];

test('0時台に見ると、前日から持ち越した便と当日朝の便を分けられる', () => {
  const r = splitOvernight(flights, new Date('2026-09-09T00:40:00+09:00'));
  // 23:41着(59分前)も「さっき着いた便」として一覧に入る。0:33着はそのあと。
  assert.deepEqual(r.carriedOver.map(f => f.flightNumber), ['NH988', 'NH4738'],
    '直前に着いた便と、日をまたいで着く便が到着順に並ぶ');
  assert.deepEqual(r.morning.map(f => f.flightNumber), ['NH107', 'JL003'],
    '当日朝の便は分けて後ろへ');
});

test('持ち越し便には、定刻からの遅れが付く', () => {
  const r = splitOvernight(flights, new Date('2026-09-09T00:40:00+09:00'));
  const nh = r.carriedOver.find(f => f.flightNumber === 'NH4738');
  assert.equal(nh.delayMin, 113, '22:40 → 24:33 は113分遅れ');
  const n988 = r.carriedOver.find(f => f.flightNumber === 'NH988');
  assert.equal(n988.delayMin, 11, '23:30 → 23:41 は11分遅れ');
});

test('昼間に見たときは分けない（深夜だけの見せ方）', () => {
  const r = splitOvernight(flights, new Date('2026-09-08T14:00:00+09:00'));
  assert.equal(r.isOvernight, false);
  assert.equal(r.carriedOver.length, 0);
});

test('23時台に見ると、これから日付をまたぐ便も持ち越し側に入る', () => {
  const r = splitOvernight(flights, new Date('2026-09-08T23:50:00+09:00'));
  assert.equal(r.isOvernight, true);
  // 23:50 時点。23:41着(9分前)と、これから着く 0:33 の便。
  assert.deepEqual(r.carriedOver.map(f => f.flightNumber), ['NH988', 'NH4738']);
});

// --- 翌日まで持ち越された便は「今夜の持ち越し」ではない ---
// 実データに estimatedTime "39:20"(＝翌日15:20・20時間40分遅れ)の便があった。
// 計算としては正しいが、深夜0時台に「あと15時間」の便を持ち越しに混ぜると邪魔になる。

test('翌朝までに着く便だけを持ち越しに入れる', () => {
  const f = [
    { flightNumber: 'A', scheduledTime: '22:40', estimatedTime: '24:33', poolLane: 3 },
    { flightNumber: 'B', scheduledTime: '22:45', estimatedTime: '25:15', poolLane: 1 },
    { flightNumber: 'C', scheduledTime: '18:40', estimatedTime: '39:20', poolLane: 3 }, // 翌日15:20
  ];
  const r = splitOvernight(f, new Date('2026-09-09T00:40:00+09:00'));
  assert.deepEqual(r.carriedOver.map(x => x.flightNumber), ['A', 'B'],
    '翌日の昼に着く便(39:20)は持ち越しに入れない');
});

test('持ち越しの上限は翌朝6時まで', () => {
  const f = [
    { flightNumber: 'D', scheduledTime: '23:00', estimatedTime: '29:30', poolLane: 2 }, // 翌5:30
    { flightNumber: 'E', scheduledTime: '23:00', estimatedTime: '31:00', poolLane: 2 }, // 翌7:00
  ];
  const r = splitOvernight(f, new Date('2026-09-09T00:40:00+09:00'));
  assert.deepEqual(r.carriedOver.map(x => x.flightNumber), ['D']);
});

// --- 日付が変わった直後に、直前まで着いていた便を見る ---
// 0:10 に見たとき「23:55 着(15分前)」は、そのままだと 1425分後 と解釈され
// 時間窓から外れて消えていた。深夜に一番見たいのは、まさにその直前の便。

test('0時10分に見たとき、23時55分着は15分前として扱う', () => {
  assert.equal(minutesFromNow('23:55', 10), -15);
});

test('0時10分に見たとき、23時30分着は40分前', () => {
  assert.equal(minutesFromNow('23:30', 10), -40);
});

test('2時に見ても、22時台の便は「前の晩」として過去に置く', () => {
  assert.equal(minutesFromNow('22:40', 2 * 60), -200);
});

test('昼間の見え方は変えない', () => {
  // 15時に見た 23:55 は、まだ来ていない便(8時間55分後)
  assert.equal(minutesFromNow('23:55', 15 * 60), 8 * 60 + 55);
  // 15時に見た 13:00 は 2時間前
  assert.equal(minutesFromNow('13:00', 15 * 60), -120);
});

test('直前に着いた便も、深夜の一覧に入れる', () => {
  const f = [
    { flightNumber: 'A', scheduledTime: '22:40', estimatedTime: '24:33', poolLane: 3 },   // 持ち越し
    { flightNumber: 'B', scheduledTime: '23:40', estimatedTime: '23:55', poolLane: 1 },   // 15分前に到着
    { flightNumber: 'C', scheduledTime: '20:00', estimatedTime: '20:05', poolLane: 2 },   // 4時間前(古い)
    { flightNumber: 'D', scheduledTime: '04:25', estimatedTime: '04:25', poolLane: 4 },   // 朝の便
  ];
  const r = splitOvernight(f, new Date('2026-09-09T00:10:00+09:00'));
  assert.deepEqual(r.carriedOver.map(x => x.flightNumber), ['B', 'A'],
    '直前に着いた便(B)も含め、到着時刻の順に並べる');
  assert.deepEqual(r.morning.map(x => x.flightNumber), ['D']);
});

test('直前の便は、さかのぼる範囲を区切る（何時間も前の便は出さない）', () => {
  const f = [
    { flightNumber: 'B', scheduledTime: '23:40', estimatedTime: '23:55', poolLane: 1 },
    { flightNumber: 'C', scheduledTime: '20:00', estimatedTime: '20:05', poolLane: 2 },
  ];
  const r = splitOvernight(f, new Date('2026-09-09T00:10:00+09:00'));
  assert.ok(!r.carriedOver.some(x => x.flightNumber === 'C'), '4時間前の便は出さない');
});

test('さっき着いた便は、直近1時間ぶんに絞る（0時台に15便並べない）', () => {
  const mk = (n, t) => ({ flightNumber: n, scheduledTime: t, estimatedTime: t, poolLane: 1 });
  const f = [mk('古1', '22:45'), mk('古2', '22:50'), mk('近1', '23:30'), mk('近2', '23:55')];
  const r = splitOvernight(f, new Date('2026-09-09T00:10:00+09:00'));
  // 0:10 から見て 22:45 は85分前、23:30 は40分前
  assert.deepEqual(r.carriedOver.map(x => x.flightNumber), ['近1', '近2'],
    '1時間より前に着いた便は出さない');
});

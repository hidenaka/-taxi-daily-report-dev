// 雨雲レーダーの材料づくり（純粋な部分）
//
// データ元: 気象庁 高解像度降水ナウキャスト のタイル。
//   実況 targetTimes_N1.json … 過去3時間ぶん・5分刻み(37コマ)
//   予測 targetTimes_N2.json … 1時間先まで・5分刻み
// 時刻文字列は UTC の 'YYYYMMDDHHmmss'。画面はJSTで出すので変換が要る。
import { test } from 'node:test';
import assert from 'node:assert';
import {
  parseJmaTime, buildFrames, tileUrl, frameLabel, frameClock,
  searchPlaces, PRESET_PLACES,
} from '../tools/js/radar-data.js';

const n1 = [
  { basetime: '20260911011500', validtime: '20260911011500', elements: ['hrpns'] },
  { basetime: '20260911011000', validtime: '20260911011000', elements: ['hrpns'] },
  { basetime: '20260911010500', validtime: '20260911010500', elements: ['hrpns'] },
];
const n2 = [
  { basetime: '20260911011500', validtime: '20260911021500', elements: ['hrpns'] },
  { basetime: '20260911011500', validtime: '20260911020000', elements: ['hrpns'] },
];

test('気象庁の時刻文字列はUTCとして読む', () => {
  assert.equal(parseJmaTime('20260911011500'), Date.UTC(2026, 8, 11, 1, 15, 0));
  assert.equal(parseJmaTime(''), null);
  assert.equal(parseJmaTime('こわれた'), null);
});

test('実況と予測をつないで、古い順に並べる', () => {
  const frames = buildFrames(n1, n2);
  assert.equal(frames.length, 5);
  assert.deepEqual(frames.map(f => f.validtime), [
    '20260911010500', '20260911011000', '20260911011500', '20260911020000', '20260911021500',
  ]);
  assert.deepEqual(frames.map(f => f.kind), ['obs', 'obs', 'obs', 'fcst', 'fcst']);
});

test('実況の最後が「いま」の位置になる', () => {
  const frames = buildFrames(n1, n2);
  const idx = frames.findIndex(f => f.isLatestObs);
  assert.equal(idx, 2, '実況3コマ目(最新)が「いま」');
  assert.equal(frames.filter(f => f.isLatestObs).length, 1);
});

test('同じ時刻が両方に出てきても二重にしない', () => {
  const dup = [{ basetime: '20260911011500', validtime: '20260911011500', elements: ['hrpns'] }];
  const frames = buildFrames(n1, dup);
  assert.equal(frames.length, 3);
  assert.equal(frames[2].kind, 'obs', '実況を優先する（実際に降った記録のほうが確か）');
});

test('データが空でも落ちない', () => {
  assert.deepEqual(buildFrames([], []), []);
  assert.deepEqual(buildFrames(null, null), []);
});

test('タイルのURLを組み立てる', () => {
  const f = buildFrames(n1, n2)[0];
  assert.equal(
    tileUrl(f, 11, 1819, 807),
    'https://www.jma.go.jp/bosai/jmatile/data/nowc/20260911010500/none/20260911010500/surf/hrpns/11/1819/807.png'
  );
});

test('予測コマは基準時刻と表示時刻が違う', () => {
  const f = buildFrames(n1, n2)[3];
  assert.equal(
    tileUrl(f, 10, 909, 403),
    'https://www.jma.go.jp/bosai/jmatile/data/nowc/20260911011500/none/20260911020000/surf/hrpns/10/909/403.png'
  );
});

test('時刻は日本時間で出す', () => {
  const f = buildFrames(n1, n2)[2]; // 01:15 UTC = 10:15 JST
  assert.equal(frameClock(f), '10:15');
});

test('「いま」からの前後を言葉にする', () => {
  const frames = buildFrames(n1, n2);
  const now = parseJmaTime('20260911011500');
  assert.equal(frameLabel(frames[2], now), 'いま');
  assert.equal(frameLabel(frames[0], now), '10分前');
  assert.equal(frameLabel(frames[4], now), '1時間後');
  assert.equal(frameLabel(frames[3], now), '45分後');
});

// --- 場所えらび ---
const coords = {
  '大田区羽田空港': [35.549, 139.779],
  '大田区羽田': [35.551, 139.748],
  '大田区本羽田': [35.548, 139.727],
  '新宿区新宿': [35.690, 139.704],
  '渋谷区渋谷': [35.659, 139.703],
};

test('地名で探せる', () => {
  const r = searchPlaces('羽田', coords, 10);
  assert.equal(r.length, 3);
  assert.equal(r[0].name, '大田区羽田', '前が一致するものを先に、短いものを先に');
});

test('区名でも探せる', () => {
  const r = searchPlaces('渋谷', coords, 10);
  assert.equal(r[0].name, '渋谷区渋谷');
  assert.deepEqual([r[0].lat, r[0].lon], [35.659, 139.703]);
});

test('見つからない・空のときは空で返す', () => {
  assert.deepEqual(searchPlaces('ぞんざいな地名', coords, 10), []);
  assert.deepEqual(searchPlaces('', coords, 10), []);
  assert.deepEqual(searchPlaces('羽田', null, 10), []);
});

test('件数は絞れる', () => {
  assert.equal(searchPlaces('羽田', coords, 2).length, 2);
});

test('よく行く場所は最初から選べる', () => {
  assert.ok(PRESET_PLACES.length >= 4);
  const haneda = PRESET_PLACES.find(p => p.name.includes('羽田'));
  assert.ok(haneda, '羽田空港は必ず入れる');
  assert.ok(haneda.lat > 35 && haneda.lat < 36);
  assert.ok(haneda.lon > 139 && haneda.lon < 140);
});

// --- もっと先の時間まで見る (2026-09-11 本人要望) ---------------------------
// ナウキャスト(5分刻み)は1時間先まで。その先は「降水短時間予報」(rasrf)を足す。
//   1〜6時間先  … 10分ごとに更新される基準時刻から（1時間刻み）
//   7〜15時間先 … 毎正時の基準時刻から（1時間刻み）
// 同じ時刻が複数の基準時刻にあるので、いちばん新しい基準時刻のものを採る。
import { buildFramesWithShortRange, TARGET_TIMES_SHORT } from '../tools/js/radar-data.js';

const shortRange = [
  // 古い基準時刻（採らない）
  { basetime: '20260911000000', validtime: '20260911030000', elements: ['rasrf'] },
  // 新しい基準時刻（こちらを採る）
  { basetime: '20260911015000', validtime: '20260911030000', elements: ['rasrf'] },
  { basetime: '20260911015000', validtime: '20260911040000', elements: ['rasrf'] },
  // 毎正時の基準時刻から、さらに先
  { basetime: '20260911010000', validtime: '20260911080000', elements: ['rasrf'] },
  { basetime: '20260911010000', validtime: '20260911160000', elements: ['rasrf'] },
  // 過去の解析（先の予想ではないので使わない）
  { basetime: '20260911000000', validtime: '20260911000000', elements: ['rasrf'] },
];

test('1時間より先のコマが後ろに足される', () => {
  const frames = buildFramesWithShortRange(n1, n2, shortRange);
  // n1(3コマ) + n2(2コマ: 02:00, 02:15) + 短時間予報(03:00,04:00,08:00,16:00)
  assert.equal(frames.length, 9);
  assert.deepEqual(frames.slice(5).map(f => f.validtime), [
    '20260911030000', '20260911040000', '20260911080000', '20260911160000',
  ]);
  assert.ok(frames.slice(5).every(f => f.kind === 'fcst'));
});

test('同じ時刻なら新しい基準時刻のものを採る', () => {
  const frames = buildFramesWithShortRange(n1, n2, shortRange);
  const f = frames.find(x => x.validtime === '20260911030000');
  assert.equal(f.basetime, '20260911015000');
});

test('ナウキャストと重なる時間帯は、細かいほうを残す', () => {
  const overlap = [{ basetime: '20260911015000', validtime: '20260911021500', elements: ['rasrf'] }];
  const frames = buildFramesWithShortRange(n1, n2, overlap);
  const f = frames.find(x => x.validtime === '20260911021500');
  assert.equal(f.product, 'hrpns', '5分刻みのナウキャストを優先');
  assert.equal(frames.length, 5);
});

test('過去の解析は先の予想として混ぜない', () => {
  const frames = buildFramesWithShortRange(n1, n2, shortRange);
  assert.ok(!frames.some(f => f.validtime === '20260911000000'));
});

test('コマごとに、どのデータかが分かる', () => {
  const frames = buildFramesWithShortRange(n1, n2, shortRange);
  assert.equal(frames[0].product, 'hrpns');
  assert.equal(frames[8].product, 'rasrf');
});

test('短時間予報のタイルURLは別の場所を指す', () => {
  const frames = buildFramesWithShortRange(n1, n2, shortRange);
  const f = frames[8];
  assert.equal(
    tileUrl(f, 10, 909, 403),
    'https://www.jma.go.jp/bosai/jmatile/data/rasrf/20260911010000/none/20260911160000/surf/rasrf/10/909/403.png'
  );
});

test('先の時間の言い方', () => {
  const frames = buildFramesWithShortRange(n1, n2, shortRange);
  const now = parseJmaTime('20260911011500');
  assert.equal(frameLabel(frames[8], now), '14時間45分後');
  assert.equal(frameLabel(frames[7], now), '6時間45分後');
});

test('短時間予報が取れなくても、これまで通り動く', () => {
  const frames = buildFramesWithShortRange(n1, n2, []);
  assert.equal(frames.length, 5);
  assert.deepEqual(frames, buildFrames(n1, n2));
});

test('短時間予報の時刻一覧の場所', () => {
  assert.equal(TARGET_TIMES_SHORT, 'https://www.jma.go.jp/bosai/jmatile/data/rasrf/targetTimes.json');
});

// --- 時間バーの目盛り (2026-09-12 本人指摘) ---------------------------------
// 1) 何時のコマを見ているのか、バーの上で位置が読めない
// 2) 「3時間前」より「14時間後」のほうが幅が狭い＝コマ番号で等間隔に並べていたため。
//    過去3時間は5分刻みで37コマ、先は1時間刻みで13コマ。時間の長さと幅が合っていなかった。
// → バーは時間に比例させ、3時間おきの目盛りを置く。
import { frameOffsets, buildTicks, nearestFrameIndex } from '../tools/js/radar-data.js';

// 実況3コマ(5分刻み) + 予測1コマ(1時間後) の極端な例で、比例しているかを見る
const obs3 = [
  { basetime: '20260911011500', validtime: '20260911011500', elements: ['hrpns'] },
  { basetime: '20260911011000', validtime: '20260911011000', elements: ['hrpns'] },
  { basetime: '20260911010500', validtime: '20260911010500', elements: ['hrpns'] },
];
const far = [{ basetime: '20260911011500', validtime: '20260911021500', elements: ['hrpns'] }];

test('コマの位置は「時間の長さ」で決まる', () => {
  const frames = buildFrames(obs3, far);           // 01:05 01:10 01:15 02:15 (計70分)
  const off = frameOffsets(frames);
  assert.equal(off.totalMin, 70);
  assert.deepEqual(off.minutes, [0, 5, 10, 70]);
  assert.deepEqual(off.percents.map((p) => Math.round(p)), [0, 7, 14, 100]);
});

test('コマが1つでも落ちない', () => {
  const one = buildFrames([obs3[0]], []);
  const off = frameOffsets(one);
  assert.equal(off.totalMin, 0);
  assert.deepEqual(off.percents, [0]);
  assert.deepEqual(frameOffsets([]), { minutes: [], percents: [], totalMin: 0 });
});

test('バーの位置から、いちばん近いコマを選ぶ', () => {
  const frames = buildFrames(obs3, far);
  assert.equal(nearestFrameIndex(frames, 0), 0);
  assert.equal(nearestFrameIndex(frames, 6), 1, '6分の位置は 5分のコマ');
  assert.equal(nearestFrameIndex(frames, 40), 2, '40分の位置は 10分のコマ（次は70分）');
  assert.equal(nearestFrameIndex(frames, 999), 3, '右端を超えたら最後のコマ');
  assert.equal(nearestFrameIndex([], 5), -1);
});

test('目盛りは3時間おきに置く', () => {
  const now = parseJmaTime('20260911011500');
  const frames = [
    { timeMs: now - 180 * 60000, kind: 'obs' },
    { timeMs: now, kind: 'obs', isLatestObs: true },
    { timeMs: now + 840 * 60000, kind: 'fcst' },
  ];
  const ticks = buildTicks(frames);
  assert.deepEqual(ticks.map((t) => t.label), ['3時間前', 'いま', '3時間後', '6時間後', '9時間後', '12時間後']);
});

test('目盛りの位置も時間に比例する', () => {
  const now = parseJmaTime('20260911011500');
  const frames = [
    { timeMs: now - 180 * 60000, kind: 'obs' },
    { timeMs: now, kind: 'obs', isLatestObs: true },
    { timeMs: now + 180 * 60000, kind: 'fcst' },
  ];
  const ticks = buildTicks(frames);   // 全6時間ぶん
  assert.deepEqual(ticks.map((t) => Math.round(t.pct)), [0, 50, 100]);
});

test('目盛りが無いときは空', () => {
  assert.deepEqual(buildTicks([]), []);
  assert.deepEqual(buildTicks(null), []);
});

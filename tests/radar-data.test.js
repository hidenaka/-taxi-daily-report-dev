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

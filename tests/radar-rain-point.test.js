// 時刻バーを「その場所の雨の強さ」で色分けするための材料
//
// 気象庁のタイル画像は、雨の強さが決まった色で塗られている（実測した9段階）。
// 地図の真ん中の1点について、各コマのタイルの色を読めば
// 「何時ごろ、どれくらい降るか」がバーの色で分かる。
import { test } from 'node:test';
import assert from 'node:assert';
import { RAIN_LEVELS, rainLevelFromPixel, pointTile } from '../tools/js/radar-data.js';

test('雨の強さの段は、実測した9段階', () => {
  assert.equal(RAIN_LEVELS.length, 8, '雨ありの8段（雨なしは別）');
  assert.deepEqual(RAIN_LEVELS[0].rgb, [242, 242, 255]);
  assert.deepEqual(RAIN_LEVELS[RAIN_LEVELS.length - 1].rgb, [180, 0, 104]);
  assert.ok(RAIN_LEVELS.every((l) => typeof l.label === 'string' && l.label.length > 0));
});

test('透けている画素は「雨なし」', () => {
  assert.equal(rainLevelFromPixel(0, 0, 0, 0), -1);
  assert.equal(rainLevelFromPixel(160, 210, 255, 0), -1, 'アルファ0ならどんな色でも雨なし');
});

test('実測した色は、そのままその段になる', () => {
  assert.equal(rainLevelFromPixel(242, 242, 255, 255), 0);
  assert.equal(rainLevelFromPixel(160, 210, 255, 255), 1);
  assert.equal(rainLevelFromPixel(33, 140, 255, 255), 2);
  assert.equal(rainLevelFromPixel(0, 65, 255, 255), 3);
  assert.equal(rainLevelFromPixel(250, 245, 0, 255), 4);
  assert.equal(rainLevelFromPixel(255, 153, 0, 255), 5);
  assert.equal(rainLevelFromPixel(255, 40, 0, 255), 6);
  assert.equal(rainLevelFromPixel(180, 0, 104, 255), 7);
});

test('少しずれた色は、いちばん近い段にする', () => {
  // 画像の圧縮や重ね合わせで1〜2ずれることがある
  assert.equal(rainLevelFromPixel(241, 243, 254, 255), 0);
  assert.equal(rainLevelFromPixel(2, 64, 250, 255), 3);
});

test('どの段にも遠い色は「雨なし」にする', () => {
  assert.equal(rainLevelFromPixel(10, 200, 10, 255), -1, '緑はこの表に無い');
});

test('緯度経度から、タイルと画素の位置を出す', () => {
  // 羽田空港 z=10
  const t = pointTile(35.5494, 139.7798, 10);
  assert.equal(t.x, 909);
  assert.equal(t.y, 403);
  assert.ok(t.px >= 0 && t.px < 256);
  assert.ok(t.py >= 0 && t.py < 256);
});

test('タイルの中の位置も出す（端と端で違う）', () => {
  const a = pointTile(35.5494, 139.7798, 10);
  const b = pointTile(35.5494, 139.8798, 10);
  assert.notDeepEqual([a.x, a.px], [b.x, b.px], '経度が違えば位置も違う');
});

test('ズームが違えばタイルも違う', () => {
  const z8 = pointTile(35.5494, 139.7798, 8);
  assert.equal(z8.x, 227);
  assert.equal(z8.y, 100);
});

// --- タップした地点の雨を一言で (2026-09-13 本人要望) -----------------------
// 帯だけだと「で、いつ降るの」が読み取りにくいので、先頭に一言そえる。
import { describeRainTimeline } from '../tools/js/radar-data.js';

const fr = (mins) => mins.map((m, i) => ({
  timeMs: Date.UTC(2026, 8, 13, 0, 0) + m * 60000,
  kind: m <= 0 ? 'obs' : 'fcst',
  isLatestObs: m === 0,
}));

test('いま降っていれば、そう言う', () => {
  const frames = fr([-10, 0, 10, 20]);
  assert.equal(describeRainTimeline([1, 1, 2, 0], frames), 'いま雨（1〜5mm/h）');
});

test('この先で降り出すなら、その時刻を言う', () => {
  const frames = fr([-10, 0, 60, 120]);
  // 基準 2026-09-13T00:00Z = 9時(JST)。+60分のコマは 10時。
  assert.equal(describeRainTimeline([-1, -1, 1, 3], frames), '10時ごろから雨');
});

test('ずっと降らないなら、そう言い切る', () => {
  const frames = fr([-10, 0, 60]);
  assert.equal(describeRainTimeline([-1, -1, -1], frames), 'この先ずっと雨なし');
});

test('過去だけ降っていて、この先降らないなら「雨なし」', () => {
  const frames = fr([-20, -10, 0, 60]);
  assert.equal(describeRainTimeline([2, 1, -1, -1], frames), 'この先ずっと雨なし');
});

test('材料が無ければ空', () => {
  assert.equal(describeRainTimeline([], []), '');
  assert.equal(describeRainTimeline(null, null), '');
});

import { test } from 'node:test';
import assert from 'node:assert';
import { poolSourceNotice, CAMERA_FRESH_MINUTES } from '../tools/js/pool-status-section.js';

// 2026-08-20、羽田の配信元カメラが総入れ替えされ、旧カメラは同日11:26/12:25で更新停止した。
// 表示写真だけ新カメラへ切り替えたので、「写真は最新だが数値は止まっている」状態が生まれる。
// ひとまとめに「映像エラー」と出すと、最新の写真を見ている乗務員が混乱する。

const NOW = Date.parse('2026-08-20T22:40:00+09:00');

test('通常時は警告を出さず、時点だけ出す', () => {
  const r = poolSourceNotice({ generatedAt: '2026-08-20T22:38:00+09:00', sourceStale: false }, NOW);
  assert.equal(r.banner, null);
  assert.equal(r.meta, '📷 22:38時点');
});

test('写真が最新なら「写真は最新・数値は停止中」と分けて伝える', () => {
  const r = poolSourceNotice({
    generatedAt: '2026-08-20T22:39:00+09:00',
    sourceStale: true,
    sourceStaleSince: '2026-08-20T12:25:37+09:00',
    cameraLiveAt: '2026-08-20T22:39:50+09:00',
  }, NOW);
  assert.match(r.banner, /写真は最新（22:39時点）/);
  assert.match(r.banner, /数値の最終更新: 12:25/);
  assert.match(r.banner, /カメラが入れ替わった/);
  assert.equal(r.meta, '📷 写真 22:39時点（数値は更新停止中）');
});

test('写真も古ければ従来どおり映像エラーとして伝える', () => {
  const r = poolSourceNotice({
    generatedAt: '2026-08-20T22:39:00+09:00',
    sourceStale: true,
    sourceStaleSince: '2026-08-20T12:25:37+09:00',
    cameraLiveAt: '2026-08-20T12:25:00+09:00',   // 10時間前 = 写真も止まっている
  }, NOW);
  assert.match(r.banner, /映像にエラーが起こっている/);
  assert.match(r.meta, /映像エラーのため更新停止中/);
});

test('cameraLiveAt が無い古いデータでも落ちない', () => {
  const r = poolSourceNotice({
    generatedAt: '2026-08-20T22:39:00+09:00', sourceStale: true,
  }, NOW);
  assert.match(r.banner, /映像にエラーが起こっている/);
  assert.doesNotMatch(r.banner, /最終更新/, '時刻が無ければ括弧書きを出さない');
});

test('写真が新しいかの境目は30分', () => {
  assert.equal(CAMERA_FRESH_MINUTES, 30);
  const at = (min) => poolSourceNotice({
    generatedAt: '2026-08-20T22:39:00+09:00', sourceStale: true,
    cameraLiveAt: new Date(NOW - min * 60000).toISOString(),
  }, NOW);
  assert.match(at(29).banner, /写真は最新/);
  assert.match(at(31).banner, /映像にエラー/);
});

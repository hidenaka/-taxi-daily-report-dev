import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchWeatherForDate } from '../js/weather.js';

const loc = { lat: 35.55, lon: 139.78 };

test('天気の返事が来なければ、上限の時間で打ち切って先へ進める', async () => {
  // 返事を返さず、中止されたときだけ失敗する通信
  const hang = (_url, { signal }) => new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(new Error('aborted')));
  });
  const t0 = Date.now();
  await assert.rejects(fetchWeatherForDate('2026-11-17', loc, { timeoutMs: 50, fetchImpl: hang }));
  assert.ok(Date.now() - t0 < 1000);
});

test('返事が来れば、これまでどおり4つの時間帯にまとめる', async () => {
  const hourly = { weather_code: Array(48).fill(3), temperature_2m: Array(48).fill(10), precipitation: Array(48).fill(0) };
  const ok = async () => ({ ok: true, json: async () => ({ hourly }) });
  const w = await fetchWeatherForDate('2026-11-17', loc, { fetchImpl: ok });
  assert.equal(w.morning.label, '曇');
  assert.equal(w.night.code, 3);
});

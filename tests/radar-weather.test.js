// 雨雲ページの「天気」パネルの材料づくり（純関数）
//
// データ元は Open-Meteo（このアプリが日報の天気取得で既に使っている。鍵不要）。
// 時間ごとは168時間ぶん(7日)がまとめて返るので、「いまの時刻」から先を切り出す。
// 端末の時計は乗務員の生活時間＝日本時間なので、そのまま使ってよい。
import { test } from 'node:test';
import assert from 'node:assert';
import { weatherUrl, pickHourly, pickDaily, dayLabel } from '../tools/js/radar-weather.js';

const json = {
  hourly: {
    time: ['2026-09-11T10:00', '2026-09-11T11:00', '2026-09-11T12:00', '2026-09-11T13:00'],
    temperature_2m: [20, 21.4, 22, 23],
    precipitation_probability: [10, 70, 80, 5],
    weathercode: [3, 61, 63, 0],
  },
  daily: {
    time: ['2026-09-11', '2026-09-12'],
    weathercode: [61, 0],
    temperature_2m_max: [24.6, 31],
    temperature_2m_min: [18.9, 21.4],
    precipitation_probability_max: [100, 14],
  },
};

test('取得先は場所つきのURLになる', () => {
  const u = weatherUrl(35.6586, 139.7454);
  assert.ok(u.startsWith('https://api.open-meteo.com/v1/forecast?'));
  assert.ok(u.includes('latitude=35.6586'));
  assert.ok(u.includes('longitude=139.7454'));
  assert.ok(u.includes('timezone=Asia%2FTokyo'), '日本時間で返してもらう');
  assert.ok(u.includes('precipitation_probability'));
});

test('いまの時刻から先だけを切り出す', () => {
  const rows = pickHourly(json, new Date('2026-09-11T11:30:00+09:00'), 10);
  assert.equal(rows.length, 3, '11時台・12時・13時');
  assert.equal(rows[0].hour, 11);
  assert.equal(rows[0].isNow, true, 'いま進行中の時間帯');
  assert.equal(rows[1].isNow, false);
});

test('時間ごとの中身', () => {
  const rows = pickHourly(json, new Date('2026-09-11T11:30:00+09:00'), 10);
  assert.equal(rows[0].temp, 21, '気温は小数を丸める');
  assert.equal(rows[0].pop, 70);
  assert.equal(rows[0].code, 61);
  assert.equal(rows[0].date, '2026-09-11');
});

test('見せる時間数は絞れる', () => {
  const rows = pickHourly(json, new Date('2026-09-11T10:00:00+09:00'), 2);
  assert.equal(rows.length, 2);
});

test('データが無くても落ちない', () => {
  assert.deepEqual(pickHourly(null, new Date(), 10), []);
  assert.deepEqual(pickHourly({}, new Date(), 10), []);
  assert.deepEqual(pickDaily(null), []);
});

test('日ごとの中身', () => {
  const days = pickDaily(json);
  assert.equal(days.length, 2);
  assert.equal(days[0].date, '2026-09-11');
  assert.equal(days[0].max, 25, '小数は丸める');
  assert.equal(days[0].min, 19);
  assert.equal(days[0].pop, 100);
  assert.equal(days[0].code, 61);
});

test('日付は「9/12(土)」の形で出す', () => {
  assert.equal(dayLabel('2026-09-12'), '9/12(土)');
  assert.equal(dayLabel('2026-09-11'), '9/11(金)');
  assert.equal(dayLabel(''), '');
});

test('今日は「今日」と出す', () => {
  assert.equal(dayLabel('2026-09-11', new Date('2026-09-11T11:30:00+09:00')), '今日');
  assert.equal(dayLabel('2026-09-12', new Date('2026-09-11T11:30:00+09:00')), '明日');
  assert.equal(dayLabel('2026-09-13', new Date('2026-09-11T11:30:00+09:00')), '9/13(日)');
});

// --- 見出しの一言 (2026-09-11 本人「予報のところみにくい」) ----------------
// 48行の羅列は、読む前に「で、いつ降るの」が分からない。
// 先頭に一言だけ答えを出す。
import { rainStartHint, RAIN_POP } from '../tools/js/radar-weather.js';

const hrs = (pops, startHour = 17) => pops.map((pop, i) => ({
  hour: (startHour + i) % 24, pop, temp: 20, code: 3, isNow: i === 0,
  date: '2026-09-11', time: '',
}));

test('降り出す時間を一言で出す', () => {
  assert.equal(rainStartHint(hrs([10, 20, 40, 70, 80])), '20時ごろから雨が降りやすい');
});

test('いま既に降りやすければ、そう言う', () => {
  assert.equal(rainStartHint(hrs([80, 80, 30])), 'いま雨が降りやすい');
});

test('降りにくい日は、そう言い切る', () => {
  assert.equal(rainStartHint(hrs([0, 5, 10, 20, 30])), 'しばらく雨は降りにくい');
});

test('見る範囲は絞れる', () => {
  // 24時間先までしか見ない（それ以上先の「降る」は今の判断に使えない）
  const long = hrs([...Array(30).fill(10), 90]);
  assert.equal(rainStartHint(long, 24), 'しばらく雨は降りにくい');
});

test('雨とみなす降りやすさ', () => {
  assert.equal(RAIN_POP, 50);
});

test('データが無ければ何も言わない', () => {
  assert.equal(rainStartHint([]), '');
  assert.equal(rainStartHint(null), '');
});

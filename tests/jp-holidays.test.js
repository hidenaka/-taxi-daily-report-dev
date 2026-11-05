import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isHoliday } from '../js/jp-holidays.js';

test('isHoliday: 文化の日・振替休日・国民の休日を含み、平日は含まない', () => {
  assert.equal(isHoliday('2026-11-03'), true);
  assert.equal(isHoliday('2026-09-22'), true);
  assert.equal(isHoliday('2027-03-22'), true);
  assert.equal(isHoliday('2026-11-04'), false);
});

test('集計表は祝日を日曜と同じ赤にして「祝」を付ける', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /\(dow === 0 \|\| isHoliday\(iso\)\) \? 'dow-sun'/);
  assert.match(html, /isHoliday\(d\.date\) \? '<span class="hol-mark">祝<\/span>'/);
});

test('ホームのカレンダーは祝日・日曜の日付を赤、土曜を青にして祝日に「祝」を付ける', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const start = html.indexOf('function renderCalendar(');
  const cal = html.slice(start, html.indexOf('\nfunction formatNextShift(', start));
  assert.match(cal, /\(dow === 0 \|\| holiday\) \? 'day sun' : dow === 6 \? 'day sat'/);
  assert.match(cal, /holiday \? '<span class="hol">祝<\/span>'/);
  assert.doesNotMatch(cal, /<div class="day">/);
});

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

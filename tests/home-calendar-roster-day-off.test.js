import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { test, assert } from './run.js';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(here, '../index.html'), 'utf8');

function renderCalendarSource() {
  const start = html.indexOf('function renderCalendar(drives, range) {');
  const end = html.indexOf('\nfunction formatNextShift(', start);
  assert.notEqual(start, -1, 'renderCalendar must exist');
  assert.notEqual(end, -1, 'renderCalendar must end before formatNextShift');
  return html.slice(start, end);
}

test('home calendar renders automatic roster days off without changing existing states', () => {
  const calendar = renderCalendarSource();

  assert.match(
    html,
    /import\s*{[^}]*\bisRosterDayOff\b[^}]*}\s*from\s*'\.\/js\/planned-shifts\.js';/,
    'imports isRosterDayOff from planned-shifts.js',
  );
  assert.match(calendar, /const driveDates = drives\.map\(d => d\.date\);/, 'derives driveDates once');
  assert.match(
    calendar,
    /const isDayOff = !drive && !isPaid && !isPlanned && isRosterDayOff\(iso, driveDates, plannedSet\);/,
    'checks public holiday eligibility only after actual, paid leave, and planned shifts are absent',
  );

  const actualIndex = calendar.indexOf("cls.push('actual')");
  const paidIndex = calendar.indexOf("cls.push('paid')");
  const plannedIndex = calendar.indexOf("cls.push('planned')");
  const dayOffIndex = calendar.indexOf("cls.push('roster-day-off')");
  assert.ok(actualIndex < paidIndex && paidIndex < plannedIndex && plannedIndex < dayOffIndex, 'keeps actual, paid, planned, then day-off precedence');
  assert.match(calendar, /else if \(isDayOff\) \{\s*cls\.push\('roster-day-off'\);/, 'applies roster-day-off class');
  assert.match(calendar, /else if \(isDayOff\) \{\s*inner = `<div class="day">\$\{day\}<\/div><div class="tag">公休<\/div>`;/, 'renders the 公休 label');

  assert.match(html, /\.cal-cell\.roster-day-off\s*\{[^}]*background:\s*#fff1f1;[^}]*border-color:\s*#e6a7a7;/s, 'has the thin red public-holiday cell style');
  assert.match(html, /\.cal-cell\.roster-day-off \.tag\s*\{[^}]*color:\s*#8f3434;/s, 'has the thin red public-holiday tag style');
  assert.match(html, /公休（自動判定）/, 'includes the automatic public-holiday legend');

  const onclick = calendar.match(/const onclick = [^\n]+;/)?.[0] || '';
  const cursor = calendar.match(/const cursor = [^\n]+;/)?.[0] || '';
  assert.match(onclick, /drive[^\n]*isPlanned \|\| isPaid/, 'keeps click behavior limited to actual, planned, and paid cells');
  assert.match(cursor, /drive \|\| isPlanned \|\| isPaid/, 'keeps pointer cursor limited to actual, planned, and paid cells');
  assert.doesNotMatch(onclick + cursor, /isDayOff/, 'keeps public-holiday cells noninteractive');
});

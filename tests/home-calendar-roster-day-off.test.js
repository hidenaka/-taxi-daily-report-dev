import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { test, assert } from './run.js';
import { isRosterDayOff } from '../js/planned-shifts.js';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(here, '../index.html'), 'utf8');

function renderCalendarSource() {
  const start = html.indexOf('function renderCalendar(drives, range, rosterDriveDates) {');
  const end = html.indexOf('\nfunction formatNextShift(', start);
  assert.notEqual(start, -1, 'renderCalendar must exist');
  assert.notEqual(end, -1, 'renderCalendar must end before formatNextShift');
  return html.slice(start, end);
}

function renderSource() {
  const start = html.indexOf('async function render() {');
  const end = html.indexOf('\nfunction selectedMetricIds()', start);
  assert.notEqual(start, -1, 'render must exist');
  assert.notEqual(end, -1, 'render must end before selectedMetricIds');
  return html.slice(start, end);
}

test('home calendar renders automatic roster days off without changing existing states', () => {
  const calendar = renderCalendarSource();
  const render = renderSource();

  assert.match(
    html,
    /import\s*{[^}]*\bisRosterDayOff\b[^}]*}\s*from\s*'\.\/js\/planned-shifts\.js';/,
    'imports isRosterDayOff from planned-shifts.js',
  );
  assert.match(
    render,
    /const \[rawDrives, previousRosterDrives, nextRosterDrives\] = await Promise\.all\(\[\s*getDrivesForMonth\(viewPeriod\),\s*getDrivesForMonth\(shiftBillingPeriod\(viewPeriod, -1\)\)\.catch\(\(\) => \[\]\),\s*getDrivesForMonth\(shiftBillingPeriod\(viewPeriod, 1\)\)\.catch\(\(\) => \[\]\),\s*\]\);/s,
    'loads current and adjacent billing periods concurrently while only adjacent failures degrade to empty arrays',
  );
  assert.match(
    render,
    /const rosterDriveDates = \[\.\.\.new Set\(\[\.\.\.previousRosterDrives, \.\.\.rawDrives, \.\.\.nextRosterDrives\]\.map\(d => d\.date\)\)\];/,
    'deduplicates previous, current, and next actual dates for roster boundaries',
  );
  assert.match(render, /renderCalendar\(drives, range, rosterDriveDates\);/, 'passes roster evidence separately from current-period drives');
  assert.match(html, /function renderCalendar\(drives, range, rosterDriveDates\) \{/, 'accepts roster boundary dates separately');
  assert.match(calendar, /for \(const d of drives\) driveByDate\[d\.date\] = d;/, 'builds actual cells from current-period drives only');
  assert.match(
    calendar,
    /const isPlanned = plannedSet\.has\(iso\) && iso >= today;/,
    'uses a future-only planned predicate for calendar UI state',
  );
  assert.match(
    calendar,
    /const isDayOff = !drive && !isPaid && !isPlanned\s*&& isRosterDayOff\(iso, rosterDriveDates, plannedSet, today\);/,
    'checks public holiday eligibility using today as the past-plan cutoff',
  );

  const actualIndex = calendar.indexOf("cls.push('actual')");
  const paidIndex = calendar.indexOf("cls.push('paid')");
  const plannedIndex = calendar.indexOf("cls.push('planned')");
  const dayOffIndex = calendar.indexOf("cls.push('roster-day-off')");
  assert.ok(actualIndex < paidIndex && paidIndex < plannedIndex && plannedIndex < dayOffIndex, 'keeps actual, paid, planned, then day-off precedence');
  assert.match(calendar, /else if \(isPlanned\) \{\s*cls\.push\('planned'\);/, 'uses the planned UI predicate for classes');
  assert.match(calendar, /else if \(isPlanned\) \{\s*inner = `<div class="day">\$\{day\}<\/div><div class="tag">予定<\/div>`;/, 'uses the planned UI predicate for labels');
  assert.doesNotMatch(calendar, /isPlanned && iso >= today/, 'does not apply a redundant future check after defining isPlanned');
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

test('adjacent-period actual shifts bound roster days off on the home calendar', () => {
  const rosterDriveDates = ['2026-07-14'];
  const plannedSet = new Set(['2026-07-19']);

  assert.equal(isRosterDayOff('2026-07-15', rosterDriveDates, plannedSet), false, 'the day after an outside-current actual shift is ake');
  assert.equal(isRosterDayOff('2026-07-16', rosterDriveDates, plannedSet), true, 'the first displayed day can be a roster day off');
});

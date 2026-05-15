import { test, assert } from './run.js';
import { readFileSync } from 'node:fs';
import { getOuterRouteOptionsForIc } from '../tools/js/route-options.js';

const icsData = JSON.parse(readFileSync('tools/data/ics.json', 'utf-8'));
const deduction = JSON.parse(readFileSync('tools/data/deduction.json', 'utf-8'));

const entryableIcs = icsData.ics.filter((ic) => ic.entry_type === 'both');
const icById = new Map(icsData.ics.map((ic) => [ic.id, ic]));

const SHUTOKO_ROUTES = new Set([
  '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11',
  'C1', 'C2', 'B', 'Y', 'K1', 'K2', 'K3', 'K5', 'K6', 'K7', 'E',
  '6_mukojima', 'S1',
]);
const OUTER_DIRECTION_IDS = new Set(deduction.directions.map((d) => d.id));

function isShutokoOnly(ic) {
  return SHUTOKO_ROUTES.has(ic.route);
}

// 「物理的にそのICが乗っている外側高速」: IC.route 一致 or baseline_of
function getOwnedDirections(ic) {
  const set = new Set();
  if (OUTER_DIRECTION_IDS.has(ic.route)) set.add(ic.route);
  for (const dir of deduction.directions) {
    if (dir.baseline.ic_id === ic.id) set.add(dir.id);
  }
  return set;
}

test('coverage: 全 入口×出口 ペアで options が返る', () => {
  let totalPairs = 0;
  let validPairs = 0;
  let noneOnly = 0;
  let multiOptions = 0;
  for (const entry of entryableIcs) {
    for (const exit of entryableIcs) {
      if (entry.id === exit.id) continue;
      const opts = getOuterRouteOptionsForIc({ ic: entry, exitIc: exit, deduction });
      totalPairs++;
      if (opts && opts.length > 0) validPairs++;
      if (opts.length === 1 && opts[0] === 'none') noneOnly++;
      if (opts.length > 1) multiOptions++;
    }
  }
  console.log(`[coverage] total: ${totalPairs}, valid: ${validPairs}, noneOnly: ${noneOnly}, multiOptions: ${multiOptions}`);
  assert.equal(totalPairs, validPairs);
});

test('invariant: 候補に含まれる外側高速は、入口/出口どちらかに物理所属している', () => {
  const violations = [];
  for (const entry of entryableIcs) {
    for (const exit of entryableIcs) {
      if (entry.id === exit.id) continue;
      const opts = getOuterRouteOptionsForIc({ ic: entry, exitIc: exit, deduction });
      const owned = new Set([...getOwnedDirections(entry), ...getOwnedDirections(exit)]);
      for (const opt of opts) {
        if (opt === 'none') continue;
        if (!OUTER_DIRECTION_IDS.has(opt)) continue;
        if (!owned.has(opt)) {
          violations.push({
            entry: entry.id, exit: exit.id, opt,
            entryRoute: entry.route, exitRoute: exit.route,
          });
        }
      }
    }
  }
  console.log(`[ownership invariant] violations: ${violations.length}`);
  if (violations.length > 0) {
    console.log('first 10:', JSON.stringify(violations.slice(0, 10), null, 2));
  }
  assert.equal(violations.length, 0, '物理所属していない候補が混入');
});

test('invariant: 入口=首都高内 + 出口=首都高内 では外側高速候補ゼロ', () => {
  const violations = [];
  for (const entry of entryableIcs) {
    if (!isShutokoOnly(entry)) continue;
    for (const exit of entryableIcs) {
      if (entry.id === exit.id) continue;
      if (!isShutokoOnly(exit)) continue;
      const opts = getOuterRouteOptionsForIc({ ic: entry, exitIc: exit, deduction });
      const outerInOpts = opts.filter((o) => OUTER_DIRECTION_IDS.has(o));
      if (outerInOpts.length > 0) {
        violations.push({ entry: entry.id, exit: exit.id, options: opts });
      }
    }
  }
  console.log(`[shutoko-only pairs] violations: ${violations.length}`);
  if (violations.length > 0) {
    console.log('first 5:', JSON.stringify(violations.slice(0, 5), null, 2));
  }
  assert.equal(violations.length, 0);
});

test('regression: 東京IC + 空港中央 で kitasen_route が候補に出ない', () => {
  const tokyo = icById.get('tokyo_ic');
  const haneda = icById.get('kukou_chuou');
  const opts = getOuterRouteOptionsForIc({ ic: tokyo, exitIc: haneda, deduction });
  console.log(`[tokyo→kukou_chuou] options: ${JSON.stringify(opts)}`);
  assert.ok(!opts.includes('kitasen_route'), 'kitasen_route が混入');
  assert.ok(opts.includes('tomei'), 'tomei が含まれない');
});

test('regression: 湾岸環八 + 東京IC で kitasen_route が候補に出ない', () => {
  const wangan = icById.get('wangan_kanpachi');
  const tokyo = icById.get('tokyo_ic');
  const opts = getOuterRouteOptionsForIc({ ic: wangan, exitIc: tokyo, deduction });
  console.log(`[wangan_kanpachi→tokyo_ic] options: ${JSON.stringify(opts)}`);
  assert.ok(!opts.includes('kitasen_route'));
  assert.ok(opts.includes('tomei'));
});

test('regression: 中台(5号線)→空港中央 で外側高速候補ゼロ (両方首都高内)', () => {
  const nakadai = icById.get('nakadai');
  const haneda = icById.get('kukou_chuou');
  const opts = getOuterRouteOptionsForIc({ ic: nakadai, exitIc: haneda, deduction });
  console.log(`[nakadai→kukou_chuou] options: ${JSON.stringify(opts)}`);
  assert.deepEqual(opts, ['none']);
});

test('regression: tamagawa_ic は third_keihin と yokoyoko 両方の起点 (両方候補)', () => {
  const tamagawa = icById.get('tamagawa_ic');
  const kasumi = icById.get('kasumigaseki');
  const opts = getOuterRouteOptionsForIc({ ic: tamagawa, exitIc: kasumi, deduction });
  console.log(`[tamagawa_ic→kasumigaseki] options: ${JSON.stringify(opts)}`);
  assert.ok(opts.includes('third_keihin'));
  assert.ok(opts.includes('yokoyoko'));
});

test('detect: 複数外側高速並列パターン (新方式での残存数)', () => {
  const cases = [];
  for (const entry of entryableIcs) {
    for (const exit of entryableIcs) {
      if (entry.id === exit.id) continue;
      const opts = getOuterRouteOptionsForIc({ ic: entry, exitIc: exit, deduction });
      const outerCount = opts.filter((o) => OUTER_DIRECTION_IDS.has(o)).length;
      if (outerCount >= 2) cases.push({ entry: entry.id, exit: exit.id, options: opts, outerCount });
    }
  }
  cases.sort((a, b) => b.outerCount - a.outerCount);
  console.log(`[multi-outer] cases: ${cases.length}`);
  if (cases.length > 0) {
    console.log('top 10:', JSON.stringify(cases.slice(0, 10), null, 2));
  }
});

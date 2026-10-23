import { test } from 'node:test';
import assert from 'node:assert/strict';
import { laneScene } from '../tools/js/koji-lane-scene.js';

const closedAt = (s) => s.lanes.map((l, i) => (l.closed ? i : -1)).filter((i) => i >= 0);

test('片側だけの工事: 下半分（右へ走る側）の歩道側の車線をふさぐ', () => {
  const s = laneScene({ restrictionType: 'lane_closure', lanesTotal: 4, lanesRestricted: 1, roadSide: '上' });
  assert.equal(s.type, 'lane');
  assert.deepEqual(s.lanes.map((l) => l.dir), [-1, -1, 1, 1]);
  assert.deepEqual(closedAt(s), [3]);
  assert.equal(s.workLabel, '工事中 3車線');
  assert.equal(s.bottomLabel, '上り側');
  assert.equal(s.topLabel, '下り側');
  assert.equal(s.guessed, false);
});

test('両側の工事は上下に分け、「中」があれば中央寄りからふさぐ', () => {
  const both = laneScene({ restrictionType: 'lane_closure', lanesTotal: 4, lanesRestricted: 2, roadSide: '内外' });
  assert.deepEqual(closedAt(both), [0, 3]);
  const mid = laneScene({ restrictionType: 'lane_closure', lanesTotal: 6, lanesRestricted: 2, roadSide: '上中下' });
  assert.deepEqual(closedAt(mid), [2, 3]);
  assert.equal(mid.workLabel, '工事中 4車線');
});

test('片側交互通行・片側1車線の道の規制・通行止め', () => {
  const alt = laneScene({ restrictionType: 'alternating_one_way', lanesTotal: 2, lanesRestricted: 1, roadSide: '上下' });
  assert.equal(alt.type, 'alternating');
  assert.equal(alt.lanes.length, 2);
  const narrow = laneScene({ restrictionType: 'lane_closure', lanesTotal: 2, lanesRestricted: 1, roadSide: '上' });
  assert.equal(narrow.type, 'alternating');
  assert.equal(narrow.guessed, true);
  const closed = laneScene({ restrictionType: 'road_closed', lanesTotal: 4, lanesRestricted: 4, roadSide: '上下' });
  assert.equal(closed.type, 'closed');
  assert.ok(closed.lanes.every((l) => l.closed));
});

test('車線の数が無いときは2車線の目安で描き、目安だと分かるようにする', () => {
  const s = laneScene({ restrictionType: 'lane_closure', roadSide: '上' });
  assert.equal(s.guessed, true);
  assert.ok(s.lanes.length >= 2);
});

test('都のデータの全工事で、絵の並びが作れて、各方向に車が通れる車線が残る', async () => {
  const { readFileSync } = await import('node:fs');
  const F = JSON.parse(readFileSync(new URL('../tools/data/koji.json', import.meta.url), 'utf8')).features;
  for (const f of F) {
    const s = laneScene(f.properties);
    assert.ok(s.lanes.length >= 1 && s.lanes.length <= 8, f.properties.id);
    if (s.type === 'lane') {
      for (const d of [1, -1]) {
        const ls = s.lanes.filter((l) => l.dir === d);
        if (ls.length) assert.ok(ls.some((l) => !l.closed), `${f.properties.id} ${d}`);
      }
    }
  }
});

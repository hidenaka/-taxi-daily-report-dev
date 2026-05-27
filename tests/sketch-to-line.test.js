import { test, assert } from './run.js';
import { buildApproachLine } from '../scripts/lib/sketch-to-line.mjs';

const mainWays = [
  { geometry: [
    { lat: 35.66, lng: 139.72 }, { lat: 35.66, lng: 139.725 },
    { lat: 35.66, lng: 139.73 }, { lat: 35.66, lng: 139.735 }, { lat: 35.66, lng: 139.74 },
  ] },
];
const pin = { lat: 35.658, lng: 139.730 };

test('buildApproachLine: east から進入で東端→pinの最近点まで', () => {
  const line = buildApproachLine({
    semantics: { entry_direction: 'east', turn: null },
    mainWays, turnWays: null, pin,
  });
  assert.ok(line.length >= 2);
  assert.equal(line[0].lng, 139.74);
  assert.ok(Math.abs(line[line.length - 1].lng - 139.73) < 1e-6);
});

test('buildApproachLine: west から進入で西端→pinの最近点まで', () => {
  const line = buildApproachLine({
    semantics: { entry_direction: 'west', turn: null },
    mainWays, turnWays: null, pin,
  });
  assert.equal(line[0].lng, 139.72);
  assert.ok(Math.abs(line[line.length - 1].lng - 139.73) < 1e-6);
});

test('buildApproachLine: mainWays 空なら空配列', () => {
  const line = buildApproachLine({ semantics: { entry_direction: 'east' }, mainWays: [], pin });
  assert.deepEqual(line, []);
});

test('buildApproachLine: turn + turnWays で道路Bに繋がる', () => {
  const turnWays = [
    { geometry: [
      { lat: 35.66, lng: 139.735 }, { lat: 35.659, lng: 139.735 },
      { lat: 35.658, lng: 139.735 }, { lat: 35.657, lng: 139.735 },
    ] },
  ];
  const line = buildApproachLine({
    semantics: { entry_direction: 'east', turn: 'right' },
    mainWays, turnWays, pin,
  });
  assert.ok(line.length >= 3);
  assert.equal(line[0].lng, 139.74);
  const hasJunction = line.some((p) => Math.abs(p.lat - 35.66) < 1e-6 && Math.abs(p.lng - 139.735) < 1e-6);
  assert.ok(hasJunction, 'junction point should be in line');
});

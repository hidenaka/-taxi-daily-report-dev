import { test, assert } from './run.js';
import { airlineToColorKey, AIRLINE_COLORS } from '../tools/js/airline-color.js';

test('airlineToColorKey: 主要キャリアを返す', () => {
  assert.equal(airlineToColorKey('JAL'), 'jal');
  assert.equal(airlineToColorKey('ANA'), 'ana');
  assert.equal(airlineToColorKey('JJP'), 'jjp');
  assert.equal(airlineToColorKey('SKY'), 'sky');
  assert.equal(airlineToColorKey('ADO'), 'ado');
  assert.equal(airlineToColorKey('SNA'), 'sna');
  assert.equal(airlineToColorKey('SFJ'), 'sfj');
});

test('airlineToColorKey: 未知のキャリアは other', () => {
  assert.equal(airlineToColorKey('XYZ'), 'other');
  assert.equal(airlineToColorKey(''), 'other');
  assert.equal(airlineToColorKey(null), 'other');
  assert.equal(airlineToColorKey(undefined), 'other');
});

test('AIRLINE_COLORS: 全キーに hex 色が定義されている', () => {
  for (const key of ['jal', 'ana', 'jjp', 'sky', 'ado', 'sna', 'sfj', 'other']) {
    assert.match(AIRLINE_COLORS[key], /^#[0-9a-f]{6}$/i, `${key} は hex 色`);
  }
});

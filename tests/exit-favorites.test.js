import { test, assert } from './run.js';
import {
  seedFavorites, loadFavorites, addFavorite, removeFavorite, moveToIndex, saveFavorites, EXIT_FAVORITES_KEY,
} from '../tools/js/exit-favorites.js';

function fakeStorage(initial = {}) {
  const m = new Map(Object.entries(initial));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    _raw: (k) => (m.has(k) ? m.get(k) : null),
  };
}

test('seedFavorites: defaults を保存して配列を返す', () => {
  const s = fakeStorage();
  const out = seedFavorites(['a', 'b'], s);
  assert.deepEqual(out, ['a', 'b']);
  assert.deepEqual(JSON.parse(s._raw(EXIT_FAVORITES_KEY)), ['a', 'b']);
});

test('loadFavorites: 未存在なら defaults でseed', () => {
  const s = fakeStorage();
  assert.deepEqual(loadFavorites(['x'], s), ['x']);
  assert.deepEqual(loadFavorites(['y'], s), ['x']);
});

test('loadFavorites: 保存済みを優先して返す', () => {
  const s = fakeStorage({ [EXIT_FAVORITES_KEY]: JSON.stringify(['p', 'q']) });
  assert.deepEqual(loadFavorites(['z'], s), ['p', 'q']);
});

test('loadFavorites: 破損JSONは defaults にフォールバック', () => {
  const s = fakeStorage({ [EXIT_FAVORITES_KEY]: '{not json' });
  assert.deepEqual(loadFavorites(['d'], s), ['d']);
});

test('loadFavorites: 配列でない値は defaults にフォールバック', () => {
  const s = fakeStorage({ [EXIT_FAVORITES_KEY]: JSON.stringify({ foo: 1 }) });
  assert.deepEqual(loadFavorites(['d'], s), ['d']);
});

test('addFavorite: 末尾に追加（純関数・元配列を変更しない）', () => {
  const base = ['a'];
  const out = addFavorite(base, 'b');
  assert.deepEqual(out, ['a', 'b']);
  assert.deepEqual(base, ['a']);
});

test('addFavorite: 重複は追加しない', () => {
  assert.deepEqual(addFavorite(['a', 'b'], 'a'), ['a', 'b']);
});

test('addFavorite: 空/null icId は無視', () => {
  assert.deepEqual(addFavorite(['a'], ''), ['a']);
  assert.deepEqual(addFavorite(['a'], null), ['a']);
});

test('removeFavorite: 該当を除去（純関数）', () => {
  const base = ['a', 'b', 'c'];
  assert.deepEqual(removeFavorite(base, 'b'), ['a', 'c']);
  assert.deepEqual(base, ['a', 'b', 'c']);
});

test('removeFavorite: 空配列も許容', () => {
  assert.deepEqual(removeFavorite(['a'], 'a'), []);
});

test('saveFavorites: localStorage へ永続化', () => {
  const s = fakeStorage();
  saveFavorites(['m', 'n'], s);
  assert.deepEqual(JSON.parse(s._raw(EXIT_FAVORITES_KEY)), ['m', 'n']);
});

test('seedFavorites: defaults内の非文字列を除外する', () => {
  const s = fakeStorage();
  assert.deepEqual(seedFavorites([1, 'a', null, 'b'], s), ['a', 'b']);
});

test('loadFavorites: getItem が例外を投げても defaults でseed', () => {
  const s = {
    getItem: () => { throw new Error('SecurityError'); },
    setItem: () => {},
  };
  assert.deepEqual(loadFavorites(['d'], s), ['d']);
});

test('saveFavorites: setItem が例外を投げても落ちず list を返す', () => {
  const s = { setItem: () => { throw new Error('QuotaExceeded'); } };
  assert.deepEqual(saveFavorites(['m'], s), ['m']);
});

test('moveToIndex: 先頭を末尾へ移動・元配列不変', () => {
  const base = ['a', 'b', 'c'];
  assert.deepEqual(moveToIndex(base, 'a', 2), ['b', 'c', 'a']);
  assert.deepEqual(base, ['a', 'b', 'c']);
});

test('moveToIndex: 末尾を先頭へ移動', () => {
  assert.deepEqual(moveToIndex(['a', 'b', 'c'], 'c', 0), ['c', 'a', 'b']);
});

test('moveToIndex: 中間へ移動', () => {
  assert.deepEqual(moveToIndex(['a', 'b', 'c', 'd'], 'd', 1), ['a', 'd', 'b', 'c']);
});

test('moveToIndex: 範囲外indexはクランプ', () => {
  assert.deepEqual(moveToIndex(['a', 'b', 'c'], 'a', 99), ['b', 'c', 'a']);
  assert.deepEqual(moveToIndex(['a', 'b', 'c'], 'c', -5), ['c', 'a', 'b']);
});

test('moveToIndex: 未存在icIdは変更なし', () => {
  assert.deepEqual(moveToIndex(['a', 'b'], 'z', 0), ['a', 'b']);
});

import { test, assert } from './run.js';
import { generateSlug, isAnonymizedSlug, isLegacySlug } from '../js/slug-gen.js';

// 確定的テスト用の固定 rng（連続値を順に返す）
function makeFixedRng(values) {
  let i = 0;
  return () => values[i++ % values.length];
}

// generateSlug

test('generateSlug: デフォルトは co-XXXXXX 形式（6文字 body）', () => {
  const slug = generateSlug(undefined, undefined, makeFixedRng([0, 0, 0, 0, 0, 0]));
  assert.equal(slug, 'co-000000');
});

test('generateSlug: rng で末尾近い値を渡すと末尾文字が使われる', () => {
  // ALPHABET の最後（i=31）の文字は z（Crockford lowercase）
  const slug = generateSlug(undefined, undefined, makeFixedRng([0.999, 0.999, 0.999, 0.999, 0.999, 0.999]));
  assert.equal(slug, 'co-zzzzzz');
});

test('generateSlug: カスタムプレフィックスを使える', () => {
  const slug = generateSlug('client-', 4, makeFixedRng([0, 0, 0, 0]));
  assert.equal(slug, 'client-0000');
});

test('generateSlug: カスタム長さで body が変わる', () => {
  const slug = generateSlug('co-', 8, makeFixedRng([0, 0, 0, 0, 0, 0, 0, 0]));
  assert.equal(slug, 'co-00000000');
});

test('generateSlug: length < 4 は throw', () => {
  assert.throws(() => generateSlug('co-', 3), /length must be >= 4/);
});

test('generateSlug: Math.random デフォルトでも generation できる（形式チェックのみ）', () => {
  const slug = generateSlug();
  assert.match(slug, /^co-[0-9a-hjkmnp-tv-z]{6}$/);
});

test('generateSlug: i / l / o / u は出ない（Crockford 除外）', () => {
  // 100 回引いて i, l, o, u が出ないこと（確率的に十分）
  for (let i = 0; i < 100; i++) {
    const slug = generateSlug();
    assert.equal(/[ilou]/.test(slug.slice(3)), false, `slug "${slug}" にCrockford除外文字`);
  }
});

// isAnonymizedSlug

test('isAnonymizedSlug: co-XXXXXX を true 判定', () => {
  assert.equal(isAnonymizedSlug('co-a3f7b2'), true);
  assert.equal(isAnonymizedSlug('co-000000'), true);
  assert.equal(isAnonymizedSlug('co-zzzzzz'), true);
});

test('isAnonymizedSlug: ローマ字 slug は false', () => {
  assert.equal(isAnonymizedSlug('keiho'), false);
  assert.equal(isAnonymizedSlug('my-company'), false);
});

test('isAnonymizedSlug: co- なし は false', () => {
  assert.equal(isAnonymizedSlug('a3f7b2'), false);
});

test('isAnonymizedSlug: co- だが除外文字を含むと false', () => {
  assert.equal(isAnonymizedSlug('co-ilou00'), false); // Crockford 除外文字
});

test('isAnonymizedSlug: null / 空文字 / non-string は false', () => {
  assert.equal(isAnonymizedSlug(null), false);
  assert.equal(isAnonymizedSlug(''), false);
  assert.equal(isAnonymizedSlug(undefined), false);
  assert.equal(isAnonymizedSlug(123), false);
});

test('isAnonymizedSlug: 7文字以上の body も受理（将来拡張用）', () => {
  assert.equal(isAnonymizedSlug('co-a3f7b2c'), true);
});

// isLegacySlug

test('isLegacySlug: ローマ字 slug を true 判定', () => {
  assert.equal(isLegacySlug('keiho'), true);
  assert.equal(isLegacySlug('my-company'), true);
});

test('isLegacySlug: 匿名化 slug (co-XXXXXX) は false', () => {
  assert.equal(isLegacySlug('co-a3f7b2'), false);
});

test('isLegacySlug: 形式不正 slug は false', () => {
  assert.equal(isLegacySlug('Bad Slug!'), false);
  assert.equal(isLegacySlug('1starts-digit'), false);
  assert.equal(isLegacySlug(null), false);
});

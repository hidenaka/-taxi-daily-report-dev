import { test, assert } from './run.js';
import {
  captureInviteSlug,
  loadInviteSlug,
  clearInviteSlug,
  validateInviteSlug,
  loadReferrer,
} from '../js/invite-url.js';

function makeStorage(initial = {}) {
  const data = { ...initial };
  return {
    setItem: (k, v) => { data[k] = String(v); },
    getItem: (k) => (k in data ? data[k] : null),
    removeItem: (k) => { delete data[k]; },
    _data: data,
  };
}

// captureInviteSlug

test('captureInviteSlug: 正常 slug を storage に保存し slug を返す', () => {
  const storage = makeStorage();
  const params = new URLSearchParams('?company=keiho');
  const result = captureInviteSlug(params, storage);
  assert.equal(result, 'keiho');
  assert.equal(storage._data.taxi_pending_company, 'keiho');
});

test('captureInviteSlug: company クエリ無し → null・storage 触らず', () => {
  const storage = makeStorage();
  const params = new URLSearchParams('?other=foo');
  const result = captureInviteSlug(params, storage);
  assert.equal(result, null);
  assert.equal(storage._data.taxi_pending_company, undefined);
});

test('captureInviteSlug: 不正文字を含む slug は拒否（null・storage 触らず）', () => {
  const storage = makeStorage();
  const params = new URLSearchParams('?company=Bad Slug!');
  const result = captureInviteSlug(params, storage);
  assert.equal(result, null);
  assert.equal(storage._data.taxi_pending_company, undefined);
});

test('captureInviteSlug: 大文字始まりは拒否（slug は小文字始まり前提）', () => {
  const storage = makeStorage();
  const params = new URLSearchParams('?company=Keiho');
  const result = captureInviteSlug(params, storage);
  assert.equal(result, null);
});

test('captureInviteSlug: 既存値がある時、正常 slug で上書き', () => {
  const storage = makeStorage({ taxi_pending_company: 'old-slug' });
  const params = new URLSearchParams('?company=new-slug');
  const result = captureInviteSlug(params, storage);
  assert.equal(result, 'new-slug');
  assert.equal(storage._data.taxi_pending_company, 'new-slug');
});

test('captureInviteSlug: ハイフン・アンダースコア・数字を含む slug を受理', () => {
  const storage = makeStorage();
  const params = new URLSearchParams('?company=my-co_2');
  assert.equal(captureInviteSlug(params, storage), 'my-co_2');
});

// loadInviteSlug

test('loadInviteSlug: 保存済み slug を返す', () => {
  const storage = makeStorage({ taxi_pending_company: 'keiho' });
  assert.equal(loadInviteSlug(storage), 'keiho');
});

test('loadInviteSlug: 未保存 → null', () => {
  const storage = makeStorage();
  assert.equal(loadInviteSlug(storage), null);
});

test('loadInviteSlug: 不正値が入っていたら null（防御的）', () => {
  const storage = makeStorage({ taxi_pending_company: 'Bad Slug!' });
  assert.equal(loadInviteSlug(storage), null);
});

// clearInviteSlug

test('clearInviteSlug: 保存値を削除する', () => {
  const storage = makeStorage({ taxi_pending_company: 'keiho' });
  clearInviteSlug(storage);
  assert.equal(storage._data.taxi_pending_company, undefined);
});

// validateInviteSlug

test('validateInviteSlug: slug 存在 → true', async () => {
  const fetcher = async (slug) => slug === 'keiho';
  assert.equal(await validateInviteSlug('keiho', fetcher), true);
});

test('validateInviteSlug: slug 不存在 → false', async () => {
  const fetcher = async () => false;
  assert.equal(await validateInviteSlug('unknown', fetcher), false);
});

test('validateInviteSlug: slug が null → false（fetcher 呼ばず）', async () => {
  let called = false;
  const fetcher = async () => { called = true; return true; };
  assert.equal(await validateInviteSlug(null, fetcher), false);
  assert.equal(called, false);
});

test('validateInviteSlug: fetcher が throw → false', async () => {
  const fetcher = async () => { throw new Error('network down'); };
  assert.equal(await validateInviteSlug('keiho', fetcher), false);
});

// referrer (ref クエリ) のテスト

test('captureInviteSlug: company + ref 正常 → 両方保存', () => {
  const storage = makeStorage();
  const params = new URLSearchParams('?company=keiho&ref=taro_san');
  const result = captureInviteSlug(params, storage);
  assert.equal(result, 'keiho');
  assert.equal(storage._data.taxi_pending_company, 'keiho');
  assert.equal(storage._data.taxi_pending_referrer, 'taro_san');
});

test('captureInviteSlug: company 無し + ref あり → 何も保存しない（ref も依存）', () => {
  const storage = makeStorage();
  const params = new URLSearchParams('?ref=taro');
  assert.equal(captureInviteSlug(params, storage), null);
  assert.equal(storage._data.taxi_pending_referrer, undefined);
});

test('captureInviteSlug: company OK + ref が不正形式 → company のみ保存', () => {
  const storage = makeStorage();
  const params = new URLSearchParams('?company=keiho&ref=Bad User!');
  assert.equal(captureInviteSlug(params, storage), 'keiho');
  assert.equal(storage._data.taxi_pending_referrer, undefined);
});

test('captureInviteSlug: ref が大文字始まり → 拒否', () => {
  const storage = makeStorage();
  const params = new URLSearchParams('?company=keiho&ref=Taro');
  captureInviteSlug(params, storage);
  assert.equal(storage._data.taxi_pending_referrer, undefined);
});

test('loadReferrer: 保存済み ref を返す', () => {
  const storage = makeStorage({ taxi_pending_referrer: 'jiro' });
  assert.equal(loadReferrer(storage), 'jiro');
});

test('loadReferrer: 未保存 → null', () => {
  assert.equal(loadReferrer(makeStorage()), null);
});

test('loadReferrer: 不正値 → null', () => {
  const storage = makeStorage({ taxi_pending_referrer: 'Bad!' });
  assert.equal(loadReferrer(storage), null);
});

test('clearInviteSlug: company と ref を同時に削除', () => {
  const storage = makeStorage({ taxi_pending_company: 'keiho', taxi_pending_referrer: 'taro' });
  clearInviteSlug(storage);
  assert.equal(storage._data.taxi_pending_company, undefined);
  assert.equal(storage._data.taxi_pending_referrer, undefined);
});

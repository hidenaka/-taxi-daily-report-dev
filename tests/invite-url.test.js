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

test('captureInviteSlug: company + 数字始まり ref 正常 → 両方保存', () => {
  const storage = makeStorage();
  const params = new URLSearchParams('?company=keiho&ref=123driver');
  const result = captureInviteSlug(params, storage);
  assert.equal(result, 'keiho');
  assert.equal(storage._data.taxi_pending_company, 'keiho');
  assert.equal(storage._data.taxi_pending_referrer, '123driver');
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

test('loadReferrer: 数字始まり ref を返す', () => {
  const storage = makeStorage({ taxi_pending_referrer: '123driver' });
  assert.equal(loadReferrer(storage), '123driver');
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

import { buildCompanyInviteUrl } from '../js/invite-url.js';

test('buildCompanyInviteUrl: ref ありで &ref=<id> 付与', () => {
  assert.equal(
    buildCompanyInviteUrl('co-7q7ros', 'https://app.taxicabis.com', 'driver_a1b2'),
    'https://app.taxicabis.com/?company=co-7q7ros&ref=driver_a1b2'
  );
});

test('buildCompanyInviteUrl: ref なし(null/undefined/空文字)で &ref なし', () => {
  const expected = 'https://app.taxicabis.com/?company=co-7q7ros';
  assert.equal(buildCompanyInviteUrl('co-7q7ros', 'https://app.taxicabis.com'), expected);
  assert.equal(buildCompanyInviteUrl('co-7q7ros', 'https://app.taxicabis.com', null), expected);
  assert.equal(buildCompanyInviteUrl('co-7q7ros', 'https://app.taxicabis.com', ''), expected);
});

test('buildCompanyInviteUrl: 特殊文字を encodeURIComponent', () => {
  assert.equal(
    buildCompanyInviteUrl('co-7q7ros', 'https://app.taxicabis.com', 'a&b'),
    'https://app.taxicabis.com/?company=co-7q7ros&ref=a%26b'
  );
});

import { shouldRedirectInviteToSignup, buildSignupRedirectUrl } from '../js/invite-url.js';

// shouldRedirectInviteToSignup: 招待リンク(?company=)を未登録者が踏んだら登録ページへ直行
test('shouldRedirectInviteToSignup: company あり + 未登録 → true', () => {
  assert.equal(shouldRedirectInviteToSignup(true, false), true);
});

test('shouldRedirectInviteToSignup: company あり + 登録済み(メール認証) → false（ホーム維持）', () => {
  assert.equal(shouldRedirectInviteToSignup(true, true), false);
});

test('shouldRedirectInviteToSignup: company 無し → false（通常アクセスはホーム）', () => {
  assert.equal(shouldRedirectInviteToSignup(false, false), false);
  assert.equal(shouldRedirectInviteToSignup(false, true), false);
});

// 既存ユーザー保護（回帰防止）: 過去に招待 slug を保存しただけの既存ユーザーが、
// 通常起動（?company= 無し）でアプリを開いたときに登録ページへ飛ばされてはならない。
// 第1引数は「今の URL に ?company= があるか」であって、保存済み slug の有無ではない。
test('shouldRedirectInviteToSignup: 保存済み slug あるが company param 無し → false（既存ユーザーはホーム）', () => {
  // 通常起動では hasCompanyParam=false。未登録(匿名)でもホーム維持。
  assert.equal(shouldRedirectInviteToSignup(false, false), false);
});

// 既にローカルにアカウント/データを持つ既存ユーザーは、招待リンクを再度踏んでも
// 自分のデータから引き剥がさない（データ保護・第3引数 isExistingLocalUser）。
test('shouldRedirectInviteToSignup: company あり + 未登録 + 既存ローカルデータあり → false（データ保護）', () => {
  assert.equal(shouldRedirectInviteToSignup(true, false, true), false);
});

test('shouldRedirectInviteToSignup: company あり + 未登録 + 既存データ無し → true（新規見込み客）', () => {
  assert.equal(shouldRedirectInviteToSignup(true, false, false), true);
});

// buildSignupRedirectUrl: 登録フォームへ company/ref を引き継いで遷移
test('buildSignupRedirectUrl: slug + ref → mode=signup&company&ref', () => {
  assert.equal(
    buildSignupRedirectUrl('co-swyg3o', 'user_self'),
    'login.html?mode=signup&company=co-swyg3o&ref=user_self'
  );
});

test('buildSignupRedirectUrl: ref なし → mode=signup&company のみ', () => {
  const expected = 'login.html?mode=signup&company=co-swyg3o';
  assert.equal(buildSignupRedirectUrl('co-swyg3o'), expected);
  assert.equal(buildSignupRedirectUrl('co-swyg3o', null), expected);
  assert.equal(buildSignupRedirectUrl('co-swyg3o', ''), expected);
});

import { test, assert } from './run.js';
import { isSampleGuestUserId, resolveAuthBadge, SAMPLE_GUEST_USER_ID } from '../js/auth-state.js';

test('isSampleGuestUserId: user_sample / 空 は既定ゲスト', () => {
  assert.equal(isSampleGuestUserId('user_sample'), true);
  assert.equal(isSampleGuestUserId(''), true);
  assert.equal(isSampleGuestUserId(null), true);
  assert.equal(isSampleGuestUserId(undefined), true);
});

test('isSampleGuestUserId: 実 userId は既定ゲストでない', () => {
  assert.equal(isSampleGuestUserId('kohkuma1976'), false);
  assert.equal(isSampleGuestUserId('user_self'), false);
});

test('resolveAuthBadge: メール認証中は「ログイン中」', () => {
  const r = resolveAuthBadge({ emailAuthed: true, myId: 'kohkuma1976' });
  assert.equal(r.kind, 'login');
  assert.equal(r.text, 'ログイン中');
  assert.equal(r.showLogout, true);
  assert.equal(r.showLoginForm, false);
});

test('resolveAuthBadge: view-as 中は admin閲覧として最優先で表示', () => {
  // view-as は emailAuthed/myId より優先。admin が自分のメールでログインしたまま対象を閲覧。
  const r = resolveAuthBadge({ emailAuthed: true, myId: 'kohkuma1976', viewAs: 'kohkuma1976' });
  assert.equal(r.kind, 'viewing-admin');
  assert.equal(r.text, 'kohkuma1976 を閲覧中（管理者）');
  assert.equal(r.showExitViewAs, true);
  assert.equal(r.showLoginForm, false);
  assert.equal(r.showLogout, false);
});

test('resolveAuthBadge: view-as 無しなら従来どおり', () => {
  const r = resolveAuthBadge({ emailAuthed: true, myId: 'taro', viewAs: null });
  assert.equal(r.kind, 'login');
  assert.equal(r.showExitViewAs, false);
});

test('resolveAuthBadge: admin強制切替の閲覧(匿名+実userId)は「サンプル」にしない', () => {
  // これが今回の修正の核: 匿名セッションでも実 userId を見ているならサンプル扱い禁止。
  const r = resolveAuthBadge({ emailAuthed: false, myId: 'kohkuma1976' });
  assert.equal(r.kind, 'viewing');
  assert.equal(r.text, 'kohkuma1976 のデータを表示中');
  assert.equal(r.showLoginForm, false); // 閲覧中はログイン誘導を出さない
  // 匿名で実データ表示中でも「ログアウト」で抜けられる（出口が無いと別アカウントに切替できない）
  assert.equal(r.showLogout, true);
});

test('resolveAuthBadge: 既定ゲストのみ「サンプルデータ（ログインしてください）」', () => {
  const r = resolveAuthBadge({ emailAuthed: false, myId: SAMPLE_GUEST_USER_ID });
  assert.equal(r.kind, 'sample');
  assert.equal(r.text, 'サンプルデータ（ログインしてください）');
  assert.equal(r.showLoginForm, true);
});

test('resolveAuthBadge: myId 未設定(空)も既定ゲスト扱い', () => {
  const r = resolveAuthBadge({ emailAuthed: false, myId: null });
  assert.equal(r.kind, 'sample');
});

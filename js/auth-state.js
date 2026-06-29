// auth-state.js — 認証バッジ表示の純粋な判定ロジック（UI/SDK 非依存・テスト可能）。
//
// 背景: admin強制切替の「なりすまし閲覧」は匿名セッションだが taxi_user_id=対象 を持ち、
// 実データ(drives/{userId})を表示している。これを「サンプルデータ（ログインしてください）」
// と誤表示しないよう、バッジは「匿名か否か」ではなく「実 userId のデータを見ているか」で
// 判定する。

// 既定ゲスト（サンプル）の userId。これを見ている時だけ「サンプルデータ」と表示する。
export const SAMPLE_GUEST_USER_ID = 'user_sample';

// 既定ゲスト（サンプル）を見ているか。
export function isSampleGuestUserId(myId) {
  return !myId || myId === SAMPLE_GUEST_USER_ID;
}

// バッジ状態を決める純関数。
//   emailAuthed: メール認証でログイン中か
//   myId:        現在表示中の userId（currentUserId || localStorage.taxi_user_id）
// 戻り値 kind: 'login'（メール認証） | 'viewing'（実データ閲覧・匿名） | 'sample'（既定ゲスト）
export function resolveAuthBadge({ emailAuthed, myId }) {
  if (emailAuthed) {
    return { kind: 'login', text: 'ログイン中', showLoginForm: false, showLogout: true };
  }
  if (!isSampleGuestUserId(myId)) {
    return { kind: 'viewing', text: `${myId} のデータを表示中`, showLoginForm: true, showLogout: false };
  }
  return { kind: 'sample', text: 'サンプルデータ（ログインしてください）', showLoginForm: true, showLogout: false };
}

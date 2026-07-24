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
//   myId:        現在表示中の userId（getUserId() = view-as中なら対象, それ以外は本人）
//   viewAs:      管理者の閲覧(view-as)対象 userId（無ければ null/undefined）
// 戻り値 kind: 'viewing-admin'（admin閲覧） | 'login'（メール認証） | 'viewing'（匿名で実データ） | 'sample'
export function resolveAuthBadge({ emailAuthed, myId, viewAs } = {}) {
  if (viewAs) {
    // 管理者の閲覧中。ログイン誘導は出さず「自分に戻る」を出す。
    return { kind: 'viewing-admin', text: `${viewAs} を閲覧中（管理者）`, showLoginForm: false, showLogout: false, showExitViewAs: true };
  }
  if (emailAuthed) {
    return { kind: 'login', text: 'ログイン中', showLoginForm: false, showLogout: true, showExitViewAs: false };
  }
  if (!isSampleGuestUserId(myId)) {
    // 匿名だが実 userId のデータを表示中（旧来の挙動・保険）。ログイン誘導は出さないが、
    // この状態から抜ける出口としてログアウトは出す（無いと別アカウントへ切り替えられない）。
    return { kind: 'viewing', text: `${myId} のデータを表示中`, showLoginForm: false, showLogout: true, showExitViewAs: false };
  }
  return { kind: 'sample', text: 'サンプルデータ（ログインしてください）', showLoginForm: true, showLogout: false, showExitViewAs: false };
}

// 初回行動カードの表示判定。日報が1件も無い新規ユーザーにのみ true。
import { SAMPLE_GUEST_USER_ID } from './auth-state.js';

export function shouldShowFirstRunCard({ hasAnyDrive }) {
  return hasAnyDrive === false;
}

// 「この端末に既存データあり」印(cabis_has_drive)を保存してよいかの判定。
// サンプル(user_sample)閲覧中の件数で印を付けると、招待リンクで来た新規訪問者の端末が
// 「既存ユーザー」と誤認され signup リダイレクトが抑止される（招待リンクを開き直すと
// user_sample のホームに着地してしまう不具合の真因）。実ユーザーのデータのみ印を付ける。
export function shouldMarkHasDrive({ myUserId, driveCount }) {
  return driveCount > 0 && !!myUserId && myUserId !== SAMPLE_GUEST_USER_ID;
}

// 招待リダイレクト保護の「この端末の既存ユーザー」判定。
// storage: Web Storage 互換 (`.getItem(k)`)
// 印(cabis_has_drive)があっても taxi_user_id がサンプルのままなら実ユーザーではない
// （shouldMarkHasDrive 導入前に誤保存された端末もここで自己修復される）。
export function isExistingLocalRealUser(storage) {
  if (storage.getItem('cabis_has_drive') !== '1') return false;
  const uid = storage.getItem('taxi_user_id');
  return !!uid && uid !== SAMPLE_GUEST_USER_ID;
}

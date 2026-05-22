// 初回行動カードの表示判定。日報が1件も無い新規ユーザーにのみ true。
export function shouldShowFirstRunCard({ hasAnyDrive }) {
  return hasAnyDrive === false;
}

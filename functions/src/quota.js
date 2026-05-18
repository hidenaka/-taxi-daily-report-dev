// functions/src/quota.js
// ユーザー別の1日あたりOCR利用上限。Firestore `ocrUsage/{uid}` に {date,count} を保持。
// オーナーのAPIキー（＝Cloud Function）を全ドライバーが共有するため、1人が
// 過去日報を大量登録するなどで暴走しないよう、サーバー側で回数を数えて止める。
// 自前OCR（AI API不使用）のため画像課金はゼロだが、計算コストの暴走を防ぐ。
import { getFirestore, FieldValue } from "firebase-admin/firestore";

// 通常の日報は1日1回。リトライ・複数日まとめ等を許容しつつ暴走を止める値。
const DAILY_LIMIT = 20;

// 日本時間の YYYY-MM-DD（UTC+9）。上限は日本の暦日でリセットする。
function todayJst() {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

/**
 * uid の本日の利用回数が上限未満なら count を1増やして true。超過なら false。
 * トランザクションで増分するため同時実行でも数え漏れ・過剰加算しない。
 * @param {string} uid
 * @returns {Promise<boolean>}
 */
export async function consumeQuota(uid) {
  const db = getFirestore();
  const ref = db.collection("ocrUsage").doc(uid);
  const today = todayJst();
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? snap.data() : {};
    const count = data.date === today ? data.count || 0 : 0;
    if (count >= DAILY_LIMIT) return false;
    tx.set(ref, {
      date: today,
      count: count + 1,
      updatedAt: FieldValue.serverTimestamp(),
    });
    return true;
  });
}

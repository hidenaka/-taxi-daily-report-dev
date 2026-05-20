// functions/src/quota.js
// ユーザー別の1日あたりOCR利用上限。Firestore `ocrUsage/{uid}` に {date,count} を保持。
// オーナーのAPIキー（＝Cloud Function）を全ドライバーが共有するため、1人が
// 過去日報を大量登録するなどで暴走しないよう、サーバー側で回数を数えて止める。
// 自前OCR（AI API不使用）のため画像課金はゼロだが、計算コストの暴走を防ぐ。
import { getFirestore, FieldValue } from "firebase-admin/firestore";

// 通常の日報は1日1回。リトライ・複数日まとめ・過去分の一括取込等を許容しつつ
// 暴走を止める値。100枚なら半年分の日報を1日で取り込める。
export const DAILY_LIMIT = 100;

// 日本時間の YYYY-MM-DD（UTC+9）。上限は日本の暦日でリセットする。
function todayJst() {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

/**
 * uid の本日の利用回数が上限未満なら count を1増やして残り回数を返す。
 * 超過時は ok=false と remaining=0 を返し、呼び出し元で 429 を返却する。
 * トランザクションで増分するため同時実行でも数え漏れ・過剰加算しない。
 * @param {string} uid
 * @returns {Promise<{ok: boolean, remaining: number, limit: number}>}
 */
export async function consumeQuota(uid) {
  const db = getFirestore();
  const ref = db.collection("ocrUsage").doc(uid);
  const today = todayJst();
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? snap.data() : {};
    const count = data.date === today ? data.count || 0 : 0;
    if (count >= DAILY_LIMIT) {
      return { ok: false, remaining: 0, limit: DAILY_LIMIT };
    }
    const nextCount = count + 1;
    tx.set(ref, {
      date: today,
      count: nextCount,
      updatedAt: FieldValue.serverTimestamp(),
    });
    return { ok: true, remaining: DAILY_LIMIT - nextCount, limit: DAILY_LIMIT };
  });
}

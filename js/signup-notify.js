// 招待登録時の admin メール通知（DB非保存）クライアント側ロジック。
// 純関数はテスト可能。postSignupNotify は best-effort（登録をブロックしない・PIIをログしない）。

// 入力検証。consent 未チェック・氏名空・長さ超過を不可にする。（電話番号は収集しない）
export function validateSignupFields({ name, consent }) {
  const errors = [];
  if (!consent) errors.push('利用目的への同意が必要です');
  const n = (name || '').trim();
  if (!n) errors.push('氏名を入力してください');
  else if (n.length > 50) errors.push('氏名が長すぎます');
  return { ok: errors.length === 0, errors };
}

// 送信ペイロード。電話・会社名・consent は含めない（consent は送信可否のゲートのみ）。
export function buildNotifyPayload({ idToken, userId, name }) {
  return {
    idToken,
    userId,
    name: String(name || '').trim(),
  };
}

// worker へ best-effort 送信。失敗しても呼び出し側で登録はブロックしない。PII本文はログしない。
export async function postSignupNotify(base, payload) {
  try {
    const res = await fetch(base + '/notify-signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return res.ok;
  } catch (e) {
    console.warn('signup notify failed (registration still OK)');
    return false;
  }
}

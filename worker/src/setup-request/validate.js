// worker/src/setup-request/validate.js — Worker 側ペイロード検証（純関数）
// フロント側の validate と整合性を保つ。フロントを通り抜けた不正値を最終的に弾く。

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TOKEN_RE = /^[0-9a-f]{64}$/;
const ALLOWED_PLANS = ['partner', 'normal'];
const ALLOWED_PAYROLL_MODES = ['step_rate', 'fixed_rate'];

export function validateSubmitPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return { ok: false, error: 'payload が不正です' };
  }

  // token
  if (!TOKEN_RE.test(String(payload.token || ''))) {
    return { ok: false, error: 'token 形式が不正です' };
  }

  // contact
  const c = payload.contact || {};
  if (!String(c.companyName || '').trim()) return { ok: false, error: '会社名が空です' };
  if (!String(c.name || '').trim()) return { ok: false, error: 'お名前が空です' };
  const email = String(c.email || '').trim();
  if (!EMAIL_RE.test(email)) return { ok: false, error: 'メールアドレスが不正です' };

  // config
  const cfg = payload.config || {};
  if (!ALLOWED_PLANS.includes(cfg.plan)) return { ok: false, error: 'plan 不正' };
  if (!ALLOWED_PAYROLL_MODES.includes(cfg.payrollMode)) {
    return { ok: false, error: 'payrollMode 不正' };
  }
  const tk = Number(cfg.takeHomeRate);
  if (!Number.isFinite(tk) || tk < 0.5 || tk > 1.0) {
    return { ok: false, error: 'takeHomeRate 範囲外' };
  }
  const rs = Number(cfg.responsibilityShifts);
  if (!Number.isFinite(rs) || rs < 1 || rs > 30) {
    return { ok: false, error: 'responsibilityShifts 範囲外' };
  }
  const pl = Number(cfg.paidLeaveAmount);
  if (!Number.isFinite(pl) || pl < 0) {
    return { ok: false, error: 'paidLeaveAmount 不正' };
  }
  const pi = cfg.premiumIncentive || {};
  const th = Number(pi.thresholdSalesExclTax);
  const am = Number(pi.amountPerShift);
  if (!Number.isFinite(th) || th < 0) return { ok: false, error: 'premiumIncentive.threshold 不正' };
  if (!Number.isFinite(am) || am < 0) return { ok: false, error: 'premiumIncentive.amount 不正' };

  if (cfg.payrollMode === 'fixed_rate') {
    const fr = Number(cfg.fixedRate);
    if (!Number.isFinite(fr) || fr <= 0 || fr > 1) {
      return { ok: false, error: 'fixedRate 範囲外' };
    }
  }

  // rateTable inputs（step_rate のみ）
  let rateTableSource;
  if (cfg.payrollMode === 'step_rate') {
    const hasNumeric = !!(cfg.rateTable && cfg.rateTable.numeric
      && Object.keys(cfg.rateTable.numeric).length > 0);
    const hasText = !!(payload.rateTableText && String(payload.rateTableText).trim().length > 0);
    const hasAttachment = Number(payload.attachmentCount) > 0;
    const count = [hasNumeric, hasText, hasAttachment].filter(Boolean).length;
    if (count === 0) {
      return { ok: false, error: '歩率の記入が空です（数値/自由テキスト/添付のいずれか必須）' };
    }
    if (count === 1) {
      rateTableSource = hasNumeric ? 'numeric' : hasText ? 'text' : 'attachment';
    } else {
      rateTableSource = 'mixed';
    }
  }

  // 添付件数（サイズ・MIME 検証は handler 側で File オブジェクトを見て行う）
  if (Number(payload.attachmentCount) > 3) {
    return { ok: false, error: '添付ファイルは最大3枚までです' };
  }
  return { ok: true, rateTableSource };
}

export function validateIssueUrlPayload(_payload) {
  return { ok: true };
}

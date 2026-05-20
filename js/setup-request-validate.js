// js/setup-request-validate.js — ヒアリングフォーム値検証（純関数・フロントエンド）

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const ALLOWED_PLANS = ['partner', 'normal'];
const ALLOWED_PAYROLL_MODES = ['step_rate', 'fixed_rate'];
const ALLOWED_ATTACHMENT_MIMES = ['application/pdf', 'image/jpeg', 'image/png'];

const MAX_ATTACHMENT_COUNT = 3;
const MAX_ATTACHMENT_TOTAL_BYTES = 10 * 1024 * 1024; // 10MB

export function validateContact(contact) {
  if (!contact || typeof contact !== 'object') {
    return { ok: false, error: '連絡先情報が不正です' };
  }
  const companyName = String(contact.companyName || '').trim();
  const name = String(contact.name || '').trim();
  const email = String(contact.email || '').trim();
  if (!companyName) return { ok: false, error: '会社名を入力してください' };
  if (!name) return { ok: false, error: 'お名前を入力してください' };
  if (!email) return { ok: false, error: 'メールアドレスを入力してください' };
  if (!EMAIL_RE.test(email)) return { ok: false, error: 'メールアドレスの形式が不正です' };
  return { ok: true };
}

export function validateConfig(config) {
  if (!config || typeof config !== 'object') {
    return { ok: false, error: '設定情報が不正です' };
  }
  if (!ALLOWED_PLANS.includes(config.plan)) {
    return { ok: false, error: 'プランは partner / normal のいずれかです' };
  }
  if (!ALLOWED_PAYROLL_MODES.includes(config.payrollMode)) {
    return { ok: false, error: '給与モードを選択してください' };
  }

  const tk = Number(config.takeHomeRate);
  if (!Number.isFinite(tk) || tk < 0.5 || tk > 1.0) {
    return { ok: false, error: '手取り率は0.5〜1.0の範囲で入力してください' };
  }
  const rs = Number(config.responsibilityShifts);
  if (!Number.isFinite(rs) || rs < 1 || rs > 30) {
    return { ok: false, error: '責任出番数は1〜30の範囲で入力してください' };
  }
  const pl = Number(config.paidLeaveAmount);
  if (!Number.isFinite(pl) || pl < 0) {
    return { ok: false, error: '有給1日金額は0以上の数値で入力してください' };
  }

  if (!config.premiumIncentive || typeof config.premiumIncentive !== 'object') {
    return { ok: false, error: 'インセンティブ情報が不正です' };
  }
  const th = Number(config.premiumIncentive.thresholdSalesExclTax);
  const am = Number(config.premiumIncentive.amountPerShift);
  if (!Number.isFinite(th) || th < 0) {
    return { ok: false, error: 'インセンティブ閾値売上が不正です' };
  }
  if (!Number.isFinite(am) || am < 0) {
    return { ok: false, error: 'インセンティブ額が不正です' };
  }

  if (config.payrollMode === 'fixed_rate') {
    const fr = Number(config.fixedRate);
    if (!Number.isFinite(fr) || fr <= 0 || fr > 1) {
      return { ok: false, error: '固定率(fixedRate)は0〜1の範囲で入力してください' };
    }
  }
  return { ok: true };
}

export function validateRateTableInputs(input) {
  if (!input || typeof input !== 'object') {
    return { ok: false, error: '歩率入力が不正です' };
  }
  if (input.payrollMode !== 'step_rate') {
    return { ok: true }; // step_rate 以外は rateTable 不要
  }
  const hasNumeric = !!(input.numericTable && Object.keys(input.numericTable).length > 0);
  const hasText = !!(input.rateTableText && String(input.rateTableText).trim().length > 0);
  const hasAttachment = Number(input.attachmentCount) > 0;
  const count = [hasNumeric, hasText, hasAttachment].filter(Boolean).length;
  if (count === 0) {
    return { ok: false, error: '歩率の記入方法を1つ以上選んでください（数値・自由テキスト・添付）' };
  }
  if (count === 1) {
    if (hasNumeric) return { ok: true, source: 'numeric' };
    if (hasText) return { ok: true, source: 'text' };
    return { ok: true, source: 'attachment' };
  }
  return { ok: true, source: 'mixed' };
}

export function validateAttachments(attachments) {
  const list = Array.isArray(attachments) ? attachments : [];
  if (list.length > MAX_ATTACHMENT_COUNT) {
    return { ok: false, error: `添付ファイルは最大${MAX_ATTACHMENT_COUNT}枚までです` };
  }
  let total = 0;
  for (const a of list) {
    if (!ALLOWED_ATTACHMENT_MIMES.includes(a.type)) {
      return { ok: false, error: '添付ファイルの形式は PDF / JPEG / PNG のみです' };
    }
    total += Number(a.size) || 0;
  }
  if (total > MAX_ATTACHMENT_TOTAL_BYTES) {
    return { ok: false, error: '添付ファイルの合計サイズは10MB以下にしてください' };
  }
  return { ok: true };
}

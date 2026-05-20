// js/admin-companies.js — admin 会社管理: フォーム値の検証とドキュメント化（純関数）
//
// 設計方針（2026-05-20 決定）: 会社名(name)はサーバーに保存しない。
// データ流出時の特定リスク低減のため、companies ドキュメントは内部識別子(slug)＋
// 給与/プラン等の運用設定のみを保持する。会社名表示が必要な場面は管理者の頭の中の
// マップ（または手元のローカルメモ）で扱う。

const SLUG_RE = /^[a-z][a-z0-9_]*$/;

const NUMBER_LABELS = {
  takeHomeRate: '手取り率',
  responsibilityShifts: '責任出番数',
  paidLeaveAmount: '有給休暇1日金額',
  fixedRate: '固定率',
  thresholdSalesExclTax: 'インセンティブ閾値売上',
  amountPerShift: 'インセンティブ額',
};

// 数値フォーム値を number 化。空文字・非数値は NaN を返す。
function num(v) {
  if (v === '' || v === null || v === undefined) return NaN;
  return Number(v);
}

// フォーム値オブジェクト → companies ドキュメント。
// 成功時は { doc }、検証エラー時は { error } を返す。
// 会社レベル項目のうち rateTable / fixedRate は payrollMode に応じて取捨選択する。
export function buildCompanyDoc(form) {
  const slug = String(form.slug || '').trim();
  if (!SLUG_RE.test(slug) || slug.length < 2 || slug.length > 40) {
    return { error: '会社ID(slug)は半角英小文字で始まり、英小文字・数字・_ のみ・2〜40文字です' };
  }
  if (form.plan !== 'partner' && form.plan !== 'normal') {
    return { error: 'プランは partner / normal のいずれかです' };
  }
  const payrollMode = String(form.payrollMode || '').trim();
  if (!payrollMode) return { error: '給与モードを選択してください' };

  // モードに依らず必須の数値項目
  const numbers = {
    takeHomeRate: num(form.takeHomeRate),
    responsibilityShifts: num(form.responsibilityShifts),
    paidLeaveAmount: num(form.paidLeaveAmount),
    thresholdSalesExclTax: num(form.premiumThreshold),
    amountPerShift: num(form.premiumAmount),
  };
  for (const [k, v] of Object.entries(numbers)) {
    if (!Number.isFinite(v)) {
      return { error: `数値項目「${NUMBER_LABELS[k]}」が未入力または不正です` };
    }
  }

  const doc = {
    slug,
    plan: form.plan,
    active: form.active === true,
    takeHomeRate: numbers.takeHomeRate,
    responsibilityShifts: numbers.responsibilityShifts,
    premiumIncentive: {
      thresholdSalesExclTax: numbers.thresholdSalesExclTax,
      amountPerShift: numbers.amountPerShift,
    },
    paidLeaveAmount: numbers.paidLeaveAmount,
    payrollMode,
  };

  // defaultRecArea は任意項目。空文字なら省略、設定された文字列は doc に含める。
  const defaultRecArea = String(form.defaultRecArea || '').trim();
  if (defaultRecArea) doc.defaultRecArea = defaultRecArea;

  // 固定部立は fixedRate 必須・rateTable 不要。変動部立は逆。
  if (payrollMode === 'fixed_rate') {
    const fixedRate = num(form.fixedRate);
    if (!Number.isFinite(fixedRate)) {
      return { error: `数値項目「${NUMBER_LABELS.fixedRate}」が未入力または不正です` };
    }
    doc.fixedRate = fixedRate;
  } else {
    if (!form.rateTable || typeof form.rateTable !== 'object') {
      return { error: '歩率テーブルが不正です' };
    }
    doc.rateTable = form.rateTable;
  }
  return { doc };
}

// 会社の申込URLを生成する純関数。配布用QR/メール周知の元データ。
// 例: buildCompanySignupUrl('keiho') === 'https://app.taxicabis.com/?company=keiho'
export function buildCompanySignupUrl(slug, baseUrl = 'https://app.taxicabis.com') {
  if (!slug) return '';
  const base = String(baseUrl).replace(/\/+$/, '');
  return `${base}/?company=${slug}`;
}

// 紹介者付き招待URLを生成する純関数。settings.html「自社の人に紹介する」用。
// 例: buildReferralUrl('keiho', 'taro') === 'https://app.taxicabis.com/?company=keiho&ref=taro'
// ref が空/不正な場合は会社URLのみを返す（フォールバック）。
export function buildReferralUrl(slug, referrerUserId, baseUrl = 'https://app.taxicabis.com') {
  const url = buildCompanySignupUrl(slug, baseUrl);
  if (!url || !referrerUserId) return url;
  if (!/^[a-z][a-z0-9_]{2,29}$/.test(referrerUserId)) return url;
  return `${url}&ref=${referrerUserId}`;
}

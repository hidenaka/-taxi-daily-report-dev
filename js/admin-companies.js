// js/admin-companies.js — admin 会社管理: フォーム値の検証とドキュメント化（純関数）

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
export function buildCompanyDoc(form) {
  const slug = String(form.slug || '').trim();
  if (!SLUG_RE.test(slug) || slug.length < 2 || slug.length > 40) {
    return { error: '会社ID(slug)は半角英小文字で始まり、英小文字・数字・_ のみ・2〜40文字です' };
  }
  const name = String(form.name || '').trim();
  if (!name) return { error: '会社名を入力してください' };
  if (form.plan !== 'partner' && form.plan !== 'normal') {
    return { error: 'プランは partner / normal のいずれかです' };
  }
  const payrollMode = String(form.payrollMode || '').trim();
  if (!payrollMode) return { error: '給与モードを選択してください' };

  const numbers = {
    takeHomeRate: num(form.takeHomeRate),
    responsibilityShifts: num(form.responsibilityShifts),
    paidLeaveAmount: num(form.paidLeaveAmount),
    fixedRate: num(form.fixedRate),
    thresholdSalesExclTax: num(form.premiumThreshold),
    amountPerShift: num(form.premiumAmount),
  };
  for (const [k, v] of Object.entries(numbers)) {
    if (!Number.isFinite(v)) {
      return { error: `数値項目「${NUMBER_LABELS[k]}」が未入力または不正です` };
    }
  }
  if (!form.rateTable || typeof form.rateTable !== 'object') {
    return { error: '歩率テーブルが不正です' };
  }

  const doc = {
    name,
    slug,
    plan: form.plan,
    active: form.active === true,
    rateTable: form.rateTable,
    takeHomeRate: numbers.takeHomeRate,
    responsibilityShifts: numbers.responsibilityShifts,
    premiumIncentive: {
      thresholdSalesExclTax: numbers.thresholdSalesExclTax,
      amountPerShift: numbers.amountPerShift,
    },
    paidLeaveAmount: numbers.paidLeaveAmount,
    payrollMode,
    fixedRate: numbers.fixedRate,
  };
  return { doc };
}

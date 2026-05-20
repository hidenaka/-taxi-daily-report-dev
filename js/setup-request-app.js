// js/setup-request-app.js — ヒアリングフォーム DOM 配線
//
// 流れ:
//   1. URL の `t` を取り出して Worker /validate-token を叩く
//   2. valid → フォーム表示
//   3. 送信ボタン → 検証 → /submit へ multipart/form-data POST
//   4. 成功 → 完了画面 / 失敗 → エラー表示

import {
  validateContact, validateConfig, validateRateTableInputs, validateAttachments,
} from './setup-request-validate.js';

// Worker URL は host で自動切替
const WORKER_BASE = location.hostname === 'app.taxicabis.com'
  ? 'https://cabis-billing.haqei64384.workers.dev'
  : 'https://cabis-billing-dev.haqei64384.workers.dev';

const $ = (id) => document.getElementById(id);

document.addEventListener('DOMContentLoaded', () => {
  bootstrap().catch((err) => {
    console.error(err);
    showError('予期しないエラーが発生しました');
  });
});

async function bootstrap() {
  const params = new URLSearchParams(location.search);
  const token = params.get('t') || '';
  if (!token) {
    showError('招待URLが必要です（Cabis 開発者にご連絡ください）');
    return;
  }
  const res = await fetch(`${WORKER_BASE}/setup-request/validate-token?t=${encodeURIComponent(token)}`);
  const data = await res.json();
  if (data.status === 'valid') {
    initForm(token);
  } else if (data.status === 'already_used') {
    showError('このURLは既に使用されています');
  } else if (data.status === 'expired') {
    showError('このURLは期限切れです');
  } else {
    showError('このURLは無効です');
  }
}

function showError(msg) {
  $('gateValidating').style.display = 'none';
  $('gateError').style.display = '';
  $('gateErrorMsg').textContent = msg;
}

function showDone() {
  $('setupForm').style.display = 'none';
  $('gateDone').style.display = '';
}

function initForm(token) {
  $('gateValidating').style.display = 'none';
  $('setupForm').style.display = '';

  buildNumericRateRows();

  // payrollMode ラジオ切替
  document.querySelectorAll('input[name="payrollMode"]').forEach((r) => {
    r.addEventListener('change', () => applyPayrollModeUI());
  });
  applyPayrollModeUI();

  // インセンティブ無しチェック
  $('incentiveNone').addEventListener('change', () => {
    const disabled = $('incentiveNone').checked;
    $('incentiveThreshold').disabled = disabled;
    $('incentiveAmount').disabled = disabled;
    if (disabled) {
      $('incentiveThreshold').value = '0';
      $('incentiveAmount').value = '0';
    }
  });

  // 添付ファイル選択
  $('attachments').addEventListener('change', renderAttachmentList);

  // 送信
  $('submitBtn').addEventListener('click', () => submitForm(token));
}

function buildNumericRateRows() {
  const wrap = $('numericRateRows');
  wrap.innerHTML = '';
  for (let i = 1; i <= 11; i++) {
    const row = document.createElement('div');
    row.className = 'rate-row';
    row.innerHTML = `<label class="muted">${i}乗務目</label>
      <input class="input" data-shift="${i}" type="number" step="0.1" min="0" max="100" placeholder="55">
      <span>%</span>`;
    wrap.appendChild(row);
  }
}

function applyPayrollModeUI() {
  const mode = document.querySelector('input[name="payrollMode"]:checked')?.value;
  $('monthlyNote').style.display = mode === 'monthly' ? '' : 'none';
  $('rateSection').style.display = mode === 'monthly' ? 'none' : '';
  $('fixedRateBlock').style.display = mode === 'fixed_rate' ? '' : 'none';
  $('stepRateBlock').style.display = mode === 'step_rate' ? '' : 'none';
}

function renderAttachmentList() {
  const files = Array.from($('attachments').files || []);
  const ul = $('attachmentList');
  ul.innerHTML = '';
  for (const f of files) {
    const li = document.createElement('li');
    li.textContent = `${f.name} (${formatBytes(f.size)})`;
    ul.appendChild(li);
  }
}

function formatBytes(n) {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}

function collectForm() {
  const mode = document.querySelector('input[name="payrollMode"]:checked')?.value;

  const contact = {
    companyName: $('companyName').value.trim(),
    name: $('contactName').value.trim(),
    email: $('contactEmail').value.trim(),
    phone: $('contactPhone').value.trim(),
  };

  const incentiveOff = $('incentiveNone').checked;
  const config = {
    plan: $('plan').value,
    payrollMode: mode,
    takeHomeRate: Number($('takeHomeRate').value) / 100,
    responsibilityShifts: Number($('responsibilityShifts').value),
    paidLeaveAmount: Number($('paidLeaveAmount').value),
    premiumIncentive: {
      thresholdSalesExclTax: incentiveOff ? 0 : Number($('incentiveThreshold').value),
      amountPerShift: incentiveOff ? 0 : Number($('incentiveAmount').value),
    },
  };
  if ($('defaultRecArea').value.trim()) {
    config.defaultRecArea = $('defaultRecArea').value.trim();
  }
  if (mode === 'fixed_rate') {
    config.fixedRate = Number($('fixedRate').value) / 100;
  }
  if (mode === 'step_rate') {
    const numeric = {};
    document.querySelectorAll('#numericRateRows input').forEach((inp) => {
      const v = inp.value.trim();
      if (v) numeric[inp.dataset.shift] = Number(v) / 100;
    });
    const finalRate = $('numericFinalRate').value.trim();
    if (finalRate) numeric['12+'] = Number(finalRate) / 100;
    if (Object.keys(numeric).length > 0) {
      config.rateTable = { numeric };
    }
  }

  const notes = $('notes').value.trim();
  const rateTableText = mode === 'step_rate' ? $('rateTableText').value.trim() : '';
  const files = Array.from($('attachments').files || []);

  return { contact, config, notes, rateTableText, files };
}

async function submitForm(token) {
  $('submitStatus').textContent = '';
  const { contact, config, notes, rateTableText, files } = collectForm();

  const mode = config.payrollMode;
  if (mode === 'monthly') {
    $('submitStatus').textContent = '月給制は未対応です。中野までご連絡ください。';
    return;
  }

  const vc = validateContact(contact);
  if (!vc.ok) return showSubmitError(vc.error);
  const vcfg = validateConfig(config);
  if (!vcfg.ok) return showSubmitError(vcfg.error);
  const vr = validateRateTableInputs({
    payrollMode: mode,
    numericTable: config.rateTable && config.rateTable.numeric,
    rateTableText,
    attachmentCount: files.length,
  });
  if (!vr.ok) return showSubmitError(vr.error);
  const va = validateAttachments(files);
  if (!va.ok) return showSubmitError(va.error);

  $('submitBtn').disabled = true;
  $('submitStatus').textContent = '送信中...';

  const form = new FormData();
  form.append('t', token);
  form.append('config', JSON.stringify(config));
  form.append('contact', JSON.stringify(contact));
  form.append('notes', notes);
  form.append('rateTableText', rateTableText);
  for (const f of files) form.append('attachments', f, f.name);

  try {
    const res = await fetch(`${WORKER_BASE}/setup-request/submit`, {
      method: 'POST',
      body: form,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    showDone();
  } catch (err) {
    console.error('submit failed', err);
    $('submitBtn').disabled = false;
    showSubmitError(`送信に失敗しました: ${err.message}`);
  }
}

function showSubmitError(msg) {
  $('submitStatus').textContent = msg;
  $('submitStatus').style.color = '#dc3545';
}

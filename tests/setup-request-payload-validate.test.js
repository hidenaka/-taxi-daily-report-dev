import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  validateSubmitPayload,
  validateIssueUrlPayload,
} from '../worker/src/setup-request/validate.js';

const validConfig = {
  plan: 'partner',
  payrollMode: 'fixed_rate',
  fixedRate: 0.55,
  takeHomeRate: 0.75,
  responsibilityShifts: 11,
  paidLeaveAmount: 39340,
  premiumIncentive: { thresholdSalesExclTax: 80000, amountPerShift: 2000 },
};

const validContact = {
  companyName: '○○組合',
  name: '山田 太郎',
  email: 'yamada@example.com',
  phone: '',
};

test('validateSubmitPayload: 完全な fixed_rate ペイロードで ok', () => {
  const r = validateSubmitPayload({
    token: 'a'.repeat(64),
    config: validConfig,
    contact: validContact,
    notes: '',
    rateTableText: '',
    attachmentCount: 0,
  });
  assert.equal(r.ok, true);
});

test('validateSubmitPayload: token 長さ不正でエラー', () => {
  const r = validateSubmitPayload({
    token: 'short',
    config: validConfig,
    contact: validContact,
    notes: '',
    rateTableText: '',
    attachmentCount: 0,
  });
  assert.equal(r.ok, false);
  assert.match(r.error, /token|トークン/);
});

test('validateSubmitPayload: step_rate で歩率記入なし→エラー', () => {
  const r = validateSubmitPayload({
    token: 'a'.repeat(64),
    config: { ...validConfig, payrollMode: 'step_rate', fixedRate: undefined },
    contact: validContact,
    notes: '',
    rateTableText: '',
    attachmentCount: 0,
  });
  assert.equal(r.ok, false);
  assert.match(r.error, /歩率/);
});

test('validateSubmitPayload: step_rate で numericTable のみ→ok, source=numeric', () => {
  const r = validateSubmitPayload({
    token: 'a'.repeat(64),
    config: {
      ...validConfig,
      payrollMode: 'step_rate',
      fixedRate: undefined,
      rateTable: { numeric: { 1: 0.55, 2: 0.56 } },
    },
    contact: validContact,
    notes: '',
    rateTableText: '',
    attachmentCount: 0,
  });
  assert.equal(r.ok, true);
  assert.equal(r.rateTableSource, 'numeric');
});

test('validateSubmitPayload: 連絡先メール形式不正→エラー', () => {
  const r = validateSubmitPayload({
    token: 'a'.repeat(64),
    config: validConfig,
    contact: { ...validContact, email: 'invalid' },
    notes: '',
    rateTableText: '',
    attachmentCount: 0,
  });
  assert.equal(r.ok, false);
  assert.match(r.error, /メール/);
});

test('validateSubmitPayload: 添付4枚→エラー', () => {
  const r = validateSubmitPayload({
    token: 'a'.repeat(64),
    config: validConfig,
    contact: validContact,
    notes: '',
    rateTableText: '',
    attachmentCount: 4,
  });
  assert.equal(r.ok, false);
  assert.match(r.error, /3枚|添付/);
});

test('validateIssueUrlPayload: 空 body で ok（admin 認証は別レイヤー）', () => {
  const r = validateIssueUrlPayload({});
  assert.equal(r.ok, true);
});

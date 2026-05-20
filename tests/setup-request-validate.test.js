import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  validateContact,
  validateConfig,
  validateRateTableInputs,
  validateAttachments,
} from '../js/setup-request-validate.js';

test('validateContact: 必須欄が全部埋まれば ok=true', () => {
  const r = validateContact({
    companyName: '○○組合',
    name: '山田 太郎',
    email: 'yamada@example.com',
    phone: '',
  });
  assert.equal(r.ok, true);
});

test('validateContact: 会社名が空ならエラー', () => {
  const r = validateContact({ companyName: '', name: '山田', email: 'a@b.c', phone: '' });
  assert.equal(r.ok, false);
  assert.match(r.error, /会社名/);
});

test('validateContact: メール形式が不正ならエラー', () => {
  const r = validateContact({ companyName: '会社', name: '山田', email: 'invalid', phone: '' });
  assert.equal(r.ok, false);
  assert.match(r.error, /メール/);
});

test('validateConfig: fixed_rate モードで fixedRate と必須数値が揃えば ok', () => {
  const r = validateConfig({
    plan: 'partner',
    payrollMode: 'fixed_rate',
    fixedRate: 0.55,
    takeHomeRate: 0.75,
    responsibilityShifts: 11,
    paidLeaveAmount: 39340,
    premiumIncentive: { thresholdSalesExclTax: 80000, amountPerShift: 2000 },
  });
  assert.equal(r.ok, true);
});

test('validateConfig: fixed_rate で fixedRate 欠落ならエラー', () => {
  const r = validateConfig({
    plan: 'partner',
    payrollMode: 'fixed_rate',
    takeHomeRate: 0.75,
    responsibilityShifts: 11,
    paidLeaveAmount: 39340,
    premiumIncentive: { thresholdSalesExclTax: 80000, amountPerShift: 2000 },
  });
  assert.equal(r.ok, false);
  assert.match(r.error, /固定率|fixedRate/);
});

test('validateConfig: takeHomeRate 範囲外（>1）ならエラー', () => {
  const r = validateConfig({
    plan: 'partner',
    payrollMode: 'fixed_rate',
    fixedRate: 0.55,
    takeHomeRate: 1.5,
    responsibilityShifts: 11,
    paidLeaveAmount: 39340,
    premiumIncentive: { thresholdSalesExclTax: 80000, amountPerShift: 2000 },
  });
  assert.equal(r.ok, false);
  assert.match(r.error, /手取り率/);
});

test('validateConfig: plan が partner/normal 以外ならエラー', () => {
  const r = validateConfig({
    plan: 'premium',
    payrollMode: 'fixed_rate',
    fixedRate: 0.55,
    takeHomeRate: 0.75,
    responsibilityShifts: 11,
    paidLeaveAmount: 39340,
    premiumIncentive: { thresholdSalesExclTax: 80000, amountPerShift: 2000 },
  });
  assert.equal(r.ok, false);
});

test('validateRateTableInputs: 数値入力ありなら ok', () => {
  const r = validateRateTableInputs({
    payrollMode: 'step_rate',
    numericTable: { 1: 0.55, 2: 0.56 },
    rateTableText: '',
    attachmentCount: 0,
  });
  assert.equal(r.ok, true);
  assert.equal(r.source, 'numeric');
});

test('validateRateTableInputs: 自由テキストありなら ok', () => {
  const r = validateRateTableInputs({
    payrollMode: 'step_rate',
    numericTable: null,
    rateTableText: '売上40万未満: 1〜11乗務目 55%、...',
    attachmentCount: 0,
  });
  assert.equal(r.ok, true);
  assert.equal(r.source, 'text');
});

test('validateRateTableInputs: 添付ありなら ok', () => {
  const r = validateRateTableInputs({
    payrollMode: 'step_rate',
    numericTable: null,
    rateTableText: '',
    attachmentCount: 2,
  });
  assert.equal(r.ok, true);
  assert.equal(r.source, 'attachment');
});

test('validateRateTableInputs: 3つとも空ならエラー', () => {
  const r = validateRateTableInputs({
    payrollMode: 'step_rate',
    numericTable: null,
    rateTableText: '',
    attachmentCount: 0,
  });
  assert.equal(r.ok, false);
  assert.match(r.error, /1つ以上|歩率/);
});

test('validateRateTableInputs: 数値+テキストの両方ありなら source=mixed', () => {
  const r = validateRateTableInputs({
    payrollMode: 'step_rate',
    numericTable: { 1: 0.55 },
    rateTableText: '補足あり',
    attachmentCount: 0,
  });
  assert.equal(r.ok, true);
  assert.equal(r.source, 'mixed');
});

test('validateRateTableInputs: payrollMode=fixed_rate なら常に ok（rateTable 不要）', () => {
  const r = validateRateTableInputs({
    payrollMode: 'fixed_rate',
    numericTable: null,
    rateTableText: '',
    attachmentCount: 0,
  });
  assert.equal(r.ok, true);
  assert.equal(r.source, undefined);
});

test('validateAttachments: 3枚以下・10MB以下・MIME OK なら ok', () => {
  const r = validateAttachments([
    { type: 'application/pdf', size: 2_000_000 },
    { type: 'image/jpeg', size: 3_000_000 },
  ]);
  assert.equal(r.ok, true);
});

test('validateAttachments: 4枚以上ならエラー', () => {
  const r = validateAttachments([
    { type: 'image/jpeg', size: 100 },
    { type: 'image/jpeg', size: 100 },
    { type: 'image/jpeg', size: 100 },
    { type: 'image/jpeg', size: 100 },
  ]);
  assert.equal(r.ok, false);
  assert.match(r.error, /3枚/);
});

test('validateAttachments: 合計10MB超ならエラー', () => {
  const r = validateAttachments([
    { type: 'application/pdf', size: 6_000_000 },
    { type: 'application/pdf', size: 6_000_000 },
  ]);
  assert.equal(r.ok, false);
  assert.match(r.error, /10MB|サイズ/);
});

test('validateAttachments: 許可されない MIME ならエラー', () => {
  const r = validateAttachments([
    { type: 'application/zip', size: 100 },
  ]);
  assert.equal(r.ok, false);
  assert.match(r.error, /形式|MIME|PDF/);
});

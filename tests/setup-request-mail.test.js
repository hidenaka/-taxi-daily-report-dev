import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { buildAdminNotificationBody } from '../worker/src/setup-request/mail.js';

const sampleContact = {
  companyName: '○○組合',
  name: '山田 太郎',
  email: 'yamada@example.com',
  phone: '090-1234-5678',
};

const sampleFixedConfig = {
  plan: 'partner',
  payrollMode: 'fixed_rate',
  fixedRate: 0.55,
  takeHomeRate: 0.75,
  responsibilityShifts: 11,
  paidLeaveAmount: 39340,
  premiumIncentive: { thresholdSalesExclTax: 80000, amountPerShift: 2000 },
  defaultRecArea: '千代田区丸の内',
};

const sampleStepConfig = {
  plan: 'normal',
  payrollMode: 'step_rate',
  takeHomeRate: 0.78,
  responsibilityShifts: 12,
  paidLeaveAmount: 40000,
  premiumIncentive: { thresholdSalesExclTax: 80000, amountPerShift: 2000 },
  rateTable: { numeric: { 1: 0.55, 2: 0.56, 11: 0.65 } },
};

test('buildAdminNotificationBody: 申請ID と slug がメール本文に含まれる', () => {
  const body = buildAdminNotificationBody({
    requestId: 'req_abc123',
    assignedSlug: 'co-a3f7b2',
    submittedAt: '2026-05-22T05:32:00Z',
    contact: sampleContact,
    config: sampleFixedConfig,
    notes: '',
    rateTableText: '',
    rateTableSource: undefined,
    attachmentSummaries: [],
  });
  assert.match(body, /req_abc123/);
  assert.match(body, /co-a3f7b2/);
});

test('buildAdminNotificationBody: 連絡先が含まれる（Firestore 未保存の旨も明記）', () => {
  const body = buildAdminNotificationBody({
    requestId: 'r1', assignedSlug: 'co-x', submittedAt: 'now',
    contact: sampleContact, config: sampleFixedConfig,
    notes: '', rateTableText: '', rateTableSource: undefined, attachmentSummaries: [],
  });
  assert.match(body, /○○組合/);
  assert.match(body, /山田 太郎/);
  assert.match(body, /yamada@example\.com/);
  assert.match(body, /090-1234-5678/);
  assert.match(body, /Firestore.*保存/);
});

test('buildAdminNotificationBody: 電話番号が空ならその行が出ない', () => {
  const body = buildAdminNotificationBody({
    requestId: 'r1', assignedSlug: 'co-x', submittedAt: 'now',
    contact: { ...sampleContact, phone: '' }, config: sampleFixedConfig,
    notes: '', rateTableText: '', rateTableSource: undefined, attachmentSummaries: [],
  });
  assert.doesNotMatch(body, /電話:/);
});

test('buildAdminNotificationBody: fixed_rate モードで固定率が含まれる', () => {
  const body = buildAdminNotificationBody({
    requestId: 'r1', assignedSlug: 'co-x', submittedAt: 'now',
    contact: sampleContact, config: sampleFixedConfig,
    notes: '', rateTableText: '', rateTableSource: undefined, attachmentSummaries: [],
  });
  assert.match(body, /固定率/);
  assert.match(body, /0\.55/);
});

test('buildAdminNotificationBody: step_rate モードで数値歩率テーブルが整形される', () => {
  const body = buildAdminNotificationBody({
    requestId: 'r1', assignedSlug: 'co-x', submittedAt: 'now',
    contact: sampleContact, config: sampleStepConfig,
    notes: '', rateTableText: '', rateTableSource: 'numeric', attachmentSummaries: [],
  });
  assert.match(body, /歩率記入方法.*numeric/);
  assert.match(body, /1乗務目/);
  assert.match(body, /11乗務目/);
});

test('buildAdminNotificationBody: 自由テキストが含まれる（rateTableText 指定時）', () => {
  const body = buildAdminNotificationBody({
    requestId: 'r1', assignedSlug: 'co-x', submittedAt: 'now',
    contact: sampleContact, config: sampleStepConfig,
    notes: '', rateTableText: '売上40万未満は1〜11乗務目55%、12乗務目以降50%',
    rateTableSource: 'mixed', attachmentSummaries: [],
  });
  assert.match(body, /自由テキスト/);
  assert.match(body, /売上40万未満/);
});

test('buildAdminNotificationBody: 添付ファイル名が含まれる', () => {
  const body = buildAdminNotificationBody({
    requestId: 'r1', assignedSlug: 'co-x', submittedAt: 'now',
    contact: sampleContact, config: sampleStepConfig,
    notes: '', rateTableText: '', rateTableSource: 'attachment',
    attachmentSummaries: [
      { filename: 'kyuyo-kitei.pdf', size: 1234567 },
      { filename: '規程.jpg', size: 800000 },
    ],
  });
  assert.match(body, /添付ファイル/);
  assert.match(body, /kyuyo-kitei\.pdf/);
  assert.match(body, /規程\.jpg/);
});

test('buildAdminNotificationBody: notes が空なら自由記述セクションが出ない', () => {
  const body = buildAdminNotificationBody({
    requestId: 'r1', assignedSlug: 'co-x', submittedAt: 'now',
    contact: sampleContact, config: sampleFixedConfig,
    notes: '', rateTableText: '', rateTableSource: undefined, attachmentSummaries: [],
  });
  assert.doesNotMatch(body, /自由記述/);
});

test('buildAdminNotificationBody: notes が指定されれば本文に出る', () => {
  const body = buildAdminNotificationBody({
    requestId: 'r1', assignedSlug: 'co-x', submittedAt: 'now',
    contact: sampleContact, config: sampleFixedConfig,
    notes: '繁忙期は歩率+1%', rateTableText: '', rateTableSource: undefined, attachmentSummaries: [],
  });
  assert.match(body, /自由記述/);
  assert.match(body, /繁忙期は歩率\+1%/);
});

test('buildAdminNotificationBody: defaultRecArea が指定されれば本文に出る', () => {
  const body = buildAdminNotificationBody({
    requestId: 'r1', assignedSlug: 'co-x', submittedAt: 'now',
    contact: sampleContact, config: sampleFixedConfig,
    notes: '', rateTableText: '', rateTableSource: undefined, attachmentSummaries: [],
  });
  assert.match(body, /営業地デフォルト/);
  assert.match(body, /千代田区丸の内/);
});

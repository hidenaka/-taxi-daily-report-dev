# 会社設定ヒアリングフォーム 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新規導入会社の給与ルールを担当ドライバーがWebフォームから入力・送信し、中野氏が admin で確認・取込できる仕組みを構築する。

**Architecture:** cabis-billing Worker に endpoint 4本（issue-url / validate-token / submit / archive）を追加し、フォーム受付・トークン管理・メール送信を Worker に集約。Firestore `companySetupRequests` コレクションを Service Account 経由で Worker のみが write、admin は Firestore SDK 直接 read（Rules で admin 限定）。個人特定情報（会社名・氏名・連絡先・自由記述・添付）は Firestore に保存せずメール送信のみで中野氏に届ける。

**Tech Stack:** Cloudflare Workers (fetch + Web Crypto + Cloudflare Mail Channels)、Firebase Firestore (REST API)、HTML/Vanilla JS (ES Modules)、Node.js `node --test` (Worker/フロントエンド純関数のテスト)

設計書: `docs/superpowers/specs/2026-05-20-company-setup-intake-form-design.md`

---

## File Structure

### 新規ファイル
- `worker/src/setup-request/token.js` — 招待トークン生成・hash・検証（純関数）
- `worker/src/setup-request/validate.js` — Worker 側ペイロード検証（純関数）
- `worker/src/setup-request/mail.js` — Cloudflare Mail Channels API 呼出（純関数）
- `worker/src/setup-request/firestore.js` — companySetupRequests への CRUD（Firestore REST 呼出）
- `worker/src/setup-request/handler.js` — 4 endpoint のハンドラ（issueUrl / validateToken / submit / archive）
- `worker/src/auth/verify-id-token.js` — Firebase Auth ID Token 検証（純関数 + JWKs キャッシュ）
- `js/setup-request-validate.js` — フォーム値検証（純関数・フロントエンド）
- `js/setup-request-app.js` — フォーム DOM 配線（トークン検証・送信処理）
- `setup-request.html` — ヒアリングフォーム本体
- `tests/setup-request-validate.test.js` — フロントエンド純関数テスト
- `tests/setup-request-token.test.js` — Worker トークン純関数テスト（Worker は node 直接実行できる純関数のみ）
- `tests/setup-request-payload-validate.test.js` — Worker ペイロード検証テスト

### 既存ファイル変更
- `worker/src/index.js` — ルータに /setup-request/* 4ルートを追加
- `worker/wrangler.toml` — MAIL_FROM / MAIL_TO 環境変数追加
- `admin.html` — 「📨 ヒアリングURL発行」「📥 申請レビュー」セクション追加、「🏢 会社管理」の取込モード対応
- `js/admin-companies.js` — 取込フォーム事前入力 / 取込完了マークの純関数追加
- `js/firebase-storage.js` — `adminListSetupRequests()`, `adminImportSetupRequest()` 追加
- `firestore.rules` — `companySetupRequests/{id}` のルール追加
- `sw.js` — 新規 HTML/JS を STATIC_FILES に登録、CACHE_PREFIX bump

---

## Task 1: ヒアリングフォーム値検証の純関数

**Files:**
- Create: `js/setup-request-validate.js`
- Create: `tests/setup-request-validate.test.js`

- [ ] **Step 1: 失敗するテストを書く** `tests/setup-request-validate.test.js`

```javascript
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
```

- [ ] **Step 2: テストを実行して失敗を確認**

```bash
cd "/Users/hideakimacbookair/Library/Mobile Documents/com~apple~CloudDocs/タクシー乗務アプリ/タクシー日報-wt-setup-intake"
node --test tests/setup-request-validate.test.js
```
期待: `Cannot find module ...js/setup-request-validate.js` でFAIL

- [ ] **Step 3: 純関数を実装** `js/setup-request-validate.js`

```javascript
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
```

- [ ] **Step 4: テスト合格を確認**

```bash
node --test tests/setup-request-validate.test.js
```
期待: 全テスト PASS（16件）

- [ ] **Step 5: コミット**

```bash
cd "/Users/hideakimacbookair/Library/Mobile Documents/com~apple~CloudDocs/タクシー乗務アプリ/タクシー日報-wt-setup-intake"
git add js/setup-request-validate.js tests/setup-request-validate.test.js
git commit -m "feat(setup-request): フォーム値検証の純関数を追加"
```

---

## Task 2: Worker 招待トークン純関数

**Files:**
- Create: `worker/src/setup-request/token.js`
- Create: `tests/setup-request-token.test.js`

- [ ] **Step 1: 失敗するテストを書く** `tests/setup-request-token.test.js`

```javascript
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { generateToken, hashToken } from '../worker/src/setup-request/token.js';

test('generateToken: 64文字のランダム文字列を返す', () => {
  const t = generateToken();
  assert.equal(t.length, 64);
  assert.match(t, /^[a-z0-9]+$/);
});

test('generateToken: 連続呼出で異なる値', () => {
  const a = generateToken();
  const b = generateToken();
  assert.notEqual(a, b);
});

test('hashToken: 同じ入力で同じ hash', async () => {
  const t = 'sample-token';
  const a = await hashToken(t);
  const b = await hashToken(t);
  assert.equal(a, b);
});

test('hashToken: SHA-256 16進数64文字', async () => {
  const h = await hashToken('sample');
  assert.equal(h.length, 64);
  assert.match(h, /^[0-9a-f]{64}$/);
});

test('hashToken: 異なる入力で異なる hash', async () => {
  const a = await hashToken('a');
  const b = await hashToken('b');
  assert.notEqual(a, b);
});
```

- [ ] **Step 2: テスト失敗を確認**

```bash
node --test tests/setup-request-token.test.js
```
期待: モジュール未存在で FAIL

- [ ] **Step 3: 純関数を実装** `worker/src/setup-request/token.js`

```javascript
// worker/src/setup-request/token.js — 招待トークン生成・hash 化（純関数）
// Node.js (テスト時) と Cloudflare Workers (本番時) の両方で動く Web Crypto を使う。

const TOKEN_BYTES = 32; // 32 bytes -> 64 hex chars

export function generateToken() {
  const buf = new Uint8Array(TOKEN_BYTES);
  crypto.getRandomValues(buf);
  return bytesToHex(buf);
}

export async function hashToken(token) {
  const data = new TextEncoder().encode(String(token));
  const buf = await crypto.subtle.digest('SHA-256', data);
  return bytesToHex(new Uint8Array(buf));
}

function bytesToHex(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}
```

- [ ] **Step 4: テスト合格を確認**

```bash
node --test tests/setup-request-token.test.js
```
期待: 全テスト PASS

- [ ] **Step 5: コミット**

```bash
git add worker/src/setup-request/token.js tests/setup-request-token.test.js
git commit -m "feat(worker): 招待トークン生成・hash純関数を追加"
```

---

## Task 3: Worker ペイロード検証純関数

**Files:**
- Create: `worker/src/setup-request/validate.js`
- Create: `tests/setup-request-payload-validate.test.js`

- [ ] **Step 1: 失敗するテストを書く** `tests/setup-request-payload-validate.test.js`

```javascript
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
```

- [ ] **Step 2: テスト失敗を確認**

```bash
node --test tests/setup-request-payload-validate.test.js
```
期待: FAIL

- [ ] **Step 3: Worker 検証純関数を実装** `worker/src/setup-request/validate.js`

```javascript
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
```

- [ ] **Step 4: テスト合格を確認**

```bash
node --test tests/setup-request-payload-validate.test.js
```
期待: 全テスト PASS

- [ ] **Step 5: コミット**

```bash
git add worker/src/setup-request/validate.js tests/setup-request-payload-validate.test.js
git commit -m "feat(worker): setup-request ペイロード検証純関数を追加"
```

---

## Task 4: Firebase Auth ID Token 検証純関数（admin 認証用）

**Files:**
- Create: `worker/src/auth/verify-id-token.js`
- Create: `tests/verify-id-token.test.js`

実装方針: Worker から admin 認証付き endpoint を叩くとき、ブラウザは Firebase Auth ID Token を `Authorization: Bearer <token>` で送る。Worker は Google の公開 JWKs を取得して JWT 署名検証し、`aud` / `iss` / `exp` をチェック、`sub` (UID) が ADMIN_UIDS に含まれるか確認する。

ADMIN_UIDS は環境変数で投入。

- [ ] **Step 1: 失敗するテストを書く** `tests/verify-id-token.test.js`

```javascript
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { parseJwtUnsafe, isAdminUid } from '../worker/src/auth/verify-id-token.js';

test('parseJwtUnsafe: 正常な JWT を分解できる', () => {
  // payload: {"sub":"abc","iat":1,"exp":2}
  const header = btoa(JSON.stringify({ alg: 'RS256' })).replace(/=+$/, '');
  const payload = btoa(JSON.stringify({ sub: 'abc', iat: 1, exp: 2 })).replace(/=+$/, '');
  const fake = `${header}.${payload}.signature`;
  const parsed = parseJwtUnsafe(fake);
  assert.equal(parsed.payload.sub, 'abc');
});

test('parseJwtUnsafe: 不正な形式なら null', () => {
  assert.equal(parseJwtUnsafe('not-a-jwt'), null);
  assert.equal(parseJwtUnsafe('a.b'), null);
  assert.equal(parseJwtUnsafe(''), null);
});

test('isAdminUid: 含まれていれば true', () => {
  assert.equal(isAdminUid('uid_a', ['uid_a', 'uid_b']), true);
});

test('isAdminUid: 含まれていなければ false', () => {
  assert.equal(isAdminUid('uid_x', ['uid_a', 'uid_b']), false);
});

test('isAdminUid: ADMIN_UIDS が空配列なら false', () => {
  assert.equal(isAdminUid('uid_a', []), false);
});

test('isAdminUid: ADMIN_UIDS が null/undefined でも false', () => {
  assert.equal(isAdminUid('uid_a', null), false);
  assert.equal(isAdminUid('uid_a', undefined), false);
});
```

- [ ] **Step 2: テスト失敗を確認**

```bash
node --test tests/verify-id-token.test.js
```
期待: FAIL

- [ ] **Step 3: 実装** `worker/src/auth/verify-id-token.js`

```javascript
// worker/src/auth/verify-id-token.js
// Firebase Auth ID Token 検証 (Worker 用)
//
// 流れ:
//   1. Authorization: Bearer <id_token> から JWT を取り出す
//   2. Google の公開 JWKs を取得（kid で対応する鍵を選ぶ）
//   3. RS256 で署名検証
//   4. payload の aud (=FIREBASE_PROJECT_ID), iss (=https://securetoken.google.com/<project>),
//      exp (未来) を検証
//   5. payload.sub (=UID) を返す
//
// 公開 JWKs は isolate 内でキャッシュ（24時間）。

const JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/metadata/x509/securetoken@system.gserviceaccount.com';

let jwksCache = null; // { keys, fetchedAt }
const JWKS_TTL_MS = 24 * 60 * 60 * 1000;

export function parseJwtUnsafe(jwt) {
  try {
    if (typeof jwt !== 'string') return null;
    const parts = jwt.split('.');
    if (parts.length !== 3) return null;
    const header = JSON.parse(atob(parts[0].replace(/-/g, '+').replace(/_/g, '/')));
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    return { header, payload, signaturePart: parts[2], headerB64: parts[0], payloadB64: parts[1] };
  } catch {
    return null;
  }
}

export function isAdminUid(uid, adminUids) {
  if (!Array.isArray(adminUids)) return false;
  if (!uid) return false;
  return adminUids.includes(uid);
}

export async function verifyFirebaseIdToken(idToken, projectId) {
  const parsed = parseJwtUnsafe(idToken);
  if (!parsed) throw new Error('invalid_token');
  const { header, payload } = parsed;
  if (header.alg !== 'RS256') throw new Error('alg_unsupported');

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp < now) throw new Error('expired');
  if (payload.aud !== projectId) throw new Error('aud_mismatch');
  if (payload.iss !== `https://securetoken.google.com/${projectId}`) throw new Error('iss_mismatch');
  if (!payload.sub) throw new Error('no_sub');

  const jwks = await getJwks();
  const cert = jwks[header.kid];
  if (!cert) throw new Error('kid_not_found');

  const key = await importX509(cert);
  const data = new TextEncoder().encode(parsed.headerB64 + '.' + parsed.payloadB64);
  const sig = base64UrlToBytes(parsed.signaturePart);
  const ok = await crypto.subtle.verify(
    { name: 'RSASSA-PKCS1-v1_5' }, key, sig, data,
  );
  if (!ok) throw new Error('signature_invalid');
  return { uid: payload.sub };
}

async function getJwks() {
  const now = Date.now();
  if (jwksCache && (now - jwksCache.fetchedAt) < JWKS_TTL_MS) return jwksCache.keys;
  const res = await fetch(JWKS_URL);
  if (!res.ok) throw new Error('jwks_fetch_failed');
  const keys = await res.json();
  jwksCache = { keys, fetchedAt: now };
  return keys;
}

async function importX509(certPem) {
  const b64 = certPem
    .replace(/-----BEGIN CERTIFICATE-----/, '')
    .replace(/-----END CERTIFICATE-----/, '')
    .replace(/\s+/g, '');
  const der = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  // X.509 から SPKI を取り出す: Cloudflare Workers は importKey('spki') で証明書ファイル
  // バイナリのうち SubjectPublicKeyInfo を渡す必要がある。証明書全体を渡しても importKey は
  // 失敗するため、Google が公開している証明書 PEM そのものを importKey('x509') 相当で扱う。
  // ※ Workers は spki のみ対応。回避: 既知の公開鍵を直接 importKey('jwk') で扱う API も
  // 検討可能だが、Google の x509 endpoint は PEM 証明書を返す。実装では下記 ASN.1 抽出を行う。
  const spki = extractSpkiFromCertificate(der);
  return crypto.subtle.importKey(
    'spki', spki,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['verify'],
  );
}

// 簡易 ASN.1 パーサで X.509 証明書から SubjectPublicKeyInfo (SPKI) を抽出する。
// 既知形式: SEQUENCE { tbsCertificate, signatureAlgorithm, signatureValue }
// tbsCertificate の SubjectPublicKeyInfo は固定インデックスではないため、TBS の中で
// 6番目（v3 cert）の SEQUENCE を抽出する。Google の Firebase 証明書は v3 で安定。
function extractSpkiFromCertificate(certDer) {
  // 軽量実装: tbsCertificate を走査して SubjectPublicKeyInfo SEQUENCE を見つける。
  // 詳細は実装時に asn1-parser 風ロジックを書く（依存追加なし）。
  // ※ 実装時はオンライン ASN.1 デコーダで Firebase 証明書のオフセットを確認し、
  // 必要なら hard-coded offset での抽出にする（Firebase の証明書は構造が安定）。
  let i = 0;
  function readLen(b, p) {
    let len = b[p++]; if (len & 0x80) {
      const n = len & 0x7f; len = 0;
      for (let j = 0; j < n; j++) len = (len << 8) | b[p++];
    }
    return { len, p };
  }
  function skip(b, p) {
    p++; // tag
    const { len, p: p2 } = readLen(b, p);
    return p2 + len;
  }
  function descend(b, p) {
    p++; // SEQUENCE tag
    const { p: p2 } = readLen(b, p);
    return p2;
  }
  i = descend(certDer, 0); // outer SEQUENCE
  // tbsCertificate
  const tbsStart = i;
  i++; // tag
  const { len: tbsLen, p: tbsContentStart } = readLen(certDer, i);
  const tbsEnd = tbsContentStart + tbsLen;
  i = tbsContentStart;
  // skip: version [0] explicit, serialNumber INTEGER, signature SEQUENCE,
  //       issuer SEQUENCE, validity SEQUENCE, subject SEQUENCE
  // 次の SEQUENCE が SubjectPublicKeyInfo
  let skipped = 0;
  while (skipped < 6 && i < tbsEnd) {
    i = skip(certDer, i);
    skipped++;
  }
  // 現在位置が SubjectPublicKeyInfo の先頭
  const spkiStart = i;
  i++; // tag
  const { len: spkiLen, p: spkiContentStart } = readLen(certDer, i);
  const spkiEnd = spkiContentStart + spkiLen;
  return certDer.slice(spkiStart, spkiEnd);
}

function base64UrlToBytes(b64url) {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 ? 4 - (b64.length % 4) : 0;
  const bin = atob(b64 + '='.repeat(pad));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
```

- [ ] **Step 4: テスト合格を確認**

```bash
node --test tests/verify-id-token.test.js
```
期待: parseJwtUnsafe / isAdminUid のテスト PASS（verifyFirebaseIdToken は実 Firebase JWKs が必要なため結合テストで検証）

- [ ] **Step 5: コミット**

```bash
git add worker/src/auth/verify-id-token.js tests/verify-id-token.test.js
git commit -m "feat(worker): Firebase Auth ID Token 検証ヘルパーを追加"
```

---

## Task 5: Firestore Rules 追加（companySetupRequests）

**Files:**
- Modify: `firestore.rules`

- [ ] **Step 1: firestore.rules を開いて現状確認**

```bash
cd "/Users/hideakimacbookair/Library/Mobile Documents/com~apple~CloudDocs/タクシー乗務アプリ/タクシー日報-wt-setup-intake"
grep -n "match /" firestore.rules
```

- [ ] **Step 2: companySetupRequests 用ルールを追加**

`firestore.rules` の `match /databases/{database}/documents { ... }` の中、`companies/{slug}` ルールの直下に追記:

```
    // ヒアリング申請（companySetupRequests）— 中野氏オンボーディング用
    // - read: admin のみ（既存 admin ヘルパーで判定）
    // - write: 全クライアントから不可。Worker (Service Account) のみが書ける。
    match /companySetupRequests/{requestId} {
      allow read: if isAdmin();
      allow write: if false;
    }
```

`isAdmin()` が既存ヘルパー関数として定義されているか確認:
```bash
grep -n "function isAdmin" firestore.rules
```
無い場合は既存 ルールでの admin 判定パターン（user_self / mm 等の UID リスト）を流用する形で関数化する。既存にあるパターン名に合わせること。

- [ ] **Step 3: dev に rules を deploy**

```bash
firebase deploy --only firestore:rules --project taxi-dailydata-dev
```
期待: `+ firestore: released rules`

- [ ] **Step 4: コミット**

```bash
git add firestore.rules
git commit -m "feat(rules): companySetupRequests のルールを追加（admin read のみ）"
```

---

## Task 6: Worker Firestore CRUD ヘルパー（companySetupRequests）

**Files:**
- Create: `worker/src/setup-request/firestore.js`

Firestore REST API を Service Account 経由で叩くヘルパー。`worker/src/index.js` の既存 `getAccessToken(env)` `firestoreDocPath(env, ...)` パターンを参考にする。

- [ ] **Step 1: 実装** `worker/src/setup-request/firestore.js`

```javascript
// worker/src/setup-request/firestore.js
// companySetupRequests コレクションへの CRUD（Firestore REST API）

const FIRESTORE_BASE = 'https://firestore.googleapis.com/v1';
const COLLECTION = 'companySetupRequests';

function basePath(projectId) {
  return `${FIRESTORE_BASE}/projects/${projectId}/databases/(default)/documents/${COLLECTION}`;
}

// pending 状態で新規作成。reqId はサーバ側で生成（auto-id）。
export async function createPendingRequest({ accessToken, projectId, doc }) {
  const url = `${basePath(projectId)}`; // POST = auto-id
  const body = { fields: encodeFields(doc) };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`createPendingRequest: ${res.status} ${await res.text()}`);
  const created = await res.json();
  // created.name = "projects/{pid}/databases/(default)/documents/companySetupRequests/{id}"
  const requestId = created.name.split('/').pop();
  return { requestId };
}

// tokenHash で検索 (Firestore runQuery で structuredQuery)
export async function findRequestByTokenHash({ accessToken, projectId, tokenHash }) {
  const url = `${FIRESTORE_BASE}/projects/${projectId}/databases/(default)/documents:runQuery`;
  const body = {
    structuredQuery: {
      from: [{ collectionId: COLLECTION }],
      where: {
        fieldFilter: {
          field: { fieldPath: 'tokenHash' },
          op: 'EQUAL',
          value: { stringValue: tokenHash },
        },
      },
      limit: 1,
    },
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`findRequestByTokenHash: ${res.status} ${await res.text()}`);
  const arr = await res.json();
  for (const row of arr) {
    if (row.document) {
      const requestId = row.document.name.split('/').pop();
      return { requestId, doc: decodeFields(row.document.fields) };
    }
  }
  return null;
}

// 既存ドキュメントを updateMask 付きで部分更新
export async function patchRequest({ accessToken, projectId, requestId, updates, removeFields = [] }) {
  const params = new URLSearchParams();
  const fieldsToUpdate = Object.keys(updates);
  for (const f of fieldsToUpdate) params.append('updateMask.fieldPaths', f);
  for (const f of removeFields) params.append('updateMask.fieldPaths', f);
  const url = `${basePath(projectId)}/${requestId}?${params.toString()}`;
  const body = { fields: encodeFields(updates) };
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`patchRequest: ${res.status} ${await res.text()}`);
  return await res.json();
}

// Firestore JSON 値エンコード（既存 worker/src/index.js の同名関数と同様の単純版）
export function encodeFields(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    out[k] = toFirestoreValue(v);
  }
  return out;
}

function toFirestoreValue(v) {
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v)
    ? { integerValue: String(v) }
    : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toFirestoreValue) } };
  if (typeof v === 'object') {
    const mapFields = {};
    for (const [k2, v2] of Object.entries(v)) {
      if (v2 !== undefined && v2 !== null) mapFields[k2] = toFirestoreValue(v2);
    }
    return { mapValue: { fields: mapFields } };
  }
  return { stringValue: String(v) };
}

export function decodeFields(fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields || {})) {
    out[k] = fromFirestoreValue(v);
  }
  return out;
}

function fromFirestoreValue(v) {
  if ('stringValue' in v) return v.stringValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fromFirestoreValue);
  if ('mapValue' in v) return decodeFields(v.mapValue.fields || {});
  return null;
}
```

- [ ] **Step 2: 構文チェック（lint なしの場合は手元 import で確認）**

```bash
node -e "import('./worker/src/setup-request/firestore.js').then(m => console.log(Object.keys(m)))"
```
期待: `[ 'createPendingRequest', 'findRequestByTokenHash', 'patchRequest', 'encodeFields', 'decodeFields' ]`

- [ ] **Step 3: コミット**

```bash
git add worker/src/setup-request/firestore.js
git commit -m "feat(worker): companySetupRequests CRUD ヘルパーを追加"
```

---

## Task 7: Worker Cloudflare Mail Channels 純関数

**Files:**
- Create: `worker/src/setup-request/mail.js`

Cloudflare Mail Channels API (`https://api.mailchannels.net/tx/v1/send`) を fetch で呼ぶ。

- [ ] **Step 1: 実装** `worker/src/setup-request/mail.js`

```javascript
// worker/src/setup-request/mail.js
// Cloudflare Mail Channels API でメールを送信する（純関数 + fetch）。
// 添付は base64 で乗せる。

const MAIL_API = 'https://api.mailchannels.net/tx/v1/send';

/**
 * Send a notification mail to admin.
 * @param {Object} args
 * @param {string} args.from - "noreply@taxicabis.com" 形式
 * @param {string} args.to   - 中野氏のメールアドレス
 * @param {string} args.subject
 * @param {string} args.text - プレーンテキスト本文
 * @param {Array<{filename:string, contentBase64:string, type:string}>} args.attachments
 * @returns {Promise<{ok:boolean, status:number, body:string}>}
 */
export async function sendMail({ from, to, subject, text, attachments = [] }) {
  const body = {
    personalizations: [{ to: [{ email: to }] }],
    from: { email: from },
    subject,
    content: [{ type: 'text/plain', value: text }],
    attachments: attachments.map((a) => ({
      filename: a.filename,
      type: a.type,
      content: a.contentBase64, // base64 ascii
    })),
  };
  const res = await fetch(MAIL_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { ok: res.ok, status: res.status, body: await res.text() };
}

/** メール本文をテンプレートから生成 */
export function buildAdminNotificationBody({
  requestId,
  assignedSlug,
  submittedAt,
  contact,
  config,
  notes,
  rateTableText,
  rateTableSource,
  attachmentSummaries,
}) {
  const lines = [];
  lines.push('中野様');
  lines.push('');
  lines.push('ヒアリングフォームから申請が届きました。');
  lines.push('admin の「📥 申請レビュー」で内容を確認・取込してください。');
  lines.push('');
  lines.push('──────────────────────────────────');
  lines.push(`■ 申請ID:    ${requestId}`);
  lines.push(`■ 割当slug:  ${assignedSlug}`);
  lines.push('   （Notes.app の slug マップでどの会社かご確認ください）');
  lines.push(`■ 受付時刻:  ${submittedAt}`);
  lines.push('');
  lines.push('■ 連絡先（フォーム記入内容・Firestoreには保存していません）');
  lines.push(`   会社名:     ${contact.companyName}`);
  lines.push(`   担当者:     ${contact.name}`);
  lines.push(`   メール:     ${contact.email}`);
  if (contact.phone) lines.push(`   電話:       ${contact.phone}`);
  lines.push('');
  lines.push('■ 給与モード: ' + config.payrollMode);
  lines.push('■ プラン:     ' + config.plan);
  lines.push(`■ 手取り率:   ${config.takeHomeRate}`);
  lines.push(`■ 責任出番数: ${config.responsibilityShifts}`);
  lines.push(`■ 有給金額:   ${config.paidLeaveAmount}`);
  lines.push(`■ インセンティブ: 閾値 ${config.premiumIncentive.thresholdSalesExclTax} / 額 ${config.premiumIncentive.amountPerShift}`);
  if (config.payrollMode === 'fixed_rate') {
    lines.push(`■ 固定率:     ${config.fixedRate}`);
  }
  if (config.defaultRecArea) {
    lines.push(`■ 営業地デフォルト: ${config.defaultRecArea}`);
  }
  if (config.payrollMode === 'step_rate') {
    lines.push(`■ 歩率記入方法: ${rateTableSource}`);
    if (config.rateTable && config.rateTable.numeric) {
      lines.push('   ─ 数値入力 ─');
      const entries = Object.entries(config.rateTable.numeric)
        .sort((a, b) => Number(a[0]) - Number(b[0]));
      for (const [shift, rate] of entries) {
        lines.push(`     ${shift}乗務目: ${rate}`);
      }
    }
    if (rateTableText) {
      lines.push('   ─ 自由テキスト（Firestore未保存）─');
      for (const line of rateTableText.split('\n')) lines.push('     ' + line);
    }
    if (attachmentSummaries && attachmentSummaries.length > 0) {
      lines.push('   ─ 添付ファイル ─');
      for (const a of attachmentSummaries) {
        lines.push(`     ・${a.filename} (${a.size} bytes)`);
      }
    }
  }
  if (notes) {
    lines.push('');
    lines.push('■ 自由記述（フォーム記入内容・Firestoreには保存していません）');
    for (const line of notes.split('\n')) lines.push('   ' + line);
  }
  lines.push('');
  lines.push('──────────────────────────────────');
  lines.push('admin URL: https://app.taxicabis.com/admin.html');
  lines.push('');
  lines.push('このメールは中野様の Notes.app の slug マップと突合する想定で、');
  lines.push('slug 以外の会社特定情報は admin 画面には表示されません。');
  return lines.join('\n');
}
```

- [ ] **Step 2: コミット**

```bash
git add worker/src/setup-request/mail.js
git commit -m "feat(worker): Cloudflare Mail Channels 送信ヘルパーとメール本文ビルダーを追加"
```

---

## Task 8: Worker /setup-request/issue-url ハンドラ実装

**Files:**
- Create: `worker/src/setup-request/handler.js`
- Modify: `worker/src/index.js`

- [ ] **Step 1: ハンドラを実装** `worker/src/setup-request/handler.js`

```javascript
// worker/src/setup-request/handler.js
// /setup-request/* 4 endpoint のハンドラ

import { generateToken, hashToken } from './token.js';
import { validateSubmitPayload, validateIssueUrlPayload } from './validate.js';
import {
  createPendingRequest, findRequestByTokenHash, patchRequest,
} from './firestore.js';
import { sendMail, buildAdminNotificationBody } from './mail.js';
import { verifyFirebaseIdToken, isAdminUid } from '../auth/verify-id-token.js';

const EXPIRES_DAYS = 14;
const ALLOWED_ATTACHMENT_MIMES = ['application/pdf', 'image/jpeg', 'image/png'];
const MAX_ATTACHMENT_COUNT = 3;
const MAX_ATTACHMENT_TOTAL_BYTES = 10 * 1024 * 1024;

// ----- shared utils -----

function parseAdminUids(env) {
  // env.ADMIN_UIDS は "uid_a,uid_b,uid_c" 形式
  if (!env.ADMIN_UIDS) return [];
  return String(env.ADMIN_UIDS).split(',').map((s) => s.trim()).filter(Boolean);
}

async function requireAdmin(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  if (!m) throw new Error('admin_auth_missing');
  const idToken = m[1];
  const { uid } = await verifyFirebaseIdToken(idToken, env.FIREBASE_PROJECT_ID);
  if (!isAdminUid(uid, parseAdminUids(env))) throw new Error('admin_forbidden');
  return uid;
}

// ----- /setup-request/issue-url (POST, admin) -----

export async function handleIssueUrl(request, env, helpers) {
  await requireAdmin(request, env);
  const body = await request.json().catch(() => ({}));
  const v = validateIssueUrlPayload(body);
  if (!v.ok) return helpers.json({ error: v.error }, 400);

  // slug 生成（衝突避け: companies と pending companySetupRequests を見る）
  const assignedSlug = await helpers.generateUniqueSlug(env);

  const token = generateToken();
  const tokenHash = await hashToken(token);
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + EXPIRES_DAYS * 24 * 60 * 60 * 1000);

  const accessToken = await helpers.getAccessToken(env);
  const { requestId } = await createPendingRequest({
    accessToken,
    projectId: env.FIREBASE_PROJECT_ID,
    doc: {
      status: 'pending',
      assignedSlug,
      tokenHash,
      createdAt,
      expiresAt,
    },
  });

  const url = `${env.APP_BASE_URL}/setup-request.html?t=${token}`;
  return helpers.json({
    ok: true,
    requestId,
    assignedSlug,
    url,
    expiresAt: expiresAt.toISOString(),
  });
}

// ----- /setup-request/validate-token (GET) -----

export async function handleValidateToken(request, env, helpers) {
  const url = new URL(request.url);
  const t = url.searchParams.get('t') || '';
  if (!/^[0-9a-f]{64}$/.test(t)) {
    return helpers.json({ status: 'invalid' });
  }
  const tokenHash = await hashToken(t);
  const accessToken = await helpers.getAccessToken(env);
  const found = await findRequestByTokenHash({
    accessToken, projectId: env.FIREBASE_PROJECT_ID, tokenHash,
  });
  if (!found) return helpers.json({ status: 'invalid' });

  const doc = found.doc || {};
  if (doc.status !== 'pending') {
    return helpers.json({ status: doc.status === 'submitted' ? 'already_used' : 'archived' });
  }
  const now = Date.now();
  const expMs = doc.expiresAt ? new Date(doc.expiresAt).getTime() : 0;
  if (expMs < now) return helpers.json({ status: 'expired' });

  return helpers.json({
    status: 'valid',
    assignedSlug: doc.assignedSlug,
    expiresAt: doc.expiresAt,
  });
}

// ----- /setup-request/submit (POST, multipart/form-data) -----

export async function handleSubmit(request, env, helpers) {
  if (!request.headers.get('content-type')?.startsWith('multipart/form-data')) {
    return helpers.json({ error: 'content-type must be multipart/form-data' }, 415);
  }
  const form = await request.formData();
  const token = String(form.get('t') || '');
  const configJson = form.get('config');
  const contactJson = form.get('contact');
  const notes = String(form.get('notes') || '');
  const rateTableText = String(form.get('rateTableText') || '');
  const files = form.getAll('attachments').filter((f) => f && typeof f === 'object');

  // 添付ファイル MIME / サイズ検証
  if (files.length > MAX_ATTACHMENT_COUNT) {
    return helpers.json({ error: '添付ファイルは最大3枚までです' }, 400);
  }
  let total = 0;
  for (const f of files) {
    if (!ALLOWED_ATTACHMENT_MIMES.includes(f.type)) {
      return helpers.json({ error: '添付ファイルの形式は PDF / JPEG / PNG のみです' }, 400);
    }
    total += f.size;
  }
  if (total > MAX_ATTACHMENT_TOTAL_BYTES) {
    return helpers.json({ error: '添付ファイルの合計サイズは10MB以下にしてください' }, 400);
  }

  let config, contact;
  try {
    config = JSON.parse(String(configJson));
    contact = JSON.parse(String(contactJson));
  } catch {
    return helpers.json({ error: 'config/contact が JSON ではありません' }, 400);
  }

  const v = validateSubmitPayload({
    token, config, contact, notes, rateTableText,
    attachmentCount: files.length,
  });
  if (!v.ok) return helpers.json({ error: v.error }, 400);
  const rateTableSource = v.rateTableSource;

  // トークン検証 & Firestore 更新
  const tokenHash = await hashToken(token);
  const accessToken = await helpers.getAccessToken(env);
  const found = await findRequestByTokenHash({
    accessToken, projectId: env.FIREBASE_PROJECT_ID, tokenHash,
  });
  if (!found) return helpers.json({ error: 'token invalid' }, 400);
  if (found.doc.status !== 'pending') {
    return helpers.json({ error: 'token already used or archived' }, 409);
  }
  const now = Date.now();
  if (new Date(found.doc.expiresAt).getTime() < now) {
    return helpers.json({ error: 'token expired' }, 410);
  }

  // Firestore に submitted 状態で書き込み（個人特定情報は含めない）
  const docToWrite = {
    status: 'submitted',
    submittedAt: new Date(),
    config: stripPiiFromConfig(config, rateTableSource),
  };
  await patchRequest({
    accessToken,
    projectId: env.FIREBASE_PROJECT_ID,
    requestId: found.requestId,
    updates: docToWrite,
    removeFields: ['expiresAt'],
  });

  // メール送信用に添付を base64 化
  const attachmentSummaries = [];
  const attachmentsForMail = [];
  for (const f of files) {
    const buf = new Uint8Array(await f.arrayBuffer());
    let bin = '';
    for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
    attachmentsForMail.push({
      filename: f.name || 'attachment',
      type: f.type,
      contentBase64: btoa(bin),
    });
    attachmentSummaries.push({ filename: f.name, size: f.size });
  }

  // メール本文
  const text = buildAdminNotificationBody({
    requestId: found.requestId,
    assignedSlug: found.doc.assignedSlug,
    submittedAt: new Date().toISOString(),
    contact, config, notes, rateTableText, rateTableSource, attachmentSummaries,
  });

  const mailResult = await sendMail({
    from: env.MAIL_FROM,
    to: env.MAIL_TO,
    subject: `[Cabis申請] 新規ヒアリング申請が届きました (${found.doc.assignedSlug})`,
    text,
    attachments: attachmentsForMail,
  });
  if (!mailResult.ok) {
    console.error('mail send failed:', mailResult.status, mailResult.body);
    // 既に Firestore に書込済み、ドライバには成功を返す
  }

  return helpers.json({ ok: true, requestId: found.requestId });
}

// ----- /setup-request/archive (POST, admin) -----

export async function handleArchive(request, env, helpers) {
  await requireAdmin(request, env);
  const body = await request.json().catch(() => ({}));
  const requestId = String(body.requestId || '');
  if (!requestId) return helpers.json({ error: 'requestId required' }, 400);

  const accessToken = await helpers.getAccessToken(env);
  await patchRequest({
    accessToken,
    projectId: env.FIREBASE_PROJECT_ID,
    requestId,
    updates: { status: 'archived', archivedAt: new Date() },
    removeFields: ['config', 'tokenHash', 'expiresAt'],
  });
  return helpers.json({ ok: true });
}

// ----- internal helpers -----

function stripPiiFromConfig(config, rateTableSource) {
  // Firestore に保存するのは「数値・構造化情報」のみ。
  // contact / notes / rateTableText / 添付バイナリは保存しない。
  const out = {
    plan: config.plan,
    payrollMode: config.payrollMode,
    takeHomeRate: config.takeHomeRate,
    responsibilityShifts: config.responsibilityShifts,
    paidLeaveAmount: config.paidLeaveAmount,
    premiumIncentive: { ...config.premiumIncentive },
  };
  if (config.defaultRecArea) out.defaultRecArea = config.defaultRecArea;
  if (config.payrollMode === 'fixed_rate') out.fixedRate = config.fixedRate;
  if (config.payrollMode === 'step_rate') {
    out.rateTable = { source: rateTableSource || 'unknown' };
    const numeric = config.rateTable && config.rateTable.numeric;
    if (numeric && Object.keys(numeric).length > 0) out.rateTable.numeric = numeric;
    out.rateTable.hasText = !!(rateTableSource === 'text' || rateTableSource === 'mixed');
    out.rateTable.hasAttachment = !!(rateTableSource === 'attachment' || rateTableSource === 'mixed');
  }
  return out;
}
```

- [ ] **Step 2: index.js のルータに 4 ルートを追加** `worker/src/index.js`

既存 `fetch(request, env)` の if チェーンに以下を追記（`/verify-turnstile` の下）:

```javascript
if (request.method === 'POST' && path === '/setup-request/issue-url') {
  return await handleIssueUrl(request, env, helpersForSetupRequest(env));
}
if (request.method === 'GET' && path === '/setup-request/validate-token') {
  return await handleValidateToken(request, env, helpersForSetupRequest(env));
}
if (request.method === 'POST' && path === '/setup-request/submit') {
  return await handleSubmit(request, env, helpersForSetupRequest(env));
}
if (request.method === 'POST' && path === '/setup-request/archive') {
  return await handleArchive(request, env, helpersForSetupRequest(env));
}
```

ファイル先頭に import 追加:
```javascript
import {
  handleIssueUrl, handleValidateToken, handleSubmit, handleArchive,
} from './setup-request/handler.js';
```

ファイル末尾近くに helpers ファクトリを追加:
```javascript
function helpersForSetupRequest(env) {
  return {
    json: (obj, status = 200) => json(env, obj, status),
    getAccessToken: () => getAccessToken(env),
    generateUniqueSlug: async () => {
      // co-XXXXXX 形式・Crockford base32 lowercase 6文字
      // 既存 companies / pending companySetupRequests と衝突しないかチェック
      const alphabet = '0123456789abcdefghjkmnpqrstvwxyz';
      const accessToken = await getAccessToken(env);
      for (let attempt = 0; attempt < 5; attempt++) {
        let s = 'co-';
        const buf = new Uint8Array(6);
        crypto.getRandomValues(buf);
        for (let i = 0; i < 6; i++) s += alphabet[buf[i] % alphabet.length];
        // 衝突確認: companies/{s} を GET
        const url = `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/companies/${s}`;
        const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
        if (res.status === 404) return s;
        // 200 = 既存 → 次の attempt
      }
      throw new Error('slug 衝突回避失敗（5回試行）');
    },
  };
}
```

- [ ] **Step 3: wrangler.toml に環境変数を追加** `worker/wrangler.toml`

`[vars]` の末尾に追加:
```toml
MAIL_FROM = "noreply@taxicabis.com"
MAIL_TO = "haqei64384@gmail.com"
ADMIN_UIDS = "user_self,mm"   # ← 実際の Firebase Auth UID に置換が必要
```

`[env.production.vars]` の末尾にも同じく追加（MAIL_TO は同じ、ADMIN_UIDS は本番の UID）:
```toml
MAIL_FROM = "noreply@taxicabis.com"
MAIL_TO = "haqei64384@gmail.com"
ADMIN_UIDS = "user_self,mm"
```

⚠️ ADMIN_UIDS の値は中野氏が Firebase Console で実 UID を確認して差し替える（Auth → Users から uid_self / uid_mm 等の sub 値）。

- [ ] **Step 4: 構文チェック**

```bash
node -e "import('./worker/src/setup-request/handler.js').then(m => console.log(Object.keys(m)))"
```

- [ ] **Step 5: コミット**

```bash
git add worker/src/setup-request/handler.js worker/src/index.js worker/wrangler.toml
git commit -m "feat(worker): /setup-request/* 4 endpoint を追加（issue-url/validate-token/submit/archive）"
```

---

## Task 9: ヒアリングフォーム HTML 骨格

**Files:**
- Create: `setup-request.html`

- [ ] **Step 1: HTML 骨格を作る** `setup-request.html`

```html
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>Cabis ｜ 会社情報ヒアリング</title>
  <meta name="description" content="Cabis を貴社で使うための給与設定ヒアリングフォーム">
  <link rel="stylesheet" href="css/style.css?v=1">
  <style>
    body { padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left); }
    .setup-card { max-width:640px; margin:24px auto; padding:20px; background:#fff;
      border:1px solid var(--border); border-radius:12px; }
    .setup-section { margin-top:24px; padding-top:16px; border-top:1px solid var(--border); }
    .setup-section:first-of-type { border-top:none; padding-top:0; }
    .setup-section h3 { font-size:15px; margin:0 0 8px; }
    .help-text { font-size:11px; color:#888; margin-top:4px; }
    .warn-box { background:#fff3cd; border:1px solid #ffc107; border-radius:6px; padding:10px;
      font-size:12px; color:#856404; margin:12px 0; }
    .ok-box { background:#d4edda; border:1px solid #28a745; border-radius:6px; padding:10px;
      font-size:12px; color:#155724; margin:12px 0; }
    .err-box { background:#f8d7da; border:1px solid #dc3545; border-radius:6px; padding:10px;
      font-size:12px; color:#721c24; margin:12px 0; }
    .rate-row { display:grid; grid-template-columns: 90px 1fr 30px; gap:6px; align-items:center; margin:4px 0; }
    .attach-list { font-size:11px; color:#555; margin-top:6px; }
    .attach-list li { margin:2px 0; }
    .gate-screen { max-width:480px; margin:60px auto; padding:24px; text-align:center; }
    .gate-screen h2 { font-size:18px; margin:0 0 12px; }
  </style>
</head>
<body>

  <!-- 検証中 -->
  <div id="gateValidating" class="gate-screen">
    <p>URLを検証中です...</p>
  </div>

  <!-- 無効・期限切れ・使用済み -->
  <div id="gateError" class="gate-screen" style="display:none;">
    <h2>このURLは無効です</h2>
    <p class="help-text" id="gateErrorMsg"></p>
    <p style="margin-top:16px;">
      <a href="mailto:haqei64384@gmail.com">Cabis 開発者に連絡する</a>
    </p>
  </div>

  <!-- 送信完了 -->
  <div id="gateDone" class="gate-screen" style="display:none;">
    <h2>✓ 送信しました</h2>
    <p class="help-text">Cabis 開発者が内容を確認後、<br>
       ご登録に必要な URL をメールでお送りします。<br>
       通常 1〜3 営業日です。</p>
  </div>

  <!-- フォーム本体 -->
  <main id="setupForm" class="setup-card" style="display:none;">
    <h2 style="margin:0 0 8px;">🚕 Cabis 会社情報ヒアリング</h2>
    <p class="help-text">
      Cabis を貴社で使うための給与設定を教えてください。所要時間: 5〜10分
    </p>
    <p class="help-text" style="margin-top:6px;">
      ・送信先: Cabis 開発者 中野<br>
      ・送信後の変更: 中野までご連絡
    </p>

    <!-- 1. 連絡先 -->
    <section class="setup-section">
      <h3>1. 連絡先</h3>
      <p class="help-text">※ サーバには保存しません（メール本文・添付として中野氏に届くのみ）</p>

      <label class="muted">会社名 *</label>
      <input class="input" id="companyName" type="text" required>

      <label class="muted" style="margin-top:8px;display:block;">お名前 *</label>
      <input class="input" id="contactName" type="text" required>

      <label class="muted" style="margin-top:8px;display:block;">メール *</label>
      <input class="input" id="contactEmail" type="email" required>

      <label class="muted" style="margin-top:8px;display:block;">電話（任意）</label>
      <input class="input" id="contactPhone" type="tel">
    </section>

    <!-- 2. 給与モード -->
    <section class="setup-section">
      <h3>2. 給与の決まり方</h3>
      <p class="help-text">給与明細を見て「売上 × 一定の率」なら固定、「乗務回数によって率が変わる」なら変動</p>

      <label><input type="radio" name="payrollMode" value="step_rate"> 変動歩率</label><br>
      <label><input type="radio" name="payrollMode" value="fixed_rate" checked> 固定歩率</label><br>
      <label><input type="radio" name="payrollMode" value="monthly"> 月給制</label>

      <div id="monthlyNote" class="warn-box" style="display:none;">
        月給制は現在このフォームでは未対応です。<br>
        <a href="mailto:haqei64384@gmail.com">直接ご相談</a> いただけますと幸いです。
      </div>
    </section>

    <!-- 3. 歩率（モード別動的表示） -->
    <section class="setup-section" id="rateSection">
      <h3>3. 歩率</h3>

      <!-- 固定歩率 -->
      <div id="fixedRateBlock">
        <label class="muted">固定の歩合率（%）</label>
        <input class="input" id="fixedRate" type="number" step="0.1" min="0" max="100" value="55">
      </div>

      <!-- 変動歩率: 数値入力 -->
      <div id="stepRateBlock" style="display:none;">
        <p class="help-text">記入方法は3パターン。<strong>1つ以上</strong>埋めてください。</p>

        <details open>
          <summary>▼ パターン1: 数値で入力</summary>
          <div id="numericRateRows" style="margin-top:8px;">
            <!-- 11行を JS で生成 -->
          </div>
          <div class="rate-row" style="margin-top:8px;">
            <label class="muted">12乗務目以降（固定%）</label>
            <input class="input" id="numericFinalRate" type="number" step="0.1" min="0" max="100" value="">
            <span>%</span>
          </div>
        </details>

        <details>
          <summary>▼ パターン2: 自由テキストで書く</summary>
          <textarea id="rateTableText" class="input" rows="6" style="width:100%;margin-top:8px;"
            placeholder="例: 売上40万未満は1〜11乗務目55%、12乗務目以降50%。売上40万以上60万未満は..."></textarea>
        </details>

        <details>
          <summary>▼ パターン3: 給与規程の書類を添付</summary>
          <p class="help-text">PDF / JPEG / PNG / 最大3枚 / 計10MBまで</p>
          <input id="attachments" type="file" accept="application/pdf,image/jpeg,image/png" multiple>
          <ul class="attach-list" id="attachmentList"></ul>
        </details>
      </div>
    </section>

    <!-- 4. その他の給与設定 -->
    <section class="setup-section">
      <h3>4. その他の給与設定</h3>

      <label class="muted">手取りに残る割合（%）</label>
      <input class="input" id="takeHomeRate" type="number" step="0.01" min="50" max="100" value="75">
      <p class="help-text">通常 70〜80%。分からなければ 75 でOK</p>

      <label class="muted" style="margin-top:8px;display:block;">責任出番数（回/月度）</label>
      <input class="input" id="responsibilityShifts" type="number" step="1" min="1" max="30" value="11">

      <label class="muted" style="margin-top:8px;display:block;">有給1日あたりの金額（円）</label>
      <input class="input" id="paidLeaveAmount" type="number" step="100" min="0" value="39340">
    </section>

    <!-- 5. インセンティブ -->
    <section class="setup-section">
      <h3>5. 売上達成インセンティブ</h3>
      <label class="muted">1日あたり（円・税抜）</label>
      <input class="input" id="incentiveThreshold" type="number" step="1000" min="0" value="80000">

      <label class="muted" style="margin-top:8px;display:block;">以上売り上げた日、出番ごとに（円）</label>
      <input class="input" id="incentiveAmount" type="number" step="100" min="0" value="2000">

      <label class="muted" style="margin-top:8px;display:block;">
        <input type="checkbox" id="incentiveNone"> インセンティブ無し
      </label>
    </section>

    <!-- 6. 営業地デフォルト -->
    <section class="setup-section">
      <h3>6. 営業地デフォルト（任意）</h3>
      <input class="input" id="defaultRecArea" type="text" placeholder="千代田区丸の内">
      <p class="help-text">アプリの「営業サポート」初期表示に使用。空欄なら丸の内</p>
    </section>

    <!-- 7. プラン -->
    <section class="setup-section">
      <h3>7. プラン（中野氏との合意済み）</h3>
      <select class="select" id="plan">
        <option value="partner">提携プラン（partner）</option>
        <option value="normal">通常プラン（normal）</option>
      </select>
    </section>

    <!-- 8. 補足 -->
    <section class="setup-section">
      <h3>8. その他ご要望・補足（任意）</h3>
      <textarea id="notes" class="input" rows="4" style="width:100%;"
        placeholder="繁忙期は歩率1%上乗せ等の補足"></textarea>
      <p class="help-text">※ サーバには保存しません（メール本文として中野氏に届くのみ）</p>
    </section>

    <!-- 送信 -->
    <section class="setup-section">
      <button class="btn" id="submitBtn" style="width:100%;background:var(--primary);color:#fff;font-size:16px;padding:12px;">
        📨 送信する
      </button>
      <div id="submitStatus" style="font-size:12px;margin-top:8px;"></div>
    </section>
  </main>

  <script type="module" src="js/setup-request-app.js?v=1"></script>
</body>
</html>
```

- [ ] **Step 2: コミット**

```bash
git add setup-request.html
git commit -m "feat(setup-request): ヒアリングフォーム HTML 骨格を追加"
```

---

## Task 10: ヒアリングフォーム JS 配線

**Files:**
- Create: `js/setup-request-app.js`

- [ ] **Step 1: フォーム配線を実装** `js/setup-request-app.js`

```javascript
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

// Worker URL は projectId（dev/prod）で自動切替
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
```

- [ ] **Step 2: コミット**

```bash
git add js/setup-request-app.js
git commit -m "feat(setup-request): フォームDOM配線（検証・送信）を追加"
```

---

## Task 11: admin.html — ヒアリングURL発行セクション

**Files:**
- Modify: `admin.html`

- [ ] **Step 1: 「📨 ヒアリングURL発行」セクションを追加**

`admin.html` の「🏢 会社管理」セクション (`<section class="admin-card">` で `🏢 会社管理` の section) の **直前** に挿入:

```html
    <section class="admin-card">
      <h3>📨 ヒアリングURL発行</h3>
      <p class="muted" style="font-size:11px;margin-bottom:8px;">新規導入会社の担当ドライバーにヒアリングフォームのURLを送付します。発行されたURLは1回限り・14日有効。</p>

      <label class="muted">メモ（自分用・サーバには保存されません）</label>
      <input class="input" id="setupIssueNote" type="text" placeholder="例: ○○組合（山田さん経由）">

      <button class="btn" id="issueSetupUrlBtn" style="width:100%;margin-top:8px;background:var(--primary);color:#fff;">🎲 新規ヒアリングURL発行</button>

      <div id="issuedSetupResult" style="display:none;margin-top:12px;padding:10px;background:#f5f5f5;border-radius:6px;">
        <p style="font-size:11px;color:#666;margin:0 0 4px;">割当 slug</p>
        <div style="display:flex;gap:6px;align-items:center;">
          <input class="input" id="issuedSlugDisplay" readonly style="flex:1;font-family:monospace;font-size:12px;background:#fff;">
          <button class="btn" id="copyIssuedSlugBtn" style="font-size:11px;padding:6px 10px;">📋</button>
        </div>

        <p style="font-size:11px;color:#666;margin:8px 0 4px;">招待URL（ドライバーに送付）</p>
        <div style="display:flex;gap:6px;align-items:center;">
          <input class="input" id="issuedUrlDisplay" readonly style="flex:1;font-family:monospace;font-size:11px;background:#fff;">
          <button class="btn" id="copyIssuedUrlBtn" style="font-size:11px;padding:6px 10px;">📋</button>
        </div>

        <p id="issuedExpiryDisplay" style="font-size:11px;color:#666;margin:8px 0 0;"></p>

        <div class="warn-box" style="background:#fff3cd;border:1px solid #ffc107;border-radius:6px;padding:8px;margin-top:8px;font-size:11px;color:#856404;">
          ⚠️ slug を Notes.app の暗号化ノート「キャビス slug マップ」に「<span id="issuedSlugInNote"></span> = ○○組合」と記録してください。
        </div>
      </div>

      <h4 style="margin:16px 0 6px;font-size:13px;">発行履歴（ローカル）</h4>
      <ul id="issuedSetupHistory" style="list-style:none;padding:0;font-size:11px;"></ul>
    </section>
```

- [ ] **Step 2: 配線スクリプトを追加**

`admin.html` の `<script type="module">` 末尾近く（既存 `loadCompanyListBtn` などの配線の近く）に追記:

```javascript
// ========== ヒアリングURL発行 ==========
const ISSUE_HISTORY_KEY = 'cabis_setup_issue_history_v1';

function loadIssueHistory() {
  try { return JSON.parse(localStorage.getItem(ISSUE_HISTORY_KEY)) || []; }
  catch { return []; }
}
function saveIssueHistory(arr) {
  try { localStorage.setItem(ISSUE_HISTORY_KEY, JSON.stringify(arr.slice(0, 50))); } catch {}
}
function renderIssueHistory() {
  const list = loadIssueHistory();
  const ul = document.getElementById('issuedSetupHistory');
  ul.innerHTML = '';
  for (const item of list) {
    const li = document.createElement('li');
    li.style.padding = '4px 0';
    li.style.borderBottom = '1px solid #eee';
    li.innerHTML = `<strong>${item.assignedSlug}</strong> ・ ${item.note || '(メモなし)'} ・ <span style="color:#999;">${item.issuedAt}</span>`;
    ul.appendChild(li);
  }
}

document.getElementById('issueSetupUrlBtn').addEventListener('click', async () => {
  const btn = document.getElementById('issueSetupUrlBtn');
  btn.disabled = true;
  btn.textContent = '発行中...';
  try {
    const idToken = await auth.currentUser.getIdToken();
    const note = document.getElementById('setupIssueNote').value.trim();
    const WORKER_BASE = location.hostname === 'app.taxicabis.com'
      ? 'https://cabis-billing.haqei64384.workers.dev'
      : 'https://cabis-billing-dev.haqei64384.workers.dev';
    const res = await fetch(`${WORKER_BASE}/setup-request/issue-url`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({}),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

    document.getElementById('issuedSetupResult').style.display = '';
    document.getElementById('issuedSlugDisplay').value = data.assignedSlug;
    document.getElementById('issuedUrlDisplay').value = data.url;
    document.getElementById('issuedSlugInNote').textContent = data.assignedSlug;
    document.getElementById('issuedExpiryDisplay').textContent = `有効期限: ${new Date(data.expiresAt).toLocaleString('ja-JP')}`;

    const hist = loadIssueHistory();
    hist.unshift({
      assignedSlug: data.assignedSlug,
      note,
      issuedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
    });
    saveIssueHistory(hist);
    renderIssueHistory();
  } catch (err) {
    alert('発行失敗: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '🎲 新規ヒアリングURL発行';
  }
});

document.getElementById('copyIssuedSlugBtn').addEventListener('click', () => {
  navigator.clipboard.writeText(document.getElementById('issuedSlugDisplay').value);
});
document.getElementById('copyIssuedUrlBtn').addEventListener('click', () => {
  navigator.clipboard.writeText(document.getElementById('issuedUrlDisplay').value);
});

renderIssueHistory();
```

- [ ] **Step 3: コミット**

```bash
git add admin.html
git commit -m "feat(admin): ヒアリングURL発行セクションを追加"
```

---

## Task 12: admin.html — 申請レビューセクション

**Files:**
- Modify: `admin.html`
- Modify: `js/firebase-storage.js`

- [ ] **Step 1: `js/firebase-storage.js` に申請取得関数を追加**

```javascript
// admin: companySetupRequests 一覧取得（status 別）
export async function adminListSetupRequests(filter = {}) {
  const db = ensureDb();
  let q = db.collection('companySetupRequests');
  if (filter.status) q = q.where('status', '==', filter.status);
  q = q.orderBy('submittedAt', 'desc').limit(50);
  const snap = await q.get();
  const list = [];
  snap.forEach((doc) => list.push({ id: doc.id, ...doc.data() }));
  return list;
}

// admin: 申請を imported 状態に遷移（companies/{slug} 作成と同時）
export async function adminImportSetupRequest(requestId, slug, configToImport) {
  const db = ensureDb();
  // companies/{slug} を upsert（既存 adminSaveCompany と同じ流れ）
  await db.collection('companies').doc(slug).set({
    ...configToImport,
    active: true,
    slug,
  }, { merge: true });

  // 申請を imported に
  const summary = {
    payrollMode: configToImport.payrollMode,
    plan: configToImport.plan,
  };
  await db.collection('companySetupRequests').doc(requestId).update({
    status: 'imported',
    importedAt: firebase.firestore.FieldValue.serverTimestamp(),
    importedToSlug: slug,
    importedConfigSummary: summary,
    config: firebase.firestore.FieldValue.delete(),
    tokenHash: firebase.firestore.FieldValue.delete(),
  });
}
```

- [ ] **Step 2: admin.html に「📥 申請レビュー」セクションを追加**

「📨 ヒアリングURL発行」セクションの **直後** に追加:

```html
    <section class="admin-card">
      <h3>📥 申請レビュー</h3>
      <p class="muted" style="font-size:11px;margin-bottom:8px;">ドライバーから届いたヒアリング申請を確認・取込します。</p>

      <div style="display:flex;gap:4px;margin-bottom:12px;">
        <button class="btn tab-btn active" data-tab="submitted" style="flex:1;font-size:11px;padding:6px;">未取込</button>
        <button class="btn tab-btn" data-tab="imported" style="flex:1;font-size:11px;padding:6px;">取込済</button>
        <button class="btn tab-btn" data-tab="archived" style="flex:1;font-size:11px;padding:6px;">アーカイブ</button>
      </div>

      <button class="btn" id="refreshSetupRequestsBtn" style="width:100%;font-size:11px;margin-bottom:8px;">🔄 一覧を更新</button>

      <div id="setupRequestsList" style="font-size:12px;"></div>
    </section>
```

- [ ] **Step 3: タブ・一覧表示・取込ボタンの配線**

`admin.html` の script 末尾に追記:

```javascript
// ========== 申請レビュー ==========
import { adminListSetupRequests, adminImportSetupRequest } from './js/firebase-storage.js?v=2';

let currentTab = 'submitted';

document.querySelectorAll('.tab-btn').forEach((b) => {
  b.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach((x) => x.classList.remove('active'));
    b.classList.add('active');
    currentTab = b.dataset.tab;
    loadSetupRequests();
  });
});

document.getElementById('refreshSetupRequestsBtn').addEventListener('click', loadSetupRequests);

async function loadSetupRequests() {
  const wrap = document.getElementById('setupRequestsList');
  wrap.innerHTML = '読み込み中...';
  try {
    const list = await adminListSetupRequests({ status: currentTab });
    if (list.length === 0) {
      wrap.innerHTML = '<p class="muted" style="font-size:11px;">該当する申請はありません</p>';
      return;
    }
    wrap.innerHTML = '';
    for (const item of list) {
      wrap.appendChild(renderSetupRequestCard(item));
    }
  } catch (err) {
    wrap.innerHTML = `<p style="color:#dc3545;">読み込み失敗: ${err.message}</p>`;
  }
}

function renderSetupRequestCard(item) {
  const div = document.createElement('div');
  div.style.cssText = 'border:1px solid #ddd; border-radius:8px; padding:10px; margin-bottom:8px;';

  const slug = item.assignedSlug || '(slug 未設定)';
  const submittedAt = item.submittedAt
    ? new Date(item.submittedAt.toDate ? item.submittedAt.toDate() : item.submittedAt).toLocaleString('ja-JP')
    : '-';
  const cfg = item.config || {};
  const flags = [];
  if (cfg.rateTable?.hasText) flags.push('📝 自由テキスト');
  if (cfg.rateTable?.hasAttachment) flags.push('📎 添付');

  div.innerHTML = `
    <div style="font-weight:bold;font-family:monospace;">📨 ${slug}</div>
    <div style="font-size:11px;color:#666;margin:4px 0;">受付: ${submittedAt}</div>
    <div style="font-size:11px;margin:4px 0;">プラン: ${cfg.plan || '-'} / 給与: ${cfg.payrollMode || '-'}</div>
    ${flags.length ? `<div style="font-size:11px;margin:4px 0;">${flags.join(' ')} → メール本文/添付を確認</div>` : ''}
    ${currentTab === 'submitted' ? `
      <div style="display:flex;gap:6px;margin-top:8px;">
        <button class="btn import-btn" data-id="${item.id}" data-slug="${slug}" style="flex:1;background:var(--primary);color:#fff;font-size:11px;padding:6px;">📋 取込フォームに展開</button>
        <button class="btn archive-btn" data-id="${item.id}" style="background:#dc3545;color:#fff;font-size:11px;padding:6px 10px;">🗑</button>
      </div>
    ` : ''}
  `;

  div.querySelector('.import-btn')?.addEventListener('click', () => loadIntoCompanyForm(item));
  div.querySelector('.archive-btn')?.addEventListener('click', () => archiveRequest(item.id));
  return div;
}

function loadIntoCompanyForm(item) {
  const cfg = item.config || {};
  const slug = item.assignedSlug;

  // 既存 🏢 会社管理 フォームに値を流し込む
  document.getElementById('companySelect').value = '__new__';
  document.getElementById('companySlug').value = slug;
  document.getElementById('companySlug').readOnly = true;
  document.getElementById('companyPlan').value = cfg.plan || 'partner';
  document.getElementById('companyActive').checked = true;
  document.getElementById('companyPayrollMode').value = cfg.payrollMode || 'fixed_rate';
  document.getElementById('companyTakeHomeRate').value = cfg.takeHomeRate ?? 0.75;
  document.getElementById('companyResponsibilityShifts').value = cfg.responsibilityShifts ?? 11;
  document.getElementById('companyPaidLeaveAmount').value = cfg.paidLeaveAmount ?? 39340;
  document.getElementById('companyPremiumThreshold').value = cfg.premiumIncentive?.thresholdSalesExclTax ?? 80000;
  document.getElementById('companyPremiumAmount').value = cfg.premiumIncentive?.amountPerShift ?? 2000;
  if (cfg.payrollMode === 'fixed_rate') {
    document.getElementById('companyFixedRate').value = cfg.fixedRate ?? 0.55;
  }
  if (cfg.defaultRecArea) {
    document.getElementById('companyDefaultRecArea').value = cfg.defaultRecArea;
  }
  // 数値 rateTable があれば、🏢 会社管理 の歩率テーブルに反映（既存 fillRateTable 利用）
  if (cfg.rateTable?.numeric) {
    if (typeof fillRateTable === 'function') {
      fillRateTable(cfg.rateTable.numeric);
    }
  }
  // 取込モード: companies 保存ボタンにフラグ付加（後の保存処理で imported 化）
  window.__importingRequestId = item.id;
  document.getElementById('saveCompanyBtn').textContent = `💾 会社を保存 + 申請(${item.id.slice(0, 6)}…)を取込完了に`;

  // 「🏢 会社管理」セクションまでスクロール
  document.querySelector('h3:contains("🏢")')?.scrollIntoView({ behavior: 'smooth' });
  alert(`申請 ${slug} を会社管理フォームに展開しました。\nメール本文/添付（自由テキスト・歩率規程）を確認後、必要に応じて値を修正し、保存してください。`);
}

async function archiveRequest(requestId) {
  if (!confirm('この申請をアーカイブしますか？個人特定情報は削除されます。')) return;
  try {
    const idToken = await auth.currentUser.getIdToken();
    const WORKER_BASE = location.hostname === 'app.taxicabis.com'
      ? 'https://cabis-billing.haqei64384.workers.dev'
      : 'https://cabis-billing-dev.haqei64384.workers.dev';
    const res = await fetch(`${WORKER_BASE}/setup-request/archive`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({ requestId }),
    });
    if (!res.ok) throw new Error(await res.text());
    loadSetupRequests();
  } catch (err) {
    alert('アーカイブ失敗: ' + err.message);
  }
}

// 初回読み込み
loadSetupRequests();
```

- [ ] **Step 4: 既存 saveCompanyBtn の処理に取込完了処理を追加**

`admin.html` の既存 `saveCompanyBtn` のクリックハンドラ（`adminSaveCompany(...)` 呼出の **直後**）に追記:

```javascript
// 取込モードの場合、申請を imported に遷移
if (window.__importingRequestId) {
  try {
    await adminImportSetupRequest(
      window.__importingRequestId,
      companyDoc.slug,
      companyDoc,
    );
    window.__importingRequestId = null;
    document.getElementById('companySlug').readOnly = false;
    document.getElementById('saveCompanyBtn').textContent = '💾 会社を保存';
    loadSetupRequests();
  } catch (err) {
    alert('取込完了マーク失敗（companies は保存済み）: ' + err.message);
  }
}
```

- [ ] **Step 5: コミット**

```bash
git add admin.html js/firebase-storage.js
git commit -m "feat(admin): 申請レビューと取込フローを追加"
```

---

## Task 13: sw.js を更新（新規 HTML/JS を STATIC_FILES に登録）

**Files:**
- Modify: `sw.js`

- [ ] **Step 1: 現状確認**

```bash
grep -n "CACHE_PREFIX\|STATIC_FILES" sw.js | head -10
```

- [ ] **Step 2: STATIC_FILES に新規ファイル追加**

`sw.js` の STATIC_FILES 配列（既存）に以下を追加:

```javascript
'./setup-request.html',
'./js/setup-request-app.js',
'./js/setup-request-validate.js',
```

CACHE_PREFIX のバージョン番号を +1 する（例: v172 → v173）。

- [ ] **Step 3: コミット**

```bash
git add sw.js
git commit -m "chore(sw): setup-request ファイルを STATIC_FILES に追加（v172→v173）"
```

---

## Task 14: GitHub Actions deploy.yml の --exclude に setup-request を加えなくていいか確認

**Files:**
- Read: `.github/workflows/deploy.yml`

- [ ] **Step 1: deploy.yml の rsync オプション確認**

```bash
grep -n "rsync\|--exclude" .github/workflows/deploy.yml
```

- [ ] **Step 2: 確認結果メモ**

setup-request.html は dev/prod 両方に配置されるべきファイルなので、--exclude には入れない。既存の --exclude に CNAME 等の prod-only ファイルが入っていることを確認するだけ。

変更不要なら Task 14 は skip。

---

## Task 15: Worker dev デプロイ

**Files:** （Worker のみ）

- [ ] **Step 1: wrangler.toml の ADMIN_UIDS を実 UID に置換**

中野氏が Firebase Console (`taxi-dailydata-dev`) → Authentication → Users で、管理者ユーザー（user_self / mm 等）の UID 文字列を取得し、`worker/wrangler.toml` の `ADMIN_UIDS` を更新する。

例: `ADMIN_UIDS = "abc123XYZ,def456ABC"`

- [ ] **Step 2: wrangler deploy（dev）**

```bash
cd "/Users/hideakimacbookair/Library/Mobile Documents/com~apple~CloudDocs/タクシー乗務アプリ/タクシー日報-wt-setup-intake/worker"
wrangler deploy
```
期待: `cabis-billing-dev` に 4 endpoint がデプロイされる

- [ ] **Step 3: ヘルスチェック**

```bash
curl -s https://cabis-billing-dev.haqei64384.workers.dev/health
```
期待: `{"ok":true,"service":"cabis-billing"}`

- [ ] **Step 4: コミット（wrangler.toml）**

```bash
git add worker/wrangler.toml
git commit -m "chore(worker): ADMIN_UIDS を dev 環境の実 UID で投入"
```

---

## Task 16: Mail Channels DNS 設定（中野氏作業）

**Files:** なし（Cloudflare DNS 設定）

- [ ] **Step 1: 中野氏に作業依頼**

中野氏が taxicabis.com の DNS（Cloudflare）に以下のレコードを追加:

1. **SPF レコード**（既存 SPF があれば mailchannels を追記）:
   - Type: TXT
   - Name: `@` または `taxicabis.com`
   - Content: `v=spf1 a mx include:relay.mailchannels.net ~all`

2. **DKIM 用 _domainkey レコード**:
   Cloudflare の Mail Channels デフォルト DKIM を使う場合は不要（Cloudflare が自動署名）。
   独自 DKIM を使う場合は別途生成。

3. **Domain Lockdown TXT レコード**（必須・MailChannels が他人による spoofing を防ぐため）:
   - Type: TXT
   - Name: `_mailchannels`
   - Content: `v=mc1 cfid=<Cloudflare account ID> cfid=<...other allowed accounts>`

実際の cfid は Cloudflare ダッシュボード > Workers & Pages > 自分の Worker (cabis-billing-dev) > Settings から Account ID を取得して使う。

- [ ] **Step 2: 中野氏が動作確認**

DNS 反映後、dev Worker から自分宛のテストメールを送って受信確認:
```bash
curl -X POST https://cabis-billing-dev.haqei64384.workers.dev/setup-request/submit \
  -F "t=$(curl -s -X POST -H 'Authorization: Bearer <ID_TOKEN>' \
                  https://cabis-billing-dev.haqei64384.workers.dev/setup-request/issue-url \
                  -d '{}' | jq -r '.url' | sed 's/.*?t=//')" \
  -F 'config={...}' -F 'contact={...}' ...
```

実機テストでフォームから送信する方が現実的。

---

## Task 17: dev 統合テスト（E2E）

**Files:** なし（手動検証）

- [ ] **Step 1: 招待URL発行**
  1. dev admin にログイン → 「📨 ヒアリングURL発行」セクション
  2. メモ「テスト用」と入れて「🎲 新規ヒアリングURL発行」
  3. slug と URL が表示されることを確認

- [ ] **Step 2: フォーム表示**
  1. 表示された URL をコピー
  2. シークレットウィンドウで開く
  3. 「URLを検証中...」→ フォーム表示

- [ ] **Step 3: 固定歩率で送信**
  1. 全項目記入（連絡先・固定歩率モード・各種数値）
  2. 「📨 送信する」
  3. 「✓ 送信しました」表示

- [ ] **Step 4: メール受信確認**
  1. 中野氏のメール (`haqei64384@gmail.com`) を確認
  2. 件名「[Cabis申請] 新規ヒアリング申請が届きました (co-XXXXXX)」
  3. 本文に連絡先・設定が記載されている

- [ ] **Step 5: 申請レビュー**
  1. dev admin に戻る → 「📥 申請レビュー」→「未取込」タブ
  2. 該当申請カードが表示される

- [ ] **Step 6: 取込テスト**
  1. 「📋 取込フォームに展開」クリック
  2. 「🏢 会社管理」フォームに値が事前入力される
  3. 「💾 会社を保存」クリック
  4. 申請が「取込済」タブに移動、「未取込」から消える
  5. Firestore Console で `companies/{co-XXXXXX}` の存在確認
  6. `companySetupRequests/{id}.config` が削除されていることを確認

- [ ] **Step 7: 変動歩率 + 添付テスト**
  1. 新規 URL を発行
  2. 変動歩率モード → 数値入力（1乗務目55%等）+ 自由テキスト + PDF/JPG 添付
  3. 送信
  4. メールを確認、本文に自由テキストが入っている、添付ファイルが届いている

- [ ] **Step 8: 異常系テスト**
  1. 同じ URL を2度送信 → 「既使用」表示
  2. 期限切れ URL（手動で expiresAt を過去にセット） → 「期限切れ」表示
  3. 不正トークン URL → 「無効」表示

検証メモを `qa/reports/2026-05-20-setup-intake-form-e2e.md` に記録する。

---

## Task 18: dev へ push（GitHub Pages 反映）

**Files:** なし

- [ ] **Step 1: dev/main へ push**

```bash
cd "/Users/hideakimacbookair/Library/Mobile Documents/com~apple~CloudDocs/タクシー乗務アプリ/タクシー日報-wt-setup-intake"
git push origin feat/setup-intake-form
```

- [ ] **Step 2: dev/main にマージ**

GitHub UI で PR 作成 → dev/main へ merge、または dev で直接:

```bash
git checkout dev/main
git pull dev/main
git merge --ff feat/setup-intake-form
git push dev dev/main:main
```

⚠️ active-sessions.md に書かれた既存セッション（multi-company-stage2-aggregate 等）と衝突しないかを `git status` で確認してから merge。

- [ ] **Step 3: GitHub Pages 反映確認**

`https://hidenaka.github.io/-taxi-daily-report-dev/setup-request.html?t=...` で実機検証

---

## Task 19: 本番反映（Stripe 審査通過後 = Task 8 同梱）

**Files:** なし（既存タスク 8 と統合）

本番反映は `stripe-billing` セッションの Task 8 と同梱する。理由:
- Worker 本番 (`cabis-billing`) のデプロイは Stripe Live 化と同タイミングがコスト効率良い
- Mail Channels DNS 設定（taxicabis.com）が必要、これも Stripe 関連の本番化作業と同タイミングが効率的
- Firestore Rules の本番反映、本番 ADMIN_UIDS の投入も同タイミング

実施項目（Task 8 同梱）:
1. 本番 Firestore Rules deploy (`firebase deploy --only firestore:rules --project taxi-dailydata`)
2. 本番 Worker deploy (`wrangler deploy --env production`)
3. 本番 ADMIN_UIDS / MAIL_FROM / MAIL_TO 投入
4. 本番 GitHub Pages にフロントエンド反映（feat/setup-intake-form を `origin/main` に cherry-pick）
5. taxicabis.com DNS の Mail Channels SPF/Domain Lockdown 設定
6. 本番実機検証（dev と同じシナリオを本番でも実施）

---

## Self-Review Check

実装計画書を spec と突き合わせて確認:

1. **Spec coverage**:
   - 招待URL発行UI: Task 11 ✓
   - ヒアリングフォーム本体: Task 9, 10 ✓
   - 申請レビューUI: Task 12 ✓
   - Worker 4 endpoint: Task 8 ✓
   - Firestore コレクション/Rules: Task 5, 6 ✓
   - メール送信: Task 7, 8 (組み込み) ✓
   - 変動歩率の3パターン: Task 1, 3, 9, 10 ✓
   - 取込フロー: Task 12 ✓
   - 純関数の TDD: Task 1, 2, 3, 4 ✓
   - 個人特定情報を Firestore に保存しない: Task 8 (handler の stripPiiFromConfig) ✓
   - admin 認証: Task 4 (verify-id-token) + Task 8 (requireAdmin) ✓
   - dev デプロイ: Task 15, 17 ✓
   - 本番反映 (Task 8 同梱): Task 19 ✓

2. **Placeholder scan**: TBD / TODO / 「適切な処理」等の placeholder なし

3. **Type consistency**: 関数名・パラメータ名は spec と整合

---

## 実装フロー要約

1. **純関数の TDD** (Task 1〜4) — フロント検証・Worker トークン・Worker 検証・Auth
2. **Firestore Rules** (Task 5) — 早期にデプロイしておく
3. **Worker ヘルパー** (Task 6, 7) — Firestore CRUD + Mail Channels
4. **Worker ハンドラ実装 + 配線** (Task 8) — 4 endpoint
5. **フォーム HTML + JS** (Task 9, 10)
6. **admin UI** (Task 11, 12) — 発行 + レビュー
7. **sw.js 更新** (Task 13, 14)
8. **dev デプロイ + 統合検証** (Task 15〜18)
9. **本番反映** (Task 19・Task 8 同梱)

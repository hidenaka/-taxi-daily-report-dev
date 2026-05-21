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
  try {
    await requireAdmin(request, env);
  } catch (e) {
    return helpers.json({ error: e.message }, 401);
  }
  const body = await request.json().catch(() => ({}));
  const v = validateIssueUrlPayload(body);
  if (!v.ok) return helpers.json({ error: v.error }, 400);

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

  const text = buildAdminNotificationBody({
    requestId: found.requestId,
    assignedSlug: found.doc.assignedSlug,
    submittedAt: new Date().toISOString(),
    contact, config, notes, rateTableText, rateTableSource, attachmentSummaries,
  });

  const mailResult = await sendMail({
    apiKey: env.RESEND_API_KEY,
    from: env.MAIL_FROM,
    to: env.MAIL_TO,
    subject: `[Cabis申請] 新規ヒアリング申請が届きました (${found.doc.assignedSlug})`,
    text,
    attachments: attachmentsForMail,
  });
  if (!mailResult.ok) {
    console.error('mail send failed:', mailResult.status, mailResult.body);
  }

  return helpers.json({ ok: true, requestId: found.requestId });
}

// ----- /setup-request/archive (POST, admin) -----

export async function handleArchive(request, env, helpers) {
  try {
    await requireAdmin(request, env);
  } catch (e) {
    return helpers.json({ error: e.message }, 401);
  }
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

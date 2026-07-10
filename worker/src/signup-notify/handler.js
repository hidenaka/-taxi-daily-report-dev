// POST /notify-signup — 招待登録の通知メールを admin に送る。
// Firestore には書かない。PII（氏名）をログに出さない。
import { verifyFirebaseIdToken } from '../auth/verify-id-token.js';
import { sendMail } from '../setup-request/mail.js';
import { buildSignupNotificationBody } from './body.js';

const SIGNUP_NOTIFY_USER_ID_RE = /^[a-z0-9][a-z0-9_]*$/;

export function isValidSignupNotifyUserId(userId) {
  return SIGNUP_NOTIFY_USER_ID_RE.test(String(userId || ''));
}

export async function handleNotifySignup(request, env, helpers) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    return helpers.json({ error: 'bad_json' }, 400);
  }
  const { idToken, userId, name } = payload || {};

  // 認証（登録直後の本人。スパム防止）
  let uid = null;
  try {
    ({ uid } = await verifyFirebaseIdToken(idToken, env.FIREBASE_PROJECT_ID));
  } catch {
    return helpers.json({ error: 'auth' }, 401);
  }
  if (!uid) return helpers.json({ error: 'auth' }, 401);

  // 検証（PIIはログしない）。電話番号は収集しない。
  const n = String(name || '').trim();
  if (!isValidSignupNotifyUserId(userId)) return helpers.json({ error: 'bad_userid' }, 400);
  if (!n || n.length > 50) return helpers.json({ error: 'bad_fields' }, 400);

  // companyId 併記（best-effort）
  let companyId = null;
  try {
    companyId = await helpers.findCompanyIdByUserId(userId);
  } catch {
    companyId = null;
  }

  const text = buildSignupNotificationBody({
    userId, companyId, name: n, submittedAt: new Date().toISOString(),
    appBaseUrl: env.APP_BASE_URL,
  });
  const r = await sendMail({
    apiKey: env.RESEND_API_KEY, from: env.MAIL_FROM, to: env.MAIL_TO,
    subject: '【Cabis】新規ドライバー登録通知', text,
  });
  if (!r.ok) return helpers.json({ ok: false, error: 'mail_failed' }, 502);
  return helpers.json({ ok: true });
}

// 招待登録通知メールの本文を生成する純関数（Cloudflare/Firestore 非依存・テスト可能）。
export function buildAdminApprovalUrl(appBaseUrl = 'https://app.taxicabis.com') {
  const base = String(appBaseUrl || 'https://app.taxicabis.com').replace(/\/+$/, '');
  return `${base}/admin.html`;
}

export function buildSignupNotificationBody({ userId, companyId, name, submittedAt, appBaseUrl }) {
  const adminApprovalUrl = buildAdminApprovalUrl(appBaseUrl);
  const lines = [];
  lines.push('中野様');
  lines.push('');
  lines.push('招待URLから新規ドライバー登録がありました。');
  lines.push('');
  lines.push('──────────────────────────────────');
  lines.push('■ 本人が登録した内容（氏名はFirestoreには保存していません／このメールのみ）');
  lines.push(`   ログインID: ${userId}   ← 本人がこのIDでログインします（正式なアカウントID）`);
  lines.push(`   氏名:       ${name}`);
  lines.push('');
  lines.push('■ 参考情報');
  lines.push(`   会社スラッグ: ${companyId || '(取得できず)'}`);
  lines.push(`   受付時刻:     ${submittedAt}`);
  lines.push('');
  lines.push('■ 承認ページ');
  lines.push(`   管理者ツール: ${adminApprovalUrl}`);
  lines.push(`   対象会社:     ${companyId || '(取得できず)'}`);
  lines.push('   admin.html を開き、ユーザー一覧でログインIDを確認して承認してください。');
  lines.push('');
  lines.push('──────────────────────────────────');
  lines.push('お手元の照合表（パスワード付きファイル/Notes）に転記後、本メールは削除してください。');
  lines.push('slug以外の会社特定情報・氏名はサーバーに保存されません。');
  return lines.join('\n');
}

// worker/src/setup-request/mail.js
// Cloudflare Mail Channels API でメールを送信する（純関数 + fetch）。
// 添付は base64 で乗せる。

const MAIL_API = 'https://api.mailchannels.net/tx/v1/send';

/**
 * Send a notification mail to admin.
 * @param {Object} args
 * @param {string} args.from
 * @param {string} args.to
 * @param {string} args.subject
 * @param {string} args.text
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
      content: a.contentBase64,
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

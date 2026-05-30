// js/groups-app.js — グループ画面の配線
// groups.html から type="module" で読み込まれる。

import { enforceAccess } from './access-control.js';
import { renderBottomNav } from './app.js';
import { renderLegalFooter } from './legal-footer.js';
import { auth, db } from './firebase-init.js';
import { getMyUserId } from './storage.js';
import { renderQrSvg, downloadQrPng } from './qr-code.js';
import {
  buildGroupInviteUrl,
  parseGroupSlug,
  resolveWorkerBase,
  createGroup,
  joinGroup,
  leaveGroup,
  listMyGroups,
} from './group-client.js';

// ============================================================
// ユーティリティ
// ============================================================

/** アプリの base URL（末尾スラッシュなし）を現在 URL から計算。dev サブパス対応。 */
function getAppBase() {
  return new URL('.', location.href).href.replace(/\/$/, '');
}

/** IDトークンを都度取得（失効対策）。 */
async function getIdToken() {
  return auth.currentUser.getIdToken();
}

/** ctx を構築して返す。 */
async function buildCtx() {
  const idToken = await getIdToken();
  return { idToken, workerBase: resolveWorkerBase() };
}

// ============================================================
// UI 描画
// ============================================================

function setStatus(el, msg, type = '') {
  if (!el) return;
  el.textContent = msg;
  el.className = 'groups-status' + (type ? ' ' + type : '');
}

/** グループ一覧カードを描画する。 */
async function renderGroupList() {
  const container = document.getElementById('groupListContainer');
  if (!container) return;
  container.innerHTML = '<div class="groups-empty">読み込み中…</div>';

  let groups;
  try {
    const fs = await import('https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js');
    const myUserId = getMyUserId();
    groups = await listMyGroups(fs, db, myUserId);
  } catch (e) {
    const errDiv = document.createElement('div');
    errDiv.className = 'groups-empty';
    errDiv.style.color = '#991b1b';
    errDiv.textContent = '一覧の取得に失敗しました: ' + (e.message || e);
    container.innerHTML = '';
    container.appendChild(errDiv);
    return;
  }

  if (!groups || groups.length === 0) {
    container.innerHTML = '<div class="groups-empty">まだグループに参加していません。</div>';
    return;
  }

  const appBase = getAppBase();
  container.innerHTML = '';

  for (const g of groups) {
    const inviteUrl = buildGroupInviteUrl(g.inviteSlug || '', appBase);
    const memberCount = Array.isArray(g.memberUserIds) ? g.memberUserIds.length : '?';

    const card = document.createElement('div');
    card.className = 'group-card';
    card.dataset.groupId = g.groupId;
    card.innerHTML = `
      <div class="group-card-name">${escHtml(g.name || '(名前なし)')}</div>
      <div class="group-card-meta">${memberCount}人参加中</div>
      <input type="text" class="group-card-url" readonly value="${escHtml(inviteUrl)}" aria-label="招待URL">
      <div class="group-card-actions">
        <button class="btn copy-btn" data-url="${escHtml(inviteUrl)}" style="flex:1;min-width:100px;">📋 コピー</button>
        <button class="btn qr-btn" data-url="${escHtml(inviteUrl)}" data-groupid="${escHtml(g.groupId)}" style="flex:1;min-width:100px;">📱 QR</button>
        <button class="btn leave-btn" data-groupid="${escHtml(g.groupId)}" data-name="${escHtml(g.name || '')}" style="flex:1;min-width:80px;background:#fff3f3;color:#b91c1c;border:1px solid #fca5a5;">退会</button>
      </div>
      <div class="copy-status groups-status"></div>
      <div class="group-card-qr" id="qr-${escHtml(g.groupId)}" style="display:none;"></div>
    `;
    container.appendChild(card);
  }
}

async function onGroupListClick(e) {
  const btn = e.target.closest('button');
  if (!btn) return;

  if (btn.classList.contains('copy-btn')) {
    const url = btn.dataset.url;
    const statusEl = btn.closest('.group-card').querySelector('.copy-status');
    try {
      await navigator.clipboard.writeText(url);
      setStatus(statusEl, '✅ コピーしました', 'ok');
    } catch {
      // フォールバック
      const ta = document.createElement('textarea');
      ta.value = url;
      ta.style.cssText = 'position:fixed;opacity:0;';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setStatus(statusEl, '✅ コピーしました', 'ok');
    }
    setTimeout(() => setStatus(statusEl, ''), 3000);
    return;
  }

  if (btn.classList.contains('qr-btn')) {
    const url = btn.dataset.url;
    const groupId = btn.dataset.groupid;
    const qrBox = document.getElementById('qr-' + groupId);
    if (!qrBox) return;
    if (qrBox.style.display !== 'none') {
      qrBox.style.display = 'none';
      return;
    }
    qrBox.innerHTML = '<span style="font-size:11px;color:var(--muted);">生成中…</span>';
    qrBox.style.display = '';
    try {
      const svg = await renderQrSvg(url, { cellSize: 5, margin: 4 });
      qrBox.innerHTML = `
        <div style="display:inline-block;">${svg}</div>
        <div class="qr-hint">スマホで読み取って共有してください</div>
        <button class="btn qr-dl-btn" data-url="${escHtml(url)}" style="margin-top:8px;padding:6px 14px;font-size:11px;">⬇️ PNG ダウンロード</button>
      `;
    } catch (err) {
      qrBox.innerHTML = '<span style="font-size:11px;color:#991b1b;">QRコード生成に失敗しました</span>';
    }
    return;
  }

  if (btn.classList.contains('qr-dl-btn')) {
    const url = btn.dataset.url;
    try {
      await downloadQrPng(url, 'group-invite.png', { cellSize: 10, margin: 4 });
    } catch (err) {
      alert('PNG ダウンロードに失敗しました');
    }
    return;
  }

  if (btn.classList.contains('leave-btn')) {
    const groupId = btn.dataset.groupid;
    const name = btn.dataset.name;
    if (!confirm(`「${name}」から退会しますか？`)) return;
    btn.disabled = true;
    btn.textContent = '処理中…';
    try {
      const ctx = await buildCtx();
      const result = await leaveGroup(ctx, groupId);
      if (result && (result.ok || result.status === 'ok')) {
        // カードを除去して再描画
        const card = btn.closest('.group-card');
        if (card) card.remove();
        const container = document.getElementById('groupListContainer');
        if (container && !container.querySelector('.group-card')) {
          container.innerHTML = '<div class="groups-empty">まだグループに参加していません。</div>';
        }
      } else {
        alert('退会に失敗しました: ' + (result?.error || '不明なエラー'));
        btn.disabled = false;
        btn.textContent = '退会';
      }
    } catch (err) {
      alert('退会に失敗しました: ' + (err.message || err));
      btn.disabled = false;
      btn.textContent = '退会';
    }
    return;
  }
}

/** HTML エスケープ */
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ============================================================
// 参加フロー（?group= から来た場合）
// ============================================================

async function initConsentSection() {
  const slug = parseGroupSlug(new URLSearchParams(location.search));
  if (!slug) return;

  const section = document.getElementById('consentSection');
  if (section) section.style.display = '';

  const nameEl = document.getElementById('consentGroupName');
  if (nameEl) nameEl.textContent = `招待コード: ${slug}`;

  const joinBtn = document.getElementById('joinConsentBtn');
  const statusEl = document.getElementById('consentStatus');

  joinBtn?.addEventListener('click', async () => {
    joinBtn.disabled = true;
    joinBtn.textContent = '処理中…';
    setStatus(statusEl, '');
    try {
      const ctx = await buildCtx();
      const result = await joinGroup(ctx, slug);
      if (result && (result.ok || result.status === 'ok' || result.status === 'already')) {
        // URL から ?group= を除去
        history.replaceState(null, '', location.pathname);
        if (section) section.style.display = 'none';
        setStatus(statusEl, '✅ 参加しました', 'ok');
        await renderGroupList();
      } else if (result && result.status === 'no-group') {
        setStatus(statusEl, '無効な招待です（グループが存在しません）', 'err');
        joinBtn.disabled = false;
        joinBtn.textContent = '参加する';
      } else {
        setStatus(statusEl, '参加に失敗しました: ' + (result?.error || '不明なエラー'), 'err');
        joinBtn.disabled = false;
        joinBtn.textContent = '参加する';
      }
    } catch (err) {
      setStatus(statusEl, '参加に失敗しました: ' + (err.message || err), 'err');
      joinBtn.disabled = false;
      joinBtn.textContent = '参加する';
    }
  });
}

// ============================================================
// 作成フォーム
// ============================================================

async function initCreateForm() {
  const btn = document.getElementById('createGroupBtn');
  const statusEl = document.getElementById('createStatus');
  if (!btn) return;

  btn.addEventListener('click', async () => {
    const nameInput = document.getElementById('groupNameInput');
    const name = (nameInput?.value || '').trim();
    if (!name) {
      setStatus(statusEl, 'グループ名を入力してください', 'err');
      return;
    }
    const viewCondition = document.querySelector('input[name="viewCondition"]:checked')?.value;
    const requireContributionToView = viewCondition === 'contribute';

    btn.disabled = true;
    btn.textContent = '作成中…';
    setStatus(statusEl, '');

    try {
      const ctx = await buildCtx();
      const result = await createGroup(ctx, {
        name,
        requireContributionToView,
        minViewContribution: 1,
      });
      if (result && result.ok) {
        setStatus(statusEl, '✅ グループを作成しました', 'ok');
        if (nameInput) nameInput.value = '';
        await renderGroupList();
      } else {
        setStatus(statusEl, 'グループの作成に失敗しました: ' + (result?.error || '不明なエラー'), 'err');
      }
    } catch (err) {
      setStatus(statusEl, 'グループの作成に失敗しました: ' + (err.message || err), 'err');
    } finally {
      btn.disabled = false;
      btn.textContent = 'グループを作成';
    }
  });
}

// ============================================================
// グループ一覧 click ハンドラ（初期化時に1度だけ登録）
// ============================================================

function initGroupListClickListener() {
  const container = document.getElementById('groupListContainer');
  if (!container) return;
  container.addEventListener('click', onGroupListClick);
}

// ============================================================
// メイン
// ============================================================

(async () => {
  // enforceAccess は boolean を返す（true=可, false=リダイレクト済）。
  // 未契約の場合はここで subscribe.html に遷移させ、以降の処理を止める。
  if (!(await enforceAccess('core'))) return;

  document.getElementById('navHost').innerHTML = renderBottomNav('settings');
  renderLegalFooter();

  // click リスナーは初期化時に1度だけ登録する（renderGroupList() のたびに
  // 積算されないようにコンテナへの委譲登録をここに移動）。
  initGroupListClickListener();

  await Promise.all([
    initConsentSection(),
    initCreateForm(),
    renderGroupList(),
  ]);
})();

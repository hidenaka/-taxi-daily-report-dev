// 休憩タイマー履歴の Firestore I/O。timerStates/{userId} の1ドキュメント。
// localStorage正本のバックアップ層。全てベストエフォート（失敗は呼び出し側で握りつぶす）。
import { db } from '../../js/firebase-init.js';
import { getUserId } from '../../js/firebase-auth.js';
import {
  doc, getDoc, setDoc, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js';

function ref() {
  const uid = getUserId();
  if (!uid) return null;
  return doc(db, 'timerStates', uid);
}

// クラウドの同期ドキュメントを取得。無ければ null。未ログイン/失敗時も null（呼び出し側でlocal維持）。
export async function pullTimerState() {
  const r = ref();
  if (!r) return null;
  const snap = await getDoc(r);
  if (!snap.exists()) return null;
  const d = snap.data() || {};
  return {
    records: Array.isArray(d.records) ? d.records : [],
    settings: (d.settings && typeof d.settings === 'object') ? d.settings : {},
    settingsUpdatedAt: Number(d.settingsUpdatedAt) || 0,
  };
}

// 同期ドキュメント {records, settings, settingsUpdatedAt} をクラウドへ全体上書き保存。
export async function pushTimerState(syncDoc) {
  const r = ref();
  if (!r) return;
  await setDoc(r, {
    records: Array.isArray(syncDoc.records) ? syncDoc.records : [],
    settings: syncDoc.settings || {},
    settingsUpdatedAt: Number(syncDoc.settingsUpdatedAt) || 0,
    syncedAt: serverTimestamp(),
  });
}

// tools/js/stands-data.js — stands の Firestore I/O（アダプタ）
import { db, auth } from '../../js/firebase-init.js';
import {
  collection, getDocs, getDoc, doc, setDoc, deleteDoc, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js';
import { getMyCompanyId } from '../../js/firebase-storage.js';
import { normalizeStand, validateStand } from './stands-schema.js';

export { getMyCompanyId };

// 現ユーザーが管理者か（adminUids/{uid} の存在で判定）
export async function getIsAdmin() {
  const user = auth.currentUser;
  if (!user) return false;
  try {
    const snap = await getDoc(doc(db, 'adminUids', user.uid));
    return snap.exists();
  } catch (e) {
    console.warn('getIsAdmin failed', e);
    return false;
  }
}

// 会社の stands を全件読む（id 付き）
export async function loadStands(companyId) {
  if (!companyId) return [];
  const snap = await getDocs(collection(db, 'companies', companyId, 'stands'));
  const out = [];
  snap.forEach((d) => {
    const data = d.data();
    const v = validateStand(data);
    if (!v.valid) { console.warn(`stand ${d.id} 不正でskip:`, v.errors); return; }
    out.push({ id: d.id, ...normalizeStand(data) });
  });
  return out;
}

// stand を保存（id 未指定なら自動採番）。戻り値: 保存した id。
export async function saveStand(companyId, stand) {
  if (!companyId) throw new Error('companyId が必要');
  const norm = normalizeStand(stand);
  const v = validateStand(norm);
  if (!v.valid) throw new Error('stand 検証失敗: ' + v.errors.join(', '));
  const id = stand.id || doc(collection(db, 'companies', companyId, 'stands')).id;
  const userId = (() => { try { return localStorage.getItem('taxi_user_id'); } catch { return null; } })();
  await setDoc(doc(db, 'companies', companyId, 'stands', id), {
    ...norm,
    updatedAt: serverTimestamp(),
    updatedBy: userId || null,
  });
  return id;
}

export async function deleteStand(companyId, id) {
  if (!companyId || !id) throw new Error('companyId と id が必要');
  await deleteDoc(doc(db, 'companies', companyId, 'stands', id));
}

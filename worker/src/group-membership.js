// worker/src/group-membership.js
// Firestore-backed deps for createGroupOp / joinGroupOp / leaveGroupOp（Cloudflare Worker用）。
// 安全ガード: ここから書くのは groups/{id} と groups/{id}/pool/current のみ。
//             drives/users は read のみ。

import { createGroupOp, joinGroupOp, leaveGroupOp, newGroupSlug } from '../../js/group-membership.js';
import { encodeValue, decodeFields } from './group-pool.js';

// 既存 index.js の (env, token, firestoreGet, firestoreBase) を受けて deps を返す。
export function makeMembershipDeps({ env, token, firestoreGet, firestoreBase }) {
  const base = firestoreBase(env);
  return {
    // slug が groups/{slug} として既存かチェック（衝突検出。read のみ）。
    async slugExists(slug) {
      const doc = await firestoreGet(env, token, 'groups/' + slug);
      return !!(doc && doc.fields);
    },

    // 新規 group を groups/{groupId} に全フィールド PATCH で作成。
    // 書き込み先: groups/{groupId} のみ。
    async writeGroup(groupId, docObj) {
      const url = base + '/groups/' + groupId;
      const fields = {};
      for (const [k, v] of Object.entries(docObj)) fields[k] = encodeValue(v);
      const res = await fetch(url, {
        method: 'PATCH',
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ fields }),
      });
      if (!res.ok) throw new Error('writeGroup ' + res.status + ': ' + (await res.text()));
    },

    // groupId=slug 運用なので直接 GET（runQuery 不使用）。read のみ。
    async findGroupBySlug(slug) {
      const doc = await firestoreGet(env, token, 'groups/' + slug);
      if (!doc || !doc.fields) return null;
      return { groupId: slug, group: decodeFields(doc.fields) };
    },

    // memberUserIds と updatedAt だけを updateMask 付き PATCH で更新。
    // 書き込み先: groups/{groupId} のみ（memberUserIds, updatedAt フィールドのみ）。
    async updateMembers(groupId, members, nowIso) {
      const mask = 'updateMask.fieldPaths=memberUserIds&updateMask.fieldPaths=updatedAt';
      const url = base + '/groups/' + groupId + '?' + mask;
      const res = await fetch(url, {
        method: 'PATCH',
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          fields: {
            memberUserIds: encodeValue(members),
            updatedAt: encodeValue(nowIso),
          },
        }),
      });
      if (!res.ok) throw new Error('updateMembers ' + res.status + ': ' + (await res.text()));
    },

    // pool/current を先に DELETE → group 本体を DELETE。
    // 書き込み先（削除）: groups/{groupId}/pool/current → groups/{groupId} のみ。
    async deleteGroup(groupId) {
      // pool/current の削除（404 は無視）
      await fetch(base + '/groups/' + groupId + '/pool/current', {
        method: 'DELETE',
        headers: { Authorization: 'Bearer ' + token },
      });
      // group 本体の削除
      const res = await fetch(base + '/groups/' + groupId, {
        method: 'DELETE',
        headers: { Authorization: 'Bearer ' + token },
      });
      if (!res.ok && res.status !== 404) {
        throw new Error('deleteGroup ' + res.status + ': ' + (await res.text()));
      }
    },
  };
}

export { createGroupOp, joinGroupOp, leaveGroupOp, newGroupSlug };

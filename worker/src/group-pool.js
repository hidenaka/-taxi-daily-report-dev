// Firestore-backed deps for refreshGroupPool（Cloudflare Worker用）。
// 安全ガード: ここから書くのは groups/{id}/pool/current のみ。
//             drives/users は read のみ。
import { refreshGroupPool } from '../../js/group-pool-core.js';

// pool item / pool doc を Firestore REST の値表現にエンコード（配列・map対応）。
function encodeValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(encodeValue) } };
  if (typeof v === 'object') {
    const fields = {};
    for (const [k, val] of Object.entries(v)) fields[k] = encodeValue(val);
    return { mapValue: { fields } };
  }
  return { stringValue: String(v) };
}

function decodeValue(v) {
  if (!v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(decodeValue);
  if ('mapValue' in v) {
    const o = {};
    for (const [k, val] of Object.entries(v.mapValue.fields || {})) o[k] = decodeValue(val);
    return o;
  }
  if ('nullValue' in v) return null;
  return null;
}

function decodeFields(fields) {
  const o = {};
  for (const [k, v] of Object.entries(fields || {})) o[k] = decodeValue(v);
  return o;
}

// env/token と index.js のヘルパを受け取り、refreshGroupPool 用 deps を返す。
export function makeFirestoreDeps({ env, token, firestoreGet, firestoreBase }) {
  return {
    async readGroup(groupId) {
      const doc = await firestoreGet(env, token, 'groups/' + groupId);
      if (!doc || !doc.fields) return null;
      return decodeFields(doc.fields);
    },

    async readPool(groupId) {
      const doc = await firestoreGet(env, token, `groups/${groupId}/pool/current`);
      if (!doc || !doc.fields) return null;
      return decodeFields(doc.fields);
    },

    // drives/{userId}/daily を date>=since で runQuery（read only）。
    // runQuery の URL は firestoreBase(env) + ':runQuery'、
    // parent には drives/{userId} サブドキュメントの完全パスを指定する
    // （findCompanyIdByUserId と同じ URL 構造に合わせる）。
    async readMemberDrives(userId, since) {
      const base = firestoreBase(env); // ...documents
      const url = base + ':runQuery';
      const parent = base + '/drives/' + userId;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          parent,
          structuredQuery: {
            from: [{ collectionId: 'daily' }],
            where: {
              fieldFilter: {
                field: { fieldPath: 'date' },
                op: 'GREATER_THAN_OR_EQUAL',
                value: { stringValue: since },
              },
            },
          },
        }),
      });
      if (!res.ok) return [];
      const rows = await res.json();
      return (Array.isArray(rows) ? rows : [])
        .filter(r => r.document)
        .map(r => decodeFields(r.document.fields));
    },

    // 書き込みは groups/{id}/pool/current のみ。items は配列なので encodeValue で。
    // updateMask なし（ドキュメント全体を置換）。
    async writePool(groupId, pool) {
      const url = firestoreBase(env) + '/groups/' + groupId + '/pool/current';
      const res = await fetch(url, {
        method: 'PATCH',
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          fields: {
            items: encodeValue(pool.items || []),
            builtAt: encodeValue(pool.builtAt),
            memberCount: encodeValue(pool.memberCount),
          },
        }),
      });
      if (!res.ok) throw new Error('writePool ' + res.status + ': ' + (await res.text()));
    },
  };
}

export { refreshGroupPool, decodeValue, decodeFields, encodeValue };

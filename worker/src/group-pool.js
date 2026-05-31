// Firestore-backed deps for refreshGroupPool（Cloudflare Worker用）。
// 安全ガード: ここから書くのは groups/{id}/pool/current のみ。
//             drives/users は read のみ。

// Firestore runQuery の parent に渡すリソース名（URLではない）。drives/{userId} 配下の daily を検索する親。
export function drivesQueryParent(projectId, userId) {
  return `projects/${projectId}/databases/(default)/documents/drives/${userId}`;
}

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
    // runQuery の fetch URL は firestoreBase(env) + ':runQuery'（https URL）。
    // parent は URL ではなくリソース名（drivesQueryParent）でなければならない。
    async readMemberDrives(userId, since) {
      const url = firestoreBase(env) + ':runQuery';
      const parent = drivesQueryParent(env.FIREBASE_PROJECT_ID, userId);
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
      // 1メンバーの取得失敗は欠落として続行（プール全体は壊さない）
      if (!res.ok) {
        console.warn('readMemberDrives failed', userId, res.status);
        return [];
      }
      const rows = await res.json();
      return (Array.isArray(rows) ? rows : [])
        .filter(r => r.document)
        .map(r => decodeFields(r.document.fields));
    },

    // 書き込みは groups/{id}/pool/current のみ。Plan4: 集計結果型(heatmap/areas)を保存。
    // heatmap は cell のフラット配列(各 cell は map)。生drives・個人識別・合計は保存しない。
    // updateMask なし（ドキュメント全体を置換 → 旧 items フィールドも消える）。
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
            heatmap: encodeValue(pool.heatmap || []),
            areas: encodeValue(pool.areas || []),
            builtAt: encodeValue(pool.builtAt),
            memberCount: encodeValue(pool.memberCount),
          },
        }),
      });
      if (!res.ok) throw new Error('writePool ' + res.status + ': ' + (await res.text()));
    },
  };
}

export { decodeValue, decodeFields, encodeValue };

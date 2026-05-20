// worker/src/setup-request/firestore.js
// companySetupRequests コレクションへの CRUD（Firestore REST API）

const FIRESTORE_BASE = 'https://firestore.googleapis.com/v1';
const COLLECTION = 'companySetupRequests';

function basePath(projectId) {
  return `${FIRESTORE_BASE}/projects/${projectId}/databases/(default)/documents/${COLLECTION}`;
}

// pending 状態で新規作成。requestId はサーバ側で生成（auto-id）。
export async function createPendingRequest({ accessToken, projectId, doc }) {
  const url = `${basePath(projectId)}`; // POST = auto-id
  const body = { fields: encodeFields(doc) };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`createPendingRequest: ${res.status} ${await res.text()}`);
  const created = await res.json();
  // created.name = "projects/{pid}/databases/(default)/documents/companySetupRequests/{id}"
  const requestId = created.name.split('/').pop();
  return { requestId };
}

// tokenHash で検索 (Firestore runQuery で structuredQuery)
export async function findRequestByTokenHash({ accessToken, projectId, tokenHash }) {
  const url = `${FIRESTORE_BASE}/projects/${projectId}/databases/(default)/documents:runQuery`;
  const body = {
    structuredQuery: {
      from: [{ collectionId: COLLECTION }],
      where: {
        fieldFilter: {
          field: { fieldPath: 'tokenHash' },
          op: 'EQUAL',
          value: { stringValue: tokenHash },
        },
      },
      limit: 1,
    },
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`findRequestByTokenHash: ${res.status} ${await res.text()}`);
  const arr = await res.json();
  for (const row of arr) {
    if (row.document) {
      const requestId = row.document.name.split('/').pop();
      return { requestId, doc: decodeFields(row.document.fields) };
    }
  }
  return null;
}

// 既存ドキュメントを updateMask 付きで部分更新
export async function patchRequest({ accessToken, projectId, requestId, updates, removeFields = [] }) {
  const params = new URLSearchParams();
  const fieldsToUpdate = Object.keys(updates);
  for (const f of fieldsToUpdate) params.append('updateMask.fieldPaths', f);
  for (const f of removeFields) params.append('updateMask.fieldPaths', f);
  const url = `${basePath(projectId)}/${requestId}?${params.toString()}`;
  const body = { fields: encodeFields(updates) };
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`patchRequest: ${res.status} ${await res.text()}`);
  return await res.json();
}

// Firestore JSON 値エンコード
export function encodeFields(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    out[k] = toFirestoreValue(v);
  }
  return out;
}

function toFirestoreValue(v) {
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v)
    ? { integerValue: String(v) }
    : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toFirestoreValue) } };
  if (typeof v === 'object') {
    const mapFields = {};
    for (const [k2, v2] of Object.entries(v)) {
      if (v2 !== undefined && v2 !== null) mapFields[k2] = toFirestoreValue(v2);
    }
    return { mapValue: { fields: mapFields } };
  }
  return { stringValue: String(v) };
}

export function decodeFields(fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields || {})) {
    out[k] = fromFirestoreValue(v);
  }
  return out;
}

function fromFirestoreValue(v) {
  if ('stringValue' in v) return v.stringValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fromFirestoreValue);
  if ('mapValue' in v) return decodeFields(v.mapValue.fields || {});
  return null;
}

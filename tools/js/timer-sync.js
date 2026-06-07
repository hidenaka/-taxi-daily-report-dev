// 休憩タイマー履歴の同期用 純粋ロジック（副作用なし）。
// ブラウザは tools/index.html から import、テストは node --test から import。

// 同期するsettingsフィールド（順序固定）。
export const SETTINGS_KEYS = [
  'shiftStart', 'targetBreakMin', 'continuousDriveMin', 'breakCountMin',
  'mode', 'countdownTargetMin', 'soundOn', 'wakeLockOn', 'alertDurationSec',
  'moveDetectOn', 'moveThresholdM', 'countdownPresets',
];

// 新規record用の一意ID（ブラウザ実行時。テストでは未使用）。
export function newRecordId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return 'r-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

// 既存recordにid/updatedAt/deletedを補完（移行）。id無しはrecordedAt由来の決定的legacy id。
// 2端末で同じrecordedAtなら同じid→重複しない。純粋。
export function ensureRecordIds(records) {
  if (!Array.isArray(records)) return [];
  return records.map((r) => ({
    id: r.id || ('legacy-' + (r.recordedAt || '')),
    recordedAt: r.recordedAt,
    durationSec: r.durationSec,
    updatedAt: Number.isFinite(r.updatedAt) ? r.updatedAt : (Date.parse(r.recordedAt) || 0),
    deleted: r.deleted === true,
  }));
}

// idでグルーピングし、各idは updatedAt が新しい方を採用（同点はlocal優先）。墓石も保持。純粋。
export function mergeRecords(localRecs, cloudRecs) {
  const byId = new Map();
  const consider = (r, isLocal) => {
    if (!r || r.id == null) return;
    const ex = byId.get(r.id);
    if (!ex) { byId.set(r.id, r); return; }
    const a = Number(r.updatedAt) || 0;
    const b = Number(ex.updatedAt) || 0;
    if (a > b || (a === b && isLocal)) byId.set(r.id, r);
  };
  (Array.isArray(cloudRecs) ? cloudRecs : []).forEach((r) => consider(r, false));
  (Array.isArray(localRecs) ? localRecs : []).forEach((r) => consider(r, true));
  return [...byId.values()];
}

// stateライクなオブジェクトから SETTINGS_KEYS だけ抽出。純粋。
export function pickSettings(state) {
  const s = {};
  const src = (state && typeof state === 'object') ? state : {};
  for (const k of SETTINGS_KEYS) s[k] = src[k];
  return s;
}

// 同期ドキュメント {records, settings, settingsUpdatedAt} をマージ。
// recordsは mergeRecords、settingsは settingsUpdatedAt が新しい方を採用。純粋。
export function mergeSyncDocs(local, cloud) {
  if (!cloud || typeof cloud !== 'object') return local;
  const lU = Number(local && local.settingsUpdatedAt) || 0;
  const cU = Number(cloud.settingsUpdatedAt) || 0;
  const useCloud = cU > lU;
  return {
    records: mergeRecords(local && local.records, cloud.records),
    settings: useCloud ? cloud.settings : (local && local.settings),
    settingsUpdatedAt: Math.max(lU, cU),
  };
}

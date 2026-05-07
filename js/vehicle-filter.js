// js/vehicle-filter.js — 車種別フィルタリング共通モジュール

const VALID_TYPES = ['all', 'japantaxi', 'premium'];
const STORAGE_KEY = 'activeVehicleType';

// ============================================================
// 純粋関数（テスト対象）
// ============================================================

export function isValidVehicleType(type) {
  return VALID_TYPES.includes(type);
}

function normalizeType(t) {
  if (t === 'regular') return 'japantaxi';
  return t;
}

export function filterDrivesByVehicle(drives, type) {
  if (!Array.isArray(drives)) return [];
  if (!isValidVehicleType(type) || type === 'all') {
    return drives.slice();
  }
  return drives.filter(d => normalizeType(d?.vehicleType) === type);
}

export function pickDefaultVehicleType(todayDrive, config) {
  const todayType = normalizeType(todayDrive?.vehicleType);
  if (todayType === 'japantaxi' || todayType === 'premium') return todayType;

  const cfgType = normalizeType(config?.defaults?.vehicleType);
  if (cfgType === 'japantaxi' || cfgType === 'premium') return cfgType;

  return 'all';
}

// ============================================================
// DOM/localStorage アダプタ（テスト対象外、各ページで使用）
// ============================================================

let _activeType = null;       // 現在の有効値（in-memory、最新）
let _memoryFallback = null;   // localStorage 不可時のフォールバック

export function getActiveVehicleType() {
  if (_activeType) return _activeType;
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (isValidVehicleType(v)) {
      _activeType = v;
      return v;
    }
  } catch {}
  return _memoryFallback || 'all';
}

export function setActiveVehicleType(type) {
  if (!isValidVehicleType(type)) return false;
  _activeType = type;
  try {
    localStorage.setItem(STORAGE_KEY, type);
  } catch {
    _memoryFallback = type;
  }
  window.dispatchEvent(new CustomEvent('vehicle-filter-change', { detail: { type } }));
  return true;
}

export function subscribeVehicleChange(callback) {
  const handler = (e) => callback(e.detail.type);
  window.addEventListener('vehicle-filter-change', handler);
  return () => window.removeEventListener('vehicle-filter-change', handler);
}

export async function resolveDefaultVehicleType(deps) {
  // deps: { getDrive, getConfig, todayDateStr }
  try {
    const today = await deps.getDrive(deps.todayDateStr);
    const config = await deps.getConfig();
    return pickDefaultVehicleType(today, config);
  } catch {
    return 'all';
  }
}

export function renderVehicleTabs(container, options = {}) {
  if (!container) return;
  const onChange = options.onChange || (() => {});
  const showAll = options.showAll !== false;

  const tabs = [];
  if (showAll) tabs.push({ key: 'all', label: 'すべて' });
  tabs.push({ key: 'japantaxi', label: 'ジャパンタクシー' });
  tabs.push({ key: 'premium', label: 'プレミアム' });

  const current = getActiveVehicleType();
  container.innerHTML = `<div class="vehicle-tabs" role="tablist">${
    tabs.map(t => `<button type="button" role="tab" data-vt="${t.key}" class="${t.key === current ? 'active' : ''}">${t.label}</button>`).join('')
  }</div>`;

  container.querySelectorAll('.vehicle-tabs button').forEach(btn => {
    btn.addEventListener('click', () => {
      const type = btn.dataset.vt;
      if (setActiveVehicleType(type)) {
        container.querySelectorAll('.vehicle-tabs button').forEach(b => b.classList.toggle('active', b === btn));
        onChange(type);
      }
    });
  });
}

// ホーム上部の「今日の車種: [JT] [プレ]」プロミネントなトグル
// 'all' は含まれない。タップで activeVehicleType を切替（タブと連動）
export function renderTodayVehicleToggle(container, options = {}) {
  if (!container) return;
  const onChange = options.onChange || (() => {});

  const current = getActiveVehicleType();
  const tabs = [
    { key: 'japantaxi', label: 'ジャパン' },
    { key: 'premium', label: 'プレミアム' },
  ];

  container.innerHTML = `
    <div class="today-vehicle">
      <span class="today-vehicle-label">今日の車種</span>
      <div class="today-vehicle-buttons">
        ${tabs.map(t => `<button type="button" data-vt="${t.key}" class="${t.key === current ? 'active' : ''}">${t.label}</button>`).join('')}
      </div>
    </div>
  `;

  container.querySelectorAll('.today-vehicle button').forEach(btn => {
    btn.addEventListener('click', () => {
      const type = btn.dataset.vt;
      if (setActiveVehicleType(type)) {
        container.querySelectorAll('.today-vehicle button').forEach(b => b.classList.toggle('active', b === btn));
        onChange(type);
      }
    });
  });
}

// ensureActiveVehicleType: 永続化された値があればそれを使う。なければ fresh resolve（ただし保存はしない）
// → settings 変更後の再訪問でデフォルトが正しく反映される
export async function ensureActiveVehicleType(deps) {
  let stored = null;
  try { stored = localStorage.getItem(STORAGE_KEY); } catch {}
  if (isValidVehicleType(stored)) {
    _activeType = stored;
    return stored;
  }
  // 永続化された明示的な選択なし → 都度 fresh resolve（保存はしない）
  const def = await resolveDefaultVehicleType(deps);
  _activeType = def;
  return def;
}

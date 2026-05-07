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
// DOM/sessionStorage アダプタ（テスト対象外、各ページで使用）
// ============================================================

let _memoryFallback = null;

export function getActiveVehicleType() {
  try {
    const v = sessionStorage.getItem(STORAGE_KEY);
    return isValidVehicleType(v) ? v : (_memoryFallback || 'all');
  } catch {
    return _memoryFallback || 'all';
  }
}

export function setActiveVehicleType(type) {
  if (!isValidVehicleType(type)) return false;
  try {
    sessionStorage.setItem(STORAGE_KEY, type);
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

export async function ensureActiveVehicleType(deps) {
  let current = null;
  try { current = sessionStorage.getItem(STORAGE_KEY); } catch {}
  if (isValidVehicleType(current)) return current;
  const def = await resolveDefaultVehicleType(deps);
  setActiveVehicleType(def);
  return def;
}

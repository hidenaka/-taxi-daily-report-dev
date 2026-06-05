import { buildGroupPool } from '../group-pool-core.js';

// 全ユーザー横断 drives（各 drive に _userId と vehicleType）を車種別に匿名集計。
// 各セグメントは既存 buildGroupPool を再利用（memberCount<2 は空）。
// heatmap はさらに per-cell k≥2（days>=2）で絞る。
export function buildGlobalPool(drives, opts = {}) {
  const { nowIso = '', months = 6 } = opts;
  const list = Array.isArray(drives) ? drives : [];

  const segments = {};
  for (const d of list) {
    const vt = (d && d.vehicleType) || 'japantaxi';
    (segments[vt] || (segments[vt] = [])).push(d);
  }

  const byVehicleType = {};
  for (const [vt, segDrives] of Object.entries(segments)) {
    const users = new Set();
    for (const d of segDrives) { if (d && d._userId) users.add(d._userId); }
    const pool = buildGroupPool(segDrives, users.size, { nowIso, months });
    pool.heatmap = (pool.heatmap || [])
      .filter((c) => c.days >= 2)
      .map((c) => ({ dow: c.dow, h: c.h, hourlyA: c.hourlyA, days: c.days }));
    byVehicleType[vt] = pool;
  }

  return { byVehicleType, builtAt: nowIso };
}

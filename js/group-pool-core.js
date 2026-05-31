// グループ匿名プールの再構築ロジック（純・I/Oなし）。
// Worker(オンデマンド)がこの関数群で、メンバーの drives から「匿名集計」を組み立てる。
//
// Plan4: 保存するのは集計結果のみ（生個別乗車itemsは保存しない）。
//   - heatmap: peerMedianHourlyDow を flat 化した非空セル配列（dow×hour の人ごと中央値）
//   - areas:   dropoffAreaAnalysis のエリア集計
// chart-helpers は DOM 非依存の純関数群なので Worker(esbuild)でバンドルできる。
import { peerMedianHourlyDow, dropoffAreaAnalysis } from './chart-helpers.js';

// nowIso から months ヶ月前の 'YYYY-MM-DD'（drive.date の下限比較用）。
// 注: nowIso は UTC の ISO 文字列（例 new Date().toISOString()）を渡すこと。
//     月末日(31日等)起点で月数を引くとロールオーバーするため、はみ出したら前月末日にクランプする。
export function monthsAgoDate(nowIso, months) {
  const d = new Date(nowIso);
  const targetMonth = ((d.getMonth() - months) % 12 + 12) % 12;
  d.setMonth(d.getMonth() - months);
  if (d.getMonth() !== targetMonth) d.setDate(0); // はみ出し→前月末日へ
  return d.toISOString().slice(0, 10);
}

// 直近 months ヶ月の drive だけを残す（date が cutoff 以上）。
export function selectRecentDrives(drives, nowIso, months) {
  if (!Array.isArray(drives)) return [];
  const cutoff = monthsAgoDate(nowIso, months);
  return drives.filter(d => d && typeof d.date === 'string' && d.date !== '' && d.date >= cutoff);
}

// プールが古い(builtAt が ttlMs より前) or 無い/壊れている → 再構築すべき。
export function shouldRebuild(pool, nowMs, ttlMs) {
  if (!pool || !pool.builtAt) return true;
  const built = Date.parse(pool.builtAt);
  if (!Number.isFinite(built)) return true;
  return (nowMs - built) >= ttlMs;
}

// peerMedianHourlyDow の 7×24 matrix を「非空セルのみのフラット配列」に変換。
// Firestore は array-of-arrays(配列の直接ネスト)を保存できないため、
// matrix(配列の配列) ではなく cell の平坦配列で保存する。各 cell = map なので可。
// days===0(誰も乗務していない)セルは捨てる（サイズ削減 + 個人識別を含まない）。
export function flattenHeatmap(matrix) {
  const cells = [];
  for (let dow = 0; dow < 7; dow++) {
    for (let h = 0; h < 24; h++) {
      const c = matrix[dow] && matrix[dow][h];
      if (c && c.days > 0) {
        cells.push({ dow, h, hourlyA: c.hourlyA, days: c.days, peerValues: c.peerValues });
      }
    }
  }
  return cells;
}

// drives(各要素に _userId 付き) + memberCount → 匿名集計プール {heatmap, areas, builtAt, memberCount}。
// メンバー2人未満は空集計（誰のか分かる＝匿名が成立しないため）。
// 直近 months ヶ月に絞ってから集計する。生drives・個人識別・合計は出力に残さない。
export function buildGroupPool(drives, memberCount, opts = {}) {
  const { nowIso, months = 6 } = opts;
  const mc = Number(memberCount) || 0;
  if (mc < 2) return { heatmap: [], areas: [], builtAt: nowIso, memberCount: mc };
  const recent = selectRecentDrives(drives, nowIso, months);
  const heatmap = flattenHeatmap(peerMedianHourlyDow(recent));
  const areas = dropoffAreaAnalysis(recent);
  return { heatmap, areas, builtAt: nowIso, memberCount: mc };
}

// 注入式オーケストレータ。実Firestoreは Worker 側で deps として渡す（テスト可能化）。
//   deps.readGroup(groupId)         -> { memberUserIds: [] } | null
//   deps.readPool(groupId)          -> pool | null
//   deps.readMemberDrives(uid, since) -> drives[]  (since='YYYY-MM-DD' 以降・_userIdなし)
//   deps.writePool(groupId, pool)   -> Promise<void>
export async function refreshGroupPool(deps, groupId, opts = {}) {
  const { nowIso, nowMs, ttlMs = 3600000, months = 6, force = false } = opts;
  const group = await deps.readGroup(groupId);
  if (!group) return { status: 'no-group' };
  const members = Array.isArray(group.memberUserIds) ? group.memberUserIds : [];

  if (!force) {
    const existing = await deps.readPool(groupId);
    if (!shouldRebuild(existing, nowMs, ttlMs)) {
      return { status: 'fresh', builtAt: existing.builtAt };
    }
  }
  if (members.length < 2) {
    const empty = { heatmap: [], areas: [], builtAt: nowIso, memberCount: members.length };
    await deps.writePool(groupId, empty);
    return { status: 'too-few', memberCount: members.length };
  }
  const since = monthsAgoDate(nowIso, months);
  // 各メンバーの drives に _userId を付与（peerMedianHourlyDow の per-user 中央値計算用）。
  // _userId は集計の中間でのみ使い、出力(heatmap/areas)には残さない。
  const perMember = await Promise.all(
    members.map(uid => deps.readMemberDrives(uid, since).then(d =>
      (Array.isArray(d) ? d : []).map(drv => ({ ...drv, _userId: uid }))
    ))
  );
  const allDrives = perMember.flat();
  const pool = buildGroupPool(allDrives, members.length, { nowIso, months });
  await deps.writePool(groupId, pool);
  return { status: 'rebuilt', cells: pool.heatmap.length, areas: pool.areas.length, memberCount: members.length };
}

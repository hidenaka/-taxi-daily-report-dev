// グループ匿名プールの再構築ロジック（純・I/Oなし）。
// Worker(オンデマンド)がこの関数群で、メンバーの drives から匿名プールを組み立てる。
import { buildPoolItems } from './group-anon.js';

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

// drives + memberCount → 匿名プール {items, builtAt, memberCount}。
// メンバー2人未満は空（誰のか分からない＝匿名が成立しないため）。
// 直近 months ヶ月に絞り、maxItems を超えたら新しい方(配列後方)を残す。
export function buildGroupPool(drives, memberCount, opts = {}) {
  const { nowIso, months = 6, maxItems = 5000 } = opts;
  const mc = Number(memberCount) || 0;
  if (mc < 2) return { items: [], builtAt: nowIso, memberCount: mc };
  const recent = selectRecentDrives(drives, nowIso, months);
  let items = buildPoolItems(recent);
  if (items.length > maxItems) items = items.slice(items.length - maxItems);
  return { items, builtAt: nowIso, memberCount: mc };
}

// 注入式オーケストレータ。実Firestoreは Worker 側で deps として渡す（テスト可能化）。
//   deps.readGroup(groupId)         -> { memberUserIds: [] } | null
//   deps.readPool(groupId)          -> pool | null
//   deps.readMemberDrives(uid, since) -> drives[]  (since='YYYY-MM-DD' 以降)
//   deps.writePool(groupId, pool)   -> Promise<void>
export async function refreshGroupPool(deps, groupId, opts = {}) {
  const { nowIso, nowMs, ttlMs = 3600000, months = 6, maxItems = 5000, force = false } = opts;
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
    const empty = { items: [], builtAt: nowIso, memberCount: members.length };
    await deps.writePool(groupId, empty);
    return { status: 'too-few', memberCount: members.length };
  }
  const since = monthsAgoDate(nowIso, months);
  const perMember = await Promise.all(
    members.map(uid => deps.readMemberDrives(uid, since).then(d => Array.isArray(d) ? d : []))
  );
  const allDrives = perMember.flat();
  const pool = buildGroupPool(allDrives, members.length, { nowIso, months, maxItems });
  await deps.writePool(groupId, pool);
  return { status: 'rebuilt', count: pool.items.length, memberCount: members.length };
}

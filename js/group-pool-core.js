// グループ匿名プールの再構築ロジック（純・I/Oなし）。
// Worker(オンデマンド)がこの関数群で、メンバーの drives から匿名プールを組み立てる。
import { buildPoolItems } from './group-anon.js';

// nowIso から months ヶ月前の 'YYYY-MM-DD'。drive.date の下限比較に使う。
export function monthsAgoDate(nowIso, months) {
  const d = new Date(nowIso);
  d.setMonth(d.getMonth() - months);
  return d.toISOString().slice(0, 10);
}

// 直近 months ヶ月の drive だけを残す（date が cutoff 以上）。
export function selectRecentDrives(drives, nowIso, months) {
  if (!Array.isArray(drives)) return [];
  const cutoff = monthsAgoDate(nowIso, months);
  return drives.filter(d => d && typeof d.date === 'string' && d.date !== '' && d.date >= cutoff);
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

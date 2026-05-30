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

// 到着便データの日付別スナップショットと「この日のまとめ」を更新する。
// snapshot-arrivals.yml から呼ばれる。ワークフローに直書きすると読めなくなるので分けた。
//
// やること:
//  1. tools/data/arrivals.json を、その中身の日付(updatedAt)で <date>.json へ保存
//  2. その日の summary(遅れの実態)を作る
//  3. 「本日の配車業務は終了しました」が出ていたら、その営業日の summary に時刻を残す
//     （掲示は 0:20〜2:00 頃に出るので、未明の実行では前日ぶんとして記録する）
//  4. 7日ぶんだけ残して index.json を書き直す
import fs from "node:fs";
import path from "node:path";
import { buildSummary } from "./day-summary.mjs";

const DIR = "tools/data/arrivals-days";
const SRC = "tools/data/arrivals.json";
const NOTICE = "tools/data/pool-notice.json";
const KEEP_DAYS = 7;

const shiftDay = (d, n) => {
  const [y, m, dd] = String(d).split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, dd));
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};
fs.mkdirSync(DIR, { recursive: true });

// --- 1〜2) その日のスナップショットとまとめ ---
if (fs.existsSync(SRC)) {
  const data = JSON.parse(fs.readFileSync(SRC, "utf8"));
  const day = String(data.updatedAt || "").slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    const dest = path.join(DIR, `${day}.json`);
    // 既にある終了掲示の記録は消さない(未明の実行で先に入ることがある)
    let keptEnd = null;
    if (fs.existsSync(dest)) {
      try { keptEnd = JSON.parse(fs.readFileSync(dest, "utf8")).summary?.dispatchEndedAt ?? null; } catch { /* ignore */ }
    }
    data.summary = buildSummary(data);
    if (keptEnd) data.summary.dispatchEndedAt = keptEnd;
    fs.writeFileSync(dest, JSON.stringify(data));
    console.log(`保存 ${day}.json (${data.summary.totalFlights}便 / 15分以上遅れ ${data.summary.delayed15})`);
  }
}

// --- 3) 配車業務の終了掲示 ---
if (fs.existsSync(NOTICE)) {
  try {
    const n = JSON.parse(fs.readFileSync(NOTICE, "utf8"));
    const txt = [n.flightNoticeText, n.liveText].filter(Boolean).join("\n");
    if (/配車業務は?終了/.test(txt) && n.updatedAt) {
      const at = String(n.updatedAt);
      const hh = Number(at.slice(11, 13));
      // 未明に出た掲示は前日の営業ぶん
      const bizDay = hh < 12 ? shiftDay(at.slice(0, 10), -1) : at.slice(0, 10);
      const f = path.join(DIR, `${bizDay}.json`);
      if (fs.existsSync(f)) {
        const j = JSON.parse(fs.readFileSync(f, "utf8"));
        j.summary = j.summary || buildSummary(j);
        // 最初に出た時刻を残す(あとから上書きしない)
        if (!j.summary.dispatchEndedAt) {
          j.summary.dispatchEndedAt = at.slice(11, 16);
          fs.writeFileSync(f, JSON.stringify(j));
          console.log(`終了掲示 ${bizDay} → ${j.summary.dispatchEndedAt}`);
        }
      }
    }
  } catch (e) {
    console.log("掲示の読み取りに失敗:", e.message);
  }
}

// --- 4) 7日ぶんに絞って index.json ---
const days = fs.readdirSync(DIR).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).map((f) => f.replace(".json", "")).sort();
for (const d of days.slice(0, Math.max(0, days.length - KEEP_DAYS))) {
  fs.unlinkSync(path.join(DIR, `${d}.json`));
  console.log(`削除 ${d}.json`);
}
const kept = fs.readdirSync(DIR).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).map((f) => f.replace(".json", "")).sort().reverse();
fs.writeFileSync(path.join(DIR, "index.json"), JSON.stringify({ days: kept, updatedAt: new Date().toISOString() }, null, 2));
console.log(`index.json: ${kept.join(", ")}`);

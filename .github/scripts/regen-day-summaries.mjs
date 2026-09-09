// 保存済みの日付別ファイルの「この日のまとめ」を、いまの数え方で作り直す。
// 遅れの基準を「実際に着いた時刻(actualTime)優先」に直した時の遡り適用に使う。
// dispatchEndedAt（配車業務の終了案内の時刻）は作り直しでは失われるので引き継ぐ。
import fs from "node:fs";
import { buildSummary } from "./day-summary.mjs";

const DIR = "tools/data/arrivals-days";
const files = fs.readdirSync(DIR).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
for (const f of files) {
  const p = `${DIR}/${f}`;
  const data = JSON.parse(fs.readFileSync(p, "utf8"));
  const before = data.summary || {};
  const next = buildSummary(data);
  next.dispatchEndedAt = before.dispatchEndedAt ?? null;
  data.summary = next;
  fs.writeFileSync(p, JSON.stringify(data));
  console.log(`${f}: 15分以上 ${before.delayed15 ?? "-"} → ${next.delayed15}便 / 最大 ${before.maxDelay ?? "-"} → ${next.maxDelay}分`);
}

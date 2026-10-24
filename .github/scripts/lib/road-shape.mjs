// 工事のまわりの道の形（信号・カーブ・坂）を求める（sync-koji.mjs から使う）
//
// どれも「工事の真ん中から、道の向きに沿って前後 150m」を見る。
//   t: 道の向きに沿った距離（m）。+ は道の向き（線の始点→終点、点は roadBearing）の先
//   u: 道の向きに対して右へのずれ（m）
// 出す値（工事の properties に足す。地図の層が入れ子を文字にしてしまうので平らにする）:
//   sigAt:    信号の位置 t（m）を「,」でつないだ文字。例 "-80,45"
//   curveDeg: 前後120mで道の向きが変わる角度（度）。+ は右へ曲がる（道の向きに進んだとき）
//   roadU:    道の形。t=-150..150m を 10m おきに、道の中心が右へ何m ずれるか（0.5m 単位）を「,」でつないだ文字。
//             工事の所（t=0）で 0・まっすぐ横向きになるようにそろえる。分からない所は空
//   slopePct: 坂（%）。+ は道の向きへ進むと上る。橋・トンネルにかかる所と、標高が飛ぶ所は出さない
const RANGE = 150;

export function localFrame(mid, bearingDeg) {
  const k = Math.cos((mid[1] * Math.PI) / 180) * 111320;
  const r = (bearingDeg * Math.PI) / 180;
  const ex = Math.sin(r); const ey = Math.cos(r);
  return {
    mid, bearingDeg,
    toTU([lon, lat]) {
      const x = (lon - mid[0]) * k; const y = (lat - mid[1]) * 110540;
      return { t: x * ex + y * ey, u: x * ey - y * ex };
    },
    toLonLat(t, u = 0) {
      const x = t * ex + u * ey; const y = t * ey - u * ex;
      return [mid[0] + x / k, mid[1] + y / 110540];
    },
  };
}

/** 工事の真ん中と道の向き。決められなければ null */
export function axisOf(f) {
  const g = f.geometry; const p = f.properties || {};
  if (g?.type === 'LineString' && g.coordinates.length >= 2) {
    const c = g.coordinates; const a = c[0]; const b = c[c.length - 1];
    const k = Math.cos((a[1] * Math.PI) / 180);
    const dx = (b[0] - a[0]) * k; const dy = b[1] - a[1];
    if (Math.hypot(dx, dy) * 111000 < 5) return null;
    return { mid: halfway(c), bearing: ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360 };
  }
  if (g?.type === 'Point' && typeof p.roadBearing === 'number') return { mid: g.coordinates, bearing: p.roadBearing };
  return null;
}

/** 線の長さのちょうど半分の点（点の数で真ん中を取ると、2点の線では端になってしまう） */
function halfway(c) {
  const k = Math.cos((c[0][1] * Math.PI) / 180);
  const seg = c.slice(1).map((q, i) => Math.hypot((q[0] - c[i][0]) * k, q[1] - c[i][1]));
  let rest = seg.reduce((a, b) => a + b, 0) / 2;
  for (let i = 0; i < seg.length; i++) {
    if (rest <= seg[i] && seg[i] > 0) { const f = rest / seg[i]; return [c[i][0] + (c[i + 1][0] - c[i][0]) * f, c[i][1] + (c[i + 1][1] - c[i][1]) * f]; }
    rest -= seg[i];
  }
  return c[c.length - 1];
}

/** 道に沿った信号の位置（上下線で2つある信号は1つにまとめる） */
export function signalsAlong(frame, signals, { range = RANGE, lateral = 28, merge = 35 } = {}) {
  const ts = [];
  for (const s of signals) {
    if (Math.abs(s[0] - frame.mid[0]) > 0.004 || Math.abs(s[1] - frame.mid[1]) > 0.004) continue;
    const { t, u } = frame.toTU(s);
    if (Math.abs(t) <= range && Math.abs(u) <= lateral) ts.push(t);
  }
  ts.sort((a, b) => a - b);
  const out = [];
  for (const t of ts) {
    if (out.length && t - out[out.length - 1].last < merge) { const o = out[out.length - 1]; o.sum += t; o.n += 1; o.last = t; }
    else out.push({ sum: t, n: 1, last: t });
  }
  return out.map((o) => Math.round(o.sum / o.n));
}

/**
 * 道の線の点から、道の曲がり具合（度）。u = a + b t + c t² を当てはめ、t=±120m の向きの差を取る。
 * 前後どちらかに点が足りないときは null
 */
export function curveFromPoints(pts, { reach = 120 } = {}) {
  const P = pts.filter((q) => Math.abs(q.t) <= RANGE);
  if (P.filter((q) => q.t < -60).length < 2 || P.filter((q) => q.t > 60).length < 2) return null;
  // 最小二乗（正規方程式 3×3）
  let s0 = 0, s1 = 0, s2 = 0, s3 = 0, s4 = 0, y0 = 0, y1 = 0, y2 = 0;
  for (const { t, u } of P) {
    const t2 = t * t;
    s0 += 1; s1 += t; s2 += t2; s3 += t2 * t; s4 += t2 * t2; y0 += u; y1 += u * t; y2 += u * t2;
  }
  const sol = solve3([[s0, s1, s2], [s1, s2, s3], [s2, s3, s4]], [y0, y1, y2]);
  if (!sol) return null;
  const [, b, c] = sol;
  const ang = (d) => (Math.atan(d) * 180) / Math.PI;
  return Math.round(ang(b + 2 * c * reach) - ang(b - 2 * c * reach));
}

function solve3(A, y) {
  const m = A.map((r, i) => [...r, y[i]]);
  for (let i = 0; i < 3; i++) {
    let p = i;
    for (let j = i + 1; j < 3; j++) if (Math.abs(m[j][i]) > Math.abs(m[p][i])) p = j;
    if (Math.abs(m[p][i]) < 1e-9) return null;
    [m[i], m[p]] = [m[p], m[i]];
    for (let j = 0; j < 3; j++) {
      if (j === i) continue;
      const f = m[j][i] / m[i][i];
      for (let k = i; k < 4; k++) m[j][k] -= f * m[i][k];
    }
  }
  return m.map((r, i) => r[3] / r[i]);
}

/** 道の線（lanes23）のうち、この道（名前が同じ・無ければ幹線）の点を、工事の前後で集める */
export function roadPointsNear(frame, lines, name) {
  const pick = (same) => {
    const out = [];
    for (const L of lines) {
      if (same ? L.n !== name : !L.main) continue;
      for (const c of L.c) {
        if (Math.abs(c[0] - frame.mid[0]) > 0.003 || Math.abs(c[1] - frame.mid[1]) > 0.003) continue;
        const q = frame.toTU(c);
        if (Math.abs(q.t) <= RANGE && Math.abs(q.u) <= 45) out.push(q);
      }
    }
    return out;
  };
  const same = name ? pick(true) : [];
  return same.length >= 6 ? same : pick(false);
}

/**
 * 道の線をなぞって、道の形（t ごとの u）を求める。線の点を 5m おきに埋めてから、10m ごとに真ん中の値を取る。
 * 上下線が別の線のときは2本の真ん中になる。工事の所が分からない・半分以上分からないときは null
 */
export function roadProfile(frame, lines, name, { range = RANGE, step = 10, lateral = 45 } = {}) {
  const near = (c) => Math.abs(c[0] - frame.mid[0]) < 0.003 && Math.abs(c[1] - frame.mid[1]) < 0.003;
  const collect = (same) => {
    const pts = [];
    for (const L of lines) {
      if (same ? L.n !== name : !L.main) continue;
      if (!L.c.some(near)) continue;
      for (let i = 1; i < L.c.length; i++) {
        const a = frame.toTU(L.c[i - 1]); const b = frame.toTU(L.c[i]);
        const n = Math.max(1, Math.ceil(Math.hypot(b.t - a.t, b.u - a.u) / 5));
        for (let k = 0; k <= n; k++) {
          const t = a.t + ((b.t - a.t) * k) / n; const u = a.u + ((b.u - a.u) * k) / n;
          if (Math.abs(t) <= range + step && Math.abs(u) <= lateral + Math.abs(t) * 0.5) pts.push({ t, u });
        }
      }
    }
    return pts;
  };
  let pts = name ? collect(true) : [];
  if (pts.length < 20) pts = collect(false);
  const ts = []; for (let t = -range; t <= range; t += step) ts.push(t);
  // 工事の所から外へ順にたどる。上下線が別の線の道で2本を行き来しないよう、前の値にいちばん近い点を使う
  const pick = (t, prev) => {
    let best = null;
    for (const q of pts) {
      if (Math.abs(q.t - t) > step / 2) continue;
      const d = prev == null ? Math.abs(q.u) : Math.abs(q.u - prev);
      if ((prev == null || d <= step * 0.7) && (best == null || d < best.d)) best = { d, u: q.u };
    }
    return best ? best.u : null;
  };
  const u = new Array(ts.length).fill(null);
  const c = ts.indexOf(0);
  u[c] = pick(0, null);
  if (u[c] == null || Math.abs(u[c]) > 25) return null;
  for (const dir of [1, -1]) {
    let prev = u[c];
    for (let i = c + dir; i >= 0 && i < ts.length; i += dir) {
      const v = pick(ts[i], prev);
      if (v == null) break;            // 途切れたら、その先は分からないことにする
      u[i] = v; prev = v;
    }
  }
  if (u.filter((v) => v != null).length < ts.length / 2) return null;
  // 前後と平らにならす（線の点の細かいずれを消す）
  const sm = u.map((v, i) => {
    if (v == null) return null;
    const w = [u[i - 1], v, u[i + 1]].filter((x) => x != null);
    return w.reduce((a, b) => a + b, 0) / w.length;
  });
  // 工事の所を 0・横向きにそろえる（前後 40m の傾きを引く）
  const near0 = ts.map((t, i) => ({ t, v: sm[i] })).filter((q) => q.v != null && Math.abs(q.t) <= 40);
  const n = near0.length; const mt = near0.reduce((a, q) => a + q.t, 0) / n; const mv = near0.reduce((a, q) => a + q.v, 0) / n;
  let num = 0; let den = 0; for (const q of near0) { num += (q.t - mt) * (q.v - mv); den += (q.t - mt) ** 2; }
  const k = den ? num / den : 0; const u0 = sm[c];
  return sm.map((v, i) => (v == null ? null : Math.round((v - u0 - k * ts[i]) * 2) / 2));
}

/** 道の形（roadProfile）から曲がる角度（度）。前後 90〜140m の向きの差。片側が分からなければ null */
export function curveFromProfile(prof, { range = RANGE, step = 10 } = {}) {
  const at = (t) => prof[Math.round((t + range) / step)];
  const dir = (t1, t2) => (at(t1) == null || at(t2) == null ? null : (Math.atan((at(t2) - at(t1)) / (t2 - t1)) * 180) / Math.PI);
  const a = dir(-140, -90); const b = dir(90, 140);
  return a == null || b == null ? null : Math.round(b - a);
}

/** 「◯◯方面」に使う街（[名前, lon, lat]）。運転する人が行き先に使う駅・街 */
export const DIRECTION_PLACES = [
  ['東京駅', 139.7671, 35.6812], ['新宿', 139.7006, 35.6896], ['渋谷', 139.7016, 35.658], ['池袋', 139.7109, 35.7295],
  ['上野', 139.7774, 35.7141], ['品川', 139.7387, 35.6285], ['銀座', 139.7671, 35.6717], ['六本木', 139.731, 35.6628],
  ['浅草', 139.7967, 35.7119], ['錦糸町', 139.814, 35.6962], ['北千住', 139.8048, 35.7497], ['赤羽', 139.721, 35.7777],
  ['練馬', 139.6545, 35.7377], ['中野', 139.6657, 35.7056], ['荻窪', 139.62, 35.7047], ['二子玉川', 139.6268, 35.6116],
  ['目黒', 139.7157, 35.6339], ['蒲田', 139.716, 35.5625], ['豊洲', 139.796, 35.6549], ['葛西', 139.8726, 35.6636],
  ['亀有', 139.8474, 35.7662], ['王子', 139.7381, 35.7527], ['成増', 139.6327, 35.7778], ['大井町', 139.7346, 35.6065],
  ['神田', 139.7709, 35.6918], ['秋葉原', 139.7731, 35.6984], ['日本橋', 139.7745, 35.682], ['新橋', 139.7583, 35.6663],
  ['虎ノ門', 139.7497, 35.6703], ['赤坂', 139.7369, 35.6764], ['四谷', 139.73, 35.686], ['飯田橋', 139.745, 35.702],
  ['大塚', 139.7286, 35.7317], ['巣鴨', 139.7394, 35.7334], ['高田馬場', 139.7038, 35.7128], ['恵比寿', 139.7101, 35.6467],
  ['五反田', 139.7236, 35.6262], ['三軒茶屋', 139.6699, 35.6436], ['下北沢', 139.668, 35.6613], ['中目黒', 139.6987, 35.644],
  ['田町', 139.7476, 35.6457], ['浜松町', 139.757, 35.6553], ['月島', 139.7843, 35.6646], ['門前仲町', 139.7963, 35.6716],
  ['両国', 139.793, 35.6962], ['押上', 139.813, 35.7101], ['日暮里', 139.7708, 35.728], ['板橋', 139.7195, 35.7455],
  ['羽田空港', 139.7798, 35.5494], ['大森', 139.728, 35.5884], ['自由が丘', 139.6687, 35.6077], ['吉祥寺', 139.58, 35.703],
  ['光が丘', 139.629, 35.759], ['西新井', 139.79, 35.777], ['小岩', 139.884, 35.733], ['新小岩', 139.858, 35.717],
  ['有明', 139.793, 35.634], ['表参道', 139.712, 35.665], ['水道橋', 139.7535, 35.7020], ['御茶ノ水', 139.765, 35.6993],
];

/**
 * 道の向き deg（度）に進んだ先にある街（DIRECTION_PLACES）。「◯◯方面」に使う。
 * 600m〜6km 先で、向きの差が 40度以内のもの。向きが合うほど・近いほど選ぶ。無ければ ''
 */
export function towardPlace(mid, deg, places = DIRECTION_PLACES) {
  const k = Math.cos((mid[1] * Math.PI) / 180) * 111320;
  let best = null;
  for (const [name, lon, lat] of places) {
    const x = (lon - mid[0]) * k; const y = (lat - mid[1]) * 110540;
    const d = Math.hypot(x, y);
    if (d < 600 || d > 6000) continue;   // 遠すぎる街は「方面」にしない
    const b = (Math.atan2(x, y) * 180) / Math.PI;
    const diff = Math.abs(((b - deg + 540) % 360) - 180);
    if (diff > 40) continue;
    const score = diff / 40 + d / 8000;
    if (!best || score < best.score) best = { score, name };
  }
  return best ? best.name : '';
}

/** 標高の並び（t ごと）から坂（%）。橋・トンネル・標高の飛びがあれば null */
export function slopeFromProfile(samples, { maxJump = 2.5 } = {}) {
  const S = samples.filter((s) => Number.isFinite(s.z));
  if (S.length < 6) return null;
  for (let i = 1; i < S.length; i++) if (Math.abs(S[i].z - S[i - 1].z) > maxJump) return null;
  const n = S.length;
  const mt = S.reduce((a, s) => a + s.t, 0) / n; const mz = S.reduce((a, s) => a + s.z, 0) / n;
  let num = 0; let den = 0;
  for (const s of S) { num += (s.t - mt) * (s.z - mz); den += (s.t - mt) ** 2; }
  if (!den) return null;
  const pct = (num / den) * 100;
  if (Math.abs(pct) > 12) return null;   // 一般道でこれより急な坂はまず無い（測り違い）
  return Math.round(pct * 2) / 2;
}

/** 橋・トンネルが、工事の前後 100m の道にかかっているか */
export function onStructure(frame, structures, { range = 110, lateral = 25 } = {}) {
  for (const s of structures) {
    for (const c of s.c) {
      if (Math.abs(c[0] - frame.mid[0]) > 0.003 || Math.abs(c[1] - frame.mid[1]) > 0.003) continue;
      const q = frame.toTU(c);
      if (Math.abs(q.t) <= range && Math.abs(q.u) <= lateral) return true;
    }
  }
  return false;
}

/** 地理院の標高タイル（PNG）の1画素を標高（m）に。無効値は null */
export function demValue(r, g, b) {
  let v = r * 65536 + g * 256 + b;
  if (v === 8388608) return null;
  if (v > 8388608) v -= 16777216;
  return v * 0.01;
}

export function demTileOf(lon, lat, z = 15) {
  const n = 2 ** z;
  const x = ((lon + 180) / 360) * n;
  const y = ((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * n;
  return { x: Math.floor(x), y: Math.floor(y), px: Math.min(255, Math.floor((x % 1) * 256)), py: Math.min(255, Math.floor((y % 1) * 256)) };
}

// tools/js/jartic-data.js — 国土交通省「交通量API」の1時間値を、地図で使う形にする（sync-jartic.mjs と地図の層の両方から使う）
//
// tools/data/jartic-traffic.json の形:
//   meta:   { updatedAt, hours: ['YYYYMMDDHH', …]（古い→新しい・JST）, source, notice }
//   points: [{ id, kind: 'perm'|'cctv', code, c: [lon, lat], name, v: [[上り, 下り] | null, …], off: [上り, 下り] }]
//           v は meta.hours と同じ並び。台数は1時間に通った車（小型＋大型＋見分けられない車）。分からない時間は null
//           off: その向きを使わない（8日間ずっと値が無い、または昼でもほぼ0＝数えられていない）。CCTV は向きごとに別の観測点のことがある
// 値は国の参考値で、正式な交通量調査の結果ではない（規約 第3条）。
export const NOTICE = 'このサービスは、交通量API機能を使用していますが、サービスの内容は国土交通省によって保証されたものではありません。';
export const SOURCE = '国土交通省 交通量API機能による交通量（参考値）を加工して作成';
export const KEEP_HOURS = 24 * 8;   // 先週の同じ時間と比べられるよう、8日分を持つ

const n = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const sum = (...xs) => (xs.some((x) => x == null) ? null : xs.reduce((a, b) => a + b, 0));

/** 時間コード（202610240800）→ 'YYYYMMDDHH' */
export const hourKey = (code) => String(code).slice(0, 10);

/**
 * API の1件（properties）を { hour, up, dn } に。
 * 常設（perm）: 欠測・停電・機械の異常のどれかが立っていたら、その向きは null。
 * CCTV（cctv）: 「自動車交通量」をそのまま使う（null は null のまま。0 にしない）。
 */
export function toRecord(p, kind) {
  const dir = (s) => {
    if (kind === 'perm') {
      if (['欠測', '停電', 'ループ異常', '超音波異常'].some((k) => n(p[`${s}・${k}`]))) return null;
      return sum(n(p[`${s}・小型交通量`]), n(p[`${s}・大型交通量`]), n(p[`${s}・車種判別不能交通量`]) ?? 0);
    }
    return n(p[`${s}・自動車交通量`]);
  };
  return { hour: hourKey(p['時間コード']), code: String(p['常時観測点コード']), up: dir('上り'), dn: dir('下り') };
}

/** JST の 'YYYYMMDDHH' を1時間ずつ進める/戻す */
export function addHours(key, h) {
  const d = new Date(Date.UTC(+key.slice(0, 4), +key.slice(4, 6) - 1, +key.slice(6, 8), +key.slice(8, 10) + h));
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}`;
}

/** いまの時刻（Date）→ JST の 'YYYYMMDDHH' */
export function jstHourKey(date = new Date()) {
  const d = new Date(date.getTime() + 9 * 3600e3);
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}`;
}

/**
 * これまでのデータ（doc）に、新しく取った件（records: {kind, code, c, hour, up, dn}）を足す。
 * 時間の並びは nowKey までの KEEP_HOURS 時間にそろえる。新しい観測点は足し、8日間何も来ない観測点は消す。
 */
export function mergeHistory(doc, records, nowKey, { keep = KEEP_HOURS, nameOf = () => '' } = {}) {
  const hours = []; for (let i = keep - 1; i >= 0; i--) hours.push(addHours(nowKey, -i));
  const idx = new Map(hours.map((h, i) => [h, i]));
  const old = new Map((doc?.points || []).map((p) => [p.id, p]));
  const oldIdx = new Map((doc?.meta?.hours || []).map((h, i) => [h, i]));
  const pts = new Map();
  const get = (r) => {
    const id = `${r.kind}-${r.code}`;
    if (!pts.has(id)) {
      const o = old.get(id);
      const v = hours.map((h) => (o && oldIdx.has(h) ? o.v[oldIdx.get(h)] ?? null : null));
      pts.set(id, { id, kind: r.kind, code: r.code, c: o?.c || r.c, name: o?.name ?? nameOf(r.c), v });
    }
    return pts.get(id);
  };
  for (const o of old.values()) get({ kind: o.kind, code: o.code, c: o.c });
  for (const r of records) {
    if (!idx.has(r.hour)) continue;
    const p = get(r);
    p.v[idx.get(r.hour)] = r.up == null && r.dn == null ? null : [r.up, r.dn];
  }
  const points = [...pts.values()].filter((p) => p.v.some((x) => x)).sort((a, b) => a.id.localeCompare(b.id));
  for (const p of points) p.off = [0, 1].map((d) => deadDirection(p.v.map((x) => (x ? x[d] : null)), hours));
  return { meta: { ...(doc?.meta || {}), hours, source: SOURCE, notice: NOTICE }, points };
}

/** 昼（7〜21時台）の真ん中の値が 20台/時 未満、または値が1つも無い向きは、数えられていないとみなす */
export function deadDirection(vals, hours) {
  const day = vals.filter((v, i) => v != null && +hours[i].slice(8, 10) >= 7 && +hours[i].slice(8, 10) <= 21).sort((a, b) => a - b);
  if (!day.length) return true;
  return day[day.length >> 1] < 20;
}

/** 使える向きだけ足す。どちらの向きも無ければ null */
const total = (x, off = [false, false]) => {
  if (!x) return null;
  const vs = [0, 1].filter((d) => !off[d] && x[d] != null).map((d) => x[d]);
  return vs.length ? vs.reduce((a, b) => a + b, 0) : null;
};
/** 2つの時間を、両方に値がある向きだけで比べる */
const pairTotals = (a, b, off) => {
  if (!a || !b) return [null, null];
  const ds = [0, 1].filter((d) => !off[d] && a[d] != null && b[d] != null);
  if (!ds.length) return [null, null];
  return [ds.reduce((s, d) => s + a[d], 0), ds.reduce((s, d) => s + b[d], 0)];
};

/**
 * 地図に出す値: その観測点のいちばん新しい時間の台数と、7日前の同じ時間の台数。
 * @returns {{hour, now:[up,dn], week:[up,dn]|null, total, weekTotal, ratio}|null}
 */
export function latestOf(doc, p) {
  const H = doc.meta.hours;
  for (let i = H.length - 1; i >= 0 && i >= H.length - 12; i--) {
    const off = p.off || [false, false];
    const x = p.v[i];
    const t = total(x, off);
    if (t == null) continue;
    const w = i - 24 * 7 >= 0 ? p.v[i - 24 * 7] : null;
    const [a, b] = pairTotals(x, w, off);
    return { hour: H[i], now: x, week: w || null, off, total: t, weekTotal: total(w, off), ratio: b ? a / b : null };
  }
  return null;
}

/** 先週と比べてどうか（地図の色と文字）。差が 10% 未満は「いつもどおり」 */
export function compareLabel(ratio) {
  if (ratio == null) return { key: 'none', text: '先週の値なし' };
  const pct = Math.round((ratio - 1) * 100);
  if (pct >= 10) return { key: 'more', text: `先週より ${pct}% 多い` };
  if (pct <= -10) return { key: 'less', text: `先週より ${-pct}% 少ない` };
  return { key: 'same', text: '先週とほぼ同じ' };
}

/** 'YYYYMMDDHH' → '10月24日 8時台' */
export function hourLabel(key) {
  return `${+key.slice(4, 6)}月${+key.slice(6, 8)}日 ${+key.slice(8, 10)}時台`;
}

/** その観測点の、最新の時間を含む24時間と、その7日前の24時間（グラフ用） */
export function day24(doc, p, endHour) {
  const H = doc.meta.hours; const e = H.indexOf(endHour);
  const out = [];
  const off = p.off || [false, false];
  for (let i = e - 23; i <= e; i++) out.push({ hour: H[i], now: i >= 0 ? total(p.v[i], off) : null, week: i - 168 >= 0 ? total(p.v[i - 168], off) : null });
  return out;
}

/** 読み込んだ JSON の形を確かめる。おかしな所の一覧（空なら良い） */
export function validate(doc) {
  const errs = [];
  if (!doc || !doc.meta || !Array.isArray(doc.meta.hours)) return ['meta.hours が無い'];
  if (!Array.isArray(doc.points)) return ['points が無い'];
  for (const p of doc.points) {
    if (!Array.isArray(p.c) || p.c.length !== 2) errs.push(`${p.id}: 位置が無い`);
    if (!Array.isArray(p.v) || p.v.length !== doc.meta.hours.length) errs.push(`${p.id}: 時間の数が違う`);
  }
  return errs;
}

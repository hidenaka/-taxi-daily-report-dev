// tools/js/koji-lane-scene.js — 工事の「いつも」と「工事中」の車線の並びを決める（純粋な関数）
//
// 都のデータの「全部で何車線・何車線ふさぐ・どちら側か」から、絵に描く車線の並びを作る。
// 画面の上半分＝左へ走る車、下半分＝右へ走る車（日本は左側通行なので、右へ走る車は下側を通る）。
// lanes は上から順。端の車線（歩道側）は上半分のいちばん上・下半分のいちばん下。
// どの車線をふさぐかは都のデータに無いので、片側だけなら歩道側から、「中」があれば中央寄りからふさぐ（推定）。
import { sideKind, SIDE_SHORT } from './koji-data.js';

const OPPOSITE = { up: 'down', down: 'up', inner: 'outer', outer: 'inner' };

/**
 * @returns {{ type: 'lane'|'alternating'|'closed', lanes: {dir: 1|-1, closed: boolean}[],
 *   total: number, open: number, guessed: boolean, topLabel: string, bottomLabel: string,
 *   normalLabel: string, workLabel: string }}
 */
export function laneScene(p = {}) {
  return { ...laneLayout(p), shape: roadShape(p) };
}

function laneLayout(p) {
  const t = Number(p.lanesTotal);
  const r = Number(p.lanesRestricted);
  const known = Number.isFinite(t) && t > 0 && Number.isFinite(r) && r > 0;
  const kind = sideKind(p.roadSide);
  const code = String(p.roadSide || '');

  if (p.restrictionType === 'alternating_one_way') {
    return {
      type: 'alternating',
      lanes: [{ dir: -1, closed: true }, { dir: 1, closed: false }],
      total: 2, open: 1, guessed: !known || t !== 2,
      topLabel: '', bottomLabel: '',
      normalLabel: 'いつも 2車線', workLabel: '工事中 交互に1車線',
    };
  }

  const total = known ? Math.min(t, 8) : 2;
  const nTop = Math.floor(total / 2);
  const nBot = total - nTop;
  const lanes = [
    ...Array.from({ length: nTop }, () => ({ dir: -1, closed: false })),
    ...Array.from({ length: nBot }, () => ({ dir: 1, closed: false })),
  ];
  // 上半分の i 番目（0＝歩道側）と下半分の i 番目（0＝歩道側）の添字
  const topAt = (i) => i;                       // 上半分は上から歩道側→中央
  const botAt = (i) => lanes.length - 1 - i;    // 下半分は下から歩道側→中央
  const topCenter = (i) => nTop - 1 - i;
  const botCenter = (i) => nTop + i;

  const isClosed = p.restrictionType === 'road_closed' || (known && r >= t);
  if (isClosed) {
    for (const l of lanes) l.closed = true;
    return {
      type: 'closed', lanes, total, open: 0, guessed: !known,
      ...halfLabels(kind, nTop),
      normalLabel: `いつも ${total}車線`, workLabel: '工事中 通れない',
    };
  }

  const want = known ? r : 1;
  const close = (idx) => { if (idx >= 0 && idx < lanes.length) lanes[idx].closed = true; };
  const center = code.includes('中');
  let bot = 0; let top = 0;
  if (kind === 'both' || (center && nTop > 0 && want > 1)) {
    bot = Math.ceil(want / 2); top = want - bot;
  } else {
    bot = want;
  }
  // 1方向の車線を全部ふさぐと絵が「通れない」に見えるので、各方向に1車線は残す
  bot = Math.min(bot, Math.max(0, nBot - 1));
  top = Math.min(top, Math.max(0, nTop - 1));
  for (let i = 0; i < bot; i++) close(center ? botCenter(i) : botAt(i));
  for (let i = 0; i < top; i++) close(center ? topCenter(i) : topAt(i));
  const closedN = lanes.filter((l) => l.closed).length;
  // 片側1車線の道で1車線をふさぐと、残りの1車線を両方向の車が交互に使うしかない
  if (!closedN) return { ...laneLayout({ restrictionType: 'alternating_one_way' }), guessed: true };

  return {
    type: 'lane', lanes, total, open: total - closedN,
    guessed: !known || closedN !== want,
    ...halfLabels(kind, nTop),
    normalLabel: `いつも ${total}車線`, workLabel: `工事中 ${total - closedN}車線`,
  };
}

/** 上半分・下半分の名前。片側だけの工事は、ふさぐ側を下半分に描く */
function halfLabels(kind, nTop) {
  if (kind === 'up' || kind === 'down' || kind === 'inner' || kind === 'outer') {
    return { bottomLabel: SIDE_SHORT[kind], topLabel: nTop ? SIDE_SHORT[OPPOSITE[kind]] : '' };
  }
  return { bottomLabel: '', topLabel: '' };
}

/**
 * 道の形（sync-koji.mjs が足した sigAt / curveDeg / slopePct）を、絵の右向き（→）の車から見た値にする。
 * 都のデータの線の向きと、ふさぐ側（side: 線の右=+1・左=-1）から、→ の車が線のどちら向きに走るかを決める。
 * 日本は左側通行なので、線の右側の車線を走る車は、線と逆向きに走る。
 *   sig:   信号の位置（m）。+ は → の車の行く先
 *   curve: → の車から見て、+ は右へ曲がる（度）
 *   slope: → の車から見て、+ は上り（%）
 *   road:  道の形 [{t, u}]（m）。t は → の車の行く先が +、u は → の車から見て右が +。無ければ null
 *   dirs:  { right, left }。→ の車・← の車が向かう方角と街 { compass: '北東', place: '新宿' | '' }。道の向きが無ければ null
 */
export function roadShape(p = {}) {
  const flip = Number(p.side) === 1 ? -1 : 1;
  const sig = String(p.sigAt ?? '').split(',').map(Number).filter((t) => p.sigAt != null && Number.isFinite(t)).map((t) => t * flip);
  const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
  const curve = num(p.curveDeg); const slope = num(p.slopePct);
  let road = null;
  if (p.roadU) {
    const us = String(p.roadU).split(',');
    road = us.map((v, i) => ({ t: (-150 + i * 10) * flip, u: v === '' || !Number.isFinite(Number(v)) ? null : Number(v) * flip }))
      .filter((q) => q.u != null).sort((a, b) => a.t - b.t);
    if (road.length < 2) road = null;
  }
  let dirs = null;
  const axis = num(p.axisDeg);
  if (axis != null) {
    const fwd = { compass: compass8(axis), place: p.axisTo || '' };
    const back = { compass: compass8(axis + 180), place: p.axisFrom || '' };
    dirs = flip === 1 ? { right: fwd, left: back } : { right: back, left: fwd };
  }
  return { sig: sig.sort((a, b) => a - b), curve: curve == null ? null : curve * flip, slope: slope == null ? null : slope * flip, road, dirs };
}

/** 方角（度・北が0の時計回り）→ 「北」「北東」… */
export function compass8(deg) {
  return ['北', '北東', '東', '南東', '南', '南西', '西', '北西'][Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}

/**
 * 「新宿方面」。街が無ければ「北東へ」。
 * 絵の → は画面の右で、地図の東とは限らないので、街があるときは方角を書かない（→ に「西へ」と並ぶと迷う）
 */
export function dirText(d) {
  if (!d) return '';
  return d.place ? `${d.place}方面` : `${d.compass}へ`;
}

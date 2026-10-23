// tools/js/koji-lane-anim.js — 工事の「いつも」と「工事中」を、車が動く絵で見せる
//
// laneScene()（koji-lane-scene.js）の車線の並びを、上から見た道路に描き、車を流す。
// 「工事中」ではコーンを並べ、ふさがれた車線の車が手前で隣の車線へ入る（入れないと止まって待つ）。
// 片側交互通行は、旗を持った人の合図で、左右の車が交代で1車線を通る。
// 道の形（scene.shape）があれば、信号で止まる・道が曲がる（先が見えにくい）・坂で動き出しが遅い、も描く。
//   曲がった道は、まっすぐな道の絵（別の canvas）を縦の細い帯に切り、帯ごとに上下へずらして写す。
// 絵は画面から外れたら止まる（popup を閉じると canvas が外れる）。
const SPRITES = ['car-taxi-black', 'car-white', 'car-blue', 'car-silver', 'car-truck', 'car-red', 'car-taxi-yellow', 'car-gray'];
const IMG_BASE = './img/koji/';
const imgCache = new Map();

function sprite(name) {
  if (!imgCache.has(name)) {
    const im = new Image();
    im.decoding = 'async';
    im.src = `${IMG_BASE}${name}.png`;
    imgCache.set(name, im);
  }
  const im = imgCache.get(name);
  return im.complete && im.naturalWidth ? im : null;
}

const FALLBACK = ['#1f2328', '#f3f4f6', '#7cc0e8', '#b8bec6', '#e9eef2', '#d9443a', '#f2c230', '#4b5058'];

/**
 * el に「いつも／工事中」の切り替えと、動く絵を出す。
 * @returns {{ destroy(): void, setWork(on: boolean): void }}
 */
export function mountLaneAnim(el, scene, { auto = true } = {}) {
  el.classList.add('lane-anim');
  el.innerHTML = '<div class="la-tabs" role="tablist">'
    + `<button type="button" data-w="0" role="tab">${scene.normalLabel}</button>`
    + `<button type="button" data-w="1" role="tab">${scene.workLabel}</button></div>`
    + '<canvas></canvas><div class="la-chips"></div>';
  const cv = el.querySelector('canvas');
  const tabs = [...el.querySelectorAll('.la-tabs button')];
  const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  const W = Math.max(220, Math.round(el.clientWidth || 268));
  const N = scene.lanes.length;
  const laneH = Math.max(16, Math.min(32, Math.floor(150 / N)));
  const walk = 10;                        // 歩道の幅
  const Hs = N * laneH + walk * 2;        // まっすぐな道の絵の高さ
  const shape = scene.shape || {};
  const curve = Math.max(-70, Math.min(70, Number(shape.curve) || 0));
  const curved = Math.abs(curve) >= 12;
  const PX_PER_M = W / 300;               // 工事の真ん中から前後およそ150m を描く
  const xMid = W * 0.57;                  // 工事の真ん中（zs と ze の間）
  // 道の形: 地図の道の線のとおりに曲げる（縮尺は車の進む向きと同じ。ずれが大きすぎる道だけ縮める）
  const road = shape.road || null;
  const uAt = (t) => {
    if (!road) return 0;
    if (t <= road[0].t) return road[0].u;
    for (let i = 1; i < road.length; i++) {
      if (t <= road[i].t) { const a = road[i - 1]; const b = road[i]; return a.u + ((b.u - a.u) * (t - a.t)) / (b.t - a.t); }
    }
    return road[road.length - 1].u;
  };
  let uMin = 0; let uMax = 0;
  for (let x = 0; x <= W; x += 4) { const u = uAt((x - xMid) / PX_PER_M); uMin = Math.min(uMin, u); uMax = Math.max(uMax, u); }
  const uScale = PX_PER_M * Math.min(1, 70 / Math.max(1, (uMax - uMin) * PX_PER_M));
  const bendPx = road ? Math.ceil((uMax - uMin) * uScale) : 0;
  const H = Hs + bendPx;
  const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
  cv.width = W * dpr; cv.height = H * dpr;
  cv.style.width = `${W}px`; cv.style.height = `${H}px`;
  const out = cv.getContext('2d');
  out.scale(dpr, dpr);
  // まっすぐな道は別の canvas に描く（曲げないときも同じ道筋）
  const flat = document.createElement('canvas');
  flat.width = W * dpr; flat.height = Hs * dpr;
  const roadCtx = flat.getContext('2d');
  roadCtx.scale(dpr, dpr);
  // g: いま描いている先。道（路面・線・斜線）は roadCtx に描いて曲げ、車・コーンなどは out に直接描く（曲げてゆがませない）
  let g = roadCtx;
  const bent = bendPx >= 2;
  // → の車から見て右（u が +）は、絵では下
  const bendAt = (x) => (bent ? uAt((x - xMid) / PX_PER_M) * uScale : 0);
  const base = bent ? -uMin * uScale : 0;
  /** まっすぐな道の上の点 (x, y) を、曲げた道の上へ。その場所の道の向きに回す（車・コーンは形を変えずに置く） */
  const anchor = (x, y) => {
    const ang = Math.atan((bendAt(x + 3) - bendAt(x - 3)) / 6);
    g.translate(x, base + bendAt(x) + y); g.rotate(ang); g.translate(-x, -y);
  };

  const laneY = (i) => walk + laneH * i + laneH / 2;
  const nTop = scene.lanes.filter((l) => l.dir === -1).length;
  const carL = laneH * 1.62; const carW = laneH * 0.74;
  const VMAX = W / 5.2;                   // 画面を約5秒で横切る
  const zs = W * 0.42; const ze = W * 0.72;   // 工事の場所
  const taper = laneH * 2.4;              // コーンを斜めに並べる長さ
  const sigX = (shape.sig || []).map((t) => (zs + ze) / 2 + t * PX_PER_M).filter((x) => x > 14 && x < W - 14);
  const slope = Number(shape.slope) || 0;
  const hill = Math.abs(slope) >= 2.5 ? Math.sign(slope) : 0;   // +1: → の車が上る
  // 信号: 青 5秒 → 黄 1秒 → 赤 4.5秒（全部の信号が同じ動き）
  const LIGHT = [['G', 5], ['Y', 1], ['R', 4.5]];
  let light = 0; let lightT = Math.random() * 3;
  const chips = [];
  if (sigX.length) chips.push(`信号 ${sigX.length}か所`);
  if (curved) chips.push(`${curve > 0 ? '右' : '左'}カーブ${Math.abs(curve) >= 25 ? '（先が見えにくい）' : ''}`);
  if (hill) chips.push(`→ の向きは${hill > 0 ? '上り' : '下り'}坂 ${Math.abs(slope)}%`);
  el.querySelector('.la-chips').textContent = chips.join('・');
  el.querySelector('.la-chips').hidden = !chips.length;

  let work = false; let workT = 0;        // workT: コーンの出方（0→1）
  let cars = []; let last = 0; let raf = 0; let clock = 0;
  // 自動で切り替える: いつも 4秒 → 工事中 7秒（車が詰まっていく様子が見えるように長め）
  let autoTimer = 0;
  const autoNext = () => { autoTimer = setTimeout(() => { setWork(!work); autoNext(); }, work ? 7000 : 4000); };
  if (auto && !reduce) autoNext();
  const spawnAt = scene.lanes.map(() => Math.random() * 0.8);
  // 片側交互通行の合図: → が通る / 空ける / ← が通る / 空ける
  const PHASES = [['R', 3.2], ['X', 1.6], ['L', 3.2], ['X', 1.6]];
  let phase = 0; let phaseT = 0;

  function setWork(on) {
    work = !!on;
    tabs.forEach((b) => b.setAttribute('aria-selected', String(b.dataset.w === (work ? '1' : '0'))));
    if (reduce) draw();
  }
  tabs.forEach((b) => { b.onclick = () => { clearTimeout(autoTimer); autoTimer = 0; setWork(b.dataset.w === '1'); }; });
  setWork(false);

  const closedNow = (i) => work && scene.lanes[i].closed;
  const sameDirLanes = (dir) => scene.lanes.map((l, i) => i).filter((i) => scene.lanes[i].dir === dir);

  /** ふさがれた車線 i から、入る先の車線（同じ向きで、開いている、いちばん近い車線） */
  function mergeTarget(i) {
    const c = sameDirLanes(scene.lanes[i].dir).filter((j) => !scene.lanes[j].closed);
    c.sort((a, b) => Math.abs(a - i) - Math.abs(b - i));
    return c[0] ?? null;
  }

  function spawn(dt) {
    scene.lanes.forEach((l, i) => {
      spawnAt[i] -= dt;
      if (spawnAt[i] > 0) return;
      const x0 = l.dir === 1 ? -carL : W + carL;
      const clear = cars.every((c) => Math.abs(c.y - laneY(i)) > laneH * 0.6 || Math.abs(c.x - x0) > carL * 1.8);
      if (!clear) { spawnAt[i] = 0.2; return; }
      cars.push({ x: x0, y: laneY(i), lane: i, home: i, dir: l.dir, v: VMAX * (0.85 + Math.random() * 0.15),
        s: Math.floor(Math.random() * SPRITES.length), wait: 0, gone: 0 });
      spawnAt[i] = 1.6 + Math.random() * 1.4;
    });
  }

  /** dir の向きで x より前にいる、同じ帯の車（いちばん近いもの）までの距離 */
  function gapAhead(car, y = car.y) {
    let best = Infinity;
    for (const o of cars) {
      if (o === car || o.dir !== car.dir || Math.abs(o.y - y) > laneH * 0.62) continue;
      const d = (o.x - car.x) * car.dir;
      if (d > 0 && d < best) best = d;
    }
    return best - carL;
  }
  function laneFree(car, y) {
    return cars.every((o) => o === car || o.dir !== car.dir || Math.abs(o.y - y) > laneH * 0.62
      || ((o.x - car.x) * car.dir > carL * 1.25) || ((car.x - o.x) * car.dir > carL * 1.6));
  }

  function step(dt) {
    clock += dt;
    workT = Math.max(0, Math.min(1, workT + (work ? dt : -dt) * 2.2));
    if (scene.type === 'alternating') {
      phaseT += dt;
      if (phaseT > PHASES[phase][1]) { phaseT = 0; phase = (phase + 1) % PHASES.length; }
    }
    lightT += dt;
    if (lightT > LIGHT[light][1]) { lightT = 0; light = (light + 1) % LIGHT.length; }
    spawn(dt);
    const sig = PHASES[phase][0];
    const lamp = LIGHT[light][0];
    for (const c of cars) {
      const front = c.x + (c.dir * carL) / 2;
      let stopAt = Infinity;                 // 止まる線までの距離（前のバンパーから）
      if (work) {
        if (scene.type === 'closed') {
          const line = c.dir === 1 ? zs - taper : ze + taper;
          const d = (line - front) * c.dir;
          if (d > -2) stopAt = d;
          if (c.v < 1 && d < 6) c.wait += dt;
          if (c.wait > 1.6) c.gone += dt;    // 待ちくたびれて別の道へ（消える）
        } else if (scene.type === 'alternating') {
          const enterLine = c.dir === 1 ? zs - taper - 6 : ze + taper + 6;
          const d = (enterLine - front) * c.dir;
          const mine = (c.dir === 1 && sig === 'R') || (c.dir === -1 && sig === 'L');
          if (d > -1 && !mine) stopAt = d;
          // ← の車は工事の手前で下の車線へ出て、過ぎたら戻る
          if (c.dir === -1) {
            const inZone = c.x < ze + taper + carL && c.x > zs - taper;
            c.ty = inZone && (mine || d <= -1) ? laneY(1) : laneY(0);
          }
        } else if (closedNow(c.lane)) {
          const line = c.dir === 1 ? zs - taper : ze + taper;
          const d = (line - front) * c.dir;
          const tgt = mergeTarget(c.lane);
          // カーブの先の工事は近くまで見えないので、ぎりぎりで車線を変える（入れずに止まりやすい）
          const sees = Math.abs(curve) >= 25 ? carL * 1.3 : carL * 3;
          if (tgt != null && d < sees && laneFree(c, laneY(tgt))) { c.lane = tgt; }
          else if (d > -2) stopAt = d;
        }
      } else if (scene.type === 'alternating' && c.dir === -1) {
        c.ty = laneY(0);
      }
      // 信号: 赤と黄（止まれる距離のとき）は停止線で止まる
      if (lamp !== 'G') {
        for (const sx of sigX) {
          const line = sx - c.dir * 11;
          const d = (line - front) * c.dir;
          if (d > -1 && (lamp === 'R' || d > 14)) stopAt = Math.min(stopAt, d);
        }
      }
      // 工事を過ぎたら、元の車線へ戻る
      const passed = (c.x - (c.dir === 1 ? ze : zs)) * c.dir > carL * 0.6;
      if (c.lane !== c.home && (!closedNow(c.home) || passed) && laneFree(c, laneY(c.home))) c.lane = c.home;
      const ty = c.ty ?? laneY(c.lane);
      c.y += (ty - c.y) * Math.min(1, dt * 5);
      const room = Math.min(gapAhead(c), stopAt);
      // 上り坂では速さが落ち、止まったあとの動き出しも遅い
      const up = hill && c.dir === hill;
      const want = room < 4 ? 0 : Math.min(VMAX * (up ? 0.85 : 1), room * 2.2);
      c.v += (want - c.v) * Math.min(1, dt * (want < c.v ? 8 : up ? 1.1 : 2.5));
      if (room < 1) c.v = 0;
      c.x += c.v * c.dir * dt;
    }
    cars = cars.filter((c) => c.x > -carL * 2 && c.x < W + carL * 2 && c.gone < 0.6);
  }

  // ---- 描く ----
  function draw() {
    g = roadCtx; drawRoad();
    out.clearRect(0, 0, W, H);
    if (!bent) out.drawImage(flat, 0, 0, W, Hs);
    else {
      out.fillStyle = '#e6e2d6'; out.fillRect(0, 0, W, H);
      const step = 1;   // 1px ずつ縦にずらして道を曲げる（幅が大きいと縁がギザギザになる）
      for (let x = 0; x < W; x += step) {
        out.drawImage(flat, x * dpr, 0, step * dpr, Hs * dpr, x, base + bendAt(x + step / 2), step + 0.4, Hs);
      }
    }
    g = out; drawThings();
  }

  /** 道そのもの（曲げる） */
  function drawRoad() {
    g.clearRect(0, 0, W, Hs);
    g.fillStyle = '#d9d4c7'; g.fillRect(0, 0, W, Hs);                       // 歩道
    g.fillStyle = '#55595f'; g.fillRect(0, walk, W, N * laneH);               // 車道
    // 車線の線
    for (let i = 1; i < N; i++) {
      const y = walk + laneH * i;
      if (i === nTop) {
        g.strokeStyle = '#f2c230'; g.lineWidth = 2; g.setLineDash([]);
      } else {
        g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = 1.5; g.setLineDash([10, 9]);
      }
      g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke();
    }
    g.setLineDash([]);
    drawSignals(false);
    if (workT > 0) drawWork(false);
  }

  /** 道の上に置くもの（車・コーン・人・信号の灯り・札・文字） */
  function drawThings() {
    drawSignals(true);
    if (workT > 0) drawWork(true);
    for (const c of cars) drawCar(c);
    if (workT > 0 && scene.type === 'alternating') drawFlags();
    if (workT > 0.6) drawTag();
    // 上半分・下半分の名前（片側だけの工事のとき）
    g.font = `700 10px system-ui,sans-serif`; g.textBaseline = 'middle'; g.textAlign = 'left';
    g.fillStyle = '#6b665a';
    const text = (t, x, y) => { g.save(); anchor(x, y); g.fillText(t, x, y); g.restore(); };
    if (scene.topLabel) text(scene.topLabel, 4, walk / 2 + 0.5);
    if (scene.bottomLabel) text(scene.bottomLabel, 4, Hs - walk / 2 + 0.5);
    // 向きの矢印（左右の端）
    g.fillStyle = 'rgba(255,255,255,.55)'; g.font = `700 ${Math.round(laneH * 0.55)}px system-ui,sans-serif`;
    g.textBaseline = 'middle';
    scene.lanes.forEach((l, i) => { g.textAlign = l.dir === 1 ? 'right' : 'left'; text(l.dir === 1 ? '→' : '←', l.dir === 1 ? W - 4 : 4, laneY(i)); });
  }

  function drawCar(c) {
    const im = sprite(SPRITES[c.s]);
    const a = 1 - Math.min(1, c.gone / 0.6);
    g.save(); g.globalAlpha = a; anchor(c.x, c.y); g.translate(c.x, c.y);
    if (c.dir === -1) g.scale(-1, 1);
    // 車線を変えている間は少し傾ける
    const tilt = Math.max(-0.35, Math.min(0.35, ((c.ty ?? laneY(c.lane)) - c.y) / laneH)) * c.dir;
    g.rotate(tilt * 0.6);
    if (im) {
      const h = Math.min(carW * 1.25, (carL * im.naturalHeight) / im.naturalWidth);
      g.drawImage(im, -carL / 2, -h / 2, carL, h);
    } else {
      g.fillStyle = FALLBACK[c.s]; g.strokeStyle = 'rgba(0,0,0,.45)'; g.lineWidth = 1;
      roundRect(-carL / 2, -carW / 2, carL, carW, carW * 0.35); g.fill(); g.stroke();
      g.fillStyle = 'rgba(30,40,60,.55)'; g.fillRect(carL * 0.08, -carW * 0.34, carL * 0.16, carW * 0.68);
    }
    if (c.v < 2) {                           // 止まっている車はブレーキランプ
      g.fillStyle = '#ff3b30'; g.fillRect(-carL / 2 - 1, -carW * 0.38, 2.5, carW * 0.22); g.fillRect(-carL / 2 - 1, carW * 0.16, 2.5, carW * 0.22);
    }
    g.restore();
  }

  function drawWork(things) {
    const k = easeOut(workT);
    g.save(); g.globalAlpha = k;
    const zone = (i) => {
      const y0 = walk + laneH * i; const dir = scene.lanes[i].dir;
      const x0 = zs; const x1 = ze;
      if (!things) {   // 路面の斜線（道といっしょに曲げる）
      // ふさいだ所の斜線
      g.save(); g.beginPath(); g.rect(x0, y0 + 2, x1 - x0, laneH - 4); g.clip();
      g.fillStyle = 'rgba(242,194,48,.35)'; g.fillRect(x0, y0, x1 - x0, laneH);
      g.strokeStyle = 'rgba(242,110,30,.85)'; g.lineWidth = 3.5;
      for (let x = x0 - laneH; x < x1 + laneH; x += 9) { g.beginPath(); g.moveTo(x, y0 + laneH); g.lineTo(x + laneH, y0); g.stroke(); }
      g.restore();
      return;
      }
      // コーン: 斜めに並べて、工事の間は車線の境目に沿わせる
      const edgeY = dir === 1 ? y0 : y0 + laneH;        // 車が出ていく側の境目
      const farY = dir === 1 ? y0 + laneH : y0;
      const tx0 = dir === 1 ? zs - taper : ze + taper;
      const tx1 = dir === 1 ? zs : ze;
      const n = 4;
      for (let j = 0; j <= n; j++) {
        const t = j / n; cone(tx0 + (tx1 - tx0) * t, farY + (edgeY - farY) * t * 0.85 + (dir === 1 ? 2 : -2) * (1 - t), k);
      }
      for (let x = zs; x <= ze; x += laneH * 0.9) cone(x, edgeY + (dir === 1 ? 2 : -2), k);
      // 工事の人
      const wk = sprite('worker');
      const wx = zs + (ze - zs) * (0.35 + 0.25 * Math.sin(clock * 0.7 + i));
      g.save(); anchor(wx, y0 + laneH / 2);
      if (wk) { const ww = laneH * 1.1; const wh = (ww * wk.naturalHeight) / wk.naturalWidth; g.drawImage(wk, wx - ww / 2, y0 + (laneH - wh) / 2, ww, wh); }
      else { g.fillStyle = '#f2c230'; g.beginPath(); g.arc(wx, y0 + laneH / 2, laneH * 0.22, 0, 7); g.fill(); }
      g.restore();
    };
    scene.lanes.forEach((l, i) => { if (l.closed) zone(i); });
    if (things && scene.type === 'closed') {
      for (const x of [zs - taper, ze + taper]) {
        const b = sprite('barrier');
        for (let i = 0; i < N; i++) {
          g.save(); anchor(x, laneY(i));
          if (b) g.drawImage(b, x - 4, walk + laneH * i + 1, 8, laneH - 2);
          else { g.fillStyle = i % 2 ? '#1d2024' : '#f2c230'; g.fillRect(x - 3, walk + laneH * i, 6, laneH); }
          g.restore();
        }
      }
    }
    g.restore();
  }

  function drawFlags() {
    const sig = PHASES[phase][0];
    for (const [x, y, mine] of [[zs - taper - 8, walk + N * laneH + 1, sig === 'R'], [ze + taper + 8, walk - 1, sig === 'L']]) {
      g.save(); g.globalAlpha = easeOut(workT); anchor(x, y);
      g.fillStyle = mine ? '#1fa463' : '#e0452f';
      g.beginPath(); g.arc(x, y, 6.5, 0, 7); g.fill();
      g.strokeStyle = '#fff'; g.lineWidth = 1.5; g.stroke();
      g.restore();
    }
  }

  /** 工事中の札: 「ここで合流」「交互に通る」「通れない」 */
  function drawTag() {
    const text = scene.type === 'closed' ? '通れない' : scene.type === 'alternating' ? '交代で通る' : 'ここで合流';
    const i = scene.lanes.findIndex((l) => l.closed);
    if (i < 0) return;
    const dir = scene.lanes[i].dir;
    const x = scene.type === 'lane' ? (dir === 1 ? zs - taper : ze + taper) : (zs + ze) / 2;
    const y = scene.type === 'lane' ? laneY(i) + (dir === 1 ? -laneH * 0.95 : laneH * 0.95) : walk + laneH * 0.5;
    g.font = '800 11px system-ui,sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    const w = g.measureText(text).width + 12; const h = 17;
    const bx = Math.max(2, Math.min(W - w - 2, x - w / 2)); const by = Math.max(1, Math.min(Hs - h - 1, y - h / 2));
    g.save(); g.globalAlpha = Math.min(1, (workT - 0.6) * 2.5); anchor(bx + w / 2, by + h / 2);
    g.fillStyle = '#e0452f'; roundRect(bx, by, w, h, 8); g.fill();
    g.fillStyle = '#fff'; g.fillText(text, bx + w / 2, by + h / 2 + 0.5);
    g.restore();
  }

  /** 横断歩道と停止線と信号の灯り（両側の歩道に1つずつ） */
  function drawSignals(things) {
    const col = { G: '#22c55e', Y: '#facc15', R: '#ef4444' }[LIGHT[light][0]];
    for (const x of sigX) {
      if (things) {
        for (const [lx, ly] of [[x + 9, Hs - walk / 2], [x - 9, walk / 2]]) {
          g.save(); anchor(lx, ly);
          g.fillStyle = '#2b2f33'; roundRect(lx - 6, ly - 4.5, 12, 9, 3); g.fill();
          g.fillStyle = col; g.beginPath(); g.arc(lx, ly, 3.2, 0, 7); g.fill();
          g.restore();
        }
        continue;
      }
      g.fillStyle = 'rgba(255,255,255,.8)';
      for (let y = walk + 2; y < walk + N * laneH - 2; y += 6) g.fillRect(x - 5, y, 10, 3.2);
      g.fillStyle = 'rgba(255,255,255,.9)';
      scene.lanes.forEach((l, i) => g.fillRect(x - l.dir * 11 - 1, walk + laneH * i + 2, 2, laneH - 4));
    }
  }

  function cone(x, y, k) {
    const im = sprite('cone'); const s = Math.min(14, laneH * 0.62) * (0.6 + 0.4 * k);
    g.save(); anchor(x, y);
    if (im) g.drawImage(im, x - s / 2, y - s / 2, s, s);
    else {
      g.fillStyle = '#ff7a1a'; g.beginPath(); g.arc(x, y, s * 0.42, 0, 7); g.fill();
      g.fillStyle = '#fff'; g.beginPath(); g.arc(x, y, s * 0.18, 0, 7); g.fill();
    }
    g.restore();
  }

  function roundRect(x, y, w, h, r) {
    g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  }

  function frame(ts) {
    if (!cv.isConnected) { destroy(); return; }
    const dt = Math.min(0.05, last ? (ts - last) / 1000 : 0);
    last = ts;
    step(dt); draw();
    raf = requestAnimationFrame(frame);
  }

  function destroy() {
    cancelAnimationFrame(raf); raf = 0;
    clearTimeout(autoTimer); autoTimer = 0;
  }

  if (reduce) {
    // 動きを減らす設定: 車を並べた止まった絵だけ（切り替えは押して見る）
    for (let k = 0; k < 160; k++) step(0.05);
    draw();
  } else {
    for (let k = 0; k < 90; k++) step(0.05);  // 開いた瞬間から車が流れているように
    raf = requestAnimationFrame(frame);
  }
  return { destroy, setWork };
}

const easeOut = (t) => 1 - (1 - t) * (1 - t);

// tools/js/koji-ui.js — 工事マップの画面（一覧・凡例・時刻・切り替え）
//
// 工事マップ本家（ハッカソン/osanpo-safety の public/radar.js）の画面をそのまま移植したもの。
// ボタン・並び・文言は本家と同じにする（勝手に足したり減らしたりしない）。
// 地図の層は koji-layer.js、材料づくりは koji-data.js。
import { createKojiLayer } from './koji-layer.js';
import {
  activeAt, stateAt, toDisplay, markTwins, windowAt, windowLabel, formatPeriod,
  laneLevel, levelInfo, kindOf, kindInfo, jamLevel, jamInfo, sideKind, sideLabel,
  MODES, DIRS, LEVELS, LEVEL_ORDER, KIND_MARK, SIDE_SHORT, TYPE_LABEL, LIST_MAX,
  HEAT_WEIGHT, samplePoints, OWNERS_DEF,
} from './koji-data.js';

const DATA_URL = './data/koji.json';
const HOUR = 3600 * 1000;
const STEPS = 168;          // いまから7日分・1時間きざみ
const JST_MS = 9 * HOUR;
const WEEK = ['日', '月', '火', '水', '木', '金', '土'];

const $ = (id) => document.getElementById(id);
const hourStart = (t) => Math.floor(t / HOUR) * HOUR;
const jst = (t) => new Date(t + JST_MS);
const hm = (min) => `${Math.floor(min / 60) % 24}:${String(min % 60).padStart(2, '0')}`;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function createKojiUi(map) {
  let features = [];
  let base = hourStart(Date.now());
  let mode = 'level';       // 色分け: ふさぎ具合 / 工事の種類 / 車の向き / 混みやすさ
  let view = '3d';          // 見え方: 立体 / 平面
  let sort = 'heavy';
  const hidden = new Set(); // 凡例で消した種類
  let playing = null;
  let active = false;
  let loaded = false;
  let popup = null;

  const layer = createKojiLayer(map, { onClick: (f, lngLat) => openPopup(f.properties, lngLat) });

  // ---- データ ----
  async function load() {
    if (loaded) return true;
    try {
      const res = await fetch(DATA_URL, { cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      const fc = await res.json();
      features = fc.features.map((f) => toDisplay(f, Date.now()));
      markTwins(features);
      loaded = true;
      $('sTotal').textContent = String(features.length);
      $('sRoads').textContent = String(new Set(features.map((f) => f.properties.road)).size);
      if (fc.fetchedAt) {
        const d = jst(new Date(fc.fetchedAt).getTime());
        $('koji-updated').textContent = `更新 ${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
      }
      return true;
    } catch {
      $('summary').textContent = '工事データを読み込めませんでした。';
      return false;
    }
  }

  /** 地図に層を足せるまで試す（画面が裏だと MapLibre の準備が進まないため） */
  async function ensureLayers() {
    let failsWhileVisible = 0;
    while (active && !layer.isAdded()) {
      try {
        layer.addLayers();
        return true;
      } catch (e) {
        if (!document.hidden) {
          failsWhileVisible += 1;
          if (failsWhileVisible > 40) { $('summary').textContent = `地図を作れませんでした（${e.message}）`; return false; }
        }
        await sleep(300);
      }
    }
    return layer.isAdded();
  }

  // ---- 描画 ----
  const currentT = () => base + Number($('t').value) * HOUR;

  function colorOf(p) {
    if (mode === 'jam') return jamInfo(p.jam).color;
    if (mode === 'dir') return (DIRS.find((d) => d.key === p.dir) || DIRS[DIRS.length - 1]).color;
    return (mode === 'level' ? levelInfo(p.level) : kindInfo(p.kind)).color;
  }

  function render() {
    if (!active) return;
    const t = currentT();
    const prop = MODES[mode].prop;
    const q = $('q').value.trim();
    const counts = {}; const shown = []; const ends = []; const list = []; const heat = [];
    let n = 0; let startSoon = 0; let endSoon = 0;
    const hour = jst(t).getUTCHours();
    for (const f of features) {
      const p = { ...f.properties, jam: jamLevel(f.properties, hour) };   // 混みやすさは時刻で変わる
      const st = stateAt(p, t);
      if (st === 2) counts[p[prop]] = (counts[p[prop]] || 0) + 1;
      const next = activeAt(p, t + HOUR);
      if (st !== 2 && next) startSoon += 1;
      if (st === 2 && !next) endSoon += 1;
      if (st === 0 || hidden.has(p[prop])) continue;
      const g = { ...f, properties: { ...p, st } };
      shown.push(g);
      if (st === 2) {
        n += 1;
        if (p.isLine) {
          const c = f.geometry.coordinates;
          ends.push(c[0], c[c.length - 1]);
        }
        for (const c of samplePoints(f.geometry)) {
          heat.push({ type: 'Feature', geometry: { type: 'Point', coordinates: c }, properties: { w: HEAT_WEIGHT[p.level] ?? 0.3 } });
        }
        if (!q || p.title.includes(q)) list.push(g);
      }
    }
    shown.sort((a, b) => LEVEL_ORDER[b.properties.level] - LEVEL_ORDER[a.properties.level]);  // 重いものを上に
    layer.setData({
      shown, heat,
      ends: ends.map((c) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: c }, properties: {} })),
    });

    const d = jst(t);
    $('clock').textContent = `${d.getUTCHours()}:00`;
    $('date').textContent = `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${WEEK[d.getUTCDay()]})`;
    const frac = Number($('t').value) / (STEPS - 1);
    $('done').style.width = `${frac * 100}%`;
    for (const el of $('ticks').querySelectorAll('.d')) el.classList.toggle('f', Number(el.dataset.i) > Number($('t').value));
    const alt = counts.alternating || 0; const half = counts.half || 0; const closed = counts.closed || 0;
    $('summary').innerHTML = `この時刻に工事中 <b>${n}</b> 件`
      + (mode === 'level' ? `（全面通行止め ${closed}・片側交互通行 <b>${alt}</b>・3分の1以上 ${half}）` : '')
      + (mode === 'jam' ? `（通れない ${counts.blocked || 0}・混みやすい <b>${counts.high || 0}</b>・やや混む ${counts.mid || 0}）` : '')
      + (mode === 'dir' ? `（都心へ向かう車線 <b>${counts.up || 0}</b>・都心から出る車線 <b>${counts.down || 0}</b>・内回り ${counts.inner || 0}・外回り ${counts.outer || 0}）` : '')
      + `　この1時間で始まる <b>${startSoon}</b> 件・終わる <b>${endSoon}</b> 件`;
    for (const b of $('legend').children) b.querySelector('b').textContent = String(counts[b.dataset.key] || 0);
    renderList(list, t);
  }

  function renderList(list, t) {
    const rows = list.map((f) => ({ f, w: windowAt(f.properties.timeWindow, t) }));
    const left = (r) => (r.w ? r.w.left : 1e9);
    const JAM_ORDER = { blocked: 0, high: 1, mid: 2, low: 3, unknown: 4 };
    if (sort === 'heavy' && mode === 'jam') {
      rows.sort((a, b) => JAM_ORDER[a.f.properties.jam] - JAM_ORDER[b.f.properties.jam] || LEVEL_ORDER[a.f.properties.level] - LEVEL_ORDER[b.f.properties.level]);
    } else if (sort === 'heavy') {
      rows.sort((a, b) => LEVEL_ORDER[a.f.properties.level] - LEVEL_ORDER[b.f.properties.level] || left(a) - left(b));
    }
    if (sort === 'soon') rows.sort((a, b) => left(a) - left(b));
    if (sort === 'late') rows.sort((a, b) => left(b) - left(a));
    const box = $('items');
    box.replaceChildren();
    for (const { f, w } of rows.slice(0, LIST_MAX)) {
      const p = f.properties;
      const color = colorOf(p);
      const el = document.createElement('button');
      el.className = 'item';
      const side = SIDE_SHORT[sideKind(p.roadSide)];
      const lanes = p.lanesTotal ? `${p.lanesTotal}車線中${p.lanesRestricted}` : '';
      el.innerHTML = `<span class="badge" style="border-color:${color};color:${color}">${KIND_MARK[p.kind] || '他'}</span>`
        + `<span class="t">${esc(p.road)}</span>`
        + `<span class="r"><b>${w ? hm(w.end) : '終日'}</b><span>${w ? `あと${w.left >= 60 ? `${Math.floor(w.left / 60)}時間` : `${w.left}分`}` : ''}</span></span>`
        + `<span class="s">${p.placement === 'approx' ? '位置は目安・' : ''}${esc(p.what)}・${esc(levelInfo(p.level).label)}${side ? `・${side}` : ''}${lanes ? `・${lanes}` : ''}</span>`
        + `<span class="bar"><i style="width:${w ? Math.round(w.frac * 100) : 100}%;background:${color}"></i></span>`;
      el.onclick = () => focusFeature(f);
      box.append(el);
    }
    if (rows.length > LIST_MAX) {
      const m = document.createElement('div');
      m.className = 'more';
      m.textContent = `ほか ${rows.length - LIST_MAX} 件（地図で見られます）`;
      box.append(m);
    }
    if (!rows.length) {
      const m = document.createElement('div');
      m.className = 'more';
      m.textContent = 'この時刻に当てはまる工事はありません。';
      box.append(m);
    }
  }

  function focusFeature(f) {
    const c = f.geometry.type === 'LineString'
      ? f.geometry.coordinates[Math.floor(f.geometry.coordinates.length / 2)]
      : f.geometry.coordinates;
    map.flyTo({ center: c, zoom: 16, pitch: view === '3d' ? 55 : 0, speed: 1.4 });
    openPopup(f.properties, c);
    if (innerWidth <= 760) $('list').classList.remove('open');
  }

  function pill(info) {
    const darkText = info.key === 'part';
    return `<span class="pill" style="background:${info.color};color:${darkText ? '#1d2024' : '#fff'}">${esc(info.label)}</span>`;
  }

  function popupHtml(p) {
    let h = '<div class="koji-pop">';
    h += `${pill({ key: 'road', label: '下道（都道）', color: '#4b5563' })}${pill(levelInfo(p.level))}${pill(kindInfo(p.kind))}`;
    h += `<div class="ttl">${esc(p.title)}</div>`;
    if (/高速|首都高/.test(p.title)) h += '<div class="sub">高速道路の工事ですが、規制されるのは下道の車線です。</div>';
    if (p.roadSide) h += `<div>規制する側: <b>${esc(sideLabel(p.roadSide))}</b><span class="sub">（推定）</span></div>`;
    if (Number(p.side)) h += '<div class="sub small">地図の矢印＝ふさがれる車線を走る車の向き（拡大すると出ます）</div>';
    if (p.placement === 'approx') {
      h += `<div class="warn">位置は目安です。都のデータの道路名「${esc(p.road)}」の道路が、住所の近くに見つかりません（元データの道路名か住所が違う可能性）。`
        + (p.twinRoad ? `<br>すぐ近くに、道路名だけが違う同じ内容の工事（<b>${esc(p.twinRoad)}</b>）があります。道路名の書き間違いかもしれません。` : '') + '</div>';
    }
    if (p.laneSummary) h += `<div class="b">${esc(p.laneSummary)}</div>`;
    if (Number(p.st) === 2 && p.jam) h += `<div>この時刻の混みやすさ: <b style="color:${jamInfo(p.jam).color}">${esc(jamInfo(p.jam).label)}</b><span class="sub">（目安）</span></div>`;
    else h += `<div>${esc(TYPE_LABEL[p.restrictionType] || p.restrictionType)}</div>`;
    h += `<div>作業時間: <b>${esc(windowLabel(p.timeWindow))}</b>${Number(p.st) === 1 ? '（この時刻は作業なし）' : ''}</div>`;
    h += `<div class="sub">${esc(formatPeriod(p))}</div>`;
    return `${h}</div>`;
  }

  function openPopup(p, lngLat) {
    popup?.remove();
    popup = new maplibregl.Popup({ offset: 12, maxWidth: '300px' }).setLngLat(lngLat).setHTML(popupHtml(p)).addTo(map);
  }

  // ---- 下の時刻の目盛り ----
  function drawTicks() {
    const box = $('ticks');
    box.replaceChildren();
    for (let i = 0; i < STEPS; i++) {
      const d = jst(base + i * HOUR);
      const h = d.getUTCHours();
      const x = `${(i / (STEPS - 1)) * 100}%`;
      if (h === 0) {
        const dot = document.createElement('i');
        dot.className = 'd'; dot.dataset.i = String(i); dot.style.left = x;
        const l = document.createElement('span');
        l.className = 'l'; l.style.left = x;
        l.textContent = `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${WEEK[d.getUTCDay()]})`;
        box.append(dot, l);
      } else if (h % 6 === 0) {
        const p = document.createElement('i');
        p.className = 'p'; p.style.left = x;
        box.append(p);
      }
    }
  }

  // ---- 凡例（押すと表示・非表示）----
  function buildLegend() {
    const box = $('legend');
    box.replaceChildren();
    for (const k of MODES[mode].items) {
      const b = document.createElement('button');
      b.dataset.key = k.key;
      b.setAttribute('aria-pressed', String(!hidden.has(k.key)));
      b.innerHTML = `<i style="background:${k.color}"></i>${esc(k.label)} <b>0</b>`;
      b.onclick = () => {
        if (hidden.has(k.key)) hidden.delete(k.key); else hidden.add(k.key);
        b.setAttribute('aria-pressed', String(!hidden.has(k.key)));
        render();
      };
      box.append(b);
    }
  }

  // ---- 道の持ち主 ----
  function applyRoadsUi() {
    const on = layer.isRoadsOn();
    $('roads').setAttribute('aria-pressed', String(on));
    $('owners').hidden = !on;
    for (const b of $('ownerLegend').children) b.setAttribute('aria-pressed', String(layer.isOwnerShown(b.dataset.key)));
    $('ownerHint').style.display = on && map.getZoom() < 14 ? '' : 'none';
  }

  function buildOwnerLegend() {
    const box = $('ownerLegend');
    const items = [...OWNERS_DEF.map((o) => ({ key: o.key, label: o.label, dot: `<i style="background:${o.color}"></i>` })),
      { key: 'bdry', label: '区の境', dot: '<i class="bd"></i>' }];
    box.innerHTML = items.map((x) => `<button data-key="${x.key}" aria-pressed="true">${x.dot}${esc(x.label)}</button>`).join('');
    for (const b of box.children) {
      b.onclick = () => { layer.toggleOwner(b.dataset.key); applyRoadsUi(); };
    }
  }

  // ---- 操作 ----
  function stop() {
    clearInterval(playing); playing = null;
    $('play').innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4v16l13-8z"/></svg>';
    $('play').setAttribute('aria-label', '再生');
  }

  function setMode(next) {
    mode = next;
    for (const b of document.querySelectorAll('[data-mode]')) b.setAttribute('aria-pressed', String(b.dataset.mode === mode));
    hidden.clear();
    layer.setColorMode(mode);
    buildLegend();
    render();
  }

  function setView(next) {
    view = next;
    for (const b of document.querySelectorAll('[data-view]')) b.setAttribute('aria-pressed', String(b.dataset.view === view));
    map.easeTo(view === '3d' ? { pitch: 50, bearing: -12, duration: 700 } : { pitch: 0, bearing: 0, duration: 700 });
  }

  function wire() {
    $('play').onclick = () => {
      if (playing) return stop();
      $('play').innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M6 4h4v16H6zM14 4h4v16h-4z"/></svg>';
      $('play').setAttribute('aria-label', '停止');
      playing = setInterval(() => { $('t').value = String((Number($('t').value) + 1) % STEPS); render(); }, 450);
    };
    $('t').oninput = () => render();
    $('now').onclick = () => { stop(); base = hourStart(Date.now()); $('t').value = '0'; drawTicks(); render(); };
    $('q').oninput = () => render();
    $('listBtn').onclick = () => $('list').classList.toggle('open');
    $('roads').onclick = () => { layer.setRoads(!layer.isRoadsOn()); applyRoadsUi(); };
    $('info').onclick = () => $('about').showModal();
    for (const b of document.querySelectorAll('[data-mode]')) b.onclick = () => setMode(b.dataset.mode);
    for (const b of document.querySelectorAll('[data-view]')) b.onclick = () => setView(b.dataset.view);
    for (const b of document.querySelectorAll('#sort button')) {
      b.onclick = () => {
        sort = b.dataset.sort;
        for (const x of document.querySelectorAll('#sort button')) x.setAttribute('aria-pressed', String(x === b));
        render();
      };
    }
    map.on('zoomend', applyRoadsUi);
    map.on('moveend', () => { if (active) applyRoadsUi(); });
  }

  let wired = false;

  return {
    /** 工事の画面に入る/出る */
    async setActive(next) {
      active = next;
      document.body.classList.toggle('koji-on', next);
      if (!next) { stop(); popup?.remove(); layer.setVisible(false); return; }
      if (!wired) { wire(); buildLegend(); buildOwnerLegend(); drawTicks(); wired = true; }
      if (!(await load())) return;
      if (!(await ensureLayers())) return;
      layer.setColorMode(mode);
      layer.setVisible(true);
      applyRoadsUi();
      render();
    },
    refresh: () => { if (active) applyRoadsUi(); },
    isActive: () => active,
  };
}

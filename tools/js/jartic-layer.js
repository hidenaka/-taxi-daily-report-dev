// tools/js/jartic-layer.js — 国土交通省「交通量API」の国道の観測点を、工事の画面に重ねる層（MapLibre GL）
//
// 1時間ごとに .github/workflows/sync-jartic.yml が tools/data/jartic-traffic.json を新しくする。
// 地図は、いちばん新しい時間の台数と、7日前の同じ時間の台数を比べて色を付ける。開いている間は10分ごとに読み直す。
// 規約 第5条: この層を出している間は、出典と「国土交通省が保証したものではない」旨を必ず見える所に出す。
// 既定はオフ。読めなくても、工事と雨雲の地図はそのまま動く。
import { latestOf, compareLabel, hourLabel, day24, validate, NOTICE, SOURCE } from './jartic-data.js';

const DATA_URL = './data/jartic-traffic.json';
const SRC = 'jt-pts';
const DOT = 'jt-dot';
const LABEL = 'jt-label';
const LAYERS = [DOT, LABEL];
const RELOAD_MS = 10 * 60 * 1000;
const COLORS = { more: '#d9480f', less: '#1f6fd1', same: '#4f5862', none: '#9aa0a6' };

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = (id) => document.getElementById(id);
const fmt = (v) => (v == null ? '—' : `${Number(v).toLocaleString('ja-JP')}`);

export function createJarticLayer(map, { closeOtherPopups } = {}) {
  let doc = null;
  let on = false;
  let screenActive = false;
  let added = false;
  let popup = null;
  let timer = 0;

  async function load() {
    try {
      const res = await fetch(DATA_URL, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      const errs = validate(d);
      if (errs.length) throw new Error(errs.slice(0, 3).join(' / '));
      doc = d;
      return true;
    } catch (e) {
      console.warn('[交通量API] 読み込めませんでした', e);
      return false;
    }
  }

  const pointName = (p) => p.name || '国道（23区の外）';

  function geojson() {
    return {
      type: 'FeatureCollection',
      features: doc.points.map((p) => {
        const l = latestOf(doc, p);
        const key = l ? compareLabel(l.ratio).key : 'none';
        return { type: 'Feature', geometry: { type: 'Point', coordinates: p.c }, properties: { id: p.id, key, v: l?.total ?? 0, img: `jt-l-${p.id}-${l?.total ?? 'x'}` } };
      }),
    };
  }

  /** 台数の札（地図にフォント設定が無いので、文字を画像にする） */
  function addLabels() {
    for (const p of doc.points) {
      const l = latestOf(doc, p);
      const name = `jt-l-${p.id}-${l?.total ?? 'x'}`;
      if (map.hasImage(name)) continue;
      const text = l ? `${fmt(l.total)}台` : '値なし';
      const color = COLORS[l ? compareLabel(l.ratio).key : 'none'];
      const size = 24; const font = `800 ${size}px -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif`;
      const c = document.createElement('canvas'); const g = c.getContext('2d');
      g.font = font; const w = Math.ceil(g.measureText(text).width) + 20; const h = size + 14;
      c.width = w; c.height = h; g.font = font;
      g.fillStyle = 'rgba(255,255,255,0.95)'; g.strokeStyle = color; g.lineWidth = 3;
      const r = h / 2; g.beginPath(); g.moveTo(r, 1.5); g.arcTo(w - 1.5, 1.5, w - 1.5, h - 1.5, r - 1.5); g.arcTo(w - 1.5, h - 1.5, 1.5, h - 1.5, r - 1.5);
      g.arcTo(1.5, h - 1.5, 1.5, 1.5, r - 1.5); g.arcTo(1.5, 1.5, w - 1.5, 1.5, r - 1.5); g.closePath(); g.fill(); g.stroke();
      g.fillStyle = '#1d2024'; g.textBaseline = 'middle'; g.textAlign = 'center'; g.fillText(text, w / 2, h / 2 + 1);
      map.addImage(name, g.getImageData(0, 0, w, h), { pixelRatio: 2 });
    }
  }

  /** 印: 色の丸に白い棒グラフ（工事の丸い点と見分けるため） */
  function addMarks() {
    for (const [key, color] of Object.entries(COLORS)) {
      const name = `jt-mark-${key}`;
      if (map.hasImage(name)) continue;
      const s = 48; const c = document.createElement('canvas'); c.width = s; c.height = s;
      const g = c.getContext('2d');
      g.beginPath(); g.arc(s / 2, s / 2, s / 2 - 2, 0, Math.PI * 2); g.fillStyle = '#ffffff'; g.fill();
      g.beginPath(); g.arc(s / 2, s / 2, s / 2 - 6, 0, Math.PI * 2); g.fillStyle = color; g.fill();
      g.fillStyle = '#ffffff';
      [[14, 26, 6, 8], [21, 18, 6, 16], [28, 22, 6, 12]].forEach(([x, y, w, h]) => g.fillRect(x, y, w, h));
      map.addImage(name, g.getImageData(0, 0, s, s), { pixelRatio: 2 });
    }
  }

  function addLayers() {
    if (added) return true;
    try {
      addMarks();
      addLabels();
      map.addSource(SRC, { type: 'geojson', data: geojson(), attribution: '交通量: 国土交通省 交通量API（参考値・加工）' });
      map.addLayer({
        id: LABEL, type: 'symbol', source: SRC, minzoom: 11.5,
        layout: { visibility: 'none', 'icon-image': ['get', 'img'], 'icon-anchor': 'left', 'icon-offset': [26, 0], 'icon-allow-overlap': false },
      });
      map.addLayer({
        id: DOT, type: 'symbol', source: SRC,
        layout: {
          visibility: 'none', 'icon-image': ['concat', 'jt-mark-', ['get', 'key']], 'icon-allow-overlap': true, 'icon-ignore-placement': true,
          'icon-size': ['interpolate', ['linear'], ['zoom'], 9, 0.75, 13, 1, 16, 1.2],
        },
      });
      for (const id of LAYERS) {
        map.on('click', id, (e) => {
          const f = e.features && e.features[0];
          if (f) openPopup(f.properties.id, e.lngLat);
        });
        map.on('mouseenter', id, () => { map.getCanvas().style.cursor = 'pointer'; });
        map.on('mouseleave', id, () => { map.getCanvas().style.cursor = ''; });
      }
      added = true;
      return true;
    } catch (e) {
      console.warn('[交通量API] 地図に重ねられませんでした', e);
      for (const id of LAYERS) if (map.getLayer(id)) map.removeLayer(id);
      if (map.getSource(SRC)) map.removeSource(SRC);
      return false;
    }
  }

  function applyVisibility() {
    if (!added) return;
    const v = on && screenActive ? 'visible' : 'none';
    for (const id of LAYERS) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', v);
    if (v === 'none') popup?.remove();
  }

  // ---- 吹き出し ----

  /** 24時間の棒（今日＝色・先週＝灰色の線） */
  function chart(rows) {
    const W = 260; const H = 54; const max = Math.max(1, ...rows.flatMap((r) => [r.now || 0, r.week || 0]));
    const bw = W / rows.length;
    const bars = rows.map((r, i) => {
      const x = i * bw;
      const nh = r.now == null ? 0 : (r.now / max) * (H - 14);
      const wy = r.week == null ? null : H - 12 - (r.week / max) * (H - 14);
      return `${r.now == null ? '' : `<rect x="${(x + 1).toFixed(1)}" y="${(H - 12 - nh).toFixed(1)}" width="${(bw - 2).toFixed(1)}" height="${nh.toFixed(1)}" fill="#1f5fa8" opacity=".8"/>`}`
        + `${wy == null ? '' : `<rect x="${x.toFixed(1)}" y="${(wy - 1).toFixed(1)}" width="${bw.toFixed(1)}" height="2" fill="#7b828a"/>`}`;
    }).join('');
    const ticks = rows.map((r, i) => (+r.hour.slice(8, 10) % 6 === 0 ? `<text x="${(i * bw + bw / 2).toFixed(1)}" y="${H - 1}" font-size="9" text-anchor="middle" fill="#6b7076">${+r.hour.slice(8, 10)}時</text>` : '')).join('');
    return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="この24時間の台数（棒）と、先週の同じ時間（灰色の線）">${bars}${ticks}</svg>`;
  }

  function openPopup(id, lngLat) {
    const p = doc.points.find((x) => x.id === id);
    if (!p) return;
    closeOtherPopups?.();
    popup?.remove();
    collapseNote();   // 吹き出しと重ならないよう、説明は規約の文だけにする
    const l = latestOf(doc, p);
    const cmp = l ? compareLabel(l.ratio) : null;
    const dir = (label, d) => (p.off?.[d] ? '' : `<span>${label} <b>${fmt(l.now?.[d])}</b>（先週 ${fmt(l.week?.[d])}）</span>`);
    const body = l ? `
      <div class="jt-big">${fmt(l.total)}<small>台／時</small> <span class="jt-cmp jt-${cmp.key}">${esc(cmp.text)}</span></div>
      <div class="jt-when">${esc(hourLabel(l.hour))}に通った車（先週は同じ曜日・同じ時間）</div>
      <div class="jt-dirs">${dir('上り', 0)}${dir('下り', 1)}</div>
      <div class="jt-chart"><div class="jt-cap">この24時間（棒）と先週（灰色の線）</div>${chart(day24(doc, p, l.hour))}</div>`
      : '<p>この2〜3時間は値が届いていません（機械の止まり・欠測など）。</p>';
    const html = `<div class="jt-pop">
      <div class="jt-kicker">国道の交通量（${p.kind === 'cctv' ? 'カメラで数える地点' : '道路の機械で数える地点'}）</div>
      <div class="ttl">${esc(pointName(p))}</div>
      ${body}
      <p class="jt-src">出典: ${esc(SOURCE)}。上り・下りは道路ごとに決まった向き。道の名前は地図から見た目安。</p>
    </div>`;
    popup = new maplibregl.Popup({ offset: 14, maxWidth: '300px' }).setLngLat(p.c).setHTML(html).addTo(map);
    // はみ出したら地図を動かして画面に収める（上のボタン・下の時刻の欄をよける。工事の吹き出しと同じ）
    requestAnimationFrame(() => {
      const r = popup?.getElement()?.getBoundingClientRect();
      const c = map.getContainer().getBoundingClientRect();
      if (!r) return;
      const top = c.top + (innerWidth <= 760 ? 150 : 60);
      const bottom = c.bottom - (innerWidth <= 760 ? 290 : 170);
      let dy = 0;
      if (r.top < top) dy = r.top - top;
      else if (r.bottom > bottom) dy = Math.min(r.bottom - bottom, r.top - top);
      if (dy) map.panBy([0, dy], { duration: 350 });
    });
  }

  // ---- 画面（ボタン・凡例） ----

  function placeNote(n) {
    // 道の持ち主・警視庁の交通量調査の説明が出ていたら、その下に置く
    let top = 76;
    for (const id of ['owners', 'tcNote']) {
      const el = $(id);
      if (el && !el.hidden && el.offsetParent) top = Math.max(top, el.offsetTop + el.offsetHeight + 8);
    }
    n.style.top = `${top}px`;
  }

  function setNote(html, isError = false) {
    const n = $('jtNote');
    if (!n) return;
    n.innerHTML = html;
    n.classList.toggle('err', isError);
    n.hidden = !html;
    if (html) placeNote(n);
  }

  function noteText() {
    const last = doc.meta.hours.filter((h, i) => doc.points.some((p) => p.v[i])).at(-1);
    const sw = (k, t) => `<span><i style="background:${COLORS[k]}"></i>${t}</span>`;
    return `<b>国道の交通量 ${doc.points.length}地点</b>（${last ? esc(hourLabel(last)) : '—'}まで）<br>先週の同じ曜日・同じ時間と比べた色です。`
      + `<span class="jt-legend">${sw('more', '多い')}${sw('same', 'ほぼ同じ')}${sw('less', '少ない')}</span>`
      + `<span class="jt-notice">${esc(NOTICE)}</span>`
      + '<button type="button" id="jtNoteClose" aria-label="この説明を小さくする">×</button>';
  }

  /** 説明を閉じても、規約の文（保証しない旨）だけは残す */
  function collapseNote() {
    if (!on) return;
    setNote(`<span class="jt-notice">${esc(NOTICE)}</span>`);
    $('jtNote')?.classList.add('small');
  }

  function showInfo() {
    setNote(noteText());
    $('jtNote')?.classList.remove('small');
    const close = $('jtNoteClose');
    if (close) close.onclick = collapseNote;
  }

  function applyButton() {
    const b = $('jtBtn');
    if (!b) return;
    b.setAttribute('aria-pressed', String(on));
    b.title = on ? '国道の交通量を消す' : '国道の交通量（国の交通量API・1時間ごと）を重ねる';
  }

  const UNAVAILABLE = '国道の交通量は、いま使えません（データを読み込めませんでした）。工事の表示はそのまま使えます。もう一度押すと読み直します。';

  async function refresh() {
    if (!on || document.hidden) return;
    if (!(await load()) || !added) return;
    addLabels();
    map.getSource(SRC)?.setData(geojson());
    if ($('jtNoteClose')) showInfo();
  }

  async function setOn(next) {
    on = next;
    applyButton();
    clearInterval(timer); timer = 0;
    if (!on) { applyVisibility(); setNote(''); return; }
    setNote('国道の交通量を読み込んでいます…');
    const ok = await load();
    if (!on) return;
    if (!ok || !addLayers()) { on = false; applyButton(); setNote(UNAVAILABLE, true); return; }
    applyVisibility();
    showInfo();
    timer = setInterval(refresh, RELOAD_MS);
  }

  const b = $('jtBtn');
  if (b) b.onclick = () => setOn(!on);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  applyButton();

  return {
    setScreenActive(next) {
      screenActive = next;
      applyVisibility();
      if (!next) setNote('');
      else if (on && doc && added) showInfo();
    },
    isOn: () => on,
  };
}

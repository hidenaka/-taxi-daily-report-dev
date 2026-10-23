// tools/js/traffic-count-layer.js — 警視庁の交通量調査地点を、工事の画面に重ねる層（MapLibre GL）と地点の詳細
//
// 工事・道の持ち主の層とは別の source/layer（tc-*）。既定はオフで、押したときだけ JSON を読む。
// 読めなくても、工事と雨雲の地図はそのまま動く（この層だけ「使えません」と出す）。
// 値は「調査日の7時〜19時に観測した実績」。現在の交通量・通常日の代表値・渋滞予測ではない。
// 材料の整形は traffic-count-data.js。
import {
  fmtCount, peakHour, approachSummary, surveyMonthLabel, validatePublicData, VEHICLE_KEYS, BIKE_KEYS, HOURS,
  shortCount, arrowWidthM, arrowPolygon, offsetPoint, widestGap,
} from './traffic-count-data.js';

const DATA_URL = './data/keishicho-traffic-counts.json';
const SRC = 'tc-pts';
const SRC_ARROW = 'tc-arrows';
const SRC_ARROW_LABEL = 'tc-arrow-labels';
const SRC_NAME = 'tc-names';
const ARROW = 'tc-arrow';
const ARROW_EDGE = 'tc-arrow-edge';
const ARROW_LABEL = 'tc-arrow-label';
const MARK = 'tc-mark';
const LABEL_NUM = 'tc-label-num';
const LABEL = 'tc-label';
const LAYERS = [ARROW, ARROW_EDGE, MARK, LABEL_NUM, LABEL, ARROW_LABEL];
const CLICKABLE = [MARK, LABEL_NUM, LABEL, ARROW, ARROW_LABEL];
const COLOR = '#1f5fa8';
const ARROW_FROM_M = 26;   // 矢印の先（交差点の中心からの距離）
const ARROW_TO_M = 150;    // 矢印の根元
const ARROW_ZOOM = 14.5;   // ここから矢印（入ってきた方向と台数）を描く
const ARROW_LABEL_ZOOM = 15.5;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = (id) => document.getElementById(id);

export function createTrafficCountLayer(map, { closeOtherPopups } = {}) {
  let doc = null;          // 読み込んだ JSON
  let on = false;          // 利用者がオンにしたか
  let screenActive = false; // 工事の画面にいるか
  let added = false;
  let loading = null;

  /** 読み込む（失敗しても、次にオンにしたときにもう一度試す） */
  async function load() {
    if (doc) return true;
    loading ??= (async () => {
      try {
        const res = await fetch(DATA_URL, { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const d = await res.json();
        const errs = validatePublicData(d);
        if (errs.length) throw new Error(`形が違う: ${errs.slice(0, 3).join(' / ')}`);
        doc = d;
        return true;
      } catch (e) {
        console.warn('[交通量調査] 読み込めませんでした', e);
        return false;
      } finally {
        loading = null;
      }
    })();
    return loading;
  }

  // ---- 地図の層 ----

  /** 菱形の印（工事の丸い点と見分けるため形を変える） */
  function addMarkImage() {
    if (map.hasImage('tc-diamond')) return;
    const s = 44; const c = document.createElement('canvas'); c.width = s; c.height = s;
    const g = c.getContext('2d');
    const path = () => { g.beginPath(); g.moveTo(s / 2, 3); g.lineTo(s - 3, s / 2); g.lineTo(s / 2, s - 3); g.lineTo(3, s / 2); g.closePath(); };
    g.lineJoin = 'round';
    path(); g.fillStyle = '#ffffff'; g.fill();
    g.save(); g.translate(s / 2, s / 2); g.scale(0.72, 0.72); g.translate(-s / 2, -s / 2); path(); g.fillStyle = COLOR; g.fill(); g.restore();
    map.addImage('tc-diamond', g.getImageData(0, 0, s, s), { pixelRatio: 2 });
  }

  /** 文字の札（地図にフォント設定が無いので、文字を画像にして出す）。lines[0] が太字 */
  function addLabelImage(name, lines, { size = 26, border = COLOR, bg = 'rgba(255,255,255,0.95)' } = {}) {
    if (map.hasImage(name)) return;
    const font = `800 ${size}px -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif`;
    const small = `600 ${Math.round(size * 0.82)}px -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif`;
    const lh = Math.round(size * 1.18);
    const c = document.createElement('canvas'); const g = c.getContext('2d');
    const widths = lines.map((l, i) => { g.font = i ? small : font; return g.measureText(l).width; });
    const w = Math.ceil(Math.max(...widths) + 22); const h = Math.round(size * 0.55) + lines.length * lh;
    c.width = w; c.height = h;
    g.fillStyle = bg; g.strokeStyle = border; g.lineWidth = 3;
    const r = Math.min(12, h / 2 - 2);
    g.beginPath(); g.moveTo(r, 1.5); g.arcTo(w - 1.5, 1.5, w - 1.5, h - 1.5, r); g.arcTo(w - 1.5, h - 1.5, 1.5, h - 1.5, r); g.arcTo(1.5, h - 1.5, 1.5, 1.5, r); g.arcTo(1.5, 1.5, w - 1.5, 1.5, r); g.closePath();
    g.fill(); g.stroke();
    g.textBaseline = 'alphabetic';
    lines.forEach((l, i) => { g.font = i ? small : font; g.fillStyle = i ? '#3c4248' : '#1d2024'; g.fillText(l, 11, Math.round(size * 0.18) + (i + 1) * lh - Math.round(size * 0.2)); });
    map.addImage(name, g.getImageData(0, 0, w, h), { pixelRatio: 2 });
  }

  function geojson() {
    return {
      type: 'FeatureCollection',
      features: doc.points.map((p) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
        properties: { id: p.pointId, name: p.name, v: p.total12h?.fourWheel ?? 0 },
      })),
    };
  }

  /** 入ってきた方向ごとの矢印（太さ＝四輪の12時間計）と、その根元の札 */
  function arrowGeojson() {
    const arrows = []; const labels = [];
    for (const p of doc.points) {
      if (!p.armBearings) continue;
      for (const a of p.approaches) {
        const b = p.armBearings[a.code];
        const v = a.total12h?.fourWheel;
        if (!Number.isFinite(b) || !(v > 0)) continue;
        const ring = arrowPolygon([p.lon, p.lat], b, { fromM: ARROW_FROM_M, toM: ARROW_TO_M, widthM: arrowWidthM(v) });
        arrows.push({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring] }, properties: { id: p.pointId, code: a.code } });
        labels.push({ type: 'Feature', geometry: { type: 'Point', coordinates: offsetPoint([p.lon, p.lat], b, ARROW_TO_M + 14) }, properties: { id: p.pointId, img: `tc-a-${p.pointId}-${a.code}` } });
      }
    }
    // 地点名の札は、矢印の無い向き（腕のあいだのいちばん広い所）へ少し離して置く
    const names = doc.points.map((p) => {
      const has = !!p.armBearings;
      const b = widestGap(has ? Object.values(p.armBearings) : []);
      return { type: 'Feature', geometry: { type: 'Point', coordinates: has ? offsetPoint([p.lon, p.lat], b, 75) : [p.lon, p.lat] }, properties: { id: p.pointId, has } };
    });
    return { arrows: { type: 'FeatureCollection', features: arrows }, labels: { type: 'FeatureCollection', features: labels }, names: { type: 'FeatureCollection', features: names } };
  }

  function addLayers() {
    if (added) return true;
    try {
      addMarkImage();
      for (const p of doc.points) {
        addLabelImage(`tc-n-${p.pointId}`, [`${shortCount(p.total12h?.fourWheel)}台`], { size: 24 });
        addLabelImage(`tc-l-${p.pointId}`, [p.name, `${shortCount(p.total12h?.fourWheel)}台／12時間`], { size: 26 });
        if (p.armBearings) {
          for (const a of p.approaches) addLabelImage(`tc-a-${p.pointId}-${a.code}`, [`${a.label} ${shortCount(a.total12h?.fourWheel)}`], { size: 22, border: 'rgba(31,95,168,0.55)' });
        }
      }
      const ag = arrowGeojson();
      map.addSource(SRC, { type: 'geojson', data: geojson(), attribution: '交通量: 警視庁（加工）' });
      map.addSource(SRC_ARROW, { type: 'geojson', data: ag.arrows });
      map.addSource(SRC_ARROW_LABEL, { type: 'geojson', data: ag.labels });
      map.addSource(SRC_NAME, { type: 'geojson', data: ag.names });
      const vis = 'none';
      // 札と矢印は工事の層より下に入れる（工事の矢印などの置き場所を先に取らないように）。印は一番上
      const firstKoji = (map.getStyle()?.layers || []).find((l) => l.id.startsWith('koji-'))?.id;
      map.addLayer({
        id: ARROW, type: 'fill', source: SRC_ARROW, minzoom: ARROW_ZOOM,
        layout: { visibility: vis },
        paint: { 'fill-color': COLOR, 'fill-opacity': ['interpolate', ['linear'], ['zoom'], ARROW_ZOOM, 0.35, ARROW_ZOOM + 1, 0.72] },
      }, firstKoji);
      map.addLayer({
        id: ARROW_EDGE, type: 'line', source: SRC_ARROW, minzoom: ARROW_ZOOM,
        layout: { visibility: vis, 'line-join': 'round' },
        paint: { 'line-color': '#ffffff', 'line-width': 1.5, 'line-opacity': 0.9 },
      }, firstKoji);
      map.addLayer({
        id: MARK, type: 'symbol', source: SRC,
        layout: {
          visibility: vis, 'icon-image': 'tc-diamond', 'icon-allow-overlap': true, 'icon-ignore-placement': true,
          // 印の大きさ＝交差点を通った四輪の12時間計（多いほど大きい）
          'icon-size': ['interpolate', ['linear'], ['zoom'],
            9, ['interpolate', ['linear'], ['get', 'v'], 20000, 0.35, 120000, 0.8],
            13, ['interpolate', ['linear'], ['get', 'v'], 20000, 0.55, 120000, 1.25],
            16, ['interpolate', ['linear'], ['get', 'v'], 20000, 0.7, 120000, 1.5]],
        },
      });
      map.addLayer({
        id: LABEL_NUM, type: 'symbol', source: SRC, minzoom: 12, maxzoom: 14,
        layout: { visibility: vis, 'icon-image': ['concat', 'tc-n-', ['to-string', ['get', 'id']]], 'icon-anchor': 'top', 'icon-offset': [0, 14], 'icon-allow-overlap': false },
      }, firstKoji);
      // 寄ったときの札は工事の線より上に出す（線に隠れて読めないため）。工事の札の置き場所は取らない
      map.addLayer({
        id: LABEL, type: 'symbol', source: SRC_NAME, minzoom: 14,
        layout: {
          visibility: vis, 'icon-image': ['concat', 'tc-l-', ['to-string', ['get', 'id']]],
          'icon-anchor': ['case', ['get', 'has'], 'center', 'top'], 'icon-offset': ['case', ['get', 'has'], ['literal', [0, 0]], ['literal', [0, 18]]],
          'icon-allow-overlap': true, 'icon-ignore-placement': true,
        },
      });
      map.addLayer({
        id: ARROW_LABEL, type: 'symbol', source: SRC_ARROW_LABEL, minzoom: ARROW_LABEL_ZOOM,
        layout: { visibility: vis, 'icon-image': ['get', 'img'], 'icon-allow-overlap': true, 'icon-ignore-placement': true },
      });
      for (const id of CLICKABLE) {
        map.on('click', id, (e) => {
          const f = e.features && e.features[0];
          if (!f) return;
          try { openDetail(f.properties.id); } catch (err) { console.warn('[交通量調査] 地点の詳細を出せませんでした', err); }
        });
        map.on('mouseenter', id, () => { map.getCanvas().style.cursor = 'pointer'; });
        map.on('mouseleave', id, () => { map.getCanvas().style.cursor = ''; });
      }
      added = true;
      return true;
    } catch (e) {
      console.warn('[交通量調査] 地図に重ねられませんでした', e);
      // 途中まで足したものを消して、次にオンにしたときに最初からやり直せるようにする
      for (const id of LAYERS) if (map.getLayer(id)) map.removeLayer(id);
      for (const id of [SRC, SRC_ARROW, SRC_ARROW_LABEL, SRC_NAME]) if (map.getSource(id)) map.removeSource(id);
      return false;
    }
  }

  function applyVisibility() {
    if (!added) return;
    const v = on && screenActive ? 'visible' : 'none';
    for (const id of LAYERS) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', v);
  }

  // ---- 画面（ボタン・説明・詳細） ----

  function setNote(html, isError = false) {
    const n = $('tcNote');
    if (!n) return;
    n.innerHTML = html;
    n.classList.toggle('err', isError);
    n.hidden = !html;
  }

  /** 地図の上の小さな凡例（説明は「この地図について」と地点の詳細へ） */
  function noteText() {
    const c = doc.meta.counts;
    const months = doc.meta.surveyYearMonths.map((x) => surveyMonthLabel({ surveyYearMonth: x }).replace(/（.*?）/, '')).join('・');
    return `<b>交通量調査（警視庁）${esc(c.shown)}地点</b><br>${esc(months)}の調査日（7〜19時）。<b>いまの交通量ではありません。</b>`
      + '<span class="tc-legend"><span><span class="tc-lg-mark" aria-hidden="true"></span>大きいほど車が多い</span>'
      + '<span><span class="tc-lg-arrow" aria-hidden="true"></span>寄ると、入ってきた方向と台数</span></span>'
      + '<button type="button" id="tcNoteClose" aria-label="この説明を閉じる">×</button>';
  }

  function applyButton() {
    const b = $('tcBtn');
    if (!b) return;
    b.setAttribute('aria-pressed', String(on));
    b.title = on ? '交通量調査を消す' : '交通量調査（警視庁・調査日の実績）を重ねる';
  }

  const UNAVAILABLE = '交通量調査は、いま使えません（データを読み込めませんでした）。工事の表示はそのまま使えます。もう一度押すと読み直します。';

  async function setOn(next) {
    on = next;
    applyButton();
    if (!on) { applyVisibility(); setNote(''); return; }
    try {
      setNote('交通量調査を読み込んでいます…');
      const ok = await load();
      if (!on) return;
      if (!ok || !addLayers()) { on = false; applyButton(); setNote(UNAVAILABLE, true); return; }
      applyVisibility();
      showInfo();
      fillAbout();
    } catch (e) {
      console.warn('[交通量調査] 表示できませんでした', e);
      on = false; applyButton(); applyVisibility();
      setNote(UNAVAILABLE, true);
    }
  }

  /** 「この地図について」の地点数を、読み込んだデータの数に合わせる */
  function fillAbout() {
    const el = $('tcAboutCount');
    if (!el || !doc) return;
    const c = doc.meta.counts;
    el.textContent = `区部の主要交差点 ${c.converted} 地点のうち、位置を確かめた ${c.shown} 地点です（${doc.meta.fetchedAt} に取り込み。残り ${c.unplaced} 地点は位置を確かめられないため出していません）`;
  }

  function showInfo() {
    setNote(noteText());
    const close = $('tcNoteClose');
    if (close) close.onclick = () => setNote('');
  }

  function bar(values, peakIdx = -1) {
    const max = Math.max(1, ...values.map((v) => v ?? 0));
    const w = 300; const h = 96; const bw = w / values.length;
    const bars = values.map((v, i) => {
      const bh = v == null ? 0 : Math.round(((v / max) * (h - 26)));
      return `<rect x="${(i * bw + 2).toFixed(1)}" y="${h - 16 - bh}" width="${(bw - 4).toFixed(1)}" height="${bh}" rx="2" fill="${COLOR}" opacity="${i === peakIdx ? 1 : 0.55}"></rect>`
        + `<text x="${(i * bw + bw / 2).toFixed(1)}" y="${h - 3}" text-anchor="middle">${HOURS[i]}</text>`;
    }).join('');
    return `<svg class="tc-bars" viewBox="0 0 ${w} ${h}" role="img" aria-label="時間別の四輪計（7時台〜18時台）">${bars}</svg>`;
  }

  /** 交差点の図: 入ってきた方向ごとの矢印（太さ＝台数）と、地名・台数。向きが無い地点は null */
  function crossDiagram(p) {
    if (!p.armBearings) return null;
    const S = 340; const cx = S / 2; const cy = S / 2 - 6;
    const max = Math.max(1, ...p.approaches.map((a) => a.total12h?.fourWheel ?? 0));
    const xy = (b, r) => [cx + Math.sin((b * Math.PI) / 180) * r, cy - Math.cos((b * Math.PI) / 180) * r];
    const codes = Object.keys(p.armBearings);
    const roads = codes.map((k) => { const [x, y] = xy(p.armBearings[k], 150); return `<line x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" class="tc-x-road"></line>`; }).join('');
    const arrows = p.approaches.map((a) => {
      const b = p.armBearings[a.code]; const v = a.total12h?.fourWheel;
      if (!Number.isFinite(b) || !(v > 0)) return '';
      const sw = 4 + 18 * Math.sqrt(v / max);
      const [x1, y1] = xy(b, 112); const [x2, y2] = xy(b, 30);
      const [lx, ly] = xy(b, 128);
      const anchor = Math.abs(lx - cx) < 24 ? 'middle' : lx > cx ? 'start' : 'end';
      const ty = ly + (ly > cy + 20 ? 12 : ly < cy - 20 ? -4 : 4);
      return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke-width="${sw.toFixed(1)}" class="tc-x-arrow" marker-end="url(#tcHead)"></line>`
        + `<text x="${lx.toFixed(1)}" y="${ty.toFixed(1)}" text-anchor="${anchor}" class="tc-x-lab"><tspan class="tc-x-place">${esc(a.label)}から</tspan><tspan x="${lx.toFixed(1)}" dy="15" class="tc-x-num">${fmtCount(v)}台</tspan></text>`;
    }).join('');
    return `<svg class="tc-cross" viewBox="0 0 ${S} ${S}" role="img" aria-label="交差点に入ってきた方向ごとの四輪の12時間計（上が北）">`
      + `<defs><marker id="tcHead" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="1.6" markerHeight="1.6" orient="auto-start-reverse"><path d="M0 0 10 5 0 10z" fill="${COLOR}"></path></marker></defs>`
      + `${roads}<circle cx="${cx}" cy="${cy}" r="9" fill="#fff" stroke="${COLOR}" stroke-width="3"></circle>${arrows}`
      + `<text x="${S - 8}" y="16" text-anchor="end" class="tc-x-north">↑北</text></svg>`;
  }

  function vehicleTable(rows, keys = VEHICLE_KEYS) {
    return `<div class="tc-scroll"><table><thead><tr><th></th>${keys.map(([, l]) => `<th>${esc(l)}</th>`).join('')}</tr></thead><tbody>`
      + rows.map((r) => `<tr><th>${esc(r.label)}</th>${keys.map(([k]) => `<td>${fmtCount(r.values[k])}</td>`).join('')}</tr>`).join('')
      + '</tbody></table></div>';
  }

  function hourTable(rows, key = 'fourWheel') {
    return `<div class="tc-scroll"><table><thead><tr><th></th>${HOURS.map((h) => `<th>${h}時</th>`).join('')}<th>12時間計</th></tr></thead><tbody>`
      + rows.map((r) => `<tr><th>${esc(r.label)}</th>${r.hourly.map((h) => `<td>${fmtCount(h[key])}</td>`).join('')}<td><b>${fmtCount(r.total12h[key])}</b></td></tr>`).join('')
      + '</tbody></table></div>';
  }

  function openDetail(id) {
    const p = doc?.points.find((x) => x.pointId === Number(id));
    const dlg = $('tcDetail');
    if (!p || !dlg) return;
    // 同じ場所の工事の吹き出しが一緒に開いていたら閉じる（詳細を前に出す）
    closeOtherPopups?.();
    const visual = p.coordinateStatus === 'verified-visual';
    const where = visual
      ? '位置: 国土地理院の航空写真で、交差点の位置を目で確認しました。'
      : '位置: OpenStreetMap の交差点名と道路名で自動照合しました（目ではまだ確認していません）。';
    const notes = [
      p.totalsDiffer ? `12時間計は警視庁の表の「全方向合計」です。方向ごとの数を足すと ${fmtCount(p.inflowSum12h?.fourWheel)}台 になり、合いません（立体交差や側道を別に数えているためとみられます・推測）。` : '',
      p.approachesWithoutTotal?.length ? `「${esc(p.approachesWithoutTotal.join('・'))}」から入る車は、公式の表に合計の行がありません（「—」）。` : '',
      p.totalSource === 'recomputed' ? 'この地点は公式の表に全方向の合計が無いため、12時間計は方向ごとの数を足した値です。' : '',
      p.sumMismatchCount ? `公式の表の中で、合計が合わない箇所が ${esc(p.sumMismatchCount)} か所あります（値は表のまま）。` : '',
    ].filter(Boolean).map((t) => `<p class="tc-note">${t}</p>`).join('');
    const peak = peakHour(p);
    const peakIdx = peak ? HOURS.indexOf(peak.hour) : -1;
    const dirs = approachSummary(p);
    const m = doc.meta;
    const dirLabel = (a) => (a.code === a.label ? a.label : `${a.code} ${a.label}から`);
    const diagram = crossDiagram(p);
    const bike = p.bicycle?.present
      ? `自転車（12時間計）: 車道 ${fmtCount(p.bicycle.total12h.onRoad)}台・歩道 ${fmtCount(p.bicycle.total12h.onSidewalk)}台・計 ${fmtCount(p.bicycle.total12h.total)}台（「—」は数えていない区分）`
      : '自転車: この地点のデータはありません';
    $('tcBody').innerHTML = `
      <p class="tc-kicker">警視庁交通量調査（調査日実績）</p>
      <h2>${esc(p.name)} <small>${esc(p.crossRoads.join(' × '))}</small></h2>
      <p class="tc-big"><b>${fmtCount(p.total12h.fourWheel)}</b>台 <span>四輪・7〜19時の12時間・全方向の合計</span></p>
      <p class="tc-warn">${esc(surveyMonthLabel(p))}の調査日1日の実績です。現在の交通量ではありません。通常日の代表値や渋滞予測ではありません。</p>
      ${diagram ? `<h3>どの方向から何台入ってきたか</h3>${diagram}` : `<h3>どの方向から何台入ってきたか</h3><ul class="tc-dirs">${dirs.map((d) => `<li><span>${esc(dirLabel(d))}</span><b>${fmtCount(d.fourWheel)}台</b></li>`).join('')}</ul>`}
      <h3>時間ごと${peak ? `<small>いちばん多いのは ${esc(peak.hour)}時台 ${fmtCount(peak.fourWheel)}台</small>` : ''}</h3>
      ${bar(p.hourly.map((h) => h.fourWheel), peakIdx)}
      ${notes}
      <details><summary>数の一覧（方向別・車種別・時間別）</summary>
        ${diagram ? `<p class="tc-small">入ってきた方向（四輪の12時間計）</p><ul class="tc-dirs">${dirs.map((d) => `<li><span>${esc(dirLabel(d))}</span><b>${fmtCount(d.fourWheel)}台</b></li>`).join('')}</ul>` : ''}
        <p class="tc-small">二輪 ${fmtCount(p.total12h.twoWheel)}台。${esc(bike)}</p>
        <p class="tc-small">車種別の12時間計</p>
        ${vehicleTable([{ label: '全方向の合計', values: p.total12h }, ...p.approaches.map((a) => ({ label: `${a.code === a.label ? a.label : `${a.code} ${a.label}`}から`, values: a.total12h }))])}
        <p class="tc-small">入ってきた方向 × 時間（四輪計）</p>
        ${hourTable(p.approaches.map((a) => ({ label: `${a.code === a.label ? a.label : `${a.code} ${a.label}`}から`, hourly: a.hourly, total12h: a.total12h })))}
        <p class="tc-small">出ていった方向 × 時間（四輪計）</p>
        ${hourTable(p.exits.map((e) => ({ label: `${e.code} ${e.label}へ`, hourly: e.hourly, total12h: e.total12h })))}
        <p class="tc-small">二輪車（入ってきた方向 × 時間）</p>
        ${hourTable(p.approaches.map((a) => ({ label: `${a.code === a.label ? a.label : `${a.code} ${a.label}`}から`, hourly: a.hourly, total12h: a.total12h })), 'twoWheel')}
        ${p.bicycle?.present ? `<p class="tc-small">自転車（全方向計）</p>${vehicleTable([{ label: '12時間計', values: p.bicycle.total12h }], BIKE_KEYS)}` : ''}
      </details>
      <details><summary>この地点について・出典</summary>
        <p class="tc-small">地点番号 ${esc(p.pointId)}・${esc(p.policeStation)}警察署・${esc(p.surveyHours.label)}・${esc(p.surveyYearMonth)}</p>
        <p class="tc-small">${esc(where)} ${esc(p.coordinateSource)}（確認日 ${esc(p.coordinateCheckedAt)}）</p>
        ${diagram ? '<p class="tc-small">矢印の向き: OpenStreetMap の道路の線と方向の地名（国土地理院の地名検索）で決め、地図と航空写真で目で確かめました。</p>' : ''}
      </details>
      <p class="tc-src">出典: <a href="${esc(m.sourcePage)}" target="_blank" rel="noopener">警視庁「交通量統計表」</a>の CSV（${esc(m.fetchedAt)} 取得）を加工して作成。${esc(m.attribution)}。位置と向き: © OpenStreetMap contributors・国土地理院。</p>`;
    if (!dlg.open) dlg.showModal();
  }

  function wire() {
    const b = $('tcBtn');
    if (b) b.onclick = () => setOn(!on);
  }
  wire();
  applyButton();

  return {
    /** 工事の画面に入る/出る（雨雲へ切り替えたら隠す） */
    setScreenActive(next) {
      screenActive = next;
      applyVisibility();
      if (!next) setNote('');
      else if (on && doc && added) showInfo();
    },
    isOn: () => on,
  };
}

import { computeBounds, projectLatLng } from './airport-fare-data.js';

const VB = { w: 1000, h: 1000 };
const PAD = 90;
const SVG_NS = 'http://www.w3.org/2000/svg';

// container に25エリアのノードを緯度経度投影で描画。タップで onSelect(key)。
// 戻り値: { select(key) } で外部（検索）からも選択ハイライトできる。
export function renderFareMap(container, areas, onSelect) {
  const bounds = computeBounds(areas);
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${VB.w} ${VB.h}`);
  svg.setAttribute('class', 'fare-map');
  svg.setAttribute('role', 'group');
  svg.setAttribute('aria-label', '行き先エリア地図');

  const nodeByKey = new Map();
  for (const a of areas) {
    const { x, y } = projectLatLng(a, bounds, VB, PAD);
    const g = document.createElementNS(SVG_NS, 'g');
    g.setAttribute('class', 'fare-area');
    g.setAttribute('data-area', a.key);
    g.setAttribute('tabindex', '0');
    g.setAttribute('role', 'button');
    g.setAttribute('aria-label', a.name);

    const w = 96, h = 40;
    const rect = document.createElementNS(SVG_NS, 'rect');
    rect.setAttribute('x', x - w / 2); rect.setAttribute('y', y - h / 2);
    rect.setAttribute('width', w); rect.setAttribute('height', h);
    rect.setAttribute('rx', 10);
    const label = document.createElementNS(SVG_NS, 'text');
    label.setAttribute('x', x); label.setAttribute('y', y);
    label.setAttribute('text-anchor', 'middle');
    label.setAttribute('dominant-baseline', 'central');
    label.textContent = a.name.replace(/[区市]$/, '');
    g.appendChild(rect); g.appendChild(label);

    const fire = () => { select(a.key); onSelect(a.key); };
    g.addEventListener('click', fire);
    g.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fire(); } });
    svg.appendChild(g);
    nodeByKey.set(a.key, g);
  }
  container.innerHTML = '';
  container.appendChild(svg);

  function select(key) {
    for (const [k, g] of nodeByKey) g.classList.toggle('is-selected', k === key);
  }
  return { select };
}

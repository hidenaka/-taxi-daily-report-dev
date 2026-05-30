const SVG_NS = 'http://www.w3.org/2000/svg';

// container に区境ポリゴンの地図を描画。shapes = tokyo-ward-shapes.json（各区の SVG path とラベル位置）。
// タップ/キーボードで onSelect(key) を発火。戻り値 { select(key) } で検索からも選択ハイライトできる。
export function renderFareMap(container, areas, shapes, onSelect) {
  const vb = shapes.viewBox || { w: 1000, h: 1000 };
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${vb.w} ${vb.h}`);
  svg.setAttribute('class', 'fare-map');
  svg.setAttribute('role', 'group');
  svg.setAttribute('aria-label', '行き先エリア地図');

  const nodeByKey = new Map();
  for (const a of areas) {
    const shape = shapes.areas?.[a.key];
    if (!shape) continue; // 形状が無いエリアはスキップ（25区市は全て揃っている前提）

    const g = document.createElementNS(SVG_NS, 'g');
    g.setAttribute('class', 'fare-area');
    g.setAttribute('data-area', a.key);
    g.setAttribute('tabindex', '0');
    g.setAttribute('role', 'button');
    g.setAttribute('aria-label', a.name);

    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', shape.d);

    const label = document.createElementNS(SVG_NS, 'text');
    label.setAttribute('x', shape.cx);
    label.setAttribute('y', shape.cy);
    label.setAttribute('text-anchor', 'middle');
    label.setAttribute('dominant-baseline', 'central');
    label.textContent = a.name.replace(/[区市]$/, '');

    g.appendChild(path);
    g.appendChild(label);

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

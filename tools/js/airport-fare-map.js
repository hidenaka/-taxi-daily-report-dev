const SVG_NS = 'http://www.w3.org/2000/svg';

// 区ごとの「うっすら」タイント（暗背景上で淡く色違い・隣接区を見分けやすく）。
const TINTS = [
  '#221c2b', '#1b2330', '#1b2c25', '#2c2820', '#2c1d24', '#1c2233',
  '#281b2d', '#1b2c2c', '#2d2a1b', '#251b30', '#1d2b33', '#301c28'
];

// container に区境ポリゴンの地図を描画。shapes = tokyo-ward-shapes.json（各区の SVG path とラベル位置）。
// 2層構造: 下にポリゴン層、上にラベル層 → ラベルが他区のポリゴンに隠れない。
// タップ/キーボードで onSelect(key) を発火。戻り値 { select(key) } で検索からも選択ハイライトできる。
export function renderFareMap(container, areas, shapes, onSelect) {
  const vb = shapes.viewBox || { w: 1000, h: 1000 };
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${vb.w} ${vb.h}`);
  svg.setAttribute('class', 'fare-map');
  svg.setAttribute('role', 'group');
  svg.setAttribute('aria-label', '行き先エリア地図');

  const areaLayer = document.createElementNS(SVG_NS, 'g');
  areaLayer.setAttribute('class', 'fare-areas');
  const labelLayer = document.createElementNS(SVG_NS, 'g');
  labelLayer.setAttribute('class', 'fare-labels');

  const nodeByKey = new Map();
  areas.forEach((a, i) => {
    const shape = shapes.areas?.[a.key];
    if (!shape) return; // 形状が無いエリアはスキップ（25区市は全て揃っている前提）

    const g = document.createElementNS(SVG_NS, 'g');
    g.setAttribute('class', 'fare-area');
    g.setAttribute('data-area', a.key);
    g.setAttribute('tabindex', '0');
    g.setAttribute('role', 'button');
    g.setAttribute('aria-label', a.name);

    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', shape.d);
    path.setAttribute('fill', TINTS[i % TINTS.length]); // CSS の hover/selected が上書きする
    g.appendChild(path);
    areaLayer.appendChild(g);

    const label = document.createElementNS(SVG_NS, 'text');
    label.setAttribute('class', 'fare-label');
    label.setAttribute('data-area', a.key);
    label.setAttribute('x', shape.cx);
    label.setAttribute('y', shape.cy);
    label.setAttribute('text-anchor', 'middle');
    label.setAttribute('dominant-baseline', 'central');
    label.textContent = a.name.replace(/[区市]$/, '');
    labelLayer.appendChild(label);

    nodeByKey.set(a.key, { g, label });

    const fire = () => { select(a.key); onSelect(a.key); };
    g.addEventListener('click', fire);
    g.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fire(); } });
  });

  svg.appendChild(areaLayer);
  svg.appendChild(labelLayer);
  container.innerHTML = '';
  container.appendChild(svg);

  function select(key) {
    for (const [k, { g, label }] of nodeByKey) {
      const on = (k === key);
      g.classList.toggle('is-selected', on);
      label.classList.toggle('is-selected', on);
    }
  }
  return { select };
}

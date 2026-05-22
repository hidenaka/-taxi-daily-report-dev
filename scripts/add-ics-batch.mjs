// 首都高 欠落IC 一括追加スクリプト（宣言的）。
// 使い方: node scripts/add-ics-batch.mjs <batchfile.json>
// batchfile: { newICs:[...], chains:[{route, removeEdges:[[a,b]...], sequence:[...]}], addEdges:[{from,to,route}] }
// 辺kmは haversine×1.2 を 0.1 切り上げ（必ず直線距離以上＝物理整合）。控除0前提。
import { readFileSync, writeFileSync } from 'node:fs';

const ICS = 'tools/data/ics.json';
const GRAPH = 'tools/data/shutoko_graph.json';

const batch = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const ics = JSON.parse(readFileSync(ICS, 'utf8'));
const graph = JSON.parse(readFileSync(GRAPH, 'utf8'));

const icById = Object.fromEntries(ics.ics.map(i => [i.id, i]));
const gpsOf = (id) => icById[id]?.gps;
function hav(a, b) {
  const R = 6371, r = Math.PI / 180;
  const dlat = (b.lat - a.lat) * r, dlng = (b.lng - a.lng) * r;
  const la1 = a.lat * r, la2 = b.lat * r;
  const h = Math.sin(dlat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dlng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const roadKm = (a, b) => Math.max(0.1, Math.ceil(hav(gpsOf(a), gpsOf(b)) * 1.2 * 10) / 10);

// 1) 新IC を ics に追加（svg はコード未使用＝プレースホルダ）
for (const n of batch.newICs) {
  if (icById[n.id]) { console.log('SKIP existing ic', n.id); continue; }
  const entry = {
    id: n.id, name: n.name, route: n.route, route_name: n.route_name,
    gps: { lat: n.lat, lng: n.lng }, svg: { x: 600, y: 600 },
    entry_type: n.entry_type ?? 'both', boundary_tag: null,
    is_split_point: false, ramp_access: n.ramp_access, ramp_note: n.ramp_note,
  };
  ics.ics.push(entry); icById[n.id] = entry;
}

// 2) graph ノード追加
const nodeById = Object.fromEntries(graph.nodes.map(n => [n.id, n]));
for (const n of batch.newICs) {
  if (!nodeById[n.id]) {
    const node = { id: n.id, routes: n.graph_routes ?? [n.route] };
    graph.nodes.push(node); nodeById[n.id] = node;
  }
}

// 3) チェーン再配線
const edgeKey = (a, b) => [a, b].sort().join('|');
function removeEdge(a, b) {
  const k = edgeKey(a, b);
  const before = graph.edges.length;
  graph.edges = graph.edges.filter(e => edgeKey(e.from, e.to) !== k);
  if (graph.edges.length === before) console.log('WARN: edge not found to remove', a, b);
}
for (const ch of batch.chains ?? []) {
  for (const [a, b] of ch.removeEdges ?? []) removeEdge(a, b);
  for (let i = 0; i < ch.sequence.length - 1; i++) {
    const from = ch.sequence[i], to = ch.sequence[i + 1];
    graph.edges.push({ from, to, km: roadKm(from, to), route: ch.route });
  }
}
for (const e of batch.addEdges ?? []) {
  graph.edges.push({ from: e.from, to: e.to, km: roadKm(e.from, e.to), route: e.route });
}

// 4) deduction.json（控除距離表）への追加
const DEDUCTION = 'tools/data/deduction.json';
if (batch.deductions && batch.deductions.length) {
  const ded = JSON.parse(readFileSync(DEDUCTION, 'utf8'));
  for (const dd of batch.deductions) {
    const dir = ded.directions.find(x => x.id === dd.direction);
    if (!dir) { console.log('WARN: deduction direction not found', dd.direction); continue; }
    if (dir.entries.some(e => e.ic_id === dd.ic_id)) { console.log('SKIP existing deduction', dd.ic_id); continue; }
    dir.entries.push({ ic_id: dd.ic_id, name: dd.name, km: dd.km });
  }
  writeFileSync(DEDUCTION, JSON.stringify(ded, null, 1));
  console.log('deduction.json updated:', batch.deductions.length, 'entries');
}

writeFileSync(ICS, JSON.stringify(ics, null, 1));
writeFileSync(GRAPH, JSON.stringify(graph, null, 1));
console.log(`Done. ics=${ics.ics.length} nodes=${graph.nodes.length} edges=${graph.edges.length}`);
// 物理整合チェック（新IC関連の辺）
const newIds = new Set(batch.newICs.map(n => n.id));
let viol = 0;
for (const e of graph.edges) {
  if (newIds.has(e.from) || newIds.has(e.to)) {
    const d = hav(gpsOf(e.from), gpsOf(e.to));
    const ok = e.km >= d - 1e-9;
    if (!ok) { viol++; console.log(`VIOLATION ${e.from}→${e.to} km=${e.km} straight=${d.toFixed(2)}`); }
  }
}
console.log(viol === 0 ? 'physical-consistency OK (all new edges km>=straight)' : `VIOLATIONS: ${viol}`);

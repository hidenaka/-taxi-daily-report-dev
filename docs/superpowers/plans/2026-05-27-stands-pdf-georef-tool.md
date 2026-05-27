# 自前 PDF↔地図 対応点ジオリファレンスツール Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 管理者がPDFと地図で「同じ場所」を3〜4点クリックするだけで、PDFに描かれた進入線が地図上の正しい緯度経度に自動変換される編集ツールを作る（外部AI・有料サービス不要）。

**Architecture:** 純関数（最小二乗法によるホモグラフィ計算）＋ アダプタ（左右分割UI・PDFと既存Leaflet地図でクリック登録）＋ schema 拡張（`pdfLines` / `pdfImageRef`）。新ページは作らず既存編集モードにモードを追加。

**Tech Stack:** vanilla ES Modules（バンドラなし）、既存 Leaflet 1.9.4（同梱）、Node 組み込み test runner（`./run.js` ラッパ）、Firebase v11.6.1 modular SDK。

**作業ブランチ/worktree:** `~/work/taxi-dev-stands`（branch `feat/stands-entry-route-map`）。`npm test` は `node --test tests/*.test.js`。dev反映は `bash scripts/dpush-retry.sh`。

**関連spec:** `docs/superpowers/specs/2026-05-27-stands-pdf-georef-tool-design.md`

---

## File Structure

| ファイル | 種別 | 責務 | テスト |
|---|---|---|---|
| `tools/js/stands-georef.js` | 新規・純関数 | `computeHomography(pairs)` / `applyHomography(H, points)` / `applyToPdfLines` | ✅ node:test |
| `tools/js/stands-schema.js` | 変更 | `approaches[].pdfLines` と `pdfImageRef` の validate/normalize | ✅ node:test |
| `tools/js/stands-georef-ui.js` | 新規・アダプタ | 左右分割UI・PDF/地図クリック登録・プレビュー・保存 | 構文＋手動 |
| `tools/stands.html` | 変更 | PDF合わせモード用のオーバーレイDOM＋CSS | 手動 |
| `tools/js/stands-editor.js` | 変更 | 「📐 PDF合わせ」ボタン追加→`initGeoref()` 起動 | 手動 |
| `tests/stands-georef.test.js` | 新規 | `computeHomography` / `applyHomography` のTDDテスト | — |
| `sw.js` | 変更 | `STATIC_FILES` に新JS追加＋CACHE_NAME bump | — |

`approaches[]` 拡張データ:
```json
{
  "label": "...", "road": "...", "bearing": 180, "turn": "either", "hint": "...",
  "line": [{"lat":...,"lng":...}],
  "pdfLines": [{"x":245,"y":312},{"x":410,"y":470}],
  "pdfImageRef": "roppongi_hills-1.jpg"
}
```

PDFデータ事前作成（Phase 2・本planの範囲外）:
- `scripts/data/pdf-lines-keiho.json` ← Claudeが47PDFから抽出
- `scripts/merge-pdf-lines.mjs` ← seed JSONへマージ

---

## Task 1: ホモグラフィ計算（純関数） TDD

**Files:**
- Create: `tools/js/stands-georef.js`
- Test: `tests/stands-georef.test.js`

- [ ] **Step 1: 失敗するテストを書く**

`tests/stands-georef.test.js`:
```javascript
import { test, assert } from './run.js';
import { computeHomography, applyHomography, applyToPdfLines } from '../tools/js/stands-georef.js';

// 既知の変換: pdf(100,100)→geo(35.66,139.73), 平行移動＋スケール
const simplePairs = [
  { pdf: { x: 0,   y: 0   }, geo: { lat: 35.670, lng: 139.720 } },
  { pdf: { x: 100, y: 0   }, geo: { lat: 35.670, lng: 139.730 } },
  { pdf: { x: 0,   y: 100 }, geo: { lat: 35.660, lng: 139.720 } },
  { pdf: { x: 100, y: 100 }, geo: { lat: 35.660, lng: 139.730 } },
];

test('computeHomography: 4点の既知変換を正しく解ける', () => {
  const H = computeHomography(simplePairs);
  assert.ok(H, 'H is non-null');
  // 角の点を変換→入力と一致するはず
  const out = applyHomography(H, [{ x: 0, y: 0 }, { x: 100, y: 100 }]);
  assert.ok(Math.abs(out[0].lat - 35.670) < 1e-4, `lat0 got ${out[0].lat}`);
  assert.ok(Math.abs(out[0].lng - 139.720) < 1e-4, `lng0 got ${out[0].lng}`);
  assert.ok(Math.abs(out[1].lat - 35.660) < 1e-4, `lat1 got ${out[1].lat}`);
  assert.ok(Math.abs(out[1].lng - 139.730) < 1e-4, `lng1 got ${out[1].lng}`);
});

test('computeHomography: 中点も正しく補間される', () => {
  const H = computeHomography(simplePairs);
  const mid = applyHomography(H, [{ x: 50, y: 50 }])[0];
  assert.ok(Math.abs(mid.lat - 35.665) < 1e-4, `mid lat ${mid.lat}`);
  assert.ok(Math.abs(mid.lng - 139.725) < 1e-4, `mid lng ${mid.lng}`);
});

test('computeHomography: 3点（アフィン）でも解ける', () => {
  const H = computeHomography(simplePairs.slice(0, 3));
  assert.ok(H, '3点で H 取得できる');
  const out = applyHomography(H, [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 100 }]);
  assert.ok(Math.abs(out[0].lat - 35.670) < 1e-4);
  assert.ok(Math.abs(out[2].lat - 35.660) < 1e-4);
});

test('computeHomography: 2点以下は null', () => {
  assert.equal(computeHomography(simplePairs.slice(0, 2)), null);
  assert.equal(computeHomography([]), null);
});

test('computeHomography: 一直線上の3点は null（特異）', () => {
  const colinear = [
    { pdf: { x: 0, y: 0 }, geo: { lat: 35.66, lng: 139.72 } },
    { pdf: { x: 1, y: 0 }, geo: { lat: 35.66, lng: 139.73 } },
    { pdf: { x: 2, y: 0 }, geo: { lat: 35.66, lng: 139.74 } },
  ];
  assert.equal(computeHomography(colinear), null);
});

test('applyToPdfLines: pdfLines → line(lat,lng) 配列', () => {
  const H = computeHomography(simplePairs);
  const pdfLines = [{ x: 0, y: 0 }, { x: 100, y: 100 }];
  const line = applyToPdfLines(H, pdfLines);
  assert.equal(line.length, 2);
  assert.ok(Math.abs(line[0].lat - 35.670) < 1e-4);
  assert.ok(Math.abs(line[1].lng - 139.730) < 1e-4);
});

test('applyToPdfLines: H が null なら空配列', () => {
  assert.deepEqual(applyToPdfLines(null, [{ x: 0, y: 0 }]), []);
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `cd ~/work/taxi-dev-stands && node --test tests/stands-georef.test.js`
Expected: FAIL（モジュール未定義 / Cannot find module）

- [ ] **Step 3: 最小実装**

`tools/js/stands-georef.js`:
```javascript
// tools/js/stands-georef.js — PDF px → 緯度経度 のホモグラフィ計算（純関数）
// 外部ライブラリ依存ゼロ。最小二乗法で 3x3 行列を解く。
//   pdf(x,y) → geo(lng,lat) の対応点ペアから H を求め、任意の点を変換する。

// 3x3 行列の最小二乗解（n点）。Direct Linear Transform (DLT) 法。
// 各対応点 (x,y) → (X,Y) に対し:
//   X*(h31*x + h32*y + 1) = h11*x + h12*y + h13
//   Y*(h31*x + h32*y + 1) = h21*x + h22*y + h23
// 行列 A (2n x 8) , b (2n) を作って疑似逆解（正規方程式）。
function solveDLT(pairs) {
  const n = pairs.length;
  if (n < 3) return null;
  const A = [], b = [];
  for (const p of pairs) {
    const x = p.pdf.x, y = p.pdf.y;
    const X = p.geo.lng, Y = p.geo.lat; // 注: geo の x 軸=lng, y 軸=lat
    A.push([x, y, 1, 0, 0, 0, -X * x, -X * y]); b.push(X);
    A.push([0, 0, 0, x, y, 1, -Y * x, -Y * y]); b.push(Y);
  }
  // 正規方程式 (A^T A) h = A^T b （8x8 線形）
  const AT = transpose(A); // 8 x 2n
  const ATA = matMul(AT, A); // 8 x 8
  const ATb = matVec(AT, b); // 8
  const h = solveLinear(ATA, ATb); // h[0..7]
  if (!h) return null;
  // [h11,h12,h13, h21,h22,h23, h31,h32, 1]
  return [
    [h[0], h[1], h[2]],
    [h[3], h[4], h[5]],
    [h[6], h[7], 1],
  ];
}

// 一直線・特異な配置でないかチェック（外積で面積>eps）
function isDegenerate(pairs) {
  if (pairs.length < 3) return true;
  // 任意3点で pdf 側／geo 側両方の面積が小さいなら特異
  const a = pairs[0].pdf, b = pairs[1].pdf, c = pairs[2].pdf;
  const area = Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
  return area < 1e-6;
}

export function computeHomography(pairs) {
  if (!Array.isArray(pairs) || pairs.length < 3) return null;
  if (isDegenerate(pairs)) return null;
  try {
    return solveDLT(pairs);
  } catch (e) {
    return null;
  }
}

export function applyHomography(H, points) {
  if (!H || !Array.isArray(points)) return [];
  return points.map((p) => {
    const w = H[2][0] * p.x + H[2][1] * p.y + H[2][2];
    const X = (H[0][0] * p.x + H[0][1] * p.y + H[0][2]) / w; // lng
    const Y = (H[1][0] * p.x + H[1][1] * p.y + H[1][2]) / w; // lat
    return { lat: Y, lng: X };
  });
}

export function applyToPdfLines(H, pdfLines) {
  return applyHomography(H, pdfLines || []);
}

// ============ 線形代数ヘルパー（自前・小サイズ専用） ============
function transpose(M) {
  const r = M.length, c = M[0].length;
  const T = Array.from({ length: c }, () => new Array(r));
  for (let i = 0; i < r; i++) for (let j = 0; j < c; j++) T[j][i] = M[i][j];
  return T;
}

function matMul(A, B) {
  const r = A.length, k = A[0].length, c = B[0].length;
  const C = Array.from({ length: r }, () => new Array(c).fill(0));
  for (let i = 0; i < r; i++) for (let j = 0; j < c; j++) {
    let s = 0;
    for (let m = 0; m < k; m++) s += A[i][m] * B[m][j];
    C[i][j] = s;
  }
  return C;
}

function matVec(A, v) {
  const r = A.length, c = A[0].length;
  const out = new Array(r).fill(0);
  for (let i = 0; i < r; i++) {
    let s = 0;
    for (let j = 0; j < c; j++) s += A[i][j] * v[j];
    out[i] = s;
  }
  return out;
}

// ガウス・ジョルダン消去（n x n を解く）
function solveLinear(A, b) {
  const n = A.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let i = 0; i < n; i++) {
    // 部分ピボット選択
    let maxRow = i;
    for (let k = i + 1; k < n; k++) if (Math.abs(M[k][i]) > Math.abs(M[maxRow][i])) maxRow = k;
    if (Math.abs(M[maxRow][i]) < 1e-12) return null;
    [M[i], M[maxRow]] = [M[maxRow], M[i]];
    // 行 i を正規化
    const piv = M[i][i];
    for (let j = i; j <= n; j++) M[i][j] /= piv;
    // 他行から消去
    for (let k = 0; k < n; k++) {
      if (k === i) continue;
      const f = M[k][i];
      for (let j = i; j <= n; j++) M[k][j] -= f * M[i][j];
    }
  }
  return M.map((row) => row[n]);
}
```

- [ ] **Step 4: テストを実行して PASS を確認**

Run: `node --test tests/stands-georef.test.js`
Expected: PASS（7 tests）

- [ ] **Step 5: 全体テストで回帰なし**

Run: `npm test`
Expected: 全 pass（既存26＋新7＝33以上）

- [ ] **Step 6: Commit**

```bash
git add tools/js/stands-georef.js tests/stands-georef.test.js
git commit -m "feat(stands): add homography computation (pure, no deps)"
```

---

## Task 2: schema に pdfLines / pdfImageRef を追加 TDD

**Files:**
- Modify: `tools/js/stands-schema.js`
- Modify: `tests/stands-schema.test.js`

- [ ] **Step 1: 失敗するテストを追加**

`tests/stands-schema.test.js` の末尾に追記:
```javascript
test('validateStand: approach.pdfLines が[{x,y}]ならvalid', () => {
  const r = validateStand({ ...valid, approaches: [{
    label: 'a', pdfLines: [{ x: 10, y: 20 }, { x: 30, y: 40 }], pdfImageRef: 'a-1.jpg',
  }] });
  assert.equal(r.valid, true);
});

test('validateStand: approach.pdfLines に非数値があると invalid', () => {
  const r = validateStand({ ...valid, approaches: [{
    label: 'a', pdfLines: [{ x: 'X', y: 0 }],
  }] });
  assert.equal(r.valid, false);
});

test('normalizeStand: pdfLines / pdfImageRef を保持（欠落は空配列・空文字）', () => {
  const n = normalizeStand({ name: 'X', pin: { lat: 35.7, lng: 139.7 }, approaches: [{
    label: 'a', pdfLines: [{ x: 10, y: 20 }], pdfImageRef: 'a-1.jpg',
  }] });
  assert.deepEqual(n.approaches[0].pdfLines, [{ x: 10, y: 20 }]);
  assert.equal(n.approaches[0].pdfImageRef, 'a-1.jpg');
  const n2 = normalizeStand({ name: 'Y', pin: { lat: 35.7, lng: 139.7 }, approaches: [{ label: 'a' }] });
  assert.deepEqual(n2.approaches[0].pdfLines, []);
  assert.equal(n2.approaches[0].pdfImageRef, '');
});
```

- [ ] **Step 2: テスト失敗を確認**

Run: `node --test tests/stands-schema.test.js`
Expected: 3つの新テストが FAIL（pdfLines が undefined 等）

- [ ] **Step 3: schema を更新**

`tools/js/stands-schema.js` の `validateStand` 内、`approaches` 検証ループに追記:
```javascript
        if (a.pdfLines !== undefined) {
          if (!Array.isArray(a.pdfLines)) errors.push(`approach[${i}]: pdfLines は配列`);
          else if (!a.pdfLines.every((p) => p && isFiniteNum(p.x) && isFiniteNum(p.y)))
            errors.push(`approach[${i}]: pdfLines は {x,y} の数値`);
        }
```

同ファイル `normalizeStand` 内、`approaches.map` 内のオブジェクト返却に追記:
```javascript
        pdfLines: Array.isArray(a.pdfLines)
          ? a.pdfLines
              .filter((p) => p && isFiniteNum(p.x) && isFiniteNum(p.y))
              .map((p) => ({ x: p.x, y: p.y }))
          : [],
        pdfImageRef: typeof a.pdfImageRef === 'string' ? a.pdfImageRef.trim() : '',
```

- [ ] **Step 4: テスト pass 確認**

Run: `node --test tests/stands-schema.test.js`
Expected: 全 PASS（既存 + 新 3）

- [ ] **Step 5: 全体テスト回帰**

Run: `npm test`
Expected: exit 0

- [ ] **Step 6: Commit**

```bash
git add tools/js/stands-schema.js tests/stands-schema.test.js
git commit -m "feat(stands): schema に approach.pdfLines/pdfImageRef を追加"
```

---

## Task 3: UI アダプタ — 左右分割 / クリック登録 / プレビュー / 保存

**Files:**
- Create: `tools/js/stands-georef-ui.js`
- Modify: `tools/stands.html`（オーバーレイDOM＋CSS追加）

- [ ] **Step 1: stands.html にオーバーレイDOMとCSSを追加**

`tools/stands.html` の `</body>` 直前に追加:
```html
  <div id="georef-overlay" hidden>
    <div class="g-bar">
      <span class="g-title">📐 PDF合わせ</span>
      <span class="g-status" id="g-status">対応点 0/4</span>
      <button id="g-undo" type="button">↩ やり直し</button>
      <button id="g-compute" type="button" disabled>変換</button>
      <button id="g-save" type="button" disabled>💾 保存</button>
      <button id="g-close" type="button">✖ 閉じる</button>
    </div>
    <div class="g-body">
      <div class="g-pane g-pdf">
        <div class="g-pdf-wrap"><img id="g-pdf-img" alt=""></div>
      </div>
      <div class="g-pane g-map"><div id="g-map"></div></div>
    </div>
  </div>
```

同 `<style>` 内に追加（既存 entry-card 等のあとに）:
```css
#georef-overlay{position:fixed;inset:0;z-index:1800;background:#0e0e10;color:#fff;display:flex;flex-direction:column;}
#georef-overlay[hidden]{display:none;}
#georef-overlay .g-bar{display:flex;gap:8px;align-items:center;padding:8px 10px;background:#1a1a20;border-bottom:1px solid #333;flex-wrap:wrap;}
#georef-overlay .g-title{font-weight:700;font-size:15px;margin-right:6px;}
#georef-overlay .g-status{color:#9bd;font-size:13px;margin-right:8px;}
#georef-overlay .g-bar button{font-size:13px;padding:6px 10px;border-radius:8px;border:1px solid #444;background:#222;color:#fff;}
#georef-overlay .g-bar button:disabled{opacity:.4;}
#georef-overlay .g-body{flex:1;display:flex;min-height:0;}
@media (max-width:760px){#georef-overlay .g-body{flex-direction:column;}}
#georef-overlay .g-pane{flex:1;min-width:0;min-height:0;position:relative;border:1px solid #222;overflow:hidden;}
#georef-overlay .g-pdf{background:#fff;}
#georef-overlay .g-pdf-wrap{position:absolute;inset:0;overflow:auto;}
#georef-overlay #g-pdf-img{display:block;max-width:none;cursor:crosshair;user-select:none;}
#georef-overlay .g-map #g-map{position:absolute;inset:0;cursor:crosshair;}
.g-marker{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;color:#fff;font-weight:700;font-size:12px;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.6);}
.g-marker.pdf{background:#c0392b;}
.g-marker.geo{background:#1d6fe0;}
.g-preview-line{stroke:#27ae60;stroke-width:5;opacity:.9;}
```

- [ ] **Step 2: stands-georef-ui.js を作成**

`tools/js/stands-georef-ui.js`:
```javascript
// tools/js/stands-georef-ui.js — PDF↔地図 対応点クリックジオリファレンスUI（アダプタ）
// 既存編集モードから initGeoref({stand, onSave}) で起動。完了時は onSave(updatedStand) を呼ぶ。
import { computeHomography, applyToPdfLines } from './stands-georef.js';

const TILE_CARTO = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';

export function initGeoref({ stand, onSave }) {
  if (!stand) return;
  const approachIdx = (stand.approaches || []).findIndex((a) => Array.isArray(a.pdfLines) && a.pdfLines.length >= 2);
  if (approachIdx < 0) {
    alert('この施設には PDF 進入線(pdfLines)が登録されていません。先にPhase2のデータ投入が必要です。');
    return;
  }
  const approach = stand.approaches[approachIdx];
  const imgFile = approach.pdfImageRef || (stand.images && stand.images[0]) || '';
  if (!imgFile) { alert('PDF画像が見つかりません'); return; }

  const overlay = document.getElementById('georef-overlay');
  const status = document.getElementById('g-status');
  const btnUndo = document.getElementById('g-undo');
  const btnCompute = document.getElementById('g-compute');
  const btnSave = document.getElementById('g-save');
  const btnClose = document.getElementById('g-close');
  const pdfImg = document.getElementById('g-pdf-img');
  const pdfWrap = pdfImg.parentElement;
  const mapEl = document.getElementById('g-map');

  // 状態
  let pairs = []; // [{pdf:{x,y}, geo:{lat,lng}}]
  let H = null;
  let previewLine = null;

  // Leaflet 地図（既存と同じ淡色）。施設pinを中心にズーム18。
  if (mapEl._leaflet_id) mapEl._leaflet_id = null;
  mapEl.innerHTML = '';
  const map = L.map(mapEl, { zoomControl: true }).setView([stand.pin.lat, stand.pin.lng], 18);
  L.tileLayer(TILE_CARTO, { maxZoom: 20, subdomains: 'abcd', attribution: '© OSM © CARTO' }).addTo(map);
  L.marker([stand.pin.lat, stand.pin.lng], { title: stand.name }).addTo(map);

  // PDF画像をロード（原寸表示・スクロール可）
  pdfImg.src = `data/stands-ref/${imgFile}`;

  // 待ち状態: pdf を待つ→geo を待つ→次の点へ
  let waiting = 'pdf';
  let stagedPdf = null;
  const layerPdfMarks = []; // DOM要素
  let layerGeo = L.layerGroup().addTo(map);

  function updateStatus() {
    status.textContent = `対応点 ${pairs.length}/4（${waiting === 'pdf' ? 'PDFをクリック' : '地図をクリック'}）`;
    btnCompute.disabled = pairs.length < 3;
    btnSave.disabled = !H;
  }

  function addPdfMark(x, y, n) {
    const el = document.createElement('div');
    el.className = 'g-marker pdf';
    el.textContent = n;
    el.style.cssText = `position:absolute;left:${x - 11}px;top:${y - 11}px;pointer-events:none;`;
    pdfWrap.appendChild(el);
    layerPdfMarks.push(el);
  }

  function addGeoMark(lat, lng, n) {
    L.marker([lat, lng], {
      icon: L.divIcon({ className: '', html: `<div class="g-marker geo">${n}</div>`, iconSize: [22, 22], iconAnchor: [11, 11] }),
      interactive: false,
    }).addTo(layerGeo);
  }

  function clearPreview() {
    if (previewLine) { map.removeLayer(previewLine); previewLine = null; }
  }

  pdfImg.addEventListener('click', (e) => {
    if (waiting !== 'pdf') return;
    const r = pdfImg.getBoundingClientRect();
    const x = (e.clientX - r.left) * (pdfImg.naturalWidth / r.width);
    const y = (e.clientY - r.top) * (pdfImg.naturalHeight / r.height);
    stagedPdf = { x, y };
    addPdfMark(e.clientX - pdfWrap.getBoundingClientRect().left, e.clientY - pdfWrap.getBoundingClientRect().top, pairs.length + 1);
    waiting = 'geo';
    updateStatus();
  });

  map.on('click', (e) => {
    if (waiting !== 'geo' || !stagedPdf) return;
    const geo = { lat: e.latlng.lat, lng: e.latlng.lng };
    pairs.push({ pdf: stagedPdf, geo });
    addGeoMark(geo.lat, geo.lng, pairs.length);
    stagedPdf = null;
    waiting = 'pdf';
    clearPreview();
    H = null;
    updateStatus();
  });

  btnUndo.addEventListener('click', () => {
    if (waiting === 'geo' && stagedPdf) {
      // PDF側だけ確定済みで地図待ち→PDFマーカーを1つ消す
      stagedPdf = null;
      const m = layerPdfMarks.pop();
      if (m) m.remove();
      waiting = 'pdf';
    } else if (pairs.length > 0) {
      pairs.pop();
      const m = layerPdfMarks.pop();
      if (m) m.remove();
      layerGeo.clearLayers();
      pairs.forEach((p, i) => addGeoMark(p.geo.lat, p.geo.lng, i + 1));
    }
    clearPreview();
    H = null;
    updateStatus();
  });

  btnCompute.addEventListener('click', () => {
    H = computeHomography(pairs);
    if (!H) {
      alert('対応点が不適切です（一直線上等）。目印を3方向に散らしてください。');
      updateStatus();
      return;
    }
    // approach.pdfLines を変換してプレビュー
    const line = applyToPdfLines(H, approach.pdfLines);
    clearPreview();
    if (line.length >= 2) {
      previewLine = L.polyline(line.map((p) => [p.lat, p.lng]), { className: 'g-preview-line' }).addTo(map);
      map.fitBounds(previewLine.getBounds().pad(0.3), { maxZoom: 19 });
    }
    updateStatus();
  });

  btnSave.addEventListener('click', () => {
    if (!H) return;
    const updated = JSON.parse(JSON.stringify(stand));
    // すべての approach.pdfLines（同じPDFを参照するもの）に同じ H を適用
    updated.approaches.forEach((a) => {
      if (Array.isArray(a.pdfLines) && a.pdfLines.length >= 2 && a.pdfImageRef === imgFile) {
        a.line = applyToPdfLines(H, a.pdfLines);
      }
    });
    onSave(updated);
    close();
  });

  function close() {
    overlay.hidden = true;
    map.remove();
    layerPdfMarks.forEach((m) => m.remove());
    pdfImg.src = '';
    overlay.__cleanup && overlay.__cleanup();
  }
  btnClose.addEventListener('click', close);
  overlay.__cleanup = () => {
    overlay.hidden = true;
  };

  overlay.hidden = false;
  updateStatus();
}
```

- [ ] **Step 3: 構文チェック**

Run: `node --check tools/js/stands-georef-ui.js`
Expected: エラーなし

- [ ] **Step 4: Commit**

```bash
git add tools/stands.html tools/js/stands-georef-ui.js
git commit -m "feat(stands): add georef UI (split pane click-to-pair, preview, save)"
```

---

## Task 4: 編集モードに「📐 PDF合わせ」ボタンを追加

**Files:**
- Modify: `tools/js/stands-editor.js`

- [ ] **Step 1: 編集ボタン群を確認**

Run: `grep -nE "btnPdf|btnSave|btnDelete" tools/js/stands-editor.js | head -10`
Expected: 既存ボタン（btnPdf=PDF重ねる, btnSave=保存等）が見つかる

- [ ] **Step 2: ボタン追加と起動配線**

`tools/js/stands-editor.js` の `const btnPdfRemove = mkBtn('🗺 PDF消す');` の次の行に追加:
```javascript
  const btnGeoref = mkBtn('📐 PDF合わせ');
```

同ファイルの `controls = [...]` 配列に `btnGeoref` を追加（btnPdfRemoveの直後）:
```javascript
  const controls = [pick, mkKind, btnSat, btnPin, btnMarker, btnRoute, btnPdf, btnPdfLock, btnPdfOpacity, btnPdfRemove, btnGeoref, btnUndo, btnSave, btnDelete, btnCancel];
```

`btnPdfRemove.addEventListener` の次に追加:
```javascript
  btnGeoref.addEventListener('click', async () => {
    if (!current && window.__activeStand) current = window.__activeStand;
    if (!current) { alert('施設を選択してから「📐 PDF合わせ」を押してください'); return; }
    const { initGeoref } = await import('./stands-georef-ui.js');
    initGeoref({
      stand: current,
      onSave: async (updated) => {
        try {
          await saveStand(companyId, updated);
          alert('保存しました。地図に正しい進入線が反映されます');
          location.reload();
        } catch (e) {
          alert('保存に失敗: ' + e.message);
        }
      },
    });
  });
```

- [ ] **Step 3: 構文チェック**

Run: `node --check tools/js/stands-editor.js`
Expected: エラーなし

- [ ] **Step 4: Commit**

```bash
git add tools/js/stands-editor.js
git commit -m "feat(stands): editor に「📐 PDF合わせ」ボタンを追加（georef UI起動）"
```

---

## Task 5: SW に新JS追加＋CACHE bump

**Files:**
- Modify: `sw.js`

- [ ] **Step 1: STATIC_FILES に新ファイルを追加**

`sw.js` の `'./tools/js/stands-editor.js',` 行の直後に追加:
```javascript
  './tools/js/stands-georef.js',
  './tools/js/stands-georef-ui.js',
```

- [ ] **Step 2: CACHE_NAME を bump**

`sw.js` 2行目を v228 にする（origin/main が v227 のため）:
```javascript
const CACHE_NAME = CACHE_PREFIX + 'v228';
```
※rebase後に v227 より大きければその値+1。

- [ ] **Step 3: 構文チェック**

Run: `node --check sw.js`
Expected: エラーなし

- [ ] **Step 4: 全体テスト回帰**

Run: `npm test`
Expected: 全 pass

- [ ] **Step 5: Commit**

```bash
git add sw.js
git commit -m "chore(stands): SW に georef 関連を登録 + v228"
```

---

## Task 6: dev反映（ユーザー実行）

- [ ] **Step 1: 反映**

ユーザーに依頼:
```
! bash ~/work/taxi-dev-stands/scripts/dpush-retry.sh
```

- [ ] **Step 2: Pages反映待ち→管理者で実機を開く**

確認URL: `https://hidenaka.github.io/-taxi-daily-report-dev/tools/stands.html?company=co-7q7ros`
編集モード→施設選択（pdfLines がある施設）→「📐 PDF合わせ」が出現することを確認。

※この時点では `pdfLines` データはまだない（Phase 2 で投入）。代表3施設（六本木ヒルズ/泉ガーデン/虎ノ門ヒルズ）に手動で `pdfLines` を入れたサンプルseedを別途用意するか、Phase 2 を先に行う。本planではPhase 1（仕組み）の完成までを範囲とする。

---

## Self-Review（spec照合）

### Spec coverage（spec 各要件 ↔ 本plan のタスク）
- **schema 拡張 `pdfLines`/`pdfImageRef`** → Task 2 ✅
- **`computeHomography` / `applyHomography`（純関数）** → Task 1 ✅
- **左右分割UI（PDF + 地図）** → Task 3 ✅
- **クリック登録・対応点 3〜4 点・プレビュー・保存** → Task 3 ✅
- **編集モードからの起動（📐 PDF合わせ）** → Task 4 ✅
- **SW登録＋bump** → Task 5 ✅
- **段取り（Phase 1 仕組み）** → Task 1〜5 ✅
- **Phase 2（Claude が47PDFから pdfLines 抽出）／Phase 3（ユーザーのクリック作業）／Phase 4（本番反映）** → 本plan外（Phase 1 完了後に別planで対応）

### placeholder scan
- 「TBD」「TODO」「fill in details」等のプレースホルダ: なし
- 「Similar to Task N」: 使用していない
- 各タスクで完全なコード／コマンドを明示済

### 型整合
- `pairs = [{pdf:{x,y}, geo:{lat,lng}}]` の形式は Task 1/3 で一致
- `computeHomography(pairs)` の戻り値が 3x3 配列＝Task 1 内で一貫
- `applyToPdfLines(H, pdfLines)` の戻り値 `[{lat,lng}]` は Task 3 で `polyline` に使う形式と一致
- schema の `approach.pdfLines = [{x,y}]` / `pdfImageRef = string` は Task 2/3 で一致
- `initGeoref({ stand, onSave })` のシグネチャは Task 3/4 で一致

# タクシープール現況セクション トグル Design

> 2026-05-27 設計。ユーザー要望: 到着便ページの「🚕 タクシープール現況・出庫」セクション全体を、見出しのボタンで表示/非表示できるようにする。

## 背景

`arrivals.html` の `<section id="forecast-section">` には：

1. カメラ写真2枚＋現況（混み具合・流れ・乗り場の動き・到着便リスト）
2. 説明文ⓘ
3. 予測モード切替＋スコープボタン
4. 予測/実績テーブル

が縦に並んでいる。乗務員によっては「予測テーブルだけ見たい」「画面を広く使いたい」場面があり、現況UIを一括で隠したいニーズがある。

## 目的（成功基準）

1. 見出し横のボタン1クリックで section 全体（h2を除く全コンテンツ）を表示/非表示
2. 状態が localStorage に保存され、次回起動時も維持される
3. 初回ユーザーは現状通り「表示」状態で開く（破壊的変更を避ける）
4. アクセシビリティ: `aria-expanded` 属性で状態を伝える

## 設計

### HTML 構造変更

`arrivals.html` の現状:

```html
<section id="forecast-section">
  <h2>🚕 タクシープール現況・出庫<button class="help-video-btn" ...>▶ 使い方（15秒）</button></h2>
  <div class="help-video" id="help-video-arrivals"></div>
  <div id="pool-status-block">...</div>
  <p class="fc-scope">...</p>
  <details class="fc-about">...</details>
  <div class="fc-controls">...</div>
  <div id="forecast-meta">...</div>
  ...
</section>
```

変更後:

```html
<section id="forecast-section">
  <h2>
    🚕 タクシープール現況・出庫
    <button id="forecast-section-toggle" type="button" aria-expanded="true" aria-controls="forecast-body"
            style="background:transparent; border:none; color:var(--sub); cursor:pointer; font-size:14px; margin-left:8px;">
      ▼ 折りたたみ
    </button>
    <button class="help-video-btn" data-help-video="arrivals" type="button">▶ 使い方（15秒）</button>
  </h2>
  <div class="help-video" id="help-video-arrivals"></div>
  <div id="forecast-body">  ← 新規ラッパー
    <div id="pool-status-block">...</div>
    <p class="fc-scope">...</p>
    <details class="fc-about">...</details>
    <div class="fc-controls">...</div>
    <div id="forecast-meta">...</div>
    ...
  </div>
</section>
```

> `help-video` 表示（▶使い方動画の展開先）は **forecast-body の外**に置き、折りたたみ中でも動画再生可能にする（動画は section とは独立コンテンツ）。

### JavaScript（純関数）

`tools/js/pool-status-section.js` に追加：

```js
const COLLAPSE_KEY = 'forecast-section-collapsed';

/** localStorage から折りたたみ状態を読む。'1' なら true、それ以外（含 null）は false。 */
export function getCollapsed(storage = localStorage) {
  try { return storage.getItem(COLLAPSE_KEY) === '1'; }
  catch { return false; }
}

/** localStorage に折りたたみ状態を書く。boolean を '0'/'1' に。 */
export function setCollapsed(value, storage = localStorage) {
  try { storage.setItem(COLLAPSE_KEY, value ? '1' : '0'); }
  catch { /* ストレージ無効時は無視 */ }
}

/** トグルボタンを初期化。クリックで body の hidden 属性と localStorage を更新。 */
export function initForecastSectionToggle() {
  const btn = document.getElementById('forecast-section-toggle');
  const body = document.getElementById('forecast-body');
  if (!btn || !body) return;
  const apply = (collapsed) => {
    body.hidden = collapsed;
    btn.setAttribute('aria-expanded', String(!collapsed));
    btn.textContent = collapsed ? '▶ 展開' : '▼ 折りたたみ';
  };
  apply(getCollapsed());
  btn.addEventListener('click', () => {
    const next = !getCollapsed();
    setCollapsed(next);
    apply(next);
  });
}
```

### 呼び出し

`tools/js/arrivals-app.js`（既存）で `initPoolStatusSection()` の隣に追加：

```js
import { initPoolStatusSection, initForecastSectionToggle } from './pool-status-section.js';
...
initForecastSectionToggle();
initPoolStatusSection().then(fn => { if (fn) refreshPoolStatus = fn; });
```

### Service Worker

新規ファイル無し（`pool-status-section.js` 既登録、`arrivals.html` も既登録）→ `CACHE_NAME` bump のみで取得し直される。

## テスト

```js
test('getCollapsed: localStorageに値なしならfalse', () => {
  const store = new Map();
  const storage = { getItem: k => store.get(k) ?? null, setItem: (k,v) => store.set(k,v) };
  assert.equal(getCollapsed(storage), false);
});

test('getCollapsed: "1" なら true', () => {
  const store = new Map([['forecast-section-collapsed', '1']]);
  const storage = { getItem: k => store.get(k) ?? null, setItem: (k,v) => store.set(k,v) };
  assert.equal(getCollapsed(storage), true);
});

test('getCollapsed: "0" は false', () => {
  const store = new Map([['forecast-section-collapsed', '0']]);
  const storage = { getItem: k => store.get(k) ?? null, setItem: (k,v) => store.set(k,v) };
  assert.equal(getCollapsed(storage), false);
});

test('setCollapsed: true → "1" / false → "0" を保存', () => {
  const store = new Map();
  const storage = { getItem: k => store.get(k) ?? null, setItem: (k,v) => store.set(k,v) };
  setCollapsed(true, storage);
  assert.equal(store.get('forecast-section-collapsed'), '1');
  setCollapsed(false, storage);
  assert.equal(store.get('forecast-section-collapsed'), '0');
});

test('setCollapsed: ストレージ無効でもクラッシュしない', () => {
  const storage = { getItem: () => { throw new Error('disabled'); }, setItem: () => { throw new Error('disabled'); } };
  // クラッシュしないことだけ確認
  setCollapsed(true, storage);
  assert.equal(getCollapsed(storage), false); // fallback
});
```

`initForecastSectionToggle` はDOM操作なので、ユニットテスト対象外（実機で目視確認）。

## 実装範囲

| ファイル | 変更 |
|---|---|
| `tools/arrivals.html` | h2 にトグルボタン、`<div id="forecast-body">` でラップ |
| `tools/js/pool-status-section.js` | `getCollapsed`/`setCollapsed`/`initForecastSectionToggle` を追加・export |
| `tools/js/arrivals-app.js` | `initForecastSectionToggle()` 呼び出し追加 |
| `tests/pool-status-section.test.js` | getCollapsed/setCollapsed の5テスト追加 |
| `sw.js` | CACHE_NAME bump |

Phase 分離なし、3-4コミット相当。

## 残課題（範囲外）

- 折りたたみ中に新データが届いた時の通知（例: 「⚠ 新しい便が来ています」インジケーター）。今回は不要、純粋な show/hide のみ
- アニメーション（slide）。CSSは付けない、`hidden` 属性で即座に切り替え

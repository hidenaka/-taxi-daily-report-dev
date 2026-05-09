import { test, assert } from './run.js';

// JSDOM-less な簡易DOM環境
function setupMockDom(pathname = '/index.html') {
  globalThis.document = {
    _elements: [],
    _querySelectorAll: {},
    querySelector(sel) {
      if (sel === '.legal-footer') return this._legalFooter || null;
      if (sel === 'nav.bottom') return this._navBottom || null;
      return null;
    },
    createElement(tag) {
      const el = {
        tagName: tag.toUpperCase(),
        className: '',
        innerHTML: '',
        children: [],
        parentNode: null,
      };
      this._elements.push(el);
      return el;
    },
    body: {
      _children: [],
      appendChild(el) { this._children.push(el); el.parentNode = this; },
    },
  };
  globalThis.location = { pathname };
}

test('renderLegalFooter: 通常ページではフッターが追加される', async () => {
  setupMockDom('/index.html');
  const { renderLegalFooter } = await import(`../js/legal-footer.js?t=${Date.now()}`);
  renderLegalFooter();
  const created = globalThis.document._elements.find(e => e.className === 'legal-footer');
  assert.ok(created, 'legal-footer 要素が作成されるべき');
  assert.ok(created.innerHTML.includes('特定商取引法に基づく表記'));
  assert.ok(created.innerHTML.includes('利用規約'));
  assert.ok(created.innerHTML.includes('プライバシーポリシー'));
});

test('renderLegalFooter: legal/ パス内では skip', async () => {
  setupMockDom('/legal/terms.html');
  const { renderLegalFooter } = await import(`../js/legal-footer.js?t=${Date.now()}`);
  renderLegalFooter();
  const created = globalThis.document._elements.find(e => e.className === 'legal-footer');
  assert.equal(created, undefined, 'legal/ 配下では footer は作成されない');
});

test('renderLegalFooter: 既存フッターがある時は二重描画しない (idempotent)', async () => {
  setupMockDom('/index.html');
  globalThis.document._legalFooter = { className: 'legal-footer' };
  const { renderLegalFooter } = await import(`../js/legal-footer.js?t=${Date.now()}`);
  renderLegalFooter();
  const created = globalThis.document._elements.find(e => e.className === 'legal-footer');
  assert.equal(created, undefined, '既存フッターある時は何もしない');
});

test('renderLegalFooter: nav.bottom がある時はその真上に挿入', async () => {
  setupMockDom('/index.html');
  const navParent = {
    _children: [],
    insertBefore(newEl, ref) { this._children.push({ newEl, ref }); newEl.parentNode = this; },
  };
  const navMock = { parentNode: navParent };
  globalThis.document._navBottom = navMock;
  const { renderLegalFooter } = await import(`../js/legal-footer.js?t=${Date.now()}`);
  renderLegalFooter();
  assert.equal(navParent._children.length, 1);
  assert.equal(navParent._children[0].ref, navMock);
});

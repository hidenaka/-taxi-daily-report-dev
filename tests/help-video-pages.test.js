import { test, assert } from './run.js';
import { readFileSync } from 'node:fs';

const PAGES = {
  'input.html': 'input-paste',
  'ocr-import.html': 'ocr-import',
};

for (const [page, key] of Object.entries(PAGES)) {
  const html = readFileSync(new URL('../' + page, import.meta.url), 'utf8');

  test(`${page}: ▶ボタンと空の展開コンテナが存在する`, () => {
    assert.ok(html.includes('data-help-video="' + key + '"'), '▶ボタン');
    assert.ok(html.includes('id="help-video-' + key + '"'), '展開コンテナ');
  });

  test(`${page}: 動画/サムネがHTMLに直書きされていない（3秒ルール）`, () => {
    assert.ok(!/<video[\s>]/i.test(html), 'video要素を直書きしない');
    assert.ok(!html.includes('media/help/'), 'media/help/ をHTMLで参照しない（注入はJS側）');
  });
}

// 写真から取り込みは推奨パスなので input.html の推奨カードにも ocr-import 動画を再掲する
test('input.html: 写真から取り込みカードにも ocr-import の▶＋空コンテナがある', () => {
  const html = readFileSync(new URL('../input.html', import.meta.url), 'utf8');
  assert.ok(html.includes('data-help-video="ocr-import"'), '写真カードの▶ボタン');
  assert.ok(html.includes('id="help-video-ocr-import"'), '写真カードの展開コンテナ');
});

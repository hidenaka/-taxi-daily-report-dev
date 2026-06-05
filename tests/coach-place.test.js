import { describe, it } from 'node:test';
import assert from 'node:assert';
import { normalizePlace } from '../js/coach/place.js';

describe('normalizePlace', () => {
  it('末尾のASCII数字を除く（OCRデータと同じ粒度）', () => {
    assert.strictEqual(normalizePlace('港区六本木6'), '港区六本木');
    assert.strictEqual(normalizePlace('大田区羽田空港3'), '大田区羽田空港');
  });
  it('「N丁目」を除く（漢数字・全角含む）', () => {
    assert.strictEqual(normalizePlace('港区六本木六丁目'), '港区六本木');
    assert.strictEqual(normalizePlace('港区西麻布２丁目'), '港区西麻布');
  });
  it('既に正規形ならそのまま', () => {
    assert.strictEqual(normalizePlace('港区六本木'), '港区六本木');
  });
  it('空/null は空文字', () => {
    assert.strictEqual(normalizePlace(''), '');
    assert.strictEqual(normalizePlace(null), '');
    assert.strictEqual(normalizePlace(undefined), '');
  });
});

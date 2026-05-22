import { test, assert } from './run.js';
import { HELP_VIDEOS } from '../js/help-video-registry.js';

test('HELP_VIDEOS に MVP の2キーが存在する', () => {
  assert.ok(HELP_VIDEOS['input-paste'], 'input-paste が必要');
  assert.ok(HELP_VIDEOS['ocr-import'], 'ocr-import が必要');
});

test('各エントリは src/poster/caption を持ち、media/help/ 配下を指す', () => {
  for (const [key, e] of Object.entries(HELP_VIDEOS)) {
    // tools/ サブディレクトリのページは ../media/help/ 形式を使う（パス解決の都合）
    const validSrc = e.src.startsWith('media/help/') || e.src.startsWith('../media/help/');
    assert.ok(validSrc, `${key}.src は media/help/ または ../media/help/ 配下`);
    assert.ok(e.src.endsWith('.mp4'), `${key}.src は .mp4`);
    const validPoster = e.poster.startsWith('media/help/') || e.poster.startsWith('../media/help/');
    assert.ok(validPoster, `${key}.poster は media/help/ または ../media/help/ 配下`);
    assert.ok(typeof e.caption === 'string' && e.caption.length > 0, `${key}.caption は非空`);
  }
});

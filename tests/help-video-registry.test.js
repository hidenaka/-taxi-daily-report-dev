import { test, assert } from './run.js';
import { HELP_VIDEOS } from '../js/help-video-registry.js';

test('HELP_VIDEOS に MVP の2キーが存在する', () => {
  assert.ok(HELP_VIDEOS['input-paste'], 'input-paste が必要');
  assert.ok(HELP_VIDEOS['ocr-import'], 'ocr-import が必要');
});

test('各エントリは src/poster/caption を持ち、media/help/ 配下を指す', () => {
  for (const [key, e] of Object.entries(HELP_VIDEOS)) {
    assert.ok(e.src.startsWith('media/help/'), `${key}.src は media/help/ 配下`);
    assert.ok(e.src.endsWith('.mp4'), `${key}.src は .mp4`);
    assert.ok(e.poster.startsWith('media/help/'), `${key}.poster は media/help/ 配下`);
    assert.ok(typeof e.caption === 'string' && e.caption.length > 0, `${key}.caption は非空`);
  }
});

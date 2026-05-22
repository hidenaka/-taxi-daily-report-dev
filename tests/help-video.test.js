import { test, assert } from './run.js';
import { getVideoEntry, buildPlayerHTML, buildVideoTag } from '../js/help-video.js';

const REG = {
  'input-paste': { src: 'media/help/input-paste.mp4', poster: 'media/help/input-paste.jpg', caption: '貼って取り込む' },
};

test('getVideoEntry: 存在キーでエントリを返す', () => {
  assert.equal(getVideoEntry('input-paste', REG).src, 'media/help/input-paste.mp4');
});

test('getVideoEntry: 未知キーで null', () => {
  assert.equal(getVideoEntry('nope', REG), null);
});

test('buildPlayerHTML: poster と caption を含み、video要素は含まない（遅延の保証）', () => {
  const html = buildPlayerHTML(REG['input-paste']);
  assert.ok(html.includes('media/help/input-paste.jpg'), 'poster を含む');
  assert.ok(html.includes('貼って取り込む'), 'caption を含む');
  assert.ok(html.includes('hv-play'), '再生ボタンを含む');
  assert.ok(!html.includes('<video'), 'この段階では video 要素を作らない');
});

test('buildVideoTag: src付きの video を返す（autoplay/muted/playsinline）', () => {
  const tag = buildVideoTag(REG['input-paste']);
  assert.ok(tag.includes('<video'), 'video 要素');
  assert.ok(tag.includes('src="media/help/input-paste.mp4"'), 'src');
  assert.ok(tag.includes('autoplay'), 'autoplay');
  assert.ok(tag.includes('muted'), 'muted');
  assert.ok(tag.includes('playsinline'), 'playsinline');
  assert.ok(tag.includes('controls'), 'controls');
  assert.ok(tag.includes('hv-close'), '折りたたむボタン');
});

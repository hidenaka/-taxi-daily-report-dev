// 住所から「区+町名」を取り出す extractArea の表記ゆれ対応
// 背景: 丁目を落とす正規表現が半角数字(\d)しか見ておらず、OCRが全角で読んだ住所は
//       丁目が残ったまま別エリアとして分裂していた。
//       本番実データ18,909件中609件(3.2%・325種類)が該当し、
//       例) 「千代田区丸の内２」4件 が 「千代田区丸の内」354件 と別集計になっていた。
import { test } from 'node:test';
import assert from 'node:assert';
import { extractArea } from '../js/chart-helpers.js';

test('半角の丁目を落とす(従来どおり)', () => {
  assert.strictEqual(extractArea('港区六本木7'), '港区六本木');
  assert.strictEqual(extractArea('大田区羽田空港3'), '大田区羽田空港');
  assert.strictEqual(extractArea('品川区西五反田12'), '品川区西五反田');
});

test('全角の丁目も落とす', () => {
  assert.strictEqual(extractArea('千代田区丸の内２'), '千代田区丸の内');
  assert.strictEqual(extractArea('渋谷区道玄坂２'), '渋谷区道玄坂');
  assert.strictEqual(extractArea('港区六本木１０'), '港区六本木');
});

test('全角と半角が同じエリアに寄る', () => {
  assert.strictEqual(extractArea('港区新橋１'), extractArea('港区新橋1'));
  assert.strictEqual(extractArea('大田区北千束３'), extractArea('大田区北千束3'));
});

test('丁目が無い町名はそのまま', () => {
  assert.strictEqual(extractArea('新宿区霞ヶ丘町'), '新宿区霞ヶ丘町');
  assert.strictEqual(extractArea('大田区北馬込'), '大田区北馬込');
  assert.strictEqual(extractArea('中央区銀座'), '中央区銀座');
});

test('数字が途中にある町名は壊さない', () => {
  assert.strictEqual(extractArea('中央区八重洲1'), '中央区八重洲');
  assert.strictEqual(extractArea('文京区本郷3'), '文京区本郷');
});

test('空・未入力は空文字', () => {
  assert.strictEqual(extractArea(''), '');
  assert.strictEqual(extractArea(null), '');
  assert.strictEqual(extractArea(undefined), '');
});

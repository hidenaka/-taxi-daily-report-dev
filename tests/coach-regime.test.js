import { describe, it } from 'node:test';
import assert from 'node:assert';
import { expectedRideDensity, classifyRegime } from '../js/coach/regime.js';

function t(amount, bt) { return { amount, boardTime: bt, alightTime: bt, isCancel: false }; }
const drives = [
  { date: '2026-05-01', trips: [ t(2000,'19:10'), t(2200,'19:40'), t(1800,'19:50'), t(3000,'23:30') ] },
  { date: '2026-05-08', trips: [ t(2400,'19:15'), t(2600,'19:55'), { amount:0, boardTime:'19:05', isCancel:true } ] },
];

describe('expectedRideDensity', () => {
  it('dow×hourの1日平均乗車数（キャンセル除外）', () => {
    assert.strictEqual(expectedRideDensity(drives, 5, 19), 2.5);
  });
  it('深夜23時台は薄い: 5件中1件/2日 = 0.5', () => {
    assert.strictEqual(expectedRideDensity(drives, 5, 23), 0.5);
  });
  it('一致する曜日が無ければ null', () => {
    assert.strictEqual(expectedRideDensity(drives, 1, 19), null);
  });
});

describe('classifyRegime', () => {
  it('densityがしきい値以上なら volume', () => {
    assert.strictEqual(classifyRegime(2.5), 'volume');
  });
  it('しきい値未満なら value', () => {
    assert.strictEqual(classifyRegime(0.5), 'value');
  });
  it('null は unknown', () => {
    assert.strictEqual(classifyRegime(null), 'unknown');
  });
  it('しきい値は opts で変更可', () => {
    assert.strictEqual(classifyRegime(2.5, { threshold: 3 }), 'value');
  });
});

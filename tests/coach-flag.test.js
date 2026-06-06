import { describe, it } from 'node:test';
import assert from 'node:assert';
import { coachEnabledFor } from '../js/coach/coach-flag.js';

describe('coachEnabledFor', () => {
  it('dev GitHub Pages パスは有効', () => {
    assert.strictEqual(coachEnabledFor('hidenaka.github.io', '/-taxi-daily-report-dev/coach.html'), true);
  });
  it('本番 GitHub Pages パスは無効', () => {
    assert.strictEqual(coachEnabledFor('hidenaka.github.io', '/taxi-daily-report/coach.html'), false);
  });
  it('本番カスタムドメインは無効', () => {
    assert.strictEqual(coachEnabledFor('taxicabis.com', '/coach.html'), false);
  });
  it('localhost は有効', () => {
    assert.strictEqual(coachEnabledFor('localhost', '/coach.html'), true);
    assert.strictEqual(coachEnabledFor('127.0.0.1', '/'), true);
  });
});

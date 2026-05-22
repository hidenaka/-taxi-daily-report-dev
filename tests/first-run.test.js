import { test, assert } from './run.js';
import { shouldShowFirstRunCard } from '../js/first-run.js';

test('shouldShowFirstRunCard: 日報が無ければ true', () => {
  assert.equal(shouldShowFirstRunCard({ hasAnyDrive: false }), true);
});

test('shouldShowFirstRunCard: 日報があれば false', () => {
  assert.equal(shouldShowFirstRunCard({ hasAnyDrive: true }), false);
});

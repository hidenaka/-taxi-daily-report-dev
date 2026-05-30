import { test } from 'node:test';
import assert from 'node:assert';
import { buildGroupInviteUrl, parseGroupSlug, resolveWorkerBase } from '../js/group-client.js';

test('buildGroupInviteUrl: base + /groups.html?group=slug', () => {
  assert.equal(buildGroupInviteUrl('gr-abc123', 'https://app.taxicabis.com'),
    'https://app.taxicabis.com/groups.html?group=gr-abc123');
  assert.equal(buildGroupInviteUrl('gr-x', 'https://app.taxicabis.com/'), // 末尾スラッシュ吸収
    'https://app.taxicabis.com/groups.html?group=gr-x');
});

test('parseGroupSlug: ?group= の gr- slug だけ受理', () => {
  const ok = new URLSearchParams('group=gr-abc123');
  assert.equal(parseGroupSlug(ok), 'gr-abc123');
  assert.equal(parseGroupSlug(new URLSearchParams('group=co-xxxxxx')), null); // gr- 以外は不可
  assert.equal(parseGroupSlug(new URLSearchParams('group=<script>')), null); // 不正
  assert.equal(parseGroupSlug(new URLSearchParams('')), null);
});

test('resolveWorkerBase: dev/prod 判定', () => {
  assert.equal(resolveWorkerBase({ hostname: 'app.taxicabis.com', pathname: '/groups.html' }),
    'https://cabis-billing.haqei64384.workers.dev');
  assert.equal(resolveWorkerBase({ hostname: 'hidenaka.github.io', pathname: '/-taxi-daily-report-dev/groups.html' }),
    'https://cabis-billing-dev.haqei64384.workers.dev');
  assert.equal(resolveWorkerBase({ hostname: 'localhost', pathname: '/groups.html' }),
    'https://cabis-billing-dev.haqei64384.workers.dev');
});

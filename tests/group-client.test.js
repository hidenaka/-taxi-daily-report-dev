import { test } from 'node:test';
import assert from 'node:assert';
import { buildGroupInviteUrl, parseGroupSlug, resolveWorkerBase, callWorker } from '../js/group-client.js';

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

test('callWorker: Bearerトークン付きPOSTしてjsonを返す', async () => {
  let seen = null;
  const fakeFetch = async (url, opts) => { seen = { url, opts }; return { ok: true, status: 200, json: async () => ({ ok: true, x: 1 }) }; };
  const r = await callWorker('https://w.example', '/group-create', { name: 'g' }, 'TOK', fakeFetch);
  assert.deepEqual(r, { ok: true, x: 1 });
  assert.equal(seen.url, 'https://w.example/group-create');
  assert.equal(seen.opts.method, 'POST');
  assert.equal(seen.opts.headers.Authorization, 'Bearer TOK');
  assert.equal(JSON.parse(seen.opts.body).name, 'g');
});

test('callWorker: 非okでも json を返す（呼び側でstatus判定）', async () => {
  const fakeFetch = async () => ({ ok: false, status: 403, json: async () => ({ error: 'not-a-member' }) });
  const r = await callWorker('https://w', '/group-leave', {}, 'T', fakeFetch);
  assert.deepEqual(r, { error: 'not-a-member' });
});

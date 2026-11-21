import test from 'node:test';
import assert from 'node:assert/strict';
import { createAccountLibrary } from '../lib/account.js';
function setup({ credential = { sessdata: 'a,b', biliJct: 'csrf' }, valid = true, reply, change = false } = {}) {
  const calls = []; let reads = 0;
  const run = createAccountLibrary({
    userAgent: 'test', readCredential: async () => (++reads > 1 && change ? { sessdata: 'changed' } : credential),
    navProbe: async () => ({ valid, mid: 123, uname: 'test-user' }),
    fetchImpl: async (url, options) => { calls.push({ url, options }); return { ok: true, json: async () => reply(url) }; },
  });
  return { run, calls };
}
const media = i => ({ bvid: `BV1${String(i).padStart(9, '0')}`, title: 'title', owner: { name: 'up' }, pic: '//example.com/a.jpg', duration: 42 });
test('requires login and rejects invalid args without requests', async () => {
  const { run, calls } = setup({ credential: {} });
  await assert.rejects(run(), { code: 'LOGIN_REQUIRED' });
  await assert.rejects(run({ action: 'delete' }), { code: 'BAD_REQUEST' });
  await assert.rejects(run({ page: -1 }), { code: 'BAD_REQUEST' });
  assert.equal(calls.length, 0);
});
test('unknown/expired auth never treated as valid', async () => {
  await assert.rejects(setup({ valid: false }).run(), { code: 'LOGIN_REQUIRED' });
  await assert.rejects(setup({ valid: null }).run(), { code: 'AUTH_UNVERIFIED' });
});
test('folders page and cookie encoding; response excludes secrets', async () => {
  const { run, calls } = setup({ reply: () => ({ code: 0, data: { list: Array.from({ length: 21 }, (_, i) => ({ id: i + 1, title: 'folder', media_count: 2 })) } }) });
  const result = await run({ action: 'folders', page: 2 });
  assert.equal(result.folders.length, 1); assert.equal(result.hasMore, false);
  assert.equal(calls[0].url.searchParams.get('up_mid'), '123');
  assert.equal(calls[0].options.headers.cookie, 'SESSDATA=a%2Cb; bili_jct=csrf');
  assert.equal(JSON.stringify(result).includes('sessdata'), false);
});
test('favorites normalize and filter resources; preserve pagination', async () => {
  const { run } = setup({ reply: url => ({ code: 0, data: url.pathname.endsWith('list-all')
    ? { list: [{ id: 10 }] } : { medias: [{ ...media(1), type: 2, upper: { name: 'favorite-up' } }, { ...media(2), type: 12 }], has_more: true } }) });
  const result = await run({ action: 'favorites', folderId: '10' });
  assert.equal(result.items.length, 1); assert.equal(result.items[0].up, 'favorite-up');
  assert.equal(result.items[0].cover, 'https://example.com/a.jpg');
  assert.equal(result.skipped, 1); assert.equal(result.hasMore, true);
});
test('refuses other accounts folders', async () => {
  const { run, calls } = setup({ reply: () => ({ code: 0, data: { list: [{ id: 10 }] } }) });
  await assert.rejects(run({ action: 'favorites', folderId: '99' }), { code: 'BAD_REQUEST' });
  assert.equal(calls.length, 1);
});
test('watchlater local pagination retains upstream list', async () => {
  const { run } = setup({ reply: () => ({ code: 0, data: { list: Array.from({ length: 23 }, (_, i) => media(i)) } }) });
  const first = await run({ action: 'watchlater' });
  const next = await run({ action: 'watchlater', page: 2 });
  assert.equal(first.items.length, 20); assert.equal(first.hasMore, true);
  assert.equal(next.items.length, 3); assert.equal(next.hasMore, false);
});
test('empty list succeeds', async () => {
  const { run } = setup({ reply: () => ({ code: 0, data: {} }) });
  assert.deepEqual((await run({ action: 'watchlater' })).items, []);
});
test('handles Bilibili auth failure and does not leak upstream message', async () => {
  const { run } = setup({ reply: () => ({ code: -101, message: 'secret' }) });
  await assert.rejects(run({ action: 'watchlater' }), { code: 'LOGIN_REQUIRED' });
});
test('account switch rejects stale private response', async () => {
  const { run } = setup({ change: true, reply: () => ({ code: 0, data: {} }) });
  await assert.rejects(run({ action: 'watchlater' }), { code: 'ACCOUNT_CHANGED' });
});

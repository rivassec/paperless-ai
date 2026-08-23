// test/tagCache.test.js
// Unit tests for the configurable tag cache (TAG_CACHE_LIFETIME / TAG_PAGE_SIZE).
// Run with: npm run test:unit
const test = require('node:test');
const assert = require('node:assert');

const CONFIG_PATH = require.resolve('../config/config');
const SERVICE_PATH = require.resolve('../services/paperlessService');

const TUNABLES = ['TAG_CACHE_LIFETIME', 'TAG_PAGE_SIZE'];

/**
 * Loads a fresh paperlessService singleton with the given tag cache env vars.
 * Both values are read once, when the service is constructed, so the module
 * cache has to be dropped between cases.
 * @param {object} env Values for TAG_CACHE_LIFETIME / TAG_PAGE_SIZE, or undefined to unset
 * @returns {object} A freshly constructed paperlessService
 */
function loadService(env = {}) {
  const saved = {};
  for (const key of TUNABLES) {
    saved[key] = process.env[key];
    if (env[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = String(env[key]);
    }
  }

  delete require.cache[CONFIG_PATH];
  delete require.cache[SERVICE_PATH];
  const service = require(SERVICE_PATH);

  for (const key of TUNABLES) {
    if (saved[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = saved[key];
    }
  }
  return service;
}

/**
 * Minimal stand-in for the axios client, recording every requested URL.
 * @param {Array<object>} pages Response bodies to hand back, in order
 * @returns {object} A fake client exposing get() and the requested URLs
 */
function fakeClient(pages) {
  const requested = [];
  return {
    requested,
    defaults: { baseURL: 'http://paperless.local/api' },
    get: async (url) => {
      requested.push(url);
      const page = pages[requested.length - 1];
      if (!page) {
        throw new Error(`Unexpected request #${requested.length} to ${url}`);
      }
      return { data: page };
    }
  };
}

const onePage = [{ results: [{ id: 1, name: 'Invoice' }], next: null }];

test('refreshTagCache defaults to a page size of 100', async () => {
  const service = loadService();
  const client = fakeClient(onePage);
  service.client = client;

  await service.refreshTagCache();

  assert.deepStrictEqual(client.requested, ['/tags/?page_size=100']);
  assert.strictEqual(service.tagCache.get('invoice').id, 1);
});

test('refreshTagCache honours TAG_PAGE_SIZE', async () => {
  const service = loadService({ TAG_PAGE_SIZE: 1000 });
  const client = fakeClient(onePage);
  service.client = client;

  await service.refreshTagCache();

  assert.strictEqual(service.TAG_PAGE_SIZE, 1000);
  assert.deepStrictEqual(client.requested, ['/tags/?page_size=1000']);
});

test('refreshTagCache keeps the page size across paginated responses', async () => {
  const service = loadService({ TAG_PAGE_SIZE: 2 });
  const client = fakeClient([
    {
      results: [{ id: 1, name: 'Invoice' }, { id: 2, name: 'Receipt' }],
      next: 'http://paperless.local/api/tags/?page=2&page_size=2'
    },
    { results: [{ id: 3, name: 'Contract' }], next: null }
  ]);
  service.client = client;

  await service.refreshTagCache();

  assert.deepStrictEqual(client.requested, [
    '/tags/?page_size=2',
    '/tags/?page=2&page_size=2'
  ]);
  assert.strictEqual(service.tagCache.size, 3);
});

test('invalid TAG_PAGE_SIZE and TAG_CACHE_LIFETIME fall back to the defaults', () => {
  for (const value of ['not-a-number', '0', '-5', '']) {
    const service = loadService({ TAG_PAGE_SIZE: value, TAG_CACHE_LIFETIME: value });
    assert.strictEqual(service.TAG_PAGE_SIZE, 100, `TAG_PAGE_SIZE=${value}`);
    assert.strictEqual(service.CACHE_LIFETIME, 3000, `TAG_CACHE_LIFETIME=${value}`);
  }
});

test('ensureTagCache does not refetch while the cache is still fresh', async () => {
  const service = loadService({ TAG_CACHE_LIFETIME: 3600000 });
  const client = fakeClient(onePage);
  service.client = client;

  assert.strictEqual(service.CACHE_LIFETIME, 3600000);

  await service.ensureTagCache();
  await service.ensureTagCache();
  await service.ensureTagCache();

  assert.strictEqual(client.requested.length, 1, 'expected a single refresh');
});

test('ensureTagCache refetches once TAG_CACHE_LIFETIME has elapsed', async () => {
  const service = loadService({ TAG_CACHE_LIFETIME: 3600000 });
  const client = fakeClient([...onePage, ...onePage]);
  service.client = client;

  await service.ensureTagCache();
  // Pretend the last refresh happened just over an hour ago.
  service.lastTagRefresh = Date.now() - 3600001;
  await service.ensureTagCache();

  assert.strictEqual(client.requested.length, 2);
});

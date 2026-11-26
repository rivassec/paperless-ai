// test/setupGuard.test.js
// Unit tests for the POST /setup guard (GHSA-qgr5-7f3c-qqm3).
// Run with: npm run test:unit
const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('node:events');

const { createSetupGuard } = require('../services/setupGuard');

const quiet = { error() {}, warn() {} };

function fakeRes() {
  const res = new EventEmitter();
  res.statusCode = 200;
  res.body = undefined;
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; res.emit('finish'); return res; };
  return res;
}

async function run(guard) {
  const res = fakeRes();
  let nextCalled = false;
  await guard({ ip: '192.0.2.10' }, res, () => { nextCalled = true; });
  return { res, nextCalled };
}

test('refuses setup when a user already exists', async () => {
  const guard = createSetupGuard({ getUsers: async () => [{ id: 1 }], logger: quiet });
  const { res, nextCalled } = await run(guard);
  assert.strictEqual(nextCalled, false);
  assert.strictEqual(res.statusCode, 403);
});

test('allows first-time setup when no user exists', async () => {
  const guard = createSetupGuard({ getUsers: async () => [], logger: quiet });
  const { res, nextCalled } = await run(guard);
  assert.strictEqual(nextCalled, true);
  assert.strictEqual(res.statusCode, 200);
});

test('fails closed when the user lookup throws', async () => {
  const guard = createSetupGuard({
    getUsers: async () => { throw new Error('db locked'); },
    logger: quiet,
  });
  const { res, nextCalled } = await run(guard);
  assert.strictEqual(nextCalled, false);
  assert.strictEqual(res.statusCode, 503);
});

test('fails closed when the user lookup returns no list', async () => {
  const guard = createSetupGuard({ getUsers: async () => undefined, logger: quiet });
  const { res, nextCalled } = await run(guard);
  assert.strictEqual(nextCalled, false);
  assert.strictEqual(res.statusCode, 503);
});

test('a concurrent first-time setup is refused until the first finishes', async () => {
  const guard = createSetupGuard({ getUsers: async () => [], logger: quiet });
  const first = fakeRes();
  let firstNext = false;
  await guard({}, first, () => { firstNext = true; });
  assert.strictEqual(firstNext, true);

  const second = await run(guard);
  assert.strictEqual(second.nextCalled, false);
  assert.strictEqual(second.res.statusCode, 409);

  first.emit('finish');
  const third = await run(guard);
  assert.strictEqual(third.nextCalled, true);
});

test('lock is released after a refusal', async () => {
  let users = [{ id: 1 }];
  const guard = createSetupGuard({ getUsers: async () => users, logger: quiet });
  assert.strictEqual((await run(guard)).res.statusCode, 403);
  users = [];
  assert.strictEqual((await run(guard)).nextCalled, true);
});

test('requires a getUsers function', () => {
  assert.throws(() => createSetupGuard({}), TypeError);
});

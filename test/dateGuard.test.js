// test/dateGuard.test.js
// The model's document date must not overwrite reviewed dates (via:ingest), must not set
// implausible dates, and every applied change is logged as one [DATE-CHANGE] line.
// Run with: npm run test:unit
const test = require('node:test');
const assert = require('node:assert');

const service = require('../services/paperlessService');
const { isPlausibleCreatedDate, PROTECTED_DATE_TAG } = service;

const PROTECTED_ID = 77;

/**
 * Runs updateDocument against a stubbed client and returns the PATCH bodies and log lines.
 * @param {object} doc Current document returned by getDocument
 * @param {object} updates Update passed to updateDocument
 * @param {number|null} protectedId Id of the via:ingest tag, or null when it does not exist
 * @returns {Promise<{sent: object[], logs: string[], warns: string[]}>}
 */
async function run(doc, updates, protectedId = PROTECTED_ID) {
  const sent = [];
  const logs = [];
  const warns = [];
  const original = {
    client: service.client, initialize: service.initialize, getDocument: service.getDocument,
    findExistingTag: service.findExistingTag, protectedTagCheckedAt: service.protectedTagCheckedAt,
  };
  const { log, warn } = console;
  service.initialize = () => {};
  service.client = { patch: async (url, body) => { sent.push(body); return { data: {} }; } };
  service.getDocument = async () => ({ ...doc });
  service.findExistingTag = async (name) => (name === PROTECTED_DATE_TAG && protectedId !== null ? { id: protectedId } : null);
  service.protectedTagCheckedAt = 0;
  console.log = (...a) => logs.push(a.join(' '));
  console.warn = (...a) => warns.push(a.join(' '));
  try {
    await service.updateDocument(doc.id, updates);
  } finally {
    console.log = log;
    console.warn = warn;
    Object.assign(service, original);
  }
  return { sent, logs, warns };
}

const dateLines = (logs) => logs.filter((l) => l.startsWith('[DATE-CHANGE]'));

test('a document tagged via:ingest keeps its created date', async () => {
  const { sent, logs } = await run({ id: 5, tags: [PROTECTED_ID, 3], created: '2014-06-21' }, { created: '2099-01-01', tags: [3] });
  assert.ok(!('created' in sent[0]), JSON.stringify(sent));
  assert.deepStrictEqual(dateLines(logs), []);
  const r2 = await run({ id: 5, tags: [PROTECTED_ID], created: '2014-06-21' }, { created: '2015-01-01' });
  assert.ok(!('created' in r2.sent[0]));
});

test('when the protected tag does not exist, dates apply as before', async () => {
  const { sent } = await run({ id: 6, tags: [77], created: '2026-10-07' }, { created: '2026-09-11' }, null);
  assert.strictEqual(sent[0].created, '2026-09-11');
});

test('future and pre-1990 model dates are rejected with a warning', async () => {
  for (const bad of ['2099-12-31', '1945-01-02', '1989-12-31']) {
    const { sent, warns, logs } = await run({ id: 7, tags: [], created: '2026-10-04' }, { created: bad });
    assert.ok(!('created' in sent[0]), `${bad}: ${JSON.stringify(sent)}`);
    assert.ok(warns.some((w) => w.includes('Implausible document date')), bad);
    assert.deepStrictEqual(dateLines(logs), []);
  }
});

test('an applied change logs exactly one [DATE-CHANGE] line with ids and dates only', async () => {
  const { sent, logs } = await run({ id: 1602, tags: [], created: '2026-08-07T00:00:00-07:00' }, { created: '2026-09-11', title: 'Secret title' });
  assert.strictEqual(sent[0].created, '2026-09-11');
  assert.deepStrictEqual(dateLines(logs), ['[DATE-CHANGE] doc=1602 old=2026-08-07 new=2026-09-11']);
});

test('an unchanged date is sent but not logged as a change', async () => {
  const { sent, logs } = await run({ id: 8, tags: [], created: '2026-09-11' }, { created: '2026-09-11' });
  assert.strictEqual(sent[0].created, '2026-09-11');
  assert.deepStrictEqual(dateLines(logs), []);
});

test('an unparseable model date is still skipped', async () => {
  const { sent, warns, logs } = await run({ id: 9, tags: [], created: '2026-09-11' }, { created: 'August 2026' });
  assert.ok(!('created' in sent[0]));
  assert.ok(warns.some((w) => w.includes('Unparseable')));
  assert.deepStrictEqual(dateLines(logs), []);
});

test('isPlausibleCreatedDate bounds', () => {
  const now = new Date(2026, 9, 8);
  assert.strictEqual(isPlausibleCreatedDate('2026-10-08', now), true);
  assert.strictEqual(isPlausibleCreatedDate('2026-10-09', now), false);
  assert.strictEqual(isPlausibleCreatedDate('1990-01-01', now), true);
  assert.strictEqual(isPlausibleCreatedDate('1989-12-31', now), false);
});

test('the protected tag lookup is cached, including "not found"', async () => {
  let calls = 0;
  const original = { findExistingTag: service.findExistingTag, protectedTagCheckedAt: service.protectedTagCheckedAt };
  service.findExistingTag = async () => { calls += 1; return null; };
  service.protectedTagCheckedAt = 0;
  try {
    assert.strictEqual(await service.getProtectedDateTagId(), null);
    assert.strictEqual(await service.getProtectedDateTagId(), null);
  } finally {
    Object.assign(service, original);
  }
  assert.strictEqual(calls, 1);
});

// test/createdDate.test.js
// An unparseable AI document date must be dropped, never replaced with 1990-01-01.
// Run with: npm run test:unit
const test = require('node:test');
const assert = require('node:assert');

const service = require('../services/paperlessService');
const { normalizeCreatedDate } = service;

test('valid dates normalize to yyyy-MM-dd', () => {
  assert.strictEqual(normalizeCreatedDate('2026-08-31'), '2026-08-31');
  assert.strictEqual(normalizeCreatedDate(' 2026-08-31 '), '2026-08-31');
  assert.strictEqual(normalizeCreatedDate('31.08.2026'), '2026-08-31');
  assert.strictEqual(normalizeCreatedDate('31-08-2026'), '2026-08-31');
});

test('missing or unparseable dates yield null, never the 1990 fallback', () => {
  for (const bad of [null, undefined, '', '   ', 'null', 'unknown', 'August 2026', 'August 01 - August 31, 2026', 42]) {
    assert.strictEqual(normalizeCreatedDate(bad), null, `input ${JSON.stringify(bad)}`);
  }
});

test('updateDocument drops an unparseable created instead of writing 1990-01-01', async () => {
  const sent = [];
  const original = { client: service.client, initialize: service.initialize, getDocument: service.getDocument };
  service.initialize = () => {};
  service.client = { patch: async (url, body) => { sent.push(body); return { data: {} }; } };
  service.getDocument = async () => ({ id: 1, tags: [], created: '2026-08-31' });
  try {
    await service.updateDocument(1, { title: 't', created: 'August 2026' });
    await service.updateDocument(1, { title: 't', created: '2026-09-01' });
  } finally {
    Object.assign(service, original);
  }
  const created = sent.map((b) => b.created);
  assert.ok(!created.includes('1990-01-01'), `sent ${JSON.stringify(sent)}`);
  assert.strictEqual(sent[0].created, undefined);
  assert.strictEqual(sent[1].created, '2026-09-01');
});

// test/tagAllowlist.test.js
// Unit tests for the semantic tag allow-list (TAG_ALLOWLIST, TAG_SCHEMA_ENUM) and the
// %RESTRICTED_TAGS% formatter. Run with: npm run test:unit
const test = require('node:test');
const assert = require('node:assert');

const allow = require('../services/tagAllowlist');
const RestrictionPromptService = require('../services/restrictionPromptService');

const PAPERLESS_TAGS = ['ai-processed', 'source:mail', 'Home', 'Tax', 'Investment', 'Job Search', 'Receipts'];

test('parseAllowlist: unset or blank means the feature is off', () => {
  assert.strictEqual(allow.parseAllowlist(undefined), null);
  assert.strictEqual(allow.parseAllowlist(''), null);
  assert.strictEqual(allow.parseAllowlist('   '), null);
});

test('parseAllowlist: comma list and JSON array, trimmed', () => {
  assert.deepStrictEqual(allow.parseAllowlist(' Home , Tax,Job Search '), ['Home', 'Tax', 'Job Search']);
  assert.deepStrictEqual(allow.parseAllowlist('["Home", "Tax, Federal", "Ünïcode"]'), ['Home', 'Tax, Federal', 'Ünïcode']);
});

test('parseAllowlist: set but empty, duplicate or malformed fails closed', () => {
  assert.throws(() => allow.parseAllowlist(','), /empty/);
  assert.throws(() => allow.parseAllowlist('[]'), /empty/);
  assert.throws(() => allow.parseAllowlist('Home, home'), /duplicate/);
  assert.throws(() => allow.parseAllowlist('["Home", 3]'), /string/);
  assert.throws(() => allow.parseAllowlist('[not json'), /JSON/);
});

test('resolveAllowlist: maps to the canonical Paperless spelling', () => {
  assert.deepStrictEqual(allow.resolveAllowlist(['home', 'TAX'], PAPERLESS_TAGS, 'ai-processed'), ['Home', 'Tax']);
});

test('resolveAllowlist: accepts tag objects and mixed input', () => {
  const tags = [{ name: 'Home' }, 'Tax', null, { id: 3 }, ''];
  assert.deepStrictEqual(allow.resolveAllowlist(['Home', 'Tax'], tags, 'ai-processed'), ['Home', 'Tax']);
});

test('resolveAllowlist: a stale name (not in Paperless) fails closed', () => {
  assert.throws(() => allow.resolveAllowlist(['Home', 'Mortgage'], PAPERLESS_TAGS, 'ai-processed'), /Mortgage/);
});

test('resolveAllowlist: the AI-processed tag can never be allowed', () => {
  assert.throws(() => allow.resolveAllowlist(['Home', 'AI-Processed'], PAPERLESS_TAGS, 'ai-processed'), /ai-processed/i);
});

test('resolveAllowlist: an empty Paperless tag list fails closed', () => {
  assert.throws(() => allow.resolveAllowlist(['Home'], [], 'ai-processed'), /Home/);
});

test('filterProposedTags: keeps exact (case-insensitive) matches, canonical spelling', () => {
  const r = allow.filterProposedTags(['home', ' Tax '], ['Home', 'Tax'], 4);
  assert.deepStrictEqual(r.kept, ['Home', 'Tax']);
  assert.deepStrictEqual(r.rejected, []);
});

test('filterProposedTags: rejects invented, operational and non-string values', () => {
  const r = allow.filterProposedTags(['Mortgage', 'source:mail', 'ai-processed', 42, null, 'Homes'], ['Home', 'Tax'], 4);
  assert.deepStrictEqual(r.kept, []);
  assert.strictEqual(r.rejected.length, 6);
});

test('filterProposedTags: dedupes and caps at the maximum', () => {
  const allowed = ['Home', 'Tax', 'Investment', 'Job Search', 'Receipts'];
  const r = allow.filterProposedTags(['Home', 'HOME', 'Tax', 'Investment', 'Job Search', 'Receipts'], allowed, 4);
  assert.deepStrictEqual(r.kept, ['Home', 'Tax', 'Investment', 'Job Search']);
  assert.deepStrictEqual(r.rejected, ['HOME', 'Receipts']);
});

test('filterProposedTags: zero tags is a valid answer', () => {
  assert.deepStrictEqual(allow.filterProposedTags([], ['Home'], 4), { kept: [], rejected: [] });
  assert.deepStrictEqual(allow.filterProposedTags(undefined, ['Home'], 4), { kept: [], rejected: [] });
});

test('buildTagSchema: adds enum and cardinality without mutating the base schema', () => {
  const base = { type: 'object', properties: { tags: { type: 'array', items: { type: 'string' } } } };
  const s = allow.buildTagSchema(base, ['Home', 'Tax "2025"'], 4);
  assert.deepStrictEqual(s.properties.tags, {
    type: 'array', items: { type: 'string', enum: ['Home', 'Tax "2025"'] }, minItems: 0, maxItems: 4, uniqueItems: true
  });
  assert.deepStrictEqual(base.properties.tags.items, { type: 'string' });
});

test('%RESTRICTED_TAGS%: renders plain tag-name strings as a JSON array', () => {
  const out = RestrictionPromptService.processRestrictionsInPrompt('TAGS=%RESTRICTED_TAGS%', ['Home', 'Tax "x"', 'Home', ' '], [], {});
  assert.strictEqual(out, 'TAGS=["Home","Tax \\"x\\""]');
});

test('%RESTRICTED_TAGS%: still accepts tag objects', () => {
  const out = RestrictionPromptService.processRestrictionsInPrompt('TAGS=%RESTRICTED_TAGS%', [{ name: 'Home' }, { id: 2 }], [], {});
  assert.strictEqual(out, 'TAGS=["Home"]');
});

test('fromEnv: off when TAG_ALLOWLIST is unset, resolved names plus enum flag when set', () => {
  const saved = { a: process.env.TAG_ALLOWLIST, e: process.env.TAG_SCHEMA_ENUM, p: process.env.AI_PROCESSED_TAG_NAME };
  try {
    delete process.env.TAG_ALLOWLIST;
    assert.strictEqual(allow.fromEnv(PAPERLESS_TAGS), null);
    process.env.TAG_ALLOWLIST = 'home,Tax';
    process.env.TAG_SCHEMA_ENUM = 'yes';
    process.env.AI_PROCESSED_TAG_NAME = 'ai-processed';
    assert.deepStrictEqual(allow.fromEnv(PAPERLESS_TAGS), { names: ['Home', 'Tax'], schemaEnum: true });
    process.env.TAG_ALLOWLIST = 'Home,ai-processed';
    assert.throws(() => allow.fromEnv(PAPERLESS_TAGS), /ai-processed/);
  } finally {
    for (const [k, v] of [['TAG_ALLOWLIST', saved.a], ['TAG_SCHEMA_ENUM', saved.e], ['AI_PROCESSED_TAG_NAME', saved.p]]) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
});

test('enforce: replaces the analysis tags with the allowed subset', () => {
  const analysis = { document: { tags: ['Mortgage', 'home', 'source:mail'] } };
  allow.enforce(analysis, { names: ['Home', 'Tax'] }, 1);
  assert.deepStrictEqual(analysis.document.tags, ['Home']);
  const untouched = { document: { tags: ['Anything'] } };
  allow.enforce(untouched, null, 1);
  assert.deepStrictEqual(untouched.document.tags, ['Anything']);
});

test('ollama request: TAG_SCHEMA_ENUM schema reaches the format field', async () => {
  const ollama = require('../services/ollamaService');
  let sent;
  const origPost = ollama.client.post;
  ollama.client.post = async (url, body) => { sent = body; return { data: { response: '{}' } }; };
  try {
    await ollama._callOllamaAPI('p', 's', 1024, ollama._schemaFor({ tagSchemaEnum: ['Home', 'Tax'] }));
    assert.deepStrictEqual(sent.format.properties.tags.items.enum, ['Home', 'Tax']);
    assert.strictEqual(sent.format.properties.tags.maxItems, 4);
    await ollama._callOllamaAPI('p', 's', 1024, ollama._schemaFor({}));
    assert.deepStrictEqual(sent.format.properties.tags, { type: 'array', items: { type: 'string' } });
  } finally {
    ollama.client.post = origPost;
  }
});

test('processTags: zero semantic tags still adds the AI-processed tag', async () => {
  const svc = require('../services/paperlessService');
  const saved = { add: process.env.ADD_AI_PROCESSED_TAG, name: process.env.AI_PROCESSED_TAG_NAME };
  const orig = { init: svc.initialize, cache: svc.ensureTagCache, find: svc.findExistingTag };
  process.env.ADD_AI_PROCESSED_TAG = 'yes';
  process.env.AI_PROCESSED_TAG_NAME = 'ai-processed';
  svc.initialize = () => {};
  svc.ensureTagCache = async () => {};
  svc.findExistingTag = async name => (name === 'ai-processed' ? { id: 99, name } : null);
  try {
    assert.deepStrictEqual((await svc.processTags([])).tagIds, [99]);
    assert.deepStrictEqual((await svc.processTags(undefined)).tagIds, [99]);
  } finally {
    Object.assign(svc, { initialize: orig.init, ensureTagCache: orig.cache, findExistingTag: orig.find });
    for (const [k, v] of [['ADD_AI_PROCESSED_TAG', saved.add], ['AI_PROCESSED_TAG_NAME', saved.name]]) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
});

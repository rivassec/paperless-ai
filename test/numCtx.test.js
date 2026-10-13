// test/numCtx.test.js
// Unit tests for the fixed Ollama context (OLLAMA_NUM_CTX) vs the per-document estimate.
// Run with: npm run test:unit
const test = require('node:test');
const assert = require('node:assert');

const CONFIG_PATH = require.resolve('../config/config');
const SERVICE_PATH = require.resolve('../services/ollamaService');

const TUNABLES = ['OLLAMA_NUM_CTX', 'TOKEN_LIMIT'];

/**
 * Loads a fresh ollamaService singleton with the given env vars (config is read at require time).
 * @param {object} env Values for OLLAMA_NUM_CTX / TOKEN_LIMIT, or undefined to unset
 * @returns {object} A freshly constructed ollamaService
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
  try {
    return require('../services/ollamaService');
  } finally {
    for (const key of TUNABLES) {
      if (saved[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = saved[key];
      }
    }
  }
}

test('without OLLAMA_NUM_CTX the context is the per-document estimate, capped by TOKEN_LIMIT', () => {
  const svc = loadService({ TOKEN_LIMIT: 16384 });
  assert.strictEqual(svc._calculateNumCtx(1000, 1024), 2024);
  assert.strictEqual(svc._calculateNumCtx(20000, 1024), 16384);
});

test('OLLAMA_NUM_CTX pins the context for every request, whatever the prompt size', () => {
  const svc = loadService({ TOKEN_LIMIT: 16384, OLLAMA_NUM_CTX: 65536 });
  assert.strictEqual(svc._calculateNumCtx(10, 512), 65536);
  assert.strictEqual(svc._calculateNumCtx(1000, 1024), 65536);
  assert.strictEqual(svc._calculateNumCtx(20000, 1024), 65536);
});

test('an invalid or non-positive OLLAMA_NUM_CTX falls back to the estimate', () => {
  for (const bad of ['', 'abc', '0', '-5']) {
    const svc = loadService({ TOKEN_LIMIT: 16384, OLLAMA_NUM_CTX: bad });
    assert.strictEqual(svc._calculateNumCtx(1000, 1024), 2024, `OLLAMA_NUM_CTX=${JSON.stringify(bad)}`);
  }
});

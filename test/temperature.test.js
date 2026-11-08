// test/temperature.test.js
// Unit tests for the document-analysis temperature (OLLAMA_TEMPERATURE). Run with: npm run test:unit
const test = require('node:test');
const assert = require('node:assert');

const CONFIG_PATH = require.resolve('../config/config');
const SERVICE_PATH = require.resolve('../services/ollamaService');

/**
 * Sends one analysis request through a fresh ollamaService with OLLAMA_TEMPERATURE set as given.
 * @param {string|undefined} value OLLAMA_TEMPERATURE, or undefined to unset
 * @returns {Promise<object>} the options object of the request body
 */
async function sentOptions(value) {
  const saved = process.env.OLLAMA_TEMPERATURE;
  if (value === undefined) delete process.env.OLLAMA_TEMPERATURE; else process.env.OLLAMA_TEMPERATURE = value;
  delete require.cache[CONFIG_PATH];
  delete require.cache[SERVICE_PATH];
  try {
    const svc = require('../services/ollamaService');
    let body;
    svc.client.post = async (url, b) => { body = b; return { data: { response: '{}' } }; };
    await svc._callOllamaAPI('p', 's', 1024, {});
    return body.options;
  } finally {
    if (saved === undefined) delete process.env.OLLAMA_TEMPERATURE; else process.env.OLLAMA_TEMPERATURE = saved;
  }
}

test('analysis temperature defaults to 0.7 (previous hardcoded value)', async () => {
  assert.strictEqual((await sentOptions(undefined)).temperature, 0.7);
  assert.strictEqual((await sentOptions('')).temperature, 0.7);
});

test('OLLAMA_TEMPERATURE overrides the analysis temperature', async () => {
  assert.strictEqual((await sentOptions('0.2')).temperature, 0.2);
  assert.strictEqual((await sentOptions('0')).temperature, 0);
});

test('an invalid OLLAMA_TEMPERATURE falls back to 0.7', async () => {
  assert.strictEqual((await sentOptions('abc')).temperature, 0.7);
  assert.strictEqual((await sentOptions('-1')).temperature, 0.7);
});

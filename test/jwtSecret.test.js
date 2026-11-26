// test/jwtSecret.test.js
// Unit tests for the JWT secret resolution (no hard-coded fallback).
// Run with: npm run test:unit
const test = require('node:test');
const assert = require('node:assert');

const { resolveJwtSecret, KNOWN_DEFAULT } = require('../config/jwtSecret');

const fixed = () => 'r'.repeat(128);

test('uses a strong configured secret', () => {
  const s = 'a'.repeat(64);
  assert.deepStrictEqual(resolveJwtSecret(s, fixed), { secret: s, source: 'env' });
});

test('unset secret is replaced by a random one', () => {
  const r = resolveJwtSecret(undefined, fixed);
  assert.strictEqual(r.source, 'random');
  assert.strictEqual(r.reason, 'unset');
  assert.strictEqual(r.secret, fixed());
});

test('empty secret is treated as unset', () => {
  assert.strictEqual(resolveJwtSecret('', fixed).reason, 'unset');
});

test('the known upstream default is never used', () => {
  const r = resolveJwtSecret(KNOWN_DEFAULT, fixed);
  assert.strictEqual(r.source, 'random');
  assert.strictEqual(r.reason, 'known default');
  assert.notStrictEqual(r.secret, KNOWN_DEFAULT);
});

test('a short secret is replaced', () => {
  assert.strictEqual(resolveJwtSecret('short', fixed).reason, 'too short');
});

test('default generator returns a long random secret', () => {
  const a = resolveJwtSecret(undefined).secret;
  const b = resolveJwtSecret(undefined).secret;
  assert.ok(a.length >= 64);
  assert.notStrictEqual(a, b);
});

// config/jwtSecret.js
// One JWT signing secret for the whole process.
//
// Upstream fell back to the hard-coded string 'your-secret-key' when
// JWT_SECRET was unset, so anyone could forge a login cookie. Here an unset,
// default or short secret is replaced by a random one generated at startup.
// Logins then last until the next restart, which is the safe trade-off; set
// JWT_SECRET (>= 32 chars) to keep sessions across restarts.
const crypto = require('crypto');

const KNOWN_DEFAULT = 'your-secret-key';
const MIN_LENGTH = 32;

let cached = null;

/**
 * Decides which secret to use for a configured value.
 * @param {string|undefined} configured value of JWT_SECRET
 * @param {function(): string} [randomSecret] generator, for tests
 * @returns {{secret: string, source: 'env'|'random', reason?: string}}
 */
function resolveJwtSecret(configured, randomSecret = () => crypto.randomBytes(64).toString('hex')) {
  if (typeof configured === 'string' && configured !== KNOWN_DEFAULT && configured.length >= MIN_LENGTH) {
    return { secret: configured, source: 'env' };
  }
  let reason = 'unset';
  if (configured === KNOWN_DEFAULT) reason = 'known default';
  else if (typeof configured === 'string' && configured.length > 0) reason = 'too short';
  return { secret: randomSecret(), source: 'random', reason };
}

/**
 * The process-wide JWT secret (resolved once, on first use).
 * @returns {string}
 */
function getJwtSecret() {
  if (cached === null) {
    const r = resolveJwtSecret(process.env.JWT_SECRET);
    if (r.source === 'random') {
      console.warn(`[auth] JWT_SECRET ${r.reason}; using a random per-process secret (logins reset on restart)`);
    }
    cached = r.secret;
  }
  return cached;
}

module.exports = { getJwtSecret, resolveJwtSecret, KNOWN_DEFAULT, MIN_LENGTH };

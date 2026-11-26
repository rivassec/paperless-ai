// services/setupGuard.js
// Guard for POST /setup (GHSA-qgr5-7f3c-qqm3).
//
// /setup is a public route so a fresh install can be configured before any
// account exists. Without a guard, anyone who can reach the app can POST
// /setup on an already configured instance and replace the Paperless URL and
// token, the AI provider keys and add an admin user (full takeover).
//
// Rules:
// - once at least one user exists, POST /setup is refused (403); later
//   changes go through the authenticated /settings page;
// - if the user lookup fails, refuse (503): fail closed, never open;
// - only one setup request runs at a time (409 for a concurrent one), so two
//   racing first-time requests cannot both create an account.

/**
 * Builds the Express middleware that protects POST /setup.
 * @param {object} deps
 * @param {function(): Promise<Array>} deps.getUsers returns the stored users
 * @param {object} [deps.logger] console-like logger
 * @returns {function} Express middleware (req, res, next)
 */
function createSetupGuard({ getUsers, logger = console }) {
  if (typeof getUsers !== 'function') {
    throw new TypeError('createSetupGuard: getUsers must be a function');
  }
  let inFlight = false;

  return async function setupGuard(req, res, next) {
    if (inFlight) {
      return res.status(409).json({ error: 'Setup is already in progress.' });
    }
    inFlight = true;
    let released = false;
    const release = () => {
      if (!released) {
        released = true;
        inFlight = false;
      }
    };

    let users;
    try {
      users = await getUsers();
    } catch (error) {
      release();
      logger.error('[setup-guard] user lookup failed, refusing setup:', error && error.message);
      return res.status(503).json({ error: 'Setup is unavailable.' });
    }

    if (!Array.isArray(users)) {
      release();
      logger.error('[setup-guard] user lookup returned no list, refusing setup');
      return res.status(503).json({ error: 'Setup is unavailable.' });
    }

    if (users.length > 0) {
      release();
      logger.warn('[setup-guard] refused POST /setup: instance already has a user', {
        ip: req.ip,
      });
      return res.status(403).json({
        error: 'Setup is already complete. Change settings from the Settings page after logging in.',
      });
    }

    // First-time setup: hold the lock until the response is done.
    res.on('finish', release);
    res.on('close', release);
    return next();
  };
}

module.exports = { createSetupGuard };

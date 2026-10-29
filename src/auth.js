'use strict';

const { isValidUid } = require('./validation');

function fail(res, status, message, extra = {}) {
  return res.status(status).json({ error: message, message, ...extra });
}

function createAuth({ firebaseAuth, userStore, adminUids = [] }) {
  async function verifyToken(token, { checkRevoked = false, allowDeleted = false } = {}) {
    if (typeof token !== 'string' || token.length === 0 || token.length > 4096) return null;
    let decoded;
    try {
      decoded = await firebaseAuth.verifyIdToken(token, checkRevoked);
    } catch (err) {
      if (!allowDeleted || err?.code !== 'auth/user-not-found') return null;
      // the account is already gone in Firebase, the signature is still checked
      decoded = await firebaseAuth.verifyIdToken(token).catch(() => null);
    }
    return isValidUid(decoded?.uid) ? decoded : null;
  }

  function bearerToken(req) {
    const match = /^Bearer\s+(\S+)$/i.exec(req.get('authorization') ?? '');
    return match ? match[1] : null;
  }

  async function requireAuth(req, res, next) {
    const decoded = await verifyToken(bearerToken(req));
    if (!decoded) return fail(res, 401, 'Unauthorized');
    req.auth = decoded;
    next();
  }

  // also asks Firebase whether the token was revoked or the account deleted
  function requireFreshAuth({ allowDeleted = false } = {}) {
    return async (req, res, next) => {
      const decoded = await verifyToken(bearerToken(req), { checkRevoked: true, allowDeleted });
      if (!decoded) return fail(res, 401, 'Unauthorized');
      req.auth = decoded;
      next();
    };
  }

  function loadUser(req, res, next) {
    const user = userStore.get(req.auth.uid);
    if (!user) return fail(res, 404, 'User not found');
    req.user = user;
    next();
  }

  const isAdmin = user => Boolean(user) && (user.role === 'admin' || adminUids.includes(user.uid));

  function requireAdmin(req, res, next) {
    if (!isAdmin(req.user)) return fail(res, 403, 'Forbidden');
    next();
  }

  return { verifyToken, requireAuth, requireFreshAuth, loadUser, requireAdmin, isAdmin };
}

async function verifyRecaptcha(token, secret, remoteIp) {
  const body = new URLSearchParams({ secret, response: token });
  if (remoteIp) body.set('remoteip', remoteIp);
  const response = await fetch('https://www.google.com/recaptcha/api/siteverify', {
    method: 'POST',
    body,
    signal: AbortSignal.timeout(5000)
  });
  if (!response.ok) throw new Error(`reCAPTCHA verification failed with HTTP ${response.status}`);
  return response.json();
}

module.exports = { createAuth, fail, verifyRecaptcha };

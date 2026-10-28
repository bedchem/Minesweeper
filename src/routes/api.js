'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const express = require('express');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const { fail, verifyRecaptcha } = require('../auth');
const { RANKED_SOLO, buildLeaderboard, computeGlobalStats, computeStats, filterByTimeRange } = require('../stats');
const { isValidUid, isValidUsername, parseTimeRange, sanitizeUsername, toInt } = require('../validation');

const DAY_MS = 24 * 60 * 60 * 1000;
const RECENT_LOGIN_SECONDS = 5 * 60;
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const SOLO_MAX_SIZE = 25;
const SOLO_MAX_TIME = 24 * 60 * 60;

const uidKey = (req) => req.auth?.uid ?? ipKeyGenerator(req.ip);

function limiter(limit, windowMs, keyGenerator) {
  return rateLimit({
    windowMs,
    limit,
    keyGenerator,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (req, res) => fail(res, 429, 'Too many requests, please try again later')
  });
}

function publicUser(user, isAdmin) {
  return {
    uid: user.uid,
    username: user.username,
    email: user.email ?? null,
    role: user.role ?? 'user',
    isAdmin,
    createdAt: user.createdAt ?? null,
    nameHistory: user.nameHistory ?? []
  };
}

function detectImage(buffer) {
  if (buffer.length > 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpg';
  return null;
}

async function removeAvatar(dir, uid) {
  await Promise.all(['png', 'jpg'].map(ext => fsp.rm(path.join(dir, `${uid}.${ext}`), { force: true })));
}

function disconnectUser(io, uid) {
  for (const socket of io.of('/').sockets.values()) {
    if (socket.data.uid === uid) socket.disconnect(true);
  }
}

function uniqueUsername(userStore, wanted) {
  let candidate = sanitizeUsername(wanted);
  for (let i = 0; userStore.isUsernameTaken(candidate); i++) {
    const suffix = String(Math.floor(Math.random() * 10 ** Math.min(6, 2 + i)));
    candidate = `${candidate.slice(0, 12 - suffix.length)}${suffix}`;
  }
  return candidate;
}

function createApiRouter(ctx) {
  const { config, userStore, lobbyManager, io, auth, firebaseAuth, activity, logger } = ctx;
  const router = express.Router();
  const { requireAuth, loadUser } = auth;

  const publicLimit = limiter(300, 60_000, req => ipKeyGenerator(req.ip));
  const accountLimit = limiter(30, 15 * 60_000, uidKey);
  const gameLimit = limiter(120, 15 * 60_000, uidKey);

  const leaderboardCache = new Map();
  function leaderboard(type, days) {
    const key = `${type}:${days ?? 'all'}`;
    const hit = leaderboardCache.get(key);
    if (hit && hit.version === userStore.version && Date.now() - hit.at < 60_000) return hit.data;
    const data = buildLeaderboard(userStore.all(), type, days);
    leaderboardCache.set(key, { version: userStore.version, at: Date.now(), data });
    return data;
  }

  router.use(['/api', '/recaptcha'], publicLimit);

  router.get('/api/lobbies', (req, res) => {
    res.json(lobbyManager.summaries().filter(l => l.status === 'waiting' || l.status === 'completed'));
  });

  router.get('/api/getLeaderboard', (req, res) => {
    const type = req.query.type === 'singleplayer' ? 'singleplayer' : 'multiplayer';
    res.json(leaderboard(type, parseTimeRange(req.query.timeRange)).slice(0, 50));
  });

  router.get('/api/getGlobalStats', (req, res) => {
    res.json(computeGlobalStats(userStore.all()));
  });

  router.get('/api/getStats/:username', (req, res) => {
    const user = userStore.getByUsername(req.params.username);
    if (!user) return fail(res, 404, 'User not found');
    const days = parseTimeRange(req.query.timeRange);
    const stats = computeStats(filterByTimeRange(user.gameHistory, days));
    const rank = type => {
      const entry = leaderboard(type, days).find(e => e.uid === user.uid);
      return entry ? `#${entry.rank}` : 'N/A';
    };
    stats.multiplayer.leaderboardPosition = rank('multiplayer');
    stats.singleplayer.leaderboardPosition = rank('singleplayer');
    res.json({ username: user.username, uid: user.uid, ...stats });
  });

  router.get('/api/getAllUsernames', (req, res) => {
    res.json(Array.from(userStore.all(), u => u.username));
  });

  router.post('/api/checkUsername', (req, res) => {
    const { username } = req.body ?? {};
    if (typeof username !== 'string' || !username.trim()) return res.status(400).json({ exists: false });
    res.json({ exists: userStore.isUsernameTaken(username.trim()) });
  });

  router.post('/recaptcha', async (req, res) => {
    const { token, action } = req.body ?? {};
    const secret = config.recaptchaSecrets[action === 'register' ? 'register' : 'login'];
    if (!secret) return res.json({ success: true, skipped: true });
    if (typeof token !== 'string' || !token) return res.status(400).json({ success: false, message: 'Missing token' });
    try {
      const result = await verifyRecaptcha(token, secret, req.ip);
      if (result.success) return res.json({ success: true });
      res.status(400).json({ success: false, message: 'Captcha validation failed', error: result['error-codes'] });
    } catch (err) {
      logger.error('reCAPTCHA verification error:', err);
      res.status(502).json({ success: false, message: 'Captcha verification unavailable' });
    }
  });

  router.get('/avatar/:uid', (req, res, next) => {
    const { uid } = req.params;
    const file = isValidUid(uid)
      ? ['png', 'jpg'].map(ext => path.join(config.profilePicsDir, `${uid}.${ext}`)).find(f => fs.existsSync(f))
      : null;
    res.set('Cache-Control', 'no-cache');
    res.sendFile(file ?? path.join(config.publicDir, 'assets/images/icon.png'), err => err && next(err));
  });

  router.post('/api/getUser', requireAuth, loadUser, (req, res) => {
    res.json(publicUser(req.user, auth.isAdmin(req.user)));
  });

  router.post('/api/createUser', requireAuth, accountLimit, async (req, res) => {
    const { uid, email = null, firebase } = req.auth;
    if (userStore.get(uid)) return fail(res, 400, 'User already exists');

    const requested = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
    let username = requested;
    if (firebase?.sign_in_provider === 'password') {
      if (!isValidUsername(username)) return fail(res, 400, 'Invalid username');
      if (userStore.isUsernameTaken(username)) return fail(res, 409, 'Username already taken');
    } else {
      username = uniqueUsername(userStore, requested || email?.split('@')[0]);
    }

    try {
      await userStore.create({ uid, username, email });
    } catch (err) {
      if (err.message === 'Username taken') return fail(res, 409, 'Username already taken');
      throw err;
    }
    activity.add(username, 'Neuer Benutzer erstellt');
    res.json({ message: 'User created successfully', username });
  });

  router.post('/api/updateUser', requireAuth, accountLimit, loadUser, async (req, res) => {
    const user = req.user;
    const newUsername = typeof req.body?.newUsername === 'string' ? req.body.newUsername.trim() : '';
    const renaming = newUsername !== user.username;

    if (renaming) {
      if (!isValidUsername(newUsername)) {
        return fail(res, 400, 'Username must be 3-12 characters (letters, numbers, underscore)');
      }
      if (userStore.isUsernameTaken(newUsername, user.uid)) return fail(res, 409, 'Username already taken');
      const lastChange = user.nameHistory.at(-1);
      if (lastChange) {
        const remainingMs = Date.parse(lastChange.changedAt) + config.renameCooldownDays * DAY_MS - Date.now();
        if (remainingMs > 0) {
          const d = Math.floor(remainingMs / DAY_MS);
          const h = Math.floor((remainingMs % DAY_MS) / 3_600_000);
          const m = Math.floor((remainingMs % 3_600_000) / 60_000);
          return fail(res, 400, `You can change your name again in ${d}d ${h}h ${m}m`);
        }
      }
    }

    try {
      await userStore.update(user.uid, u => {
        if (renaming) {
          u.nameHistory.push({ name: u.username, changedAt: new Date().toISOString() });
          u.username = newUsername;
        }
        if (req.auth.email) u.email = req.auth.email;
      });
    } catch (err) {
      if (err.message === 'Username taken') return fail(res, 409, 'Username already taken');
      throw err;
    }
    res.json({ message: 'User updated successfully', username: newUsername });
  });

  router.post('/api/deleteUser', requireAuth, accountLimit, async (req, res) => {
    const { uid, auth_time: authTime } = req.auth;
    if (!authTime || Date.now() / 1000 - authTime > RECENT_LOGIN_SECONDS) {
      return fail(res, 403, 'Please log in again to delete your account', { code: 'requires-recent-login' });
    }
    try {
      await firebaseAuth.deleteUser(uid);
    } catch (err) {
      if (err?.code !== 'auth/user-not-found') throw err;
    }
    const name = userStore.get(uid)?.username;
    await removeAvatar(config.profilePicsDir, uid);
    await userStore.delete(uid);
    disconnectUser(io, uid);
    if (name) activity.add(name, 'Account gelöscht');
    res.json({ message: 'User deleted' });
  });

  router.post('/api/uploadProfilePic', requireAuth, accountLimit, express.json({ limit: '7mb' }), loadUser, async (req, res) => {
    const image = req.body?.image;
    const match = typeof image === 'string' ? /^data:image\/(?:png|jpe?g);base64,([A-Za-z0-9+/=]+)$/.exec(image) : null;
    if (!match) return fail(res, 400, 'Invalid image format');

    const buffer = Buffer.from(match[1], 'base64');
    if (buffer.length > MAX_AVATAR_BYTES) return fail(res, 400, 'File too large');
    const ext = detectImage(buffer);
    if (!ext) return fail(res, 400, 'Invalid image format');

    const { uid } = req.user;
    await fsp.mkdir(config.profilePicsDir, { recursive: true });
    await removeAvatar(config.profilePicsDir, uid);
    const file = path.join(config.profilePicsDir, `${uid}.${ext}`);
    const tmp = `${file}.${process.pid}.tmp`;
    await fsp.writeFile(tmp, buffer);
    await fsp.rename(tmp, file);
    res.json({ url: `/avatar/${uid}` });
  });

  router.post('/api/saveSoloGame', requireAuth, gameLimit, loadUser, async (req, res) => {
    const result = req.body?.result ?? {};
    const width = toInt(result.width);
    const height = toInt(result.height);
    const mines = toInt(result.mines);
    const won = result.won === true;
    const time = won ? toInt(result.time) : null;

    const validBoard =
      width !== null && height !== null && mines !== null &&
      width >= RANKED_SOLO.width && width <= SOLO_MAX_SIZE &&
      height >= RANKED_SOLO.height && height <= SOLO_MAX_SIZE &&
      mines >= RANKED_SOLO.mines && mines <= width * height - 9;
    if (!validBoard || typeof result.won !== 'boolean' || (won && (time === null || time < 0 || time > SOLO_MAX_TIME))) {
      return fail(res, 400, 'Invalid game result');
    }

    await userStore.addGameResult(req.user.uid, {
      type: 'singleplayer',
      won,
      time,
      difficulty: `${width}x${height}, ${mines} mines`,
      timestamp: new Date().toISOString()
    });
    res.json({ message: 'Game result saved successfully' });
  });

  return router;
}

module.exports = { createApiRouter, disconnectUser, removeAvatar, uniqueUsername };

'use strict';

const os = require('node:os');
const express = require('express');
const { fail } = require('../auth');
const { computeGlobalStats } = require('../stats');
const { ROLES, cleanText, isValidUid, isValidUsername, normalizeLobbyCode } = require('../validation');
const { disconnectUser, removeAvatar } = require('./api');

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function createAdminRouter(ctx) {
  const { config, userStore, lobbyManager, io, auth, firebaseAuth, activity } = ctx;
  const router = express.Router();
  router.use(auth.requireAuth, auth.loadUser, auth.requireAdmin);

  const adminName = req => req.user.username;
  // ADMIN_UIDS admins can only be edited by themselves or other ADMIN_UIDS admins
  const isRoot = uid => config.adminUids.includes(uid);
  const protectedFrom = (req, uid) => isRoot(uid) && !isRoot(req.user.uid);
  const userRow = user => ({
    uid: user.uid,
    username: user.username,
    email: user.email ?? null,
    role: user.role ?? 'user',
    createdAt: user.createdAt ?? null,
    gamesPlayed: user.gameHistory?.length ?? 0
  });

  router.get('/overview', (req, res) => {
    const global = computeGlobalStats(userStore.all());
    const cpus = os.availableParallelism?.() ?? os.cpus().length;
    res.json({
      totalPlayers: global.totalPlayers,
      totalGamesPlayed: global.totalGamesPlayed,
      averageTime: global.averageTime,
      activeLobbies: lobbyManager.lobbies.size,
      activeSessions: io.of('/').sockets.size,
      serverLoad: Math.min(100, Math.round((os.loadavg()[0] / cpus) * 100)),
      memoryUsage: Math.round((1 - os.freemem() / os.totalmem()) * 100),
      processMemoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
      uptimeSeconds: Math.round(process.uptime()),
      activity: activity.recent(25)
    });
  });

  router.get('/users', (req, res) => {
    res.json(Array.from(userStore.all(), userRow));
  });

  router.post('/users', async (req, res) => {
    const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
    const email = typeof req.body?.email === 'string' ? req.body.email.trim() : '';
    const password = req.body?.password;
    const role = req.body?.role ?? 'user';
    if (!isValidUsername(username)) return fail(res, 400, 'Invalid username (3-12 characters: letters, numbers, underscore)');
    if (!EMAIL_PATTERN.test(email)) return fail(res, 400, 'Invalid email');
    if (typeof password !== 'string' || password.length < 6) return fail(res, 400, 'Password must be at least 6 characters');
    if (!ROLES.includes(role)) return fail(res, 400, 'Invalid role');
    if (userStore.isUsernameTaken(username)) return fail(res, 409, 'Username already taken');

    let created;
    try {
      created = await firebaseAuth.createUser({ email, password, displayName: username });
    } catch (err) {
      return fail(res, 400, cleanText(err?.message ?? 'Could not create user', 200));
    }
    const user = await userStore.create({ uid: created.uid, username, email, role });
    activity.add(adminName(req), `Benutzer "${username}" erstellt`);
    res.status(201).json(userRow(user));
  });

  router.patch('/users/:uid', async (req, res) => {
    const { uid } = req.params;
    const user = isValidUid(uid) ? userStore.get(uid) : null;
    if (!user) return fail(res, 404, 'User not found');
    if (protectedFrom(req, uid)) return fail(res, 403, 'Forbidden');

    const username = typeof req.body?.username === 'string' ? req.body.username.trim() : user.username;
    const email = typeof req.body?.email === 'string' ? req.body.email.trim() : user.email;
    const role = req.body?.role ?? user.role ?? 'user';
    if (username !== user.username && !isValidUsername(username)) return fail(res, 400, 'Invalid username');
    if (userStore.isUsernameTaken(username, uid)) return fail(res, 409, 'Username already taken');
    if (email && email !== user.email && !EMAIL_PATTERN.test(email)) return fail(res, 400, 'Invalid email');
    if (!ROLES.includes(role)) return fail(res, 400, 'Invalid role');
    if (uid === req.user.uid && role !== (user.role ?? 'user')) return fail(res, 400, 'You cannot change your own role');

    if (email && email !== user.email) {
      try {
        await firebaseAuth.updateUser(uid, { email });
      } catch (err) {
        if (err?.code !== 'auth/user-not-found') return fail(res, 400, cleanText(err?.message ?? 'Could not update email', 200));
      }
    }
    const renamed = username !== user.username;
    await userStore.update(uid, u => {
      if (username !== u.username) {
        u.nameHistory.push({ name: u.username, changedAt: new Date().toISOString(), by: 'admin' });
        u.username = username;
      }
      u.email = email;
      u.role = role;
    });
    if (renamed) lobbyManager.renameUser(uid, username);
    activity.add(adminName(req), `Benutzer "${username}" bearbeitet`);
    res.json(userRow(userStore.get(uid)));
  });

  router.delete('/users/:uid', async (req, res) => {
    const { uid } = req.params;
    const user = isValidUid(uid) ? userStore.get(uid) : null;
    if (!user) return fail(res, 404, 'User not found');
    if (uid === req.user.uid) return fail(res, 400, 'You cannot delete your own account here');
    if (protectedFrom(req, uid)) return fail(res, 403, 'Forbidden');
    try {
      await firebaseAuth.deleteUser(uid);
    } catch (err) {
      if (err?.code !== 'auth/user-not-found') throw err;
    }
    await removeAvatar(config.profilePicsDir, uid);
    await userStore.delete(uid);
    disconnectUser(io, uid);
    activity.add(adminName(req), `Benutzer "${user.username}" gelöscht`);
    res.json({ message: 'User deleted' });
  });

  router.get('/lobbies', (req, res) => {
    res.json(lobbyManager.summaries());
  });

  router.delete('/lobbies/:code', (req, res) => {
    const code = normalizeLobbyCode(req.params.code);
    if (!code || !lobbyManager.closeLobby(code)) return fail(res, 404, 'Lobby not found');
    res.json({ message: 'Lobby closed' });
  });

  router.get('/sessions', (req, res) => {
    res.json(Array.from(io.of('/').sockets.values(), s => ({
      id: s.id,
      uid: s.data.uid,
      username: s.data.name,
      lobby: s.data.lobbyCode,
      connectedAt: s.data.connectedAt,
      lastActivity: s.data.lastActivity,
      status: 'online'
    })));
  });

  router.post('/sessions/:id/disconnect', (req, res) => {
    const socket = io.of('/').sockets.get(req.params.id);
    if (!socket) return fail(res, 404, 'Session not found');
    socket.disconnect(true);
    activity.add(adminName(req), `Session von "${socket.data.name}" getrennt`);
    res.json({ message: 'Session disconnected' });
  });

  return router;
}

module.exports = { createAdminRouter };

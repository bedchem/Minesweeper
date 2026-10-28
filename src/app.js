'use strict';

const http = require('node:http');
const path = require('node:path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { Server } = require('socket.io');
const { ActivityLog } = require('./activityLog');
const { createAuth, fail } = require('./auth');
const { LobbyManager, registerLobbyHandlers } = require('./lobbies');
const { createApiRouter } = require('./routes/api');
const { createAdminRouter } = require('./routes/admin');

function contentSecurityPolicy(config) {
  const directives = {
    defaultSrc: ["'self'"],
    baseUri: ["'self'"],
    objectSrc: ["'none'"],
    formAction: ["'self'"],
    frameAncestors: ["'self'"],
    scriptSrc: [
      "'self'",
      'https://www.gstatic.com',
      'https://apis.google.com',
      'https://www.google.com',
      'https://cdn.jsdelivr.net',
      'https://cdnjs.cloudflare.com'
    ],
    scriptSrcAttr: ["'none'"],
    styleSrc: ["'self'", "'unsafe-inline'", 'https://cdnjs.cloudflare.com', 'https://cdn.jsdelivr.net'],
    fontSrc: ["'self'", 'data:', 'https://cdnjs.cloudflare.com'],
    imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
    connectSrc: [
      "'self'",
      'https://*.googleapis.com',
      'https://*.firebaseio.com',
      'https://www.google.com',
      'https://cdn.jsdelivr.net',
      ...config.csp.extraConnectSrc
    ],
    frameSrc: [
      "'self'",
      'https://*.firebaseapp.com',
      'https://*.web.app',
      'https://www.google.com',
      'https://recaptcha.google.com',
      ...config.csp.extraFrameSrc
    ],
    upgradeInsecureRequests: null
  };
  return { directives, reportOnly: config.csp.reportOnly };
}

function createApp({ config, userStore, firebaseAuth, logger = console }) {
  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, {
    maxHttpBufferSize: 32 * 1024,
    ...(config.allowedOrigins.length > 0 && { cors: { origin: config.allowedOrigins } })
  });

  const activity = new ActivityLog();
  const auth = createAuth({ firebaseAuth, userStore, adminUids: config.adminUids });
  const lobbyManager = new LobbyManager({ io, userStore, activity, logger, timings: config.game });
  const ctx = { config, userStore, lobbyManager, io, auth, firebaseAuth, activity, logger };

  app.set('trust proxy', config.trustProxy);
  app.use(helmet({
    contentSecurityPolicy: contentSecurityPolicy(config),
    // needed for the firebase login popup
    crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' }
  }));
  if (config.allowedOrigins.length > 0) app.use(cors({ origin: config.allowedOrigins }));

  const json = express.json({ limit: '32kb' });
  app.use((req, res, next) => (req.path === '/api/uploadProfilePic' ? next() : json(req, res, next)));

  app.use(createApiRouter(ctx));
  app.use('/api/admin', createAdminRouter(ctx));

  const page = name => (req, res) => res.sendFile(path.join(config.publicDir, name));
  app.get('/favicon.ico', page('assets/images/minesweeperlogo.png'));
  app.get('/lobby', (req, res) => res.redirect('/lobbycreation'));
  app.get('/lobby/:code', page('lobby.html'));
  app.get('/stats/:username', page('stats.html'));
  app.use(express.static(config.publicDir, { extensions: ['html'] }));
  app.use('/profile_pics', express.static(config.profilePicsDir));

  app.use((req, res) => {
    if (req.path.startsWith('/api/')) return fail(res, 404, 'Not found');
    res.status(404).sendFile(path.join(config.publicDir, '404.html'));
  });

  app.use((err, req, res, next) => {
    const status = Number.isInteger(err.status) && err.status >= 400 && err.status < 600 ? err.status : 500;
    if (status >= 500) logger.error(`Error handling ${req.method} ${req.path}:`, err);
    if (res.headersSent) return;
    fail(res, status, status >= 500 ? 'Internal server error' : err.expose ? err.message : 'Bad request');
  });

  io.use(async (socket, next) => {
    const decoded = await auth.verifyToken(socket.handshake.auth?.token);
    if (!decoded) return next(new Error('Authentication failed'));
    const user = userStore.get(decoded.uid);
    if (!user) return next(new Error('User data not found'));
    const now = Date.now();
    Object.assign(socket.data, {
      uid: user.uid,
      name: user.username,
      connectedAt: now,
      lastActivity: now,
      lobbyCode: null,
      chatCode: null
    });
    next();
  });

  io.on('connection', socket => {
    socket.emit('authInitSuccess', { name: socket.data.name, uid: socket.data.uid });
    registerLobbyHandlers(socket, lobbyManager);
  });

  async function close() {
    await new Promise(resolve => io.close(() => resolve()));
    if (server.listening) await new Promise(resolve => server.close(() => resolve()));
    await userStore.flush();
  }

  return { app, server, io, lobbyManager, activity, close };
}

module.exports = { createApp };

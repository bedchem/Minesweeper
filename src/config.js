'use strict';

const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');

const list = value => String(value ?? '').split(',').map(s => s.trim()).filter(Boolean);

function bool(value, fallback = false) {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function trustProxy(value) {
  if (value === undefined || value === '') return 'loopback, linklocal, uniquelocal';
  if (/^\d+$/.test(value)) return Number(value);
  if (['true', 'false'].includes(value)) return value === 'true';
  return value;
}

function loadConfig(env = process.env) {
  return {
    rootDir: ROOT_DIR,
    publicDir: path.join(ROOT_DIR, 'public'),
    userDataDir: path.resolve(ROOT_DIR, env.USER_DATA_DIR || 'userDATA'),
    profilePicsDir: path.resolve(ROOT_DIR, env.PROFILE_PICS_DIR || 'profile_pics'),
    serviceAccountPath: path.resolve(ROOT_DIR, env.FIREBASE_SERVICE_ACCOUNT || 'firebaseServiceAccount.json'),
    port: Number(env.PORT) || 3000,
    host: env.HOST || '0.0.0.0',
    trustProxy: trustProxy(env.TRUST_PROXY),
    allowedOrigins: list(env.ALLOWED_ORIGINS),
    adminUids: list(env.ADMIN_UIDS),
    recaptchaSecrets: {
      login: env.RECAPTCHA_SECRET_LOGIN || '',
      register: env.RECAPTCHA_SECRET_REGISTER || ''
    },
    csp: {
      reportOnly: bool(env.CSP_REPORT_ONLY),
      extraFrameSrc: list(env.CSP_EXTRA_FRAME_SRC),
      extraConnectSrc: list(env.CSP_EXTRA_CONNECT_SRC)
    },
    game: {
      countdownTickMs: 1000,
      reconnectTimeoutMs: 10_000,
      reconnectPenaltyMs: 5_000,
      lobbyClearMs: 30_000,
      maxLobbies: 1000
    },
    renameCooldownDays: 14
  };
}

module.exports = { loadConfig };

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
    serviceAccount: {
      projectId: env.FIREBASE_PROJECT_ID || '',
      clientEmail: env.FIREBASE_CLIENT_EMAIL || '',
      // accept literal "\n" in case the key was pasted without quotes
      privateKey: (env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n')
    },
    port: Number(env.PORT) || 3000,
    host: env.HOST || '0.0.0.0',
    trustProxy: trustProxy(env.TRUST_PROXY),
    allowedOrigins: list(env.ALLOWED_ORIGINS),
    adminUids: list(env.ADMIN_UIDS),
    // public web config, served as /assets/js/firebase-auth.js
    firebaseWeb: {
      apiKey: env.FIREBASE_API_KEY || '',
      authDomain: env.FIREBASE_AUTH_DOMAIN || '',
      projectId: env.FIREBASE_PROJECT_ID || '',
      storageBucket: env.FIREBASE_STORAGE_BUCKET || '',
      messagingSenderId: env.FIREBASE_MESSAGING_SENDER_ID || '',
      appId: env.FIREBASE_APP_ID || '',
      measurementId: env.FIREBASE_MEASUREMENT_ID || ''
    },
    // reCAPTCHA v2 checkbox, one key for login and register; captcha is off unless both are set
    recaptcha: {
      siteKey: env.RECAPTCHA_SITE_KEY || '',
      secret: env.RECAPTCHA_SECRET_KEY || ''
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

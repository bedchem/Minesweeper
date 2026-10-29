'use strict';

require('dotenv').config({ quiet: true });

const fs = require('node:fs');
const { initializeApp, cert, applicationDefault } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { loadConfig } = require('./src/config');
const { UserStore } = require('./src/userStore');
const { createApp } = require('./src/app');

const config = loadConfig();

function firebaseCredential() {
  if (fs.existsSync(config.serviceAccountPath)) {
    return cert(JSON.parse(fs.readFileSync(config.serviceAccountPath, 'utf8')));
  }
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) return applicationDefault();
  throw new Error(
    `Firebase service account not found at ${config.serviceAccountPath}. ` +
    'Set FIREBASE_SERVICE_ACCOUNT or GOOGLE_APPLICATION_CREDENTIALS.'
  );
}

initializeApp({ credential: firebaseCredential() });
const adminAuth = getAuth();

if (!config.recaptchaSecrets.login || !config.recaptchaSecrets.register) {
  console.warn('reCAPTCHA secrets missing (RECAPTCHA_SECRET_LOGIN / RECAPTCHA_SECRET_REGISTER): captcha checks are skipped.');
}

const userStore = new UserStore(config.userDataDir).load();
fs.mkdirSync(config.profilePicsDir, { recursive: true });

const { server, close } = createApp({
  config,
  userStore,
  firebaseAuth: {
    verifyIdToken: (token, checkRevoked = false) => adminAuth.verifyIdToken(token, checkRevoked),
    createUser: props => adminAuth.createUser(props),
    updateUser: (uid, props) => adminAuth.updateUser(uid, props),
    deleteUser: uid => adminAuth.deleteUser(uid)
  }
});

server.listen(config.port, config.host, () => {
  console.log(`Server running on http://localhost:${config.port} (${userStore.size} users loaded)`);
});

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received, shutting down...`);
  const timer = setTimeout(() => process.exit(1), 10_000);
  timer.unref();
  try {
    await close();
  } finally {
    process.exit(0);
  }
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', err => console.error('Unhandled promise rejection:', err));

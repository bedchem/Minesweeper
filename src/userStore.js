'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { isValidUid } = require('./validation');

const MAX_GAME_HISTORY = 10_000;

class UserStore {
  #dir;
  #logger;
  #users = new Map();
  #byName = new Map();
  #writes = new Map();
  version = 0;

  constructor(dir, { logger = console } = {}) {
    this.#dir = dir;
    this.#logger = logger;
  }

  load() {
    fs.mkdirSync(this.#dir, { recursive: true });
    for (const file of fs.readdirSync(this.#dir)) {
      if (!file.endsWith('.json')) continue;
      const uid = file.slice(0, -'.json'.length);
      try {
        const data = JSON.parse(fs.readFileSync(path.join(this.#dir, file), 'utf8'));
        if (!isValidUid(uid) || data?.uid !== uid || typeof data.username !== 'string') {
          this.#logger.warn(`Skipping invalid user file ${file}`);
          continue;
        }
        if (!Array.isArray(data.gameHistory)) data.gameHistory = [];
        if (!Array.isArray(data.nameHistory)) data.nameHistory = [];
        const key = data.username.toLowerCase();
        if (this.#byName.has(key)) {
          this.#logger.warn(`Duplicate username "${data.username}" (${uid}); keeping ${this.#byName.get(key)}`);
        } else {
          this.#byName.set(key, uid);
        }
        this.#users.set(uid, data);
      } catch (err) {
        this.#logger.warn(`Skipping unreadable user file ${file}: ${err.message}`);
      }
    }
    this.version++;
    return this;
  }

  get size() {
    return this.#users.size;
  }

  get(uid) {
    return this.#users.get(uid) ?? null;
  }

  getByUsername(username) {
    if (typeof username !== 'string') return null;
    const uid = this.#byName.get(username.toLowerCase());
    return uid ? this.get(uid) : null;
  }

  isUsernameTaken(username, exceptUid = null) {
    const user = this.getByUsername(username);
    return Boolean(user && user.uid !== exceptUid);
  }

  all() {
    return this.#users.values();
  }

  async create({ uid, username, email = null, role = 'user' }) {
    if (!isValidUid(uid)) throw new Error('Invalid uid');
    if (this.#users.has(uid)) throw new Error('User already exists');
    if (this.isUsernameTaken(username)) throw new Error('Username taken');
    const user = {
      uid,
      username,
      email,
      role,
      createdAt: new Date().toISOString(),
      nameHistory: [],
      gameHistory: []
    };
    this.#users.set(uid, user);
    this.#byName.set(username.toLowerCase(), uid);
    await this.#persist(uid);
    return user;
  }

  async update(uid, mutate) {
    const user = this.#users.get(uid);
    if (!user) throw new Error('User not found');
    const oldName = user.username;
    mutate(user);
    if (user.username !== oldName) {
      if (this.isUsernameTaken(user.username, uid)) {
        user.username = oldName;
        throw new Error('Username taken');
      }
      if (this.#byName.get(oldName.toLowerCase()) === uid) this.#byName.delete(oldName.toLowerCase());
      this.#byName.set(user.username.toLowerCase(), uid);
    }
    await this.#persist(uid);
    return user;
  }

  async addGameResult(uid, result) {
    if (!this.#users.has(uid)) return false;
    await this.update(uid, user => {
      user.gameHistory.push(result);
      if (user.gameHistory.length > MAX_GAME_HISTORY) user.gameHistory.splice(0, user.gameHistory.length - MAX_GAME_HISTORY);
    });
    return true;
  }

  async delete(uid) {
    const user = this.#users.get(uid);
    if (!user) return false;
    this.#users.delete(uid);
    if (this.#byName.get(user.username.toLowerCase()) === uid) this.#byName.delete(user.username.toLowerCase());
    await this.#persist(uid);
    return true;
  }

  async flush() {
    await Promise.allSettled([...this.#writes.values()]);
  }

  #persist(uid) {
    this.version++;
    const file = path.join(this.#dir, `${uid}.json`);
    const previous = this.#writes.get(uid) ?? Promise.resolve();
    const next = previous
      .catch(() => {})
      .then(async () => {
        const user = this.#users.get(uid);
        if (!user) {
          await fsp.rm(file, { force: true });
          return;
        }
        const tmp = `${file}.${process.pid}.tmp`;
        await fsp.writeFile(tmp, JSON.stringify(user, null, 2), 'utf8');
        await fsp.rename(tmp, file);
      });
    this.#writes.set(uid, next);
    next
      .catch(err => this.#logger.error(`Failed to persist user ${uid}:`, err))
      .finally(() => {
        if (this.#writes.get(uid) === next) this.#writes.delete(uid);
      });
    return next;
  }
}

module.exports = { UserStore };

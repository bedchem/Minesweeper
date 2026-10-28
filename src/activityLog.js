'use strict';

class ActivityLog {
  #entries = [];
  #limit;

  constructor(limit = 100) {
    this.#limit = limit;
  }

  add(user, action) {
    this.#entries.push({ time: new Date().toISOString(), user: user || 'system', action });
    if (this.#entries.length > this.#limit) this.#entries.shift();
  }

  recent(count = 25) {
    return this.#entries.slice(-count).reverse();
  }
}

class RateLimiter {
  #tokens;
  #updated;

  constructor(capacity, perMs) {
    this.capacity = capacity;
    this.perMs = perMs;
    this.#tokens = capacity;
    this.#updated = Date.now();
  }

  allow() {
    const now = Date.now();
    this.#tokens = Math.min(this.capacity, this.#tokens + ((now - this.#updated) / this.perMs) * this.capacity);
    this.#updated = now;
    if (this.#tokens < 1) return false;
    this.#tokens -= 1;
    return true;
  }
}

module.exports = { ActivityLog, RateLimiter };

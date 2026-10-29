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

  get idleMs() {
    return Date.now() - this.#updated;
  }
}

// One bucket per key (e.g. per account), so opening more connections doesn't buy a fresh budget.
class KeyedRateLimiter {
  #buckets = new Map();

  constructor(capacity, perMs, { sweepAt = 1000 } = {}) {
    this.capacity = capacity;
    this.perMs = perMs;
    this.sweepAt = sweepAt;
  }

  allow(key) {
    if (this.#buckets.size >= this.sweepAt) {
      // a bucket idle for perMs is full again, dropping it changes nothing
      for (const [k, bucket] of this.#buckets) if (bucket.idleMs >= this.perMs) this.#buckets.delete(k);
    }
    let bucket = this.#buckets.get(key);
    if (!bucket) this.#buckets.set(key, bucket = new RateLimiter(this.capacity, this.perMs));
    return bucket.allow();
  }
}

module.exports = { ActivityLog, KeyedRateLimiter, RateLimiter };

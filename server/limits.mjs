// Rate limits and the run queue for the "Run it live" server. Pure logic, no I/O, so it is unit tested offline.

/** Sliding-window counter: at most `max` hits per `windowMs` per key. */
export class WindowLimiter {
  constructor({ max, windowMs, now = () => Date.now() }) {
    this.max = max; this.windowMs = windowMs; this.now = now; this.hits = new Map();
  }
  _fresh(key) {
    const cutoff = this.now() - this.windowMs;
    const list = (this.hits.get(key) ?? []).filter((t) => t > cutoff);
    if (list.length) this.hits.set(key, list); else this.hits.delete(key);
    return list;
  }
  remaining(key = '*') { return Math.max(0, this.max - this._fresh(key).length); }
  /** Seconds until one more hit is allowed (0 if allowed now). */
  retryAfterSec(key = '*') {
    const list = this._fresh(key);
    if (list.length < this.max) return 0;
    return Math.max(1, Math.ceil((list[0] + this.windowMs - this.now()) / 1000));
  }
  take(key = '*') {
    if (this.retryAfterSec(key) > 0) return false;
    this._fresh(key).length; // prune
    this.hits.set(key, [...(this.hits.get(key) ?? []), this.now()]);
    return true;
  }
}

/** Runs one job at a time, holds at most `maxQueued` waiting jobs. */
export class RunQueue {
  constructor({ maxQueued = 3, timeoutMs = 300_000 } = {}) {
    this.maxQueued = maxQueued; this.timeoutMs = timeoutMs; this.waiting = []; this.active = null;
  }
  get size() { return this.waiting.length + (this.active ? 1 : 0); }
  position(id) {
    if (this.active?.id === id) return 0;
    const i = this.waiting.findIndex((j) => j.id === id);
    return i < 0 ? -1 : i + 1;
  }
  /** Returns false if the queue is full. `fn` gets an AbortSignal that fires on timeout. */
  push(id, fn, onDone = () => {}) {
    if (this.waiting.length >= this.maxQueued) return false;
    this.waiting.push({ id, fn, onDone });
    this._next();
    return true;
  }
  async _next() {
    if (this.active || !this.waiting.length) return;
    const job = (this.active = this.waiting.shift());
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(new Error(`run timed out after ${Math.round(this.timeoutMs / 1000)} s`)), this.timeoutMs);
    let result, error;
    try {
      result = await Promise.race([
        job.fn(ac.signal),
        new Promise((_, rej) => ac.signal.addEventListener('abort', () => rej(ac.signal.reason), { once: true })),
      ]);
    } catch (e) { error = e; }
    clearTimeout(timer);
    this.active = null;
    try { job.onDone(error, result); } catch { /* ignore */ }
    this._next();
  }
}

/** Client IP. Only trusts X-Forwarded-For when the operator says a proxy sits in front. */
export function clientIp(req, trustProxy = false) {
  if (trustProxy) {
    const fwd = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim();
    if (fwd) return fwd;
  }
  return req.socket?.remoteAddress ?? 'unknown';
}

/**
 * StreamManager — the transport-agnostic engine behind MCP-native streaming.
 *
 * It owns a set of subscriptions. Each subscription polls a `fetcher()` on an
 * interval, dedups identical consecutive snapshots, stores the latest value,
 * and invokes `onUpdate(subscription)` when the value changes. It knows nothing
 * about MCP or CDP — the tool layer wires a fetcher (CDP) and an onUpdate (MCP
 * resource-update notification) in. Timers are injectable so it is fully
 * unit-testable without real time or a live chart.
 */
export class StreamManager {
  constructor({ onUpdate, setInterval: setIntervalFn, clearInterval: clearIntervalFn } = {}) {
    this.onUpdate = onUpdate || (() => {});
    this._setInterval = setIntervalFn || globalThis.setInterval;
    this._clearInterval = clearIntervalFn || globalThis.clearInterval;
    this._subs = new Map();
    this._seq = 0;
  }

  /**
   * Start a subscription.
   * @param {object} o
   * @param {string} o.channel   logical channel name (quote/bars/lines/…)
   * @param {function} o.fetcher async () => snapshot|null
   * @param {number} [o.interval] poll interval ms
   * @param {boolean} [o.dedupe]  suppress identical consecutive snapshots (default true)
   * @returns {object} the subscription record
   */
  subscribe({ channel, fetcher, interval = 500, dedupe = true }) {
    if (typeof fetcher !== 'function') throw new Error('subscribe requires a fetcher function');
    const id = `${channel}#${++this._seq}`;
    const sub = {
      id, channel, interval, dedupe,
      last: null, lastHash: null,
      updates: 0, errors: 0, lastError: null,
      started: Date.now(),
    };

    const tick = async () => {
      try {
        const data = await fetcher();
        if (data == null) return;
        const hash = dedupe ? JSON.stringify(data) : null;
        if (dedupe && hash === sub.lastHash) return; // unchanged — skip
        sub.lastHash = hash;
        sub.last = data;
        sub.updates++;
        try { await this.onUpdate(sub); } catch { /* notification failures must not kill the loop */ }
      } catch (err) {
        sub.errors++;
        sub.lastError = err?.message || String(err);
      }
    };

    sub._tick = tick; // exposed so tests can drive a tick deterministically
    sub._timer = this._setInterval(() => { tick(); }, interval);
    this._subs.set(id, sub);
    return sub;
  }

  unsubscribe(id) {
    const sub = this._subs.get(id);
    if (!sub) return false;
    this._clearInterval(sub._timer);
    this._subs.delete(id);
    return true;
  }

  unsubscribeAll() {
    for (const id of [...this._subs.keys()]) this.unsubscribe(id);
  }

  get(id) {
    return this._subs.get(id) || null;
  }

  /** Public, serializable view of a subscription. */
  describe(sub) {
    return {
      id: sub.id, channel: sub.channel, interval: sub.interval,
      updates: sub.updates, errors: sub.errors, last_error: sub.lastError,
      age_ms: Date.now() - sub.started,
    };
  }

  list() {
    return [...this._subs.values()].map(s => this.describe(s));
  }
}

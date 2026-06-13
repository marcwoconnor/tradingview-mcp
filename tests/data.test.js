/**
 * Unit tests for data.js parsing/classification, the connection reconnect
 * helper, and the ui_evaluate gate. All use mocked evaluate (no live chart).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  getOhlcv, getPineLines, getPineLabels, getPineTables, getPineBoxes,
  getDepth, getQuote, classifyDepthRows, computeOhlcvIntegrity, computeBacktestMetrics,
} from '../src/core/data.js';
import { config } from '../src/config.js';
import { isConnectionError } from '../src/connection.js';
import { uiEvaluate } from '../src/core/ui.js';
import { waitFor } from '../src/wait.js';
import { diagnose } from '../src/core/health.js';
import { wrap } from '../src/tools/_format.js';
import { appError, ErrorKind } from '../src/errors.js';

// evaluate mock that always returns the same canned payload
const evalReturning = (payload) => ({ _deps: { evaluate: async () => payload } });

// ── getOhlcv summary math ────────────────────────────────────────────────

describe('getOhlcv(summary)', () => {
  it('computes high/low/change/change_pct/avg_volume', async () => {
    const bars = [
      { time: 1, open: 100, high: 110, low: 95, close: 105, volume: 10 },
      { time: 2, open: 105, high: 120, low: 100, close: 118, volume: 20 },
    ];
    const r = await getOhlcv({ summary: true, ...evalReturning({ bars, total_bars: 2, source: 'direct_bars' }) });
    assert.equal(r.high, 120);
    assert.equal(r.low, 95);
    assert.equal(r.open, 100);
    assert.equal(r.close, 118);
    assert.equal(r.change, 18);
    assert.equal(r.change_pct, '18%');
    assert.equal(r.avg_volume, 15);
  });

  it('returns null change_pct when the first open is 0 (no Infinity%)', async () => {
    const bars = [{ time: 1, open: 0, high: 5, low: 0, close: 3, volume: 1 }];
    const r = await getOhlcv({ summary: true, ...evalReturning({ bars, total_bars: 1, source: 'direct_bars' }) });
    assert.equal(r.change_pct, null);
  });

  it('throws when no bars are returned', async () => {
    await assert.rejects(() => getOhlcv({ summary: true, ...evalReturning({ bars: [], total_bars: 0 }) }), /Could not extract OHLCV/);
  });
});

// ── OHLCV integrity flags ────────────────────────────────────────────────

describe('computeOhlcvIntegrity', () => {
  it('flags the last bar as forming when within its interval', () => {
    const now = 1_700_000_000;
    const bars = [{ time: now - 300 }, { time: now - 60 }]; // last bar 60s old, 5m interval
    const r = computeOhlcvIntegrity(bars, '5', now);
    assert.equal(r.expected_interval_seconds, 300);
    assert.equal(r.last_bar_age_seconds, 60);
    assert.equal(r.forming, true);
    assert.equal(r.gaps, 0);
  });

  it('not forming once the interval has elapsed', () => {
    const now = 1_700_000_000;
    const bars = [{ time: now - 600 }, { time: now - 400 }]; // 400s old > 300s interval
    const r = computeOhlcvIntegrity(bars, '5', now);
    assert.equal(r.forming, false);
  });

  it('counts gaps larger than 1.5x the interval', () => {
    const now = 1_700_000_000;
    const bars = [{ time: 0 }, { time: 300 }, { time: 1200 }]; // 900s gap with 300s interval
    const r = computeOhlcvIntegrity(bars, '5', now);
    assert.equal(r.gaps, 1);
  });

  it('resolves daily interval', () => {
    assert.equal(computeOhlcvIntegrity([{ time: 0 }, { time: 86400 }], 'D', 86400).expected_interval_seconds, 86400);
  });
});

// ── Backtest metrics ─────────────────────────────────────────────────────

describe('computeBacktestMetrics', () => {
  it('computes drawdown, return, and Sharpe from an equity curve', () => {
    const equity = [{ equity: 100 }, { equity: 110 }, { equity: 90 }, { equity: 120 }];
    const m = computeBacktestMetrics({ equity, trades: [] });
    assert.equal(m.equity_points, 4);
    assert.equal(m.total_return_pct, 20);     // 100 → 120
    assert.equal(m.max_drawdown, 20);         // peak 110 → trough 90
    assert.ok(m.max_drawdown_pct > 18 && m.max_drawdown_pct < 19); // 20/110
    assert.equal(typeof m.sharpe_per_period, 'number');
  });

  it('computes win rate and profit factor from trades', () => {
    const trades = [{ profit: 10 }, { profit: -5 }, { profit: 20 }, { profit: -5 }];
    const m = computeBacktestMetrics({ equity: [], trades });
    assert.equal(m.trade_count, 4);
    assert.equal(m.wins, 2);
    assert.equal(m.losses, 2);
    assert.equal(m.win_rate_pct, 50);
    assert.equal(m.gross_profit, 30);
    assert.equal(m.gross_loss, 10);
    assert.equal(m.profit_factor, 3);
    assert.equal(m.net_profit, 20);
  });

  it('notes when trades lack a recognizable profit field', () => {
    const m = computeBacktestMetrics({ equity: [], trades: [{ id: 1 }, { id: 2 }] });
    assert.equal(m.trade_count, 2);
    assert.match(m.note, /no recognizable numeric profit/i);
  });

  it('accepts numeric equity points too', () => {
    const m = computeBacktestMetrics({ equity: [100, 90, 95], trades: [] });
    assert.equal(m.max_drawdown, 10);
  });
});

// ── config ───────────────────────────────────────────────────────────────

describe('config', () => {
  it('exposes CDP + timeout defaults', () => {
    assert.equal(config.cdpHost, 'localhost');
    assert.equal(config.cdpPort, 9222);
    assert.equal(config.evalTimeoutMs, 30000);
    assert.equal(config.fetchTimeoutMs, 15000);
  });
});

// ── Pine graphics parsing ────────────────────────────────────────────────

describe('getPineLines', () => {
  it('keeps only horizontal lines, dedups by rounded price, sorts high→low', async () => {
    const raw = [{
      name: 'Levels', count: 4, items: [
        { id: 'a', raw: { y1: 100, y2: 100 } },
        { id: 'b', raw: { y1: 100.004, y2: 100.004 } }, // rounds to 100 → dup
        { id: 'c', raw: { y1: 50, y2: 50 } },
        { id: 'd', raw: { y1: 60, y2: 70 } },            // not horizontal → excluded
      ],
    }];
    const r = await getPineLines(evalReturning(raw));
    assert.equal(r.studies[0].name, 'Levels');
    assert.equal(r.studies[0].total_lines, 4);
    assert.deepEqual(r.studies[0].horizontal_levels, [100, 50]);
  });

  it('returns empty when no studies match', async () => {
    const r = await getPineLines(evalReturning([]));
    assert.equal(r.study_count, 0);
  });
});

describe('getPineLabels', () => {
  it('extracts text/price and caps to the most recent max_labels', async () => {
    const items = [];
    for (let i = 0; i < 5; i++) items.push({ id: String(i), raw: { t: 'L' + i, y: i } });
    const raw = [{ name: 'Tags', count: 5, items }];
    const r = await getPineLabels({ max_labels: 2, ...evalReturning(raw) });
    assert.equal(r.studies[0].total_labels, 5);
    assert.equal(r.studies[0].showing, 2);
    assert.deepEqual(r.studies[0].labels.map(l => l.text), ['L3', 'L4']); // last 2
  });
});

describe('getPineTables', () => {
  it('formats cells into row strings by row/col order', async () => {
    const raw = [{
      name: 'Stats', count: 4, items: [
        { id: '1', raw: { tid: 0, row: 0, col: 0, t: 'A' } },
        { id: '2', raw: { tid: 0, row: 0, col: 1, t: 'B' } },
        { id: '3', raw: { tid: 0, row: 1, col: 0, t: 'C' } },
        { id: '4', raw: { tid: 0, row: 1, col: 1, t: 'D' } },
      ],
    }];
    const r = await getPineTables(evalReturning(raw));
    assert.deepEqual(r.studies[0].tables[0].rows, ['A | B', 'C | D']);
  });
});

describe('getPineBoxes', () => {
  it('dedups zones and sorts by high descending', async () => {
    const raw = [{
      name: 'Zones', count: 3, items: [
        { id: '1', raw: { y1: 100, y2: 90 } },
        { id: '2', raw: { y1: 90, y2: 100 } }, // same {high:100,low:90} → dup
        { id: '3', raw: { y1: 50, y2: 40 } },
      ],
    }];
    const r = await getPineBoxes(evalReturning(raw));
    assert.deepEqual(r.studies[0].zones, [{ high: 100, low: 90 }, { high: 50, low: 40 }]);
  });
});

// ── Order book classification (the inverted-book bug) ────────────────────

describe('classifyDepthRows', () => {
  it('splits by explicit side, sorts, computes spread', () => {
    const { bids, asks, unclassified, spread } = classifyDepthRows([
      { price: 100, size: 5, side: 'bid' },
      { price: 101, size: 3, side: 'ask' },
      { price: 99, size: 2, side: 'bid' },
      { price: 102, size: 1, side: 'ask' },
    ]);
    assert.deepEqual(bids.map(b => b.price), [100, 99]);
    assert.deepEqual(asks.map(a => a.price), [101, 102]);
    assert.equal(unclassified.length, 0);
    assert.equal(spread, 1);
  });

  it('never guesses a side — unknown rows go to unclassified (no inverted book)', () => {
    const { bids, asks, unclassified, spread } = classifyDepthRows([
      { price: 100, size: 5, side: 'unknown' },
      { price: 101, size: 3, side: 'unknown' },
    ]);
    assert.equal(bids.length, 0);
    assert.equal(asks.length, 0);
    assert.equal(unclassified.length, 2);
    assert.equal(spread, null);
  });
});

describe('getDepth', () => {
  it('surfaces unclassified rows with a note instead of guessing', async () => {
    const r = await getDepth(evalReturning({ found: true, rows: [
      { price: 100, size: 1, side: 'unknown' },
      { price: 101, size: 1, side: 'unknown' },
    ] }));
    assert.equal(r.bid_levels, 0);
    assert.equal(r.ask_levels, 0);
    assert.equal(r.unclassified.length, 2);
    assert.match(r.note, /could not be|invert|unclassified/i);
  });

  it('classifies when the page supplies sides', async () => {
    const r = await getDepth(evalReturning({ found: true, rows: [
      { price: 100, size: 1, side: 'bid' },
      { price: 101, size: 1, side: 'ask' },
    ] }));
    assert.equal(r.bid_levels, 1);
    assert.equal(r.ask_levels, 1);
    assert.equal(r.spread, 1);
  });
});

// ── getQuote bid/ask sanity ──────────────────────────────────────────────

describe('getQuote', () => {
  it('drops a crossed (ask < bid) scraped quote as unreliable', async () => {
    const r = await getQuote(evalReturning({ symbol: 'X', last: 105, close: 105, bid: 101, ask: 100 }));
    assert.equal(r.bid, undefined);
    assert.equal(r.ask, undefined);
    assert.match(r.bid_ask_note, /inconsistent|unreliable/i);
  });

  it('keeps a sane scraped quote but marks it best-effort', async () => {
    const r = await getQuote(evalReturning({ symbol: 'X', last: 105, close: 105, bid: 100, ask: 101 }));
    assert.equal(r.bid, 100);
    assert.equal(r.ask, 101);
    assert.match(r.bid_ask_note, /best-effort/i);
  });
});

// ── connection reconnect helper ──────────────────────────────────────────

describe('isConnectionError', () => {
  it('matches dropped-connection messages', () => {
    for (const m of ['Target closed', 'WebSocket is not open', 'Inspected target navigated', 'Session with given id not found']) {
      assert.equal(isConnectionError(new Error(m)), true, m);
    }
  });

  it('does not match script errors or timeouts', () => {
    assert.equal(isConnectionError(new Error('JS evaluation error: foo is not defined')), false);
    assert.equal(isConnectionError(new Error('CDP evaluate timed out after 30000ms')), false);
  });
});

// ── ui_evaluate gate ─────────────────────────────────────────────────────

describe('ui_evaluate gate', () => {
  it('is disabled unless TV_MCP_ALLOW_EVAL is set', async () => {
    const prev = process.env.TV_MCP_ALLOW_EVAL;
    delete process.env.TV_MCP_ALLOW_EVAL;
    try {
      await assert.rejects(() => uiEvaluate({ expression: '1' }), /disabled/);
    } finally {
      if (prev !== undefined) process.env.TV_MCP_ALLOW_EVAL = prev;
    }
  });

  it('runs when explicitly enabled', async () => {
    const prev = process.env.TV_MCP_ALLOW_EVAL;
    process.env.TV_MCP_ALLOW_EVAL = '1';
    try {
      const r = await uiEvaluate({ expression: '6*7', _deps: { evaluate: async () => 42 } });
      assert.equal(r.success, true);
      assert.equal(r.result, 42);
    } finally {
      if (prev === undefined) delete process.env.TV_MCP_ALLOW_EVAL;
      else process.env.TV_MCP_ALLOW_EVAL = prev;
    }
  });
});

// ── waitFor primitive ────────────────────────────────────────────────────

describe('waitFor', () => {
  it('returns true as soon as the predicate is truthy', async () => {
    let calls = 0;
    const evaluate = async () => { calls++; return calls >= 3; }; // truthy on 3rd poll
    const ok = await waitFor('cond', { timeout: 1000, interval: 1, deps: { evaluate, sleep: async () => {} } });
    assert.equal(ok, true);
    assert.equal(calls, 3);
  });

  it('returns false on timeout', async () => {
    const ok = await waitFor('cond', { timeout: 5, interval: 1, deps: { evaluate: async () => false, sleep: async () => {} } });
    assert.equal(ok, false);
  });

  it('treats an evaluate throw as not-ready (does not reject)', async () => {
    let n = 0;
    const evaluate = async () => { n++; if (n < 2) throw new Error('transient'); return true; };
    const ok = await waitFor('cond', { timeout: 1000, interval: 1, deps: { evaluate, sleep: async () => {} } });
    assert.equal(ok, true);
  });
});

// ── tv_diagnose drift detector ───────────────────────────────────────────

describe('diagnose', () => {
  it('reports healthy when everything is present', async () => {
    const report = {
      api: { chartApi: true, chartWidget: true, mainSeriesBars: true, dataSources: true, chartWidgetCollection: true, replayApi: true, alertService: true, bottomWidgetBar: true },
      selectors_core: { symbol_legend: true, chart_canvas: true, chart_container: true },
      selectors_optional: { dom_panel: false },
    };
    const r = await diagnose({ _deps: { evaluate: async () => report } });
    assert.equal(r.healthy, true);
    assert.deepEqual(r.missing_apis, []);
    assert.equal(r.hint, undefined);
  });

  it('flags missing paths/selectors with a hint', async () => {
    const report = {
      api: { chartApi: false, chartWidget: true, mainSeriesBars: true },
      selectors_core: { symbol_legend: false, chart_canvas: true },
      selectors_optional: {},
    };
    const r = await diagnose({ _deps: { evaluate: async () => report } });
    assert.equal(r.healthy, false);
    assert.deepEqual(r.missing_apis, ['chartApi']);
    assert.deepEqual(r.missing_core_selectors, ['symbol_legend']);
    assert.match(r.hint, /TradingView may have updated/);
  });
});

// ── error taxonomy surfaced through wrap() ───────────────────────────────

describe('wrap() surfaces AppError kind + hint', () => {
  it('includes error_kind and hint from a thrown AppError', async () => {
    const handler = wrap(async () => { throw appError(ErrorKind.NOT_FOUND, 'nope', { hint: 'open it' }); });
    const res = await handler({});
    const parsed = JSON.parse(res.content[0].text);
    assert.equal(parsed.success, false);
    assert.equal(parsed.error_kind, 'not_found');
    assert.equal(parsed.hint, 'open it');
    assert.equal(res.isError, true);
  });

  it('plain errors have no error_kind', async () => {
    const handler = wrap(async () => { throw new Error('boom'); });
    const parsed = JSON.parse((await handler({})).content[0].text);
    assert.equal(parsed.error, 'boom');
    assert.equal(parsed.error_kind, undefined);
  });
});

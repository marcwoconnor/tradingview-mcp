/**
 * Unit tests for data.js parsing/classification, the connection reconnect
 * helper, and the ui_evaluate gate. All use mocked evaluate (no live chart).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  getOhlcv, getPineLines, getPineLabels, getPineTables, getPineBoxes,
  getDepth, getQuote, classifyDepthRows,
} from '../src/core/data.js';
import { isConnectionError } from '../src/connection.js';
import { uiEvaluate } from '../src/core/ui.js';

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

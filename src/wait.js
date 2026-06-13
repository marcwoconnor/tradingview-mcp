import { evaluate, sleep, KNOWN_PATHS } from './connection.js';

const DEFAULT_TIMEOUT = 10000;
const POLL_INTERVAL = 200;

/**
 * Normalize a TradingView resolution for comparison. TradingView's
 * resolution() returns "1D"/"1W"/"1M" for daily/weekly/monthly, while callers
 * often pass "D"/"W"/"M"; intraday is the minute count either way ("15", "60").
 */
export function normalizeResolution(res) {
  return String(res || '').toUpperCase().trim().replace(/^1(?=[DWM]$)/, '');
}

/**
 * Poll a page-side predicate until it is truthy or the timeout elapses, instead
 * of blindly sleeping a fixed duration. `predicateExpr` is a JS expression
 * evaluated in the TradingView page; it should become truthy when the action
 * has completed. Returns true if it became truthy, false on timeout.
 *
 * `deps` (evaluate/sleep) are injectable for testing.
 */
export async function waitFor(predicateExpr, { timeout = DEFAULT_TIMEOUT, interval = POLL_INTERVAL, deps } = {}) {
  const evalFn = deps?.evaluate || evaluate;
  const sleepFn = deps?.sleep || sleep;
  const start = Date.now();
  while (Date.now() - start < timeout) {
    let ok;
    try { ok = !!(await evalFn(`!!(${predicateExpr})`)); } catch { ok = false; }
    if (ok) return true;
    await sleepFn(interval);
  }
  return false;
}

export async function waitForChartReady(expectedSymbol = null, expectedTf = null, timeout = DEFAULT_TIMEOUT) {
  const start = Date.now();
  let lastBarCount = -1;
  let stableCount = 0;

  while (Date.now() - start < timeout) {
    const state = await evaluate(`
      (function() {
        // Check for loading spinner
        var spinner = document.querySelector('[class*="loader"]')
          || document.querySelector('[class*="loading"]')
          || document.querySelector('[data-name="loading"]');
        var isLoading = spinner && spinner.offsetParent !== null;

        // Try to get bar count from data window or chart
        var barCount = -1;
        try {
          var bars = document.querySelectorAll('[class*="bar"]');
          barCount = bars.length;
        } catch {}

        // Get current symbol from header
        var symbolEl = document.querySelector('[data-name="legend-source-title"]')
          || document.querySelector('[class*="title"] [class*="apply-common-tooltip"]');
        var currentSymbol = symbolEl ? symbolEl.textContent.trim() : '';

        // Read the chart's current resolution from the API
        var resolution = '';
        try { resolution = String(${KNOWN_PATHS.chartApi}.resolution() || ''); } catch (e) {}

        return { isLoading: !!isLoading, barCount: barCount, currentSymbol: currentSymbol, resolution: resolution };
      })()
    `);

    if (!state) {
      await sleep(POLL_INTERVAL);
      continue;
    }

    // Not ready if still loading
    if (state.isLoading) {
      stableCount = 0;
      await sleep(POLL_INTERVAL);
      continue;
    }

    // Check symbol match if expected
    if (expectedSymbol && state.currentSymbol && !state.currentSymbol.toUpperCase().includes(expectedSymbol.toUpperCase())) {
      stableCount = 0;
      await sleep(POLL_INTERVAL);
      continue;
    }

    // Check resolution match if expected (the chart hasn't switched timeframe yet)
    if (expectedTf && state.resolution && normalizeResolution(state.resolution) !== normalizeResolution(expectedTf)) {
      stableCount = 0;
      await sleep(POLL_INTERVAL);
      continue;
    }

    // Check bar count stability
    if (state.barCount === lastBarCount && state.barCount > 0) {
      stableCount++;
    } else {
      stableCount = 0;
    }
    lastBarCount = state.barCount;

    if (stableCount >= 2) {
      return true;
    }

    await sleep(POLL_INTERVAL);
  }

  // Timed out before the chart stabilized — caller should verify state.
  return false;
}

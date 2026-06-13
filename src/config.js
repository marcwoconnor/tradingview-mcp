/**
 * Runtime configuration, read from environment variables with sensible
 * defaults. Set these before launching the MCP server or `tv` CLI.
 *
 *   TV_CDP_HOST           CDP host (default: localhost)
 *   TV_CDP_PORT           CDP port (default: 9222)
 *   TV_EVAL_TIMEOUT_MS    per-evaluate timeout (default: 30000)
 *   TV_FETCH_TIMEOUT_MS   per-fetch timeout (default: 15000)
 *   TV_SCREENSHOT_DIR     where screenshots are written (default: <repo>/screenshots)
 *   TV_MCP_ALLOW_EVAL     set to enable the ui_evaluate arbitrary-eval tool
 */
function positiveNum(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export const config = {
  cdpHost: process.env.TV_CDP_HOST || 'localhost',
  cdpPort: positiveNum(process.env.TV_CDP_PORT, 9222),
  evalTimeoutMs: positiveNum(process.env.TV_EVAL_TIMEOUT_MS, 30000),
  fetchTimeoutMs: positiveNum(process.env.TV_FETCH_TIMEOUT_MS, 15000),
  screenshotDir: process.env.TV_SCREENSHOT_DIR || null,
};

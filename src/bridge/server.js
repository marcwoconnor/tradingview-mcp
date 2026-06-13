#!/usr/bin/env node
/**
 * tv-bridge — exposes the TradingView MCP tools over authenticated HTTP so a
 * remote client (e.g. the ChartMind Android app) can drive your TradingView
 * Desktop chart from anywhere on your network / VPN.
 *
 * Endpoints (all JSON unless noted):
 *   GET  /health              → liveness + tool count            (no auth)
 *   GET  /tools               → Anthropic-format tool schemas     (auth)
 *   POST /call                → { name, arguments } → tool result (auth)
 *   GET  /file?path=<abs>     → serve a screenshot PNG by path    (auth)
 *
 * Auth: send `Authorization: Bearer <TV_BRIDGE_TOKEN>` on every request except
 * /health. If TV_BRIDGE_TOKEN is not set, a random token is generated and
 * printed at startup.
 *
 * Config (env):
 *   TV_BRIDGE_PORT   listen port           (default 9333)
 *   TV_BRIDGE_HOST   bind address          (default 0.0.0.0 — reachable on LAN/VPN)
 *   TV_BRIDGE_TOKEN  shared bearer token   (default: generated + printed)
 *   TV_SCREENSHOT_DIR  screenshot directory served by /file
 *   (plus all the standard TV_CDP_* / TV_*_TIMEOUT_MS vars from config.js)
 */
import { createServer } from 'http';
import { randomBytes, timingSafeEqual } from 'crypto';
import { readFile, stat } from 'fs/promises';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { collectTools, runTool } from './collect.js';
import { config } from '../config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = dirname(dirname(__dirname));
const DEFAULT_SCREENSHOT_DIR = resolve(config.screenshotDir || join(REPO_ROOT, 'screenshots'));
const MAX_BODY = 2 * 1024 * 1024; // 2 MB

const VERSION = '1.0.0';

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error('request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolveBody(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/**
 * Build the bridge HTTP server. Exported so tests can drive it without
 * binding the default port or relying on environment variables.
 */
export function createBridgeServer({
  token,
  screenshotDir = DEFAULT_SCREENSHOT_DIR,
  tools = collectTools(),
} = {}) {
  if (!token) throw new Error('createBridgeServer requires a token');
  const screenshotRoot = resolve(screenshotDir);
  const toolsByName = new Map(tools.map((t) => [t.name, t]));
  const publicTools = tools.map(({ name, description, input_schema }) => ({
    name,
    description,
    input_schema,
  }));

  function authorized(req) {
    const header = req.headers['authorization'] || '';
    const presented = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!presented) return false;
    const a = Buffer.from(presented);
    const b = Buffer.from(token);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  async function handle(req, res) {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const path = url.pathname;

    if (req.method === 'OPTIONS') {
      sendJson(res, 204, {});
      return;
    }

    // Liveness — intentionally unauthenticated so health checks/monitors work.
    if (path === '/health' && req.method === 'GET') {
      sendJson(res, 200, { ok: true, name: 'tv-bridge', version: VERSION, tools: tools.length });
      return;
    }

    // Everything below requires the bearer token.
    if (!authorized(req)) {
      sendJson(res, 401, { ok: false, error: 'unauthorized' });
      return;
    }

    if (path === '/tools' && req.method === 'GET') {
      sendJson(res, 200, { tools: publicTools });
      return;
    }

    if (path === '/call' && req.method === 'POST') {
      let payload;
      try {
        payload = JSON.parse((await readBody(req)) || '{}');
      } catch {
        sendJson(res, 400, { ok: false, error: 'invalid JSON body' });
        return;
      }
      const { name, arguments: args } = payload;
      const tool = toolsByName.get(name);
      if (!tool) {
        sendJson(res, 404, { ok: false, error: `unknown tool: ${name}` });
        return;
      }
      try {
        const { result, isError } = await runTool(tool, args || {});
        sendJson(res, 200, { ok: !isError, name, result, is_error: isError });
      } catch (err) {
        sendJson(res, 200, {
          ok: false,
          name,
          is_error: true,
          result: { success: false, error: err.message },
        });
      }
      return;
    }

    if (path === '/file' && req.method === 'GET') {
      const requested = url.searchParams.get('path');
      if (!requested) {
        sendJson(res, 400, { ok: false, error: 'missing path parameter' });
        return;
      }
      // Path-traversal guard: only serve files inside the screenshot directory.
      const target = resolve(requested);
      if (target !== screenshotRoot && !target.startsWith(screenshotRoot + '/')) {
        sendJson(res, 403, { ok: false, error: 'path outside screenshot directory' });
        return;
      }
      try {
        const info = await stat(target);
        if (!info.isFile()) throw new Error('not a file');
        const data = await readFile(target);
        const lower = target.toLowerCase();
        const type = lower.endsWith('.png')
          ? 'image/png'
          : lower.endsWith('.jpg') || lower.endsWith('.jpeg')
            ? 'image/jpeg'
            : 'application/octet-stream';
        res.writeHead(200, {
          'content-type': type,
          'content-length': info.size,
          'access-control-allow-origin': '*',
        });
        res.end(data);
      } catch {
        sendJson(res, 404, { ok: false, error: 'file not found' });
      }
      return;
    }

    sendJson(res, 404, { ok: false, error: 'not found' });
  }

  return createServer((req, res) => {
    handle(req, res).catch((err) => {
      if (!res.headersSent) sendJson(res, 500, { ok: false, error: err.message });
    });
  });
}

/** Start the server from environment configuration (used by the `tv-bridge` bin). */
function main() {
  const port = Number(process.env.TV_BRIDGE_PORT) || 9333;
  const host = process.env.TV_BRIDGE_HOST || '0.0.0.0';
  const token = process.env.TV_BRIDGE_TOKEN || randomBytes(24).toString('hex');
  const tokenGenerated = !process.env.TV_BRIDGE_TOKEN;
  const tools = collectTools();

  const server = createBridgeServer({ token, tools });
  server.listen(port, host, () => {
    process.stderr.write(`\n  tv-bridge listening on http://${host}:${port}  (${tools.length} tools)\n`);
    if (tokenGenerated) {
      process.stderr.write(`  ⚠  No TV_BRIDGE_TOKEN set — generated one for this run:\n\n`);
      process.stderr.write(`      ${token}\n\n`);
      process.stderr.write(`  Put this token in the ChartMind app's settings. To keep it stable\n`);
      process.stderr.write(`  across restarts, set TV_BRIDGE_TOKEN in your environment.\n\n`);
    } else {
      process.stderr.write(`  Auth: using TV_BRIDGE_TOKEN from environment.\n\n`);
    }
    process.stderr.write(`  ⚠  Unofficial tool. Not affiliated with TradingView Inc. or Anthropic.\n`);
    process.stderr.write(`     Only expose this bridge on networks you trust (LAN or VPN like Tailscale).\n\n`);
  });
}

// Run only when invoked directly (not when imported by tests).
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}

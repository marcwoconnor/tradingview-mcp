import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectTools } from '../src/bridge/collect.js';
import { createBridgeServer } from '../src/bridge/server.js';

const TOKEN = 'test-token-123';

// Spin up the bridge on an ephemeral port for the duration of a callback.
async function withServer(fn, opts = {}) {
  const server = createBridgeServer({ token: TOKEN, ...opts });
  await new Promise((res) => server.listen(0, '127.0.0.1', res));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  try {
    await fn(base);
  } finally {
    await new Promise((res) => server.close(res));
  }
}

const auth = { authorization: `Bearer ${TOKEN}` };

test('collectTools returns the full tool set with valid Anthropic schemas', () => {
  const tools = collectTools();
  assert.ok(tools.length >= 70, `expected many tools, got ${tools.length}`);

  for (const t of tools) {
    assert.equal(typeof t.name, 'string');
    assert.ok(t.name.length > 0);
    assert.equal(typeof t.description, 'string');
    assert.equal(t.input_schema.type, 'object', `${t.name} schema should be an object`);
    assert.equal(typeof t.input_schema.properties, 'object');
    // No JSON Schema dialect marker should leak through to the API.
    assert.equal(t.input_schema.$schema, undefined);
  }

  // Spot-check a known tool's schema shape.
  const setSymbol = tools.find((t) => t.name === 'chart_set_symbol');
  assert.ok(setSymbol, 'chart_set_symbol should exist');
  assert.deepEqual(setSymbol.input_schema.required, ['symbol']);
  assert.equal(setSymbol.input_schema.properties.symbol.type, 'string');
});

test('GET /health needs no auth and reports the tool count', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.name, 'tv-bridge');
    assert.ok(body.tools >= 70);
  });
});

test('protected routes reject missing/wrong tokens', async () => {
  await withServer(async (base) => {
    const noAuth = await fetch(`${base}/tools`);
    assert.equal(noAuth.status, 401);

    const wrong = await fetch(`${base}/tools`, { headers: { authorization: 'Bearer nope' } });
    assert.equal(wrong.status, 401);
  });
});

test('GET /tools returns schemas when authorized', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/tools`, { headers: auth });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.tools));
    assert.ok(body.tools.some((t) => t.name === 'quote_get'));
    // Handlers must not leak over the wire.
    assert.equal(body.tools[0].handler, undefined);
  });
});

test('POST /call returns 404 for unknown tools', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/call`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'does_not_exist', arguments: {} }),
    });
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.ok, false);
  });
});

test('POST /call surfaces tool errors as structured results (no TradingView needed)', async () => {
  await withServer(async (base) => {
    // tv_health_check hits CDP, which is unavailable in tests — the tool's
    // wrap() converts the failure into a structured payload, so the HTTP
    // layer should still respond 200 with is_error true.
    const res = await fetch(`${base}/call`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'tv_health_check', arguments: {} }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.name, 'tv_health_check');
    assert.equal(typeof body.result, 'object');
    // Without a live TradingView, this should report a failure rather than crash.
    assert.equal(body.ok, false);
    assert.equal(body.is_error, true);
  });
});

test('GET /file blocks path traversal outside the screenshot dir', async () => {
  await withServer(
    async (base) => {
      const res = await fetch(`${base}/file?path=/etc/passwd`, { headers: auth });
      assert.equal(res.status, 403);
    },
    { screenshotDir: '/tmp/chartmind-shots' },
  );
});

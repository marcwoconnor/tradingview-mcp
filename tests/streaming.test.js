/**
 * Streaming tests.
 *  - StreamManager: poll/dedup/error/lifecycle logic with an injected scheduler.
 *  - MCP integration: a real McpServer<->Client over the SDK's in-memory
 *    transport, proving resource-update notifications and resource reads flow.
 * No TradingView needed — fetchers are mocked.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { StreamManager } from '../src/core/streaming.js';
import { registerStreamTools } from '../src/tools/stream.js';

function fakeScheduler() {
  const timers = [];
  return {
    setInterval: (fn) => { timers.push(fn); return timers.length - 1; },
    clearInterval: (h) => { timers[h] = null; },
    timers,
  };
}

describe('StreamManager', () => {
  it('polls, dedups, and calls onUpdate only when the snapshot changes', async () => {
    let val = { a: 1 };
    const seen = [];
    const sched = fakeScheduler();
    const m = new StreamManager({ onUpdate: (s) => seen.push(s.last), ...sched });
    const sub = m.subscribe({ channel: 't', fetcher: async () => val, interval: 10 });
    await sub._tick();        // first value → update
    await sub._tick();        // identical → deduped
    val = { a: 2 };
    await sub._tick();        // changed → update
    assert.equal(sub.updates, 2);
    assert.deepEqual(seen, [{ a: 1 }, { a: 2 }]);
  });

  it('skips null snapshots', async () => {
    const sched = fakeScheduler();
    const m = new StreamManager(sched);
    const sub = m.subscribe({ channel: 't', fetcher: async () => null, interval: 10 });
    await sub._tick();
    assert.equal(sub.updates, 0);
    assert.equal(sub.last, null);
  });

  it('counts fetcher errors without throwing', async () => {
    const sched = fakeScheduler();
    const m = new StreamManager(sched);
    const sub = m.subscribe({ channel: 't', fetcher: async () => { throw new Error('boom'); }, interval: 10 });
    await sub._tick();
    assert.equal(sub.errors, 1);
    assert.match(sub.lastError, /boom/);
  });

  it('an onUpdate failure does not kill the loop', async () => {
    const sched = fakeScheduler();
    const m = new StreamManager({ onUpdate: async () => { throw new Error('notify fail'); }, ...sched });
    const sub = m.subscribe({ channel: 't', fetcher: async () => ({ x: 1 }), interval: 10 });
    await sub._tick(); // must not throw
    assert.equal(sub.updates, 1);
  });

  it('unsubscribe stops and clears; list reflects state', () => {
    const sched = fakeScheduler();
    const m = new StreamManager(sched);
    const a = m.subscribe({ channel: 'quote', fetcher: async () => ({}), interval: 10 });
    m.subscribe({ channel: 'bars', fetcher: async () => ({}), interval: 10 });
    assert.equal(m.list().length, 2);
    assert.equal(m.unsubscribe(a.id), true);
    assert.equal(m.unsubscribe('nope'), false);
    assert.equal(m.list().length, 1);
    m.unsubscribeAll();
    assert.equal(m.list().length, 0);
  });

  it('requires a fetcher function', () => {
    const sched = fakeScheduler();
    const m = new StreamManager(sched);
    assert.throws(() => m.subscribe({ channel: 't' }), /fetcher/);
  });
});

describe('streaming over MCP (in-memory transport)', () => {
  it('subscribes, pushes a resource-update notification, and serves the resource', async () => {
    let counter = 0;
    const server = new McpServer({ name: 'tv-test', version: '0.0.0' });
    const manager = registerStreamTools(server, {
      fetchers: { test: () => ({ v: ++counter }) },
      setInterval: () => 0,   // no auto-ticking; drive ticks manually for determinism
      clearInterval: () => {},
    });

    const client = new Client({ name: 'test-client', version: '0.0.0' });
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    const notifications = [];
    client.fallbackNotificationHandler = async (n) => { notifications.push(n); };
    await Promise.all([server.connect(serverT), client.connect(clientT)]);

    const subRes = await client.callTool({ name: 'stream_subscribe', arguments: { channel: 'test' } });
    const sub = JSON.parse(subRes.content[0].text);
    assert.equal(sub.success, true);
    const id = sub.id;
    assert.equal(sub.resource_uri, 'stream://' + id);

    // Drive one poll → should push notifications/resources/updated for stream://id
    await manager.get(id)._tick();
    await new Promise(r => setTimeout(r, 20)); // flush transport

    const updated = notifications.find(n => n.method === 'notifications/resources/updated');
    assert.ok(updated, 'client received resources/updated');
    assert.equal(updated.params.uri, 'stream://' + id);

    // The latest snapshot is readable as the resource
    const read = await client.readResource({ uri: 'stream://' + id });
    assert.equal(JSON.parse(read.contents[0].text).data.v, 1);

    // stream_poll fallback returns the same value without relying on push
    const polled = JSON.parse((await client.callTool({ name: 'stream_poll', arguments: { id } })).content[0].text);
    assert.equal(polled.data.v, 1);

    // stream_list shows the active subscription; unsubscribe removes it
    const listed = JSON.parse((await client.callTool({ name: 'stream_list', arguments: {} })).content[0].text);
    assert.equal(listed.count, 1);
    const unsub = JSON.parse((await client.callTool({ name: 'stream_unsubscribe', arguments: { id } })).content[0].text);
    assert.equal(unsub.success, true);

    await client.close();
    await server.close();
  });
});

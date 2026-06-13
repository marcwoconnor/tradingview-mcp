import { z } from 'zod';
import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { jsonResult } from './_format.js';
import { fetchers as defaultFetchers, DEFAULT_INTERVALS } from '../core/stream.js';
import { StreamManager } from '../core/streaming.js';

const STREAM_SCHEME = 'stream://';

/**
 * Register MCP-native streaming. A subscription polls a channel via CDP and,
 * on each change, sends a `notifications/resources/updated` for stream://{id};
 * the latest snapshot is always readable as that resource and via stream_poll
 * (the guaranteed-visible fallback for clients that don't surface push).
 *
 * `opts` is injectable for tests: { fetchers, setInterval, clearInterval }.
 * Returns the StreamManager.
 */
export function registerStreamTools(server, opts = {}) {
  const fetchers = opts.fetchers || defaultFetchers;
  const channels = Object.keys(fetchers);

  const manager = new StreamManager({
    setInterval: opts.setInterval,
    clearInterval: opts.clearInterval,
    onUpdate: async (sub) => {
      try {
        await server.server.notification({
          method: 'notifications/resources/updated',
          params: { uri: STREAM_SCHEME + sub.id },
        });
      } catch {
        // Client not connected or doesn't support resource notifications —
        // the value is still readable via the resource / stream_poll.
      }
    },
  });

  // Latest snapshot is readable as stream://{id}
  server.resource(
    'tradingview-stream',
    new ResourceTemplate(`${STREAM_SCHEME}{id}`, { list: undefined }),
    async (uri, { id }) => {
      const sub = manager.get(id);
      const body = sub
        ? { id, channel: sub.channel, updates: sub.updates, data: sub.last }
        : { id, error: 'no such subscription (it may have been unsubscribed)' };
      return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(body, null, 2) }] };
    },
  );

  server.tool(
    'stream_subscribe',
    `Start a live stream of a channel (${channels.join(', ')}). Polls the chart and pushes a resource-update notification on each change; read values via the returned resource_uri or stream_poll.`,
    {
      channel: z.enum(channels).describe('What to stream'),
      interval: z.coerce.number().optional().describe('Poll interval in ms (channel-specific default if omitted)'),
      filter: z.string().optional().describe('Study-name substring filter (lines/labels/tables channels)'),
    },
    async ({ channel, interval, filter }) => {
      try {
        const fetcher = () => fetchers[channel](filter);
        const sub = manager.subscribe({ channel, fetcher, interval: interval || DEFAULT_INTERVALS[channel] || 500 });
        return jsonResult({
          success: true,
          id: sub.id,
          channel,
          interval: sub.interval,
          resource_uri: STREAM_SCHEME + sub.id,
          note: 'Subscribed. Clients that support resource notifications will be pushed updates; otherwise call stream_poll to read the latest value.',
        });
      } catch (err) {
        return jsonResult({ success: false, error: err.message }, true);
      }
    },
  );

  server.tool(
    'stream_unsubscribe',
    'Stop a stream subscription by id, or pass "all" to stop every stream.',
    { id: z.string().describe('Subscription id, or "all"') },
    async ({ id }) => {
      try {
        if (id === 'all') {
          const n = manager.list().length;
          manager.unsubscribeAll();
          return jsonResult({ success: true, unsubscribed: n });
        }
        const ok = manager.unsubscribe(id);
        return jsonResult({ success: ok, id, error: ok ? undefined : 'no such subscription' }, !ok);
      } catch (err) {
        return jsonResult({ success: false, error: err.message }, true);
      }
    },
  );

  server.tool(
    'stream_list',
    'List active stream subscriptions and their stats (updates, errors).',
    {},
    async () => {
      try {
        const subs = manager.list();
        return jsonResult({ success: true, count: subs.length, subscriptions: subs });
      } catch (err) {
        return jsonResult({ success: false, error: err.message }, true);
      }
    },
  );

  server.tool(
    'stream_poll',
    'Read the latest streamed value(s) without relying on push notifications. Pass an id for one stream, or omit to get the latest of every active stream.',
    { id: z.string().optional().describe('Subscription id (omit for all)') },
    async ({ id }) => {
      try {
        if (id) {
          const sub = manager.get(id);
          if (!sub) return jsonResult({ success: false, error: 'no such subscription: ' + id }, true);
          return jsonResult({ success: true, id, channel: sub.channel, updates: sub.updates, data: sub.last });
        }
        const subscriptions = manager.list().map(d => ({ ...d, data: manager.get(d.id)?.last ?? null }));
        return jsonResult({ success: true, count: subscriptions.length, subscriptions });
      } catch (err) {
        return jsonResult({ success: false, error: err.message }, true);
      }
    },
  );

  return manager;
}

/**
 * Tool collector for the HTTP bridge.
 *
 * The MCP server registers tools via `server.tool(name, description, zodShape, handler)`.
 * Instead of standing up an McpServer, we pass a lightweight "collector" that records
 * each registration, then expose the same tools over HTTP. This means the bridge reuses
 * the *exact* same tool set as the stdio MCP server — no duplication, and it stays in
 * sync automatically as tools are added.
 */
import { z } from 'zod';
import { registerHealthTools } from '../tools/health.js';
import { registerChartTools } from '../tools/chart.js';
import { registerPineTools } from '../tools/pine.js';
import { registerDataTools } from '../tools/data.js';
import { registerCaptureTools } from '../tools/capture.js';
import { registerDrawingTools } from '../tools/drawing.js';
import { registerAlertTools } from '../tools/alerts.js';
import { registerBatchTools } from '../tools/batch.js';
import { registerReplayTools } from '../tools/replay.js';
import { registerIndicatorTools } from '../tools/indicators.js';
import { registerWatchlistTools } from '../tools/watchlist.js';
import { registerUiTools } from '../tools/ui.js';
import { registerPaneTools } from '../tools/pane.js';
import { registerTabTools } from '../tools/tab.js';
import { registerStreamTools } from '../tools/stream.js';

const REGISTRARS = [
  registerHealthTools,
  registerChartTools,
  registerPineTools,
  registerDataTools,
  registerCaptureTools,
  registerDrawingTools,
  registerAlertTools,
  registerBatchTools,
  registerReplayTools,
  registerIndicatorTools,
  registerWatchlistTools,
  registerUiTools,
  registerPaneTools,
  registerTabTools,
  registerStreamTools,
];

/**
 * Convert a zod "shape" (plain object of zod schemas) into a JSON Schema object
 * in the shape the Anthropic Messages API expects for tool `input_schema`.
 */
function shapeToInputSchema(shape) {
  const json = z.toJSONSchema(z.object(shape ?? {}), { target: 'draft-7' });
  // Anthropic wants a bare object schema; drop the $schema dialect marker.
  delete json.$schema;
  if (json.type !== 'object') {
    return { type: 'object', properties: {}, additionalProperties: false };
  }
  return json;
}

/**
 * Build the full tool list. Returns an array of:
 *   { name, description, input_schema, handler }
 * where `handler(args)` returns the MCP content envelope from `wrap()`.
 */
export function collectTools() {
  const tools = [];

  const collector = {
    tool(name, description, shapeOrHandler, maybeHandler) {
      // Support both (name, desc, shape, handler) and (name, desc, handler).
      const hasShape = typeof shapeOrHandler !== 'function';
      const shape = hasShape ? shapeOrHandler : {};
      const handler = hasShape ? maybeHandler : shapeOrHandler;

      tools.push({
        name,
        description,
        input_schema: shapeToInputSchema(shape),
        handler,
      });
    },
    // MCP resource registration + push notifications are not used over HTTP.
    // Streaming tools remain usable via stream_poll, so these are safe no-ops.
    resource() {},
    server: { notification: async () => {} },
  };

  for (const register of REGISTRARS) register(collector);

  return tools;
}

/**
 * Run a collected tool and return its result as a plain object.
 *
 * The MCP `wrap()` helper always resolves to { content: [{ type: 'text', text }], isError? }.
 * We parse the JSON text back into an object so the HTTP caller gets structured data.
 * Returns { result, isError }.
 */
export async function runTool(tool, args) {
  const envelope = await tool.handler(args ?? {});
  const text = envelope?.content?.[0]?.text ?? '{}';
  let result;
  try {
    result = JSON.parse(text);
  } catch {
    result = { success: false, error: 'tool returned non-JSON output', raw: text };
  }
  return { result, isError: Boolean(envelope?.isError) };
}

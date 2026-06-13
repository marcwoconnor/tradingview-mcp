import { z } from 'zod';
import { wrap } from './_format.js';
import * as core from '../core/health.js';

export function registerHealthTools(server) {
  server.tool('tv_health_check', 'Check CDP connection to TradingView and return current chart state', {}, wrap(core.healthCheck, { hint: 'TradingView is not running with CDP enabled. Use the tv_launch tool to start it automatically.' }));

  server.tool('tv_discover', 'Report which known TradingView API paths are available and their methods', {}, wrap(core.discover));

  server.tool('tv_ui_state', 'Get current UI state: which panels are open, what buttons are visible/enabled/disabled', {}, wrap(core.uiState));

  server.tool('tv_launch', 'Launch TradingView Desktop with Chrome DevTools Protocol (remote debugging) enabled. Auto-detects install location on Mac, Windows, and Linux.', {
    port: z.coerce.number().optional().describe('CDP port (default 9222)'),
    kill_existing: z.coerce.boolean().optional().describe('Kill existing TradingView instances first (default true)'),
  }, wrap(core.launch));
}

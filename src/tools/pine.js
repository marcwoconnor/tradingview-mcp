import { z } from 'zod';
import { wrap } from './_format.js';
import * as core from '../core/pine.js';

export function registerPineTools(server) {
  server.tool('pine_get_source', 'Get current Pine Script source code from the editor', {}, wrap(core.getSource));

  server.tool('pine_set_source', 'Set Pine Script source code in the editor', {
    source: z.string().describe('Pine Script source code to inject'),
  }, wrap(core.setSource));

  server.tool('pine_compile', 'Compile / add the current Pine Script to the chart', {}, wrap(core.compile));

  server.tool('pine_get_errors', 'Get Pine Script compilation errors from Monaco markers', {}, wrap(core.getErrors));

  server.tool('pine_save', 'Save the current Pine Script (Ctrl+S)', {}, wrap(core.save));

  server.tool('pine_get_console', 'Read Pine Script console/log output (compile messages, log.info(), errors)', {}, wrap(core.getConsole));

  server.tool('pine_smart_compile', 'Intelligent compile: detects button, compiles, checks errors, reports study changes', {}, wrap(core.smartCompile));

  server.tool('pine_new', 'Create a new blank Pine Script', {
    type: z.enum(['indicator', 'strategy', 'library']).describe('Type of script to create'),
  }, wrap(core.newScript));

  server.tool('pine_open', 'Open a saved Pine Script by name', {
    name: z.string().describe('Name of the saved script to open (case-insensitive match)'),
  }, wrap(core.openScript, { source: 'internal_api' }));

  server.tool('pine_list_scripts', 'List saved Pine Scripts', {}, wrap(core.listScripts));

  server.tool('pine_analyze', 'Run static analysis on Pine Script code WITHOUT compiling — catches array out-of-bounds, unguarded array.first()/last(), bad loop bounds, and implicit bool casts. Works offline, no TradingView connection needed.', {
    source: z.string().describe('Pine Script source code to analyze'),
  }, wrap(core.analyze));

  server.tool('pine_check', 'Compile Pine Script via TradingView\'s server API without needing the chart open. Returns compilation errors/warnings. Useful for validating code before injecting into the chart.', {
    source: z.string().describe('Pine Script source code to compile/validate'),
  }, wrap(core.check));
}

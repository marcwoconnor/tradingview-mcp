import { z } from 'zod';
import { wrap } from './_format.js';
import * as core from '../core/alerts.js';

export function registerAlertTools(server) {
  server.tool('alert_create', 'Create a price alert via the TradingView alert dialog', {
    condition: z.string().describe('Alert condition (e.g., "crossing", "greater_than", "less_than")'),
    price: z.coerce.number().describe('Price level for the alert'),
    message: z.string().optional().describe('Alert message'),
  }, wrap(core.create));

  server.tool('alert_list', 'List active alerts', {}, wrap(core.list));

  server.tool('alert_delete', 'Delete all alerts or open context menu for deletion', {
    delete_all: z.coerce.boolean().optional().describe('Delete all alerts'),
  }, wrap(core.deleteAlerts));
}

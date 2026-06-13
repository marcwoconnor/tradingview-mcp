/**
 * Structured error taxonomy.
 *
 * Tools previously failed with a bare `{ success: false, error: <message> }`,
 * which can't be acted on programmatically — a consumer can't tell "TradingView
 * isn't running" from "this study doesn't exist" from "the chart is still
 * loading". AppError carries a `kind` from ErrorKind so callers (and the MCP
 * `wrap()` boundary) can surface a machine-readable `error_kind`.
 */

export const ErrorKind = {
  CONNECTION: 'connection',   // CDP unreachable or the socket dropped
  TIMEOUT: 'timeout',         // an operation exceeded its time budget
  API_MISSING: 'api_missing', // a required TradingView internal path is absent (likely a TV update / drift)
  NOT_FOUND: 'not_found',     // a requested entity/panel/element wasn't present
  NO_DATA: 'no_data',         // ran successfully but produced no usable data (e.g. chart still loading)
  BAD_INPUT: 'bad_input',     // invalid arguments
  EVAL: 'eval',               // a JavaScript error inside the page
  UNKNOWN: 'unknown',
};

export class AppError extends Error {
  constructor(message, kind = ErrorKind.UNKNOWN, opts = {}) {
    super(message, opts.cause ? { cause: opts.cause } : undefined);
    this.name = 'AppError';
    this.kind = kind;
    if (opts.hint) this.hint = opts.hint;
  }
}

/** Convenience constructor: appError(ErrorKind.NOT_FOUND, 'msg', { hint }). */
export function appError(kind, message, opts) {
  return new AppError(message, kind, opts);
}

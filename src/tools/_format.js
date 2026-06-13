/**
 * Shared MCP response formatting helper.
 * All tool files use this instead of manually constructing MCP responses.
 */
export function jsonResult(obj, isError = false) {
  return {
    content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }],
    ...(isError && { isError: true }),
  };
}

/**
 * Wrap a core function as an MCP tool handler.
 *
 * Runs the core function with the validated tool arguments, serializes the
 * result via jsonResult, and converts any thrown error into a uniform
 * { success: false, error } payload (marked isError). `errorExtra`, if given,
 * is merged into the error payload — e.g. { hint: '...' }.
 *
 * Replaces the try/catch boilerplate that was duplicated across every tool.
 */
export function wrap(coreFn, errorExtra) {
  return async (args) => {
    try {
      return jsonResult(await coreFn(args ?? {}));
    } catch (err) {
      const payload = { success: false, error: err.message };
      if (err.kind) payload.error_kind = err.kind;       // from AppError
      if (err.hint) payload.hint = err.hint;             // dynamic hint
      return jsonResult({ ...payload, ...errorExtra }, true); // static errorExtra wins
    }
  };
}

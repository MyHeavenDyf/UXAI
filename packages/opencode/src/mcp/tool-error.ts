// Preserve local transport errors without changing the MCP result sent to callers.
// Weak keys release the original error as soon as the result is no longer used.
export const errors = new WeakMap<object, unknown>()

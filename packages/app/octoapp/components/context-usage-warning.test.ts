import { describe, expect, test } from "bun:test"
import { isContextAtLimit, shouldShowContextWarning, shouldShowTurnError } from "./context-usage-warning"

describe("shouldShowContextWarning", () => {
  test("shows from 80% for an active session", () => {
    expect(shouldShowContextWarning(79, "session-1")).toBe(false)
    expect(shouldShowContextWarning(80, "session-1")).toBe(true)
    expect(shouldShowContextWarning(100, "session-1")).toBe(true)
  })

  test("stays hidden after the current session ignores it", () => {
    expect(shouldShowContextWarning(80)).toBe(false)
    expect(shouldShowContextWarning(80, "session-1", "session-1")).toBe(false)
    expect(shouldShowContextWarning(80, "session-2", "session-1")).toBe(true)
  })

  test("waits until the conversation finishes", () => {
    expect(shouldShowContextWarning(80, "session-1", undefined, true)).toBe(false)
    expect(shouldShowContextWarning(80, "session-1", undefined, false)).toBe(true)
  })
})

describe("isContextAtLimit", () => {
  test("blocks only when an existing session reaches its exact token limit", () => {
    expect(isContextAtLimit(127_999, 128_000, "session-1")).toBe(false)
    expect(isContextAtLimit(128_000, 128_000, "session-1")).toBe(true)
    expect(isContextAtLimit(130_000, 128_000, "session-1")).toBe(true)
  })

  test("does not block without a session or a known limit", () => {
    expect(isContextAtLimit(128_000, 128_000)).toBe(false)
    expect(isContextAtLimit(128_000, undefined, "session-1")).toBe(false)
  })
})

describe("shouldShowTurnError", () => {
  test("does not repeat context overflow when the persistent limit warning is visible", () => {
    expect(shouldShowTurnError("ContextOverflowError", true)).toBe(false)
    expect(shouldShowTurnError("ContextOverflowError")).toBe(true)
    expect(shouldShowTurnError("ProviderAuthError", true)).toBe(true)
  })
})

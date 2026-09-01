import { describe, expect, test } from "bun:test"
import { shouldShowContextWarning } from "./context-usage-warning"

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
})

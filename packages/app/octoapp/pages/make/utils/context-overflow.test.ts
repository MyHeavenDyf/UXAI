import { describe, expect, test } from "bun:test"
import { parseContextOverflowEvent } from "./context-overflow"

describe("parseContextOverflowEvent", () => {
  test("accepts only ContextOverflowError session errors", () => {
    expect(
      parseContextOverflowEvent("session.error", {
        sessionID: "session-1",
        error: { name: "ContextOverflowError", data: { message: "context full" } },
      }),
    ).toEqual({ sessionID: "session-1", message: "context full" })

    expect(parseContextOverflowEvent("session.idle", { sessionID: "session-1" })).toBeUndefined()
    expect(
      parseContextOverflowEvent("session.error", {
        sessionID: "session-1",
        error: { name: "ProviderAuthError" },
      }),
    ).toBeUndefined()
  })
})

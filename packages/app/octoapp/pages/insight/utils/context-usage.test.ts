import { describe, expect, test } from "bun:test"
import {
  insightContextCommandName,
  insightContextTokens,
  isInsightSendDisabled,
  isMessageAbortedError,
  isSuccessfulCompaction,
} from "./context-usage"

describe("insight context usage", () => {
  test("uses summary output only after compaction succeeds", () => {
    const completed = { summary: true, finish: "stop", output: 2_000, total: 100_000 }
    const failed = { ...completed, error: { name: "APIError", data: { message: "invalid summary" } } }
    const pending = { ...completed, finish: undefined }

    expect(insightContextTokens({ message: completed, output: completed.output, total: completed.total })).toBe(2_000)
    expect(insightContextTokens({ message: failed, output: failed.output, total: failed.total })).toBe(100_000)
    expect(insightContextTokens({ message: pending, output: pending.output, total: pending.total })).toBe(100_000)
  })

  test("requires a finished, error-free summary", () => {
    expect(isSuccessfulCompaction({ summary: true, finish: "stop" })).toBe(true)
    expect(isSuccessfulCompaction({ summary: true, finish: "error", error: { name: "APIError", data: {} } })).toBe(false)
    expect(isSuccessfulCompaction({ summary: true })).toBe(false)
  })

  test("distinguishes user cancellation from command failure", () => {
    expect(isMessageAbortedError({ name: "MessageAbortedError" })).toBe(true)
    expect(isMessageAbortedError({ name: "APIError" })).toBe(false)
  })

  test("keeps context commands sendable at the hard limit", () => {
    expect(insightContextCommandName(" /compact ")).toBe("compact")
    expect(insightContextCommandName("/summarize")).toBe("summarize")
    expect(isInsightSendDisabled({ stopping: false, contextBlocked: true, text: "/compact", uploading: false })).toBe(false)
    expect(isInsightSendDisabled({ stopping: false, contextBlocked: true, text: "继续", uploading: false })).toBe(true)
  })
})

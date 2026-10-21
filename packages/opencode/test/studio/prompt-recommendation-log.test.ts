import { expect, spyOn, test } from "bun:test"
import { logRecommendationFailure, recommendationLogIDs } from "@/studio/prompt-recommendation-log"

test("failure logs retain SDK and network diagnostics without request bodies, headers or provider messages", () => {
  const warn = spyOn(console, "warn").mockImplementation(() => {})
  const error = Object.assign(new Error("private prompt and credential"), {
    name: "AI_APICallError", statusCode: 401, isRetryable: false,
    requestBodyValues: { prompt: "private prompt" }, responseBody: "private body",
    requestHeaders: { authorization: "Bearer private-key" },
    cause: Object.assign(new Error("private URL"), { code: "ECONNRESET" }),
  })
  const failure = Object.assign(new Error("MODEL_REQUEST_FAILED"), { cause: error })
  try {
    logRecommendationFailure(failure, { requestID: "request", stage: "llm", code: "MODEL_REQUEST_FAILED" })
    logRecommendationFailure(failure, { requestID: "request", stage: "execution" })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]).toEqual(["[studio.prompt-expansion] failed", {
      requestID: "request", stage: "llm", code: "MODEL_REQUEST_FAILED",
      error: { name: "Error", cause: {
        name: "AI_APICallError", statusCode: 401, isRetryable: false,
        cause: { name: "Error", code: "ECONNRESET" },
      } },
    }])
    expect(JSON.stringify(warn.mock.calls)).not.toContain("private")
    logRecommendationFailure(failure, { requestID: "different-request", stage: "llm" })
    expect(warn).toHaveBeenCalledTimes(2)
  } finally { warn.mockRestore() }
})

test("cancellations use an informational console entry", () => {
  const info = spyOn(console, "log").mockImplementation(() => {})
  const warn = spyOn(console, "warn").mockImplementation(() => {})
  try {
    logRecommendationFailure(new DOMException("cancelled", "AbortError"), { cancelled: true, requestID: "cancel" })
    expect(info.mock.calls[0]?.[0]).toBe("[studio.prompt-expansion] cancelled")
    expect(warn).not.toHaveBeenCalled()
  } finally { info.mockRestore(); warn.mockRestore() }
})

test("only bounded request identifiers are extracted from request payloads", () => {
  expect(recommendationLogIDs({
    requestID: "request-123", sessionID: "ses_123", guidePartID: "prt_123",
    prompt: "private prompt", images: [{ base64: "private" }],
  })).toEqual({ requestID: "request-123", sessionID: "ses_123", guidePartID: "prt_123" })
  expect(recommendationLogIDs({ requestID: "x".repeat(129), sessionID: "private\ntext" })).toEqual({})
  expect(recommendationLogIDs(null)).toEqual({})
})

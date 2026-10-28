import { Log } from "@opencode-ai/core/util/log"
import { expect, spyOn, test } from "bun:test"
import { logExpansionOutput, logRecommendationFailure, recommendationLogIDs } from "@/studio/prompt-recommendation-log"

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


test("completed output diagnostics preserve full text, candidates and results in terminal and existing log file", async () => {
  const terminal = spyOn(console, "log").mockImplementation(() => {})
  const requestID = crypto.randomUUID()
  const rawText = `<expandedPrompt>${"樱花林荫道".repeat(2000)}</expandedPrompt>\n<tags>风格：动漫</tags>`
  try {
    logExpansionOutput({ requestID, sessionID: "session", providerID: "provider", modelID: "model" }, {
      attempt: 1, outcome: "repairing", rawText, elapsedMs: 10,
      feedback: "返回了多份不同的正文", candidates: ["城市", "", "。"],
    })
    logExpansionOutput({ requestID, sessionID: "session", providerID: "provider", modelID: "model" }, {
      attempt: 2, outcome: "accepted", rawText: "<expandedPrompt>城市雨景</expandedPrompt>", elapsedMs: 20,
      result: { expandedPrompt: "城市雨景", tags: [] },
      diagnostics: {
        candidateCount: 1, selectedIndex: 0, selectionReason: "last_complete_valid",
        candidates: [{ index: 0, text: "城市雨景", codePoints: 4, complete: true, valid: true, selected: true }],
      },
    })
    const first = JSON.parse(String(terminal.mock.calls[0][1]))
    expect(JSON.parse(String(terminal.mock.calls[1][1])).diagnostics).toMatchObject({ candidateCount: 1, selectedIndex: 0, selectionReason: "last_complete_valid" })
    expect(first.rawText).toBe(rawText)
    expect(first.rawBytes).toBe(Buffer.byteLength(rawText))
    expect(first.candidates).toEqual([{ text: "城市", codePoints: 2 }, { text: "", codePoints: 0 }, { text: "。", codePoints: 1 }])
    expect(first).toMatchObject({ requestID, attempt: 1, outcome: "repairing", feedback: "返回了多份不同的正文", repair: false })
    expect(JSON.parse(String(terminal.mock.calls[1][1]))).toMatchObject({ attempt: 2, outcome: "accepted", repair: true, result: { expandedPrompt: "城市雨景", tags: [] } })
    expect(Log.file()).not.toBe("")
    const deadline = Date.now() + 2000
    while (Date.now() < deadline && !(await Bun.file(Log.file()).text()).includes(String(terminal.mock.calls[1][1])))
      await Bun.sleep(5)
    const file = await Bun.file(Log.file()).text()
    expect(file).toContain(`entry=${terminal.mock.calls[0][1]}`)
    expect(file).toContain(`entry=${terminal.mock.calls[1][1]}`)
  } finally { terminal.mockRestore() }
})

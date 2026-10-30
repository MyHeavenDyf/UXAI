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


test("output logs retain only metadata even when callers supply extra content fields", async () => {
  const terminal = spyOn(console, "log").mockImplementation(() => {})
  const requestID = crypto.randomUUID()
  const rawText = `<think>private reasoning</think><expandedPrompt>${"private body 🌸".repeat(2000)}</expandedPrompt><tags>风格：private tag</tags>`
  const output = {
    rawBytes: Buffer.byteLength(rawText), rawCodePoints: [...rawText].length,
    rawText, feedback: "private feedback", candidates: ["private candidate"],
    result: { expandedPrompt: "private result", tags: ["private tag"] },
    diagnostics: {
      candidateCount: 1, selectedIndex: 0, selectionReason: "last_complete_valid" as const,
      text: "private diagnostic",
      candidates: [{ index: 0, text: "private candidate", codePoints: 17, complete: true, valid: true, selected: true, reason: "private reason" }],
    },
  }
  try {
    logExpansionOutput({ requestID, sessionID: "session", providerID: "provider", modelID: "model", prompt: "private prompt" }, {
      ...output, attempt: 1, outcome: "repairing", elapsedMs: 10, code: "INVALID_MODEL_OUTPUT",
    })
    logExpansionOutput({ requestID, sessionID: "session", providerID: "provider", modelID: "model" }, {
      ...output, attempt: 2, outcome: "accepted", elapsedMs: 20, expandedCodePoints: 4, tagCount: 0,
    })
    expect(terminal).not.toHaveBeenCalled()
    expect(Log.file()).not.toBe("")
    const deadline = Date.now() + 2000
    while (Date.now() < deadline && !(await Bun.file(Log.file()).text()).split("\n").some((line) => line.includes(requestID) && line.includes('"outcome":"accepted"')))
      await Bun.sleep(5)
    const records = (await Bun.file(Log.file()).text()).split("\n")
      .filter((line) => line.includes(requestID) && line.includes("entry="))
      .map((line) => JSON.parse(line.slice(line.indexOf("entry=") + 6).replace(/ output$/, "")))
    expect(records).toHaveLength(2)
    expect(JSON.stringify(records)).not.toContain("private")
    expect(JSON.stringify(records)).not.toMatch(/"(?:rawText|text|expandedPrompt|tags|feedback|result|prompt)":/)
    expect(records[0].rawBytes).toBe(Buffer.byteLength(rawText))
    expect(records[0].rawCodePoints).toBe([...rawText].length)
    expect(records[0].diagnostics.candidates).toEqual([{ index: 0, codePoints: 17, complete: true, valid: true, selected: true, reason: "invalid_body" }])
    expect(records[0]).toMatchObject({ requestID, sessionID: "session", providerID: "provider", modelID: "model", attempt: 1, outcome: "repairing", code: "INVALID_MODEL_OUTPUT", repair: false })
    expect(records[1]).toMatchObject({ attempt: 2, outcome: "accepted", repair: true, expandedCodePoints: 4, tagCount: 0 })
    expect(records[1].diagnostics).toMatchObject({ candidateCount: 1, selectedIndex: 0, selectionReason: "last_complete_valid" })
    expect(output.rawText).toBe(rawText)
    expect(output.diagnostics.candidates[0].text).toBe("private candidate")
    expect(output.diagnostics.candidates[0].reason).toBe("private reason")
  } finally { terminal.mockRestore() }
})

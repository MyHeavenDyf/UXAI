import { afterAll, afterEach, expect, spyOn, test } from "bun:test"
import { chatError, chatTransportMetadata, createChatTrace } from "../../src/session/chat-diagnostics"

const output = spyOn(console, "info").mockImplementation(() => {})
afterEach(() => output.mockClear())
afterAll(() => output.mockRestore())

function records() {
  return output.mock.calls.filter((call) => call[0] === "[octo:chat]").map((call) => JSON.parse(String(call[1])))
}

test("counts streamed content without logging it and closes only once", () => {
  const trace = createChatTrace({ layer: "llm", sessionID: "ses_test", modelID: "model" })
  try {
    trace.event({ type: "reasoning-delta", text: "private reasoning" })
    trace.event({ type: "text-delta", text: "private reply" })
    trace.event({ type: "text-delta", text: "!" })
    trace.event({ type: "finish", finishReason: "stop" })
    trace.finish()
    trace.finish()
    expect(records().filter((item) => item.stage === "end")).toHaveLength(1)
    expect(records().at(-1)).toMatchObject({
      outcome: "text-received",
      textChars: 14,
      reasoningChars: 17,
      finishSeen: true,
    })
    expect(new Set(records().map((item) => item.requestID)).size).toBe(1)
    expect(JSON.stringify(records())).not.toContain("private")
  } finally {
    trace.finish()
  }
})

test.each([
  [undefined, "empty-output"],
  [{ type: "reasoning-delta", text: "hidden" }, "reasoning-only"],
  [{ type: "tool-call" }, "tool-only"],
  [{ type: "error", error: new Error("token=secret unLogin") }, "failed"],
] as const)("classifies no visible response: %j", (event, outcome) => {
  const trace = createChatTrace({ layer: "llm" })
  try {
    if (event) trace.event(event)
  } finally {
    trace.finish()
  }
  expect(records().at(-1).outcome).toBe(outcome)
  expect(JSON.stringify(records())).not.toContain("secret")
})

test("reports stalls and stops the periodic diagnostic after finish", async () => {
  const trace = createChatTrace({ layer: "llm" }, 10)
  try {
    trace.mark("llm:prepare")
    await Bun.sleep(40)
    expect(records().some((item) => item.stage === "waiting-or-progress" && item.waitingAt === "llm:prepare")).toBe(
      true,
    )
    trace.finish("interrupted")
    const count = records().length
    await Bun.sleep(30)
    expect(records()).toHaveLength(count)
  } finally {
    trace.finish()
  }
})

test("only records origin, known operation and credential header names", () => {
  const metadata = chatTransportMetadata(
    new Request("https://user:password@example.com/v1/chat/completions?token=secret", {
      method: "POST",
      headers: { authorization: "Bearer secret", "x-session-affinity": "ses_test" },
    }),
    { headers: { uiplustoken: "secret", cookie: "secret" } },
  )
  expect(metadata).toEqual({
    sessionID: "ses_test",
    origin: "https://example.com",
    operation: "/chat/completions",
    method: "POST",
    authHeaders: ["authorization", "uiplustoken", "cookie"],
  })
  expect(JSON.stringify(metadata)).not.toContain("secret")
  expect(JSON.stringify(metadata)).not.toContain("password")
})

test("classifies nested transport errors without message, response or headers", () => {
  const cause = Object.assign(new Error("secret network fetch failed"), { code: "ECONNRESET" })
  const error = Object.assign(new Error("secret unauthorized"), {
    statusCode: 401,
    cause,
    responseBody: "secret",
    headers: { cookie: "secret" },
  })
  const result = chatError(error)
  expect(result).toMatchObject({
    errorCodes: ["ECONNRESET"],
    httpStatuses: [401],
    categories: ["authentication", "network"],
  })
  expect(JSON.stringify(result)).not.toContain("secret")
})

test("byte counters and unknown finish values do not leak content", () => {
  const trace = createChatTrace({ layer: "transport" })
  try {
    trace.chunk(123)
    trace.chunk(456)
    trace.event({ type: "finish", finishReason: "secret" })
  } finally {
    trace.finish()
  }
  expect(records().at(-1)).toMatchObject({ chunks: 2, bytes: 579 })
  expect(JSON.stringify(records())).not.toContain("secret")
})

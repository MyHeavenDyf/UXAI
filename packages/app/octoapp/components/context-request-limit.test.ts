import { describe, expect, test } from "bun:test"
import { exceedsSafeRequestLimit } from "./context-request-limit"

describe("exceedsSafeRequestLimit", () => {
  test("blocks text attachments before they are sent to the model", () => {
    expect(
      exceedsSafeRequestLimit({
        contextTokens: 10,
        limit: 100,
        text: "summarize",
        attachments: [{ filename: "large.txt", mime: "text/plain", size: 180, status: "done" }],
      }),
    ).toBe(true)
  })

  test("adds all completed text files to the current session usage", () => {
    expect(
      exceedsSafeRequestLimit({
        contextTokens: 50,
        limit: 100,
        text: "",
        attachments: [
          { filename: "one.txt", mime: "text/plain", size: 40, status: "done" },
          { filename: "two.md", mime: "application/octet-stream", size: 40, status: "done" },
        ],
      }),
    ).toBe(true)
  })

  test("does not count unfinished or binary attachments as inline text", () => {
    expect(
      exceedsSafeRequestLimit({
        contextTokens: 10,
        limit: 100,
        text: "ok",
        attachments: [
          { filename: "pending.txt", mime: "text/plain", size: 200, status: "uploading" },
          { filename: "image.png", mime: "image/png", size: 200, status: "done" },
        ],
      }),
    ).toBe(false)
  })

  test("allows requests when the model limit is unknown", () => {
    expect(
      exceedsSafeRequestLimit({
        contextTokens: 100,
        text: "",
        attachments: [{ filename: "large.txt", mime: "text/plain", size: 200, status: "done" }],
      }),
    ).toBe(false)
  })
})

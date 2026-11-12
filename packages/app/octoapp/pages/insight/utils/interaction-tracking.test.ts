import { describe, expect, test } from "bun:test"
import { beginInsightOperation, createPreviewTracker, uploadStatus } from "./interaction-tracking"

test("preview repeats are deduplicated; refreshed content can report without exposing keys", () => {
  const events: Array<Record<string, unknown>> = []
  let revision = 1
  const ready = createPreviewTracker(() => ({ key: ["private/path", "private content", revision], fields: { tabType: "image" } }),
    (_name, fields) => { events.push(fields ?? {}) })
  ready("image-load")
  ready("image-load")
  expect(events).toHaveLength(1)
  revision++
  ready("image-load")
  expect(events).toHaveLength(2)
  expect(JSON.stringify(events)).not.toContain("private")
})

describe("Insight operation telemetry", () => {
  test("snapshots origin and pairs each execution with at most one terminal result", () => {
    const events: Array<{ name: string; fields: Record<string, unknown> }> = []
    const origin = { sessionId: "original", count: 2 }
    const finish = beginInsightOperation("files-upload", origin, (name, fields) => events.push({ name, fields: fields ?? {} }))
    origin.sessionId = "later"
    finish("partial", { successCount: 1 })
    finish("success")
    finish("failure")
    expect(events.map((event) => event.name)).toEqual(["files-upload-start", "files-upload-result"])
    expect(events[1].fields).toMatchObject({ sessionId: "original", status: "partial", successCount: 1 })
    expect(events[1].fields.operationId).toBe(events[0].fields.operationId)
    expect(events[1].fields.durationMs).toBeGreaterThanOrEqual(0)
  })

  test("cancel wins over late completion; explicit retry receives a different operation id", () => {
    const events: Array<Record<string, unknown>> = []
    const send = (_name: string, fields: Record<string, unknown> = {}) => { events.push(fields) }
    const finish = beginInsightOperation("addon-import", {}, send)
    finish("cancelled")
    finish("success")
    beginInsightOperation("addon-import", {}, send)("success")
    expect(events.map((event) => event.status).filter(Boolean)).toEqual(["cancelled", "success"])
    expect(events[0].operationId).not.toBe(events[2].operationId)
  })

  test("a throwing telemetry observer cannot fail the business action", () => {
    expect(() => beginInsightOperation("md-save", {}, () => { throw new Error("transport") })("success")).not.toThrow()
  })

  test("empty directories, filtered files and partial copies have distinct outcomes", () => {
    expect(uploadStatus(0, 0)).toBe("success")
    expect(uploadStatus(3, 3)).toBe("success")
    expect(uploadStatus(3, 2)).toBe("partial")
    expect(uploadStatus(3, 2, 1)).toBe("partial")
    expect(uploadStatus(3, 0, 3)).toBe("failure")
    expect(uploadStatus(3, 0)).toBe("failure")
  })
})

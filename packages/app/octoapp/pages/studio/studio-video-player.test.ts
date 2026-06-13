import { describe, expect, test } from "bun:test"
import { formatStudioMediaTime } from "./studio-video-player"

describe("formatStudioMediaTime", () => {
  test("formats finite media durations", () => {
    expect(formatStudioMediaTime(0)).toBe("00:00")
    expect(formatStudioMediaTime(65.9)).toBe("01:05")
    expect(formatStudioMediaTime(3605)).toBe("60:05")
  })

  test("normalizes invalid and negative durations", () => {
    expect(formatStudioMediaTime(Number.NaN)).toBe("00:00")
    expect(formatStudioMediaTime(Number.POSITIVE_INFINITY)).toBe("00:00")
    expect(formatStudioMediaTime(-5)).toBe("00:00")
  })
})

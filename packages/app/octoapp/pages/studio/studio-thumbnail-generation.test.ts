import { describe, expect, test } from "bun:test"
import { STUDIO_THUMBNAIL_TARGET_DPR, studioThumbnailDimensions } from "./studio-thumbnail-generation"

describe("Studio browser thumbnail generation", () => {
  test("uses the documented target pixel density", () => {
    expect(STUDIO_THUMBNAIL_TARGET_DPR).toBe(1.5)
  })

  test("does not enlarge small sources", () => {
    expect(studioThumbnailDimensions(250, 250)).toEqual({ width: 250, height: 250 })
    expect(studioThumbnailDimensions(600, 300)).toEqual({ width: 600, height: 300 })
  })

  test("sizes common and extreme ratios from the display bounds", () => {
    expect(studioThumbnailDimensions(300, 500)).toEqual({ width: 189, height: 315 })
    expect(studioThumbnailDimensions(1920, 1080)).toEqual({ width: 560, height: 315 })
    expect(studioThumbnailDimensions(4096, 4096)).toEqual({ width: 315, height: 315 })
    expect(studioThumbnailDimensions(4000, 500)).toEqual({ width: 630, height: 79 })
  })

  test("rejects invalid source dimensions", () => {
    expect(() => studioThumbnailDimensions(0, 100)).toThrow()
    expect(() => studioThumbnailDimensions(Number.NaN, 100)).toThrow()
  })
})

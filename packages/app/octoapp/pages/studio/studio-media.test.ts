import { describe, expect, test } from "bun:test"
import { formatStudioThumbnailDuration, isStudioThumbnailUrl, resolveStudioMediaUrl, thumbnailMediaSrc } from "./studio-media"

describe("Studio media URL selection", () => {
  test("formats the result video duration as minutes and seconds", () => {
    expect(formatStudioThumbnailDuration(5)).toBe("00:05")
    expect(formatStudioThumbnailDuration("65")).toBe("01:05")
  })

  test("converts a local thumbnail path to artifact serve", () => {
    const url = resolveStudioMediaUrl({
      value: ".octo/ses_1/thumbnails/studio_gen_1-0.webp",
      sdkUrl: "http://127.0.0.1:4096",
      directory: "/config/octo/sessions",
    })
    expect(url).toContain("/artifact/serve?")
    expect(url).toContain("sessionId=ses_1")
    expect(url).toContain("path=thumbnails%2Fstudio_gen_1-0.webp")
    expect(isStudioThumbnailUrl(url)).toBe(true)
  })

  test("rejects a remote thumbnail value but keeps displaying the original image", () => {
    expect(isStudioThumbnailUrl("https://example.com/original.png")).toBe(false)
    expect(thumbnailMediaSrc({
      id: "image",
      url: "https://example.com/original.png",
      thumbnailUrl: "https://example.com/original.png",
      thumbnailStatus: "ready",
    })).toBe("https://example.com/original.png")
  })

  test("uses the original image until a local thumbnail is ready", () => {
    const image = { id: "image", kind: "image" as const, url: "http://localhost:3000/image.png" }
    expect(thumbnailMediaSrc(image)).toBe(image.url)
    expect(thumbnailMediaSrc({ ...image, thumbnailStatus: "pending" })).toBe(image.url)
    expect(thumbnailMediaSrc({ ...image, thumbnailStatus: "failed" })).toBe(image.url)
    expect(thumbnailMediaSrc({ ...image, kind: "video", thumbnailStatus: "failed" })).toBeUndefined()
  })
})

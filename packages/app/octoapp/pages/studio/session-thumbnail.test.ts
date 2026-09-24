import { describe, expect, test } from "bun:test"
import type { Message, Part } from "@opencode-ai/sdk/v2/client"
import { extractFirstImageFromMessages, sessionThumbnailUsesVideoElement } from "./session-thumbnail"

function message(
  output: Record<string, unknown>,
  created = 1,
  attachments?: Array<{ url: string; kind?: "image" | "video"; mime?: string }>,
) {
  return {
    info: {
      id: `msg_${created}`,
      sessionID: "ses_1",
      role: "assistant",
      time: { created },
    } as unknown as Message,
    parts: [{
      id: `part_${created}`,
      sessionID: "ses_1",
      messageID: `msg_${created}`,
      type: "tool",
      tool: "internel_image_generate",
      state: {
        status: "completed",
        title: "图片生成",
        input: {},
        output: JSON.stringify(output),
        attachments,
        time: { start: created, end: created + 1 },
      },
    } as Part],
  }
}

describe("Studio session thumbnail extraction", () => {
  test("renders a ready video poster as an image even when an old fallback flag remains", () => {
    expect(sessionThumbnailUsesVideoElement({
      url: ".octo/ses_1/thumbnails/video.webp",
      updatedAt: 1,
      kind: "video",
      fallback: true,
    })).toBe(false)
    expect(sessionThumbnailUsesVideoElement({
      url: "https://example.com/video.mp4",
      updatedAt: 1,
      kind: "video",
      fallback: true,
    })).toBe(true)
  })

  test("uses a legacy original image until a thumbnail is available", () => {
    expect(extractFirstImageFromMessages([
      message({ images: ["https://example.com/original.png"] }),
    ])).toBe("https://example.com/original.png")
  })

  test("uses legacy tool attachments when structured output has no media", () => {
    expect(extractFirstImageFromMessages([
      message({}, 1, [
        { url: "https://example.com/video.mp4", kind: "video" },
        { url: "https://example.com/attachment.png", kind: "image" },
      ]),
    ])).toBe("https://example.com/attachment.png")
  })

  test("uses the newest ready local thumbnail and prefers images", () => {
    expect(extractFirstImageFromMessages([
      message({ media: [{ kind: "image", url: "https://example.com/old.png", thumbnailStatus: "ready", thumbnailUrl: ".octo/ses_1/thumbnails/old.webp" }] }, 1),
      message({ media: [
        { kind: "video", url: "https://example.com/new.mp4", thumbnailStatus: "ready", thumbnailUrl: ".octo/ses_1/thumbnails/video.webp" },
        { kind: "image", url: "https://example.com/new.png", thumbnailStatus: "ready", thumbnailUrl: ".octo/ses_1/thumbnails/new.webp" },
      ] }, 2),
    ])).toBe(".octo/ses_1/thumbnails/new.webp")
  })

  test("uses the original image while thumbnail generation is pending", () => {
    expect(extractFirstImageFromMessages([
      message({ media: [{ kind: "image", url: "https://example.com/original.png", thumbnailStatus: "pending" }] }),
    ])).toBe("https://example.com/original.png")
  })

  test("uses the original image after thumbnail generation fails", () => {
    expect(extractFirstImageFromMessages([
      message({ media: [{ kind: "image", url: "http://localhost:3000/image.png", thumbnailStatus: "failed" }] }),
    ])).toBe("http://localhost:3000/image.png")
  })

  test("uses the original video until a local poster is ready", () => {
    expect(extractFirstImageFromMessages([
      message({ media: [{ kind: "video", url: "https://example.com/video.mp4", thumbnailStatus: "failed" }] }),
    ])).toBe("https://example.com/video.mp4")
    expect(extractFirstImageFromMessages([
      message({ media: [{ kind: "video", url: "https://example.com/video.mp4", thumbnailStatus: "ready", thumbnailUrl: ".octo/ses_1/thumbnails/video.webp" }] }),
    ])).toBe(".octo/ses_1/thumbnails/video.webp")
  })
})

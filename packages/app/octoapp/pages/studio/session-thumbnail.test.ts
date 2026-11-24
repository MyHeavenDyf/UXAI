import { describe, expect, test } from "bun:test"
import type { Message, Part } from "@opencode-ai/sdk/v2/client"
import {
  extractFirstImageFromMessages,
  extractBoardThumbnailFromMessages,
  sessionThumbnailUsesVideoElement,
  shouldReplaceSessionThumbnail,
} from "./session-thumbnail"

function message(
  output: Record<string, unknown>,
  created = 1,
  attachments?: Array<{ url: string; kind?: "image" | "video"; mime?: string }>,
  completed = created + 1,
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
        time: { start: created, end: completed },
      },
    } as Part],
  }
}

describe("Studio session thumbnail extraction", () => {
  test("board thumbnails use the latest successful completion rather than task creation order", () => {
    const slow = message({ media: [{ kind: "image", url: "https://example.com/slow.png" }] }, 1, undefined, 30)
    const fast = message({ media: [{ kind: "image", url: "https://example.com/fast.png" }] }, 10, undefined, 20)
    const failed = message({ error: "生成失败" }, 40, undefined, 50)
    expect(extractBoardThumbnailFromMessages([slow, fast, failed])).toEqual({
      url: "https://example.com/slow.png",
      kind: "image",
      generationAt: 30,
    })
    expect(extractFirstImageFromMessages([slow, fast, failed])).toBe("https://example.com/fast.png")
    const video = message(
      {
        media: [
          {
            kind: "video",
            url: "https://example.com/video.mp4",
            thumbnailStatus: "ready",
            thumbnailUrl: ".octo/ses_1/thumbnails/video.webp",
          },
        ],
      },
      2,
      undefined,
      60,
    )
    expect(extractBoardThumbnailFromMessages([slow, fast, video, failed])).toEqual({
      url: ".octo/ses_1/thumbnails/video.webp",
      kind: "video",
      generationAt: 60,
    })
  })
  test("does not let an older generation overwrite the latest session thumbnail", () => {
    const latest = {
      url: ".octo/ses_1/thumbnails/latest.webp",
      updatedAt: 30,
      generationAt: 20,
    }
    expect(shouldReplaceSessionThumbnail(latest, 10)).toBe(false)
    expect(shouldReplaceSessionThumbnail(latest, 20)).toBe(true)
    expect(shouldReplaceSessionThumbnail(latest, 30)).toBe(true)
  })

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

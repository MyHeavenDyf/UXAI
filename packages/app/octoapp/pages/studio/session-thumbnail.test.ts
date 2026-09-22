import { describe, expect, test } from "bun:test"
import type { Message, Part } from "@opencode-ai/sdk/v2/client"
import { extractFirstImageFromMessages } from "./session-thumbnail"

function message(output: Record<string, unknown>, created = 1) {
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
        time: { start: created, end: created + 1 },
      },
    } as Part],
  }
}

describe("Studio session thumbnail extraction", () => {
  test("uses a legacy original image until a thumbnail is available", () => {
    expect(extractFirstImageFromMessages([
      message({ images: ["https://example.com/original.png"] }),
    ])).toBe("https://example.com/original.png")
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
})

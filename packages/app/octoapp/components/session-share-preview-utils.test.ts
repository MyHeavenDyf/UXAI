import { describe, expect, test } from "bun:test"
import { marked } from "marked"
import {
  previewLayout,
  previewMarkdown,
  previewMessageContent,
  SHARE_PREVIEW_LIMIT,
  type SharePreviewMessage,
} from "./session-share-preview-utils"

describe("share preview rendering budget", () => {
  const messages: SharePreviewMessage[] = Array.from({ length: SHARE_PREVIEW_LIMIT }, (_, index) => ({
    id: `msg_${index}`,
    role: "user",
    text: "正文",
    files: [],
    truncated: false,
  }))

  test("only mounts a viewport and overscan instead of the full history", () => {
    const layout = previewLayout(messages, {}, 6000, 280)
    expect(layout.height).toBe(14400)
    expect(layout.visible.length).toBeLessThanOrEqual(7)
    expect(layout.visible.some((message) => message.id === "msg_41")).toBe(true)
    expect(layout.visible.some((message) => message.id === "msg_0")).toBe(false)
  })

  test("accounts for measured row heights and supports empty sessions", () => {
    expect(previewLayout(messages, { msg_0: 300 }, 0, 280).offsets.msg_1).toBe(300)
    expect(previewLayout([], {}, 0, 280)).toEqual({ height: 0, offsets: {}, visible: [] })
  })

  test("turns real HTML artifacts into file cards while preserving surrounding prose", () => {
    const content = previewMessageContent({
      id: "msg_artifact",
      role: "assistant",
      files: [],
      truncated: false,
      text: '下面是视觉分析。\n\n<artifact identifier="sync-status-bar" type="html" title="同步状态按钮原型">\n<!DOCTYPE html><html><style>body{color:red}</style><script>PRIVATE_SCRIPT()</script><body>PRIVATE_HTML_SOURCE</body></html>\n</artifact>\n\n文件已生成。',
    })
    expect(content.text).toBe("下面是视觉分析。\n\n\n\n文件已生成。")
    expect(content.files).toEqual([{ name: "同步状态按钮原型.html", mime: "text/html" }])
    expect(JSON.stringify(content)).not.toContain("PRIVATE_")
  })

  test("hides a clipped artifact body and keeps normal code examples unchanged", () => {
    const base = { id: "msg_preview", role: "assistant" as const, files: [], truncated: true }
    const clipped = previewMessageContent({
      ...base,
      text: '说明\n<artifact type="html" title="login.html"><html>PRIVATE_SOURCE',
    })
    expect(clipped.text).toBe("说明")
    expect(clipped.files).toEqual([{ name: "login.html", mime: "text/html" }])
    const example = '示例：\n\n```html\n<artifact type="html" title="示例">这是代码示例</artifact>\n```'
    expect(previewMessageContent({ ...base, text: example }).text).toBe(example)
    expect(previewMessageContent({ ...base, text: example }).files).toEqual([])
    expect(previewMessageContent({ ...base, role: "user", text: example }).text).toBe(example)
  })

  test("renders Markdown without scripts, links, images or executable artifacts", () => {
    const html = previewMarkdown(
      '**你好**\n\n[打开](javascript:alert(1)) ![图片](https://example.com/image.png)\n\n<img src=x onerror=alert(1)>\n<script>alert(1)</script>\n\n```html\n<iframe src="https://example.com"></iframe>\n```',
    )
    expect(html).toContain("<strong>你好</strong>")
    expect(html).not.toMatch(/<(script|img|iframe|a)(\s|>)/i)
    expect(html).not.toContain("onerror")
    expect(html).toContain("&lt;iframe")
  })

  test("stays synchronous and isolated when App enables global async Markdown extensions", async () => {
    const defaults = { ...marked.defaults }
    let calls = 0
    marked.use({
      async: true,
      walkTokens: async () => {
        calls++
      },
    })
    try {
      expect(await marked.parse("**App**")).toContain("<strong>App</strong>")
      const before = calls
      const html = previewMarkdown("**预览**\n\n<script>alert(1)</script>")
      expect(typeof html).toBe("string")
      expect(html).toContain("<strong>预览</strong>")
      expect(html).not.toContain("<script>")
      expect(calls).toBe(before)
    } finally {
      marked.setOptions(defaults)
    }
  })
})

import { expect, test } from "bun:test"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { commentAuthor, commentFileKey, commentPinTarget, commentTarget, createHtmlComments } from "./html-comments"
import type { FileComment } from "../../make/components/result-viewer/comment-popover"

test("标注作者沿用 Design 头像地址，无账号或登录数据损坏时回退", () => {
  const previous = localStorage.getItem("userInfo")
  try {
    localStorage.setItem("userInfo", JSON.stringify({ nickName: "测试用户", account: "a123456" }))
    expect(commentAuthor()).toMatchObject({ commenterName: "测试用户", commenterAccount: "a123456" })
    expect(commentAuthor().commenterAvatar).toMatch(/^https:\/\/octo\.hdesign\.huawei\.com\/w3lab\/rest\/yellowpage\/face\/123456\/120\?ts=\d+$/)
    localStorage.setItem("userInfo", "{}")
    expect(commentAuthor().commenterAvatar).toBe("")
    localStorage.setItem("userInfo", "invalid json")
    expect(commentAuthor().commenterAvatar).toBe("")
  } finally {
    if (previous === null) localStorage.removeItem("userInfo")
    else localStorage.setItem("userInfo", previous)
  }
})

test("完整路径隔离同名文件，Windows 路径大小写归一，长路径键长度固定", async () => {
  expect(await commentFileKey("C:\\A\\page.html")).toBe(await commentFileKey("c:/a/page.html"))
  expect(await commentFileKey("/a_b/page.html")).not.toBe(await commentFileKey("/a/b/page.html"))
  expect((await commentFileKey("/目录".repeat(100) + "/page.html")).length).toBe(72)
})
test("拒绝不完整、非有限坐标的 iframe 标注数据", () => {
  expect(commentTarget({ elementId: "a", selector: "h1", position: { x: NaN, y: 0, w: 1, h: 1 } })).toBeUndefined()
  expect(commentTarget(null)).toBeUndefined()
  expect(commentTarget({ elementId: "a", selector: "h1", position: { x: 0, y: 0, w: 1, h: 1 } })?.selector).toBe("h1")
})
test("已有标记以当前视口坐标打开，拒绝非法坐标", () => {
  const comment: FileComment = { id: "c1", filePath: "/a.html", elementId: "el-1", selector: "h1", label: "", text: "", htmlHint: "", note: "修改", position: { x: 0.9, y: 0.9, w: 0.1, h: 0.1 }, createdAt: 1, updatedAt: 1 }
  const rect = { left: 80, top: 120, width: 40, height: 40 }
  expect(commentPinTarget(comment, rect)).toMatchObject({ hoverPoint: { x: 128, y: 120 }, pinPosition: rect })
  expect(commentPinTarget(comment, { ...rect, top: 30 })?.hoverPoint?.y).toBe(30)
  expect(commentPinTarget(comment, { ...rect, top: NaN })).toBeUndefined()
  expect(commentPinTarget(comment, null)).toBeUndefined()
  expect(comment.position.y).toBe(0.9)
})

test("通过 HTTP 复用标注协议，绑定原会话，保存后可读回与删除", async () => {
  const saved = new Map<string, FileComment[]>()
  const server = createServer(async (request, response) => {
      response.setHeader("Access-Control-Allow-Origin", "*")
      response.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
      response.setHeader("Access-Control-Allow-Headers", "Content-Type, x-opencode-directory")
      if (request.method === "OPTIONS") { response.end(); return }
      const url = new URL(request.url!, "http://127.0.0.1")
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(Buffer.from(chunk))
      const data = request.method === "POST" ? JSON.parse(Buffer.concat(chunks).toString()) : Object.fromEntries(url.searchParams)
      const key = `${data.sessionId}/${data.commentFilePath}`
      if (request.method === "POST") saved.set(key, [data.comment])
      if (request.method === "DELETE") saved.set(key, (saved.get(key) ?? []).filter(item => item.id !== data.commentId))
      response.setHeader("Content-Type", "application/json")
      response.end(JSON.stringify(request.method === "GET" ? { comments: saved.get(key) ?? [] } : { ok: true }))
  })
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve))
  try {
    const origin = { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, directory: "/project", sessionId: "s1", filePath: "/a/page.html" }
    const client = createHtmlComments(origin)
    origin.sessionId = "s2"
    const comment: FileComment = { id: "c1", filePath: "/a/page.html", elementId: "el-1", selector: "h1", label: "", text: "标题", htmlHint: "", note: "修改标题", position: { x: 0, y: 0, w: 1, h: 1 }, createdAt: 1, updatedAt: 1 }
    await client.save(comment)
    expect(await client.load()).toEqual([comment])
    await client.save({ ...comment, commenterAccount: "b654321", commenterAvatar: "" })
    expect((await client.load())[0].commenterAvatar).toContain("/face/654321/120?ts=")
    await client.save({ ...comment, commenterAccount: "b654321", commenterAvatar: "https://example.com/existing-avatar.png" })
    expect((await client.load())[0].commenterAvatar).toBe("https://example.com/existing-avatar.png")
    expect([...saved.keys()][0]).toStartWith("s1/")
    expect(await createHtmlComments({ ...origin, filePath: "/b/page.html" }).load()).toEqual([])
    await client.remove("c1")
    expect(await client.load()).toEqual([])
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
})

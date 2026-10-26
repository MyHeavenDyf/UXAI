import { afterEach, expect, test } from "bun:test"
import JSZip from "jszip"
import { Blob as NodeBlob } from "node:buffer"
import { createArchiveZip } from "./archive-utils"
import type { FileComment } from "../../make/components/result-viewer/comment-popover"

const originalApi = Object.getOwnPropertyDescriptor(window, "api")
afterEach(() => {
  if (originalApi) Object.defineProperty(window, "api", originalApi)
  if (!originalApi) Reflect.deleteProperty(window, "api")
})
const comment: FileComment = {
  id: "comment-1", filePath: "/project/page.html", elementId: "el-1", selector: "h1",
  label: "标题", text: "标题", htmlHint: "", note: "修改标题", position: { x: 0, y: 0, w: 1, h: 1 },
  createdAt: 10, updatedAt: 20, commenterAccount: "a123", commenterName: "作者",
}
const options = () => ({ screenshotBlob: new NodeBlob(["screenshot"]) as unknown as Blob, htmlContent: "<h1>标题</h1>", htmlFilePath: "" })

test("HTML 归档包含 Design 协议的标注数据，保留作者、位置选择器和备注", async () => {
  const blob = await createArchiveZip({ ...options(), comments: [comment] })
  const zip = await JSZip.loadAsync(await blob.arrayBuffer())
  expect(JSON.parse(await zip.file("data/comments.json")!.async("string"))).toEqual([
    { id: "comment-1", note: "修改标题", selector: "h1", time: 20, account: "a123", userName: "作者", attachments: [] },
  ])
  expect(await zip.file("preview/index.html")!.async("string")).toBe("<h1>标题</h1>")
})

test("无标注的 HTML 继续生成合法空列表", async () => {
  const zip = await JSZip.loadAsync(await (await createArchiveZip(options())).arrayBuffer())
  expect(JSON.parse(await zip.file("data/comments.json")!.async("string"))).toEqual([])
})

test("标注附件按 Design 目录打包，附件读不到时不能静默生成残缺归档", async () => {
  const bytes = new TextEncoder().encode("附件内容").buffer
  const paths: string[] = []
  Object.defineProperty(window, "api", { configurable: true, value: {
    readFileBuffer: async (path: string) => { paths.push(path); return bytes },
  } })
  const input = { ...options(), projectDir: "/project", comments: [{ ...comment, attachments: [{
    id: "attachment-1", filename: "note.txt", mime: "text/plain", size: bytes.byteLength,
    filePath: ".octo/s1/comments/file/comment-1/note.txt", uploadedAt: 10,
  }] }] }
  const zip = await JSZip.loadAsync(await (await createArchiveZip(input)).arrayBuffer())
  expect(paths).toEqual(["/project/.octo/s1/comments/file/comment-1/note.txt"])
  expect(await zip.file("data/comment-1/attachment-1.txt")!.async("string")).toBe("附件内容")
  expect(JSON.parse(await zip.file("data/comments.json")!.async("string"))[0].attachments).toEqual([{ fileName: "note.txt", id: "attachment-1.txt" }])
  Object.defineProperty(window, "api", { configurable: true, value: { readFileBuffer: async () => null } })
  await expect(createArchiveZip(input)).rejects.toThrow("标注附件读取失败")
})

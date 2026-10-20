import { afterAll, afterEach, describe, expect, spyOn, test } from "bun:test"
import { mkdtemp, mkdir, readFile, rm, stat, writeFile, readdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve, sep } from "node:path"
import JSZip from "jszip"
import type { ResultTab } from "../components/result-viewer/tab-store"
import { createC2DZip } from "../../make/utils/canvas-to-design"
import { canvasDisabledReason, createCanvasOptions, saveCanvasReturn } from "./canvas-edit"
import { insightCanvasTransport } from "./canvas-transport"
import { tracker } from "@/utils/tracker"

const tracking = spyOn(tracker, "interaction").mockImplementation(() => {})
afterAll(() => tracking.mockRestore())

const roots: string[] = []
const originalApi = Object.getOwnPropertyDescriptor(window, "api")
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => {
    if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error("Invalid test cleanup root")
    return rm(root, { recursive: true, force: true })
  }))
  if (originalApi) Object.defineProperty(window, "api", originalApi)
  if (!originalApi) Reflect.deleteProperty(window, "api")
})

const api = {
  readFileBuffer: (path: string) => Bun.file(path).arrayBuffer(),
  writeFileBuffer: async (path: string, data: ArrayBuffer) => { await mkdir(dirname(path), { recursive: true }); await writeFile(path, new Uint8Array(data)) },
  fileExists: (path: string) => stat(path).then(value => value.isFile(), () => false),
  dirExists: (path: string) => stat(path).then(value => value.isDirectory(), () => false),
}
function tab(values: Partial<ResultTab> = {}): ResultTab {
  return { id: "html-1", title: "报告", type: "html", source: "inline", content: "<html><body>cached</body></html>", createdAt: new Date(), ...values }
}
async function workspace() {
  const directory = await mkdtemp(join(tmpdir(), "insight-canvas-"))
  roots.push(directory)
  return directory
}
async function put(directory: string, path: string, content: string) {
  await mkdir(dirname(join(directory, path)), { recursive: true })
  await writeFile(join(directory, path), content)
  return join(directory, path)
}
function origin(directory: string, values: Partial<Parameters<typeof createCanvasOptions>[0]> = {}) {
  return { directory, sessionId: "s1", tab: tab(), api, notify: () => {}, ...values }
}
async function unpack(blob: Blob) {
  const outer = await JSZip.loadAsync(await blob.arrayBuffer())
  return { manifest: JSON.parse(await outer.file("octo-c2d.json")!.async("string")), html: await JSZip.loadAsync(await outer.file("data/html.zip")!.async("arraybuffer")) }
}
function returned(filename: string, content: string) {
  return { filename, base64: Buffer.from(content).toString("base64") }
}

describe("Insight HTML 画布入口条件", () => {
  test("占位接口始终不可用；内容、模式和会话分别给出原因", () => {
    expect(insightCanvasTransport.available).toBe(false)
    expect(canvasDisabledReason(tab(), "preview", "s1", false)).toContain("当前环境暂不支持")
    expect(canvasDisabledReason(tab(), "source", "s1", true)).toContain("切换到预览")
    expect(canvasDisabledReason(tab({ content: undefined }), "preview", "s1", true)).toContain("加载中")
    expect(canvasDisabledReason(tab({ content: " \n " }), "preview", "s1", true)).toContain("为空")
    expect(canvasDisabledReason(tab(), "preview", undefined, true)).toContain("进入会话")
    expect(canvasDisabledReason(tab({ type: "markdown" }), "preview", "s1", true)).toContain("仅 HTML")
    expect(canvasDisabledReason(tab(), "preview", "s1", true)).toBe("")
    expect(canvasDisabledReason(tab(), "preview", "s1", true, "error")).toContain("读取失败")
    expect(canvasDisabledReason(tab(), "preview", "s1", true, "loading")).toContain("加载中")
  })
})

describe("C2D 使用真实 HTML 和资源", () => {
  test("递归 CSS 资源完整打包；读取快照与原文件后续变更隔离，同次 getZip 复用", async () => {
    const directory = await workspace()
    const html = '<link rel="stylesheet" href="css/main.css"><img src="images/a.svg">'
    const filePath = await put(directory, "report.html", html)
    await put(directory, "css/main.css", 'body{background:url("../images/b.svg")}')
    await put(directory, "images/a.svg", "<svg>a</svg>")
    await put(directory, "images/b.svg", "<svg>b</svg>")
    const options = await createCanvasOptions(origin(directory, { tab: tab({ source: "path", filePath, content: "stale" }) }))
    await writeFile(filePath, "changed after prepare")
    await writeFile(join(directory, "images/a.svg"), "changed asset")
    const first = options.getZip()
    expect(options.getZip()).toBe(first)
    const result = await unpack(await first)
    expect(result.manifest).toEqual({ name: "octo-c2d", version: "1.0.0", frames: [{ name: "报告", filePath: "./data/html.zip" }] })
    expect(await result.html.file("index.html")!.async("string")).toBe(html)
    expect(await result.html.file("images/a.svg")!.async("string")).toBe("<svg>a</svg>")
    expect(await result.html.file("images/b.svg")!.async("string")).toBe("<svg>b</svg>")
  })
  test("已落盘 URI 用本地副本；inline 去围栏且无本地路径", async () => {
    const directory = await workspace()
    const filePath = await put(directory, "local.html", "local edits")
    const local = await createCanvasOptions(origin(directory, { tab: tab({ source: "uri", filePath, uri: "https://example.test/report", content: "remote" }) }))
    expect(await (await unpack(await local.getZip())).html.file("index.html")!.async("string")).toBe("local edits")
    const inline = await createCanvasOptions(origin(directory, { tab: tab({ title: "", fileName: "fallback.html", content: "```html\n<h1>inline</h1>\n```" }) }))
    expect(inline.config.designName).toBe("fallback.html")
    expect(await (await unpack(await inline.getZip())).html.file("index.html")!.async("string")).toBe("<h1>inline</h1>")
  })
  test("读盘失败不得导入缓存；缺少路径、空 HTML 均拒绝", async () => {
    const directory = await workspace()
    await expect(createCanvasOptions(origin(directory, { tab: tab({ source: "path", filePath: join(directory, "missing.html") }) }))).rejects.toThrow("无法读取 HTML")
    await expect(createCanvasOptions(origin(directory, { tab: tab({ source: "path" }) }))).rejects.toThrow("无法读取 HTML")
    await expect(createCanvasOptions(origin(directory, { tab: tab({ content: "" }) }))).rejects.toThrow("HTML 内容为空")
  })
  test("父级引用在读取外部资源前拒绝，必要资源缺失也拒绝", async () => {
    const directory = await workspace()
    const filePath = await put(directory, "page/index.html", '<script src="../outside.js"></script>')
    await put(directory, "outside.js", "private")
    const reads: string[] = []
    await expect(createCanvasOptions(origin(directory, {
      tab: tab({ source: "path", filePath }),
      api: { ...api, readFileBuffer: path => { reads.push(path); return api.readFileBuffer(path) } },
    }))).rejects.toThrow("所在目录之外")
    expect(reads.some(path => path.endsWith("outside.js"))).toBe(false)
    await writeFile(filePath, '<img src="missing.svg">')
    await expect(createCanvasOptions(origin(directory, { tab: tab({ source: "path", filePath }) }))).rejects.toThrow("本地资源无法读取")
  })
  test("无基准相对资源被阻止，外部 URL 原样保留并提示联网", async () => {
    const directory = await workspace()
    await expect(createCanvasOptions(origin(directory, { tab: tab({ content: '<img src="images/a.png">' }) }))).rejects.toThrow("保存到本地目录")
    const notices: string[] = []
    const html = '<img src="https://example.test/a.svg">'
    const options = await createCanvasOptions(origin(directory, { tab: tab({ source: "uri", content: html }), notify: title => { notices.push(title) } }))
    expect(notices).toEqual(["外部资源依赖画布环境联网加载"])
    expect(await (await unpack(await options.getZip())).html.file("index.html")!.async("string")).toBe(html)
  })
  test("Design 旧调用沿用 window.api 及读盘失败回退，不使用 Insight 的严格检查", async () => {
    const directory = await workspace()
    const filePath = await put(directory, "report.html", '<img src="missing.svg">disk')
    Object.defineProperty(window, "api", { configurable: true, value: {
      marker: "original-receiver",
      readFileBuffer(path: string) {
        expect(this.marker).toBe("original-receiver")
        return api.readFileBuffer(path).catch(() => null)
      },
    } })
    const options = { htmlContent: "fallback", htmlFilePath: filePath, tabTitle: "Design" }
    expect(await (await unpack(await createC2DZip(options))).html.file("index.html")!.async("string")).toContain("disk")
    await rm(filePath)
    expect(await (await unpack(await createC2DZip(options))).html.file("index.html")!.async("string")).toBe("fallback")
  })
})

describe("画布回传使用真实文件系统", () => {
  test("并发同名 HTML 不覆盖；文件与目录撞名也避让", async () => {
    const directory = await workspace()
    const uploads = join(directory, ".octo/s1/uploads")
    await mkdir(join(uploads, "report.html"), { recursive: true })
    const paths = await Promise.all([saveCanvasReturn(returned("report.html", "first"), origin(directory)), saveCanvasReturn(returned("report.html", "second"), origin(directory))])
    expect(paths[0]).toEndWith("report (1).html")
    expect(paths[1]).toEndWith("report (2).html")
    expect(await readFile(paths[0], "utf8")).toBe("first")
    expect(await readFile(paths[1], "utf8")).toBe("second")
  })
  test("ZIP 保留资源相对结构；同名目录不覆盖，原 HTML 保持原样", async () => {
    const directory = await workspace()
    const original = await put(directory, "original.html", "original")
    const zip = new JSZip().file("index.html", '<img src="images/a.svg">').file("images/a.svg", "<svg/>")
    const data = { filename: "report.zip", base64: await zip.generateAsync({ type: "base64" }) }
    const first = await saveCanvasReturn(data, origin(directory))
    const second = await saveCanvasReturn(data, origin(directory))
    expect(second).toBe(`${first} (1)`)
    expect(await readFile(`${first}/images/a.svg`, "utf8")).toBe("<svg/>")
    expect(await readFile(`${second}/index.html`, "utf8")).toContain('src="images/a.svg"')
    expect(await readFile(original, "utf8")).toBe("original")
  })
  test("回调固定原会话；刷新失败不影响写入成功", async () => {
    const directory = await workspace()
    const notices: string[] = []
    const input = origin(directory, { notify: title => { notices.push(title) }, onFilesRefresh: () => { throw new Error("refresh") } })
    const options = await createCanvasOptions(input)
    input.sessionId = "s2"
    await options.downloadHtml!(returned("edited.html", "saved"))
    expect(await readFile(join(directory, ".octo/s1/uploads/edited.html"), "utf8")).toBe("saved")
    expect(await api.dirExists(join(directory, ".octo/s2"))).toBe(false)
    expect(notices).toEqual(["已保存到会话文件", "文件已保存，但会话文件列表刷新失败，请手动刷新"])
  })
  test("缺少可靠撞名检查时不提供回传能力；拒绝坏数据及越界文件名", async () => {
    const directory = await workspace()
    expect((await createCanvasOptions(origin(directory, { api: { writeFileBuffer: api.writeFileBuffer } }))).downloadHtml).toBeUndefined()
    for (const data of [returned("../evil.html", "bad"), returned("C:/evil.html", "bad"), returned("report.txt", "bad"), { filename: "report.html", base64: "%%%=" }, returned(".zip", "bad")]) {
      await expect(saveCanvasReturn(data, origin(directory))).rejects.toThrow()
    }
    expect(await readdir(directory)).toEqual([])
  })
  test("原始 ZIP 越界路径及大小写冲突在写盘前拒绝", async () => {
    const directory = await workspace()
    for (const zip of [new JSZip().file("../outside.html", "bad"), new JSZip().file("a.html", "a").file("A.html", "b"), new JSZip()]) {
      await expect(saveCanvasReturn({ filename: "report.zip", base64: await zip.generateAsync({ type: "base64" }) }, origin(directory))).rejects.toThrow()
      expect(await readdir(directory)).toEqual([])
    }
  })
  test("部分写盘失败保留文件，重试另选目录", async () => {
    const directory = await workspace()
    const notices: string[] = []
    const data = { filename: "report.zip", base64: await new JSZip().file("a.html", "a").file("b.html", "b").generateAsync({ type: "base64" }) }
    await expect(saveCanvasReturn(data, origin(directory, {
      notify: title => { notices.push(title) },
      api: { ...api, writeFileBuffer: (path, data) => path.endsWith("b.html") ? Promise.reject(new Error("write")) : api.writeFileBuffer(path, data) },
    }))).rejects.toThrow("保存不完整")
    expect(notices.some(notice => notice === "已保存到会话文件")).toBe(false)
    expect(await readFile(join(directory, ".octo/s1/uploads/report/a.html"), "utf8")).toBe("a")
    expect(await saveCanvasReturn(data, origin(directory))).toEndWith("report (1)")
  })
})

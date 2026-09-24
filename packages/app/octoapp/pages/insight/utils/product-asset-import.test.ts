import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, readFile, rename, rm, readdir, stat, writeFile } from "node:fs/promises"
import { join, dirname } from "node:path"
import { tmpdir } from "node:os"
import JSZip from "jszip"
import { assetDownloadSource, importProductAsset, migrateAssetMentions, safeAssetPath } from "./product-asset-import"

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
async function workspace() {
  const root = await mkdtemp(join(tmpdir(), "insight-assets-"))
  roots.push(root)
  return root
}
const api = {
  writeFileBuffer: async (path: string, buffer: ArrayBuffer) => { await mkdir(dirname(path), { recursive: true }); await writeFile(path, new Uint8Array(buffer)) },
  movePendingUploadToSession: async (path: string, directory: string, session: string) => {
    const dest = join(directory, ".octo", session, "uploads", path.replace(/\\/g, "/").split("/").at(-1)!)
    await mkdir(dirname(dest), { recursive: true })
    await rename(path, dest)
    return dest
  },
}
function response(bytes: ArrayBuffer) {
  return async () => new Response(bytes)
}

describe("产品资产导入", () => {
  test("沿用 type 30/40 地址规则", () => {
    expect(assetDownloadSource({ type: 40, fileName: "稿.txt", s3BaseUrl: "https://assets.test/", docPath: "/files/a.txt" }, "")).toEqual({ url: "https://assets.test/files/a.txt", filename: "稿.txt" })
    expect(assetDownloadSource({ type: 30, fileName: "原型", versionInfo: [{ filePath: "/v1", fileName: "src.zip", fileSize: 1 }] }, "https://assets.test")).toEqual({ url: "https://assets.test/main/v1/src.zip", filename: "原型.zip" })
  })
  test("ZIP 保留目录和相对链接，整目录迁移且同根只迁移一次", async () => {
    const directory = await workspace()
    const zip = new JSZip().file("index.html", '<img src="images/a.svg">').file("images/a.svg", "<svg/>")
    const result = await importProductAsset({ type: 40, fileName: "prototype.zip", docPath: "a.zip" }, {
      directory, baseUrl: "", api, signal: new AbortController().signal, fetch: response(await zip.generateAsync({ type: "arraybuffer" })),
    })
    expect(await readFile(`${result.root}/images/a.svg`, "utf8")).toBe("<svg/>")
    const moved = new Map<string, string>()
    const files = await migrateAssetMentions(result.files, directory, "session", api.movePendingUploadToSession, moved)
    expect(moved.size).toBe(1)
    expect(await readFile(files[0].path, "utf8")).toContain('src="images/a.svg"')
    expect(await readFile(files[1].path, "utf8")).toBe("<svg/>")
    expect(await migrateAssetMentions(result.files, directory, "session", api.movePendingUploadToSession, moved)).toEqual(files)
  })
  test("已有会话直接导入 uploads，同名两次不覆盖", async () => {
    const directory = await workspace()
    const options = { directory, sessionId: "s1", baseUrl: "", api, signal: new AbortController().signal, fetch: response(new TextEncoder().encode("data").buffer) }
    const file = { type: 40, fileName: "材料.txt", docPath: "a.txt" }
    const a = await importProductAsset(file, options)
    const b = await importProductAsset(file, options)
    expect(a.root).not.toBe(b.root)
    expect(a.files[0].filename).not.toBe(b.files[0].filename)
    expect(a.root.replace(/\\/g, "/")).toContain("/.octo/s1/uploads/")
    expect(await readFile(a.files[0].path, "utf8")).toBe("data")
  })
  test("写入中取消不会注册/迁移结果", async () => {
    const directory = await workspace()
    const abort = new AbortController()
    await expect(importProductAsset({ type: 40, fileName: "a.txt", docPath: "a.txt" }, {
      directory, sessionId: "s1", baseUrl: "", signal: abort.signal,
      api: { ...api, writeFileBuffer: async (path, data) => { await api.writeFileBuffer(path, data); abort.abort() } },
      fetch: response(new ArrayBuffer(1)),
    })).rejects.toThrow()
    expect(await stat(join(directory, ".octo", "s1")).catch(() => null)).toBeNull()
  })
  test("拒绝越界、危险文件名和空包；错误发生在写盘前", async () => {
    for (const name of ["../a", "/a", "C:/a", "a/../b", "CON.txt", "a."]) expect(() => safeAssetPath(name)).toThrow()
    const directory = await workspace()
    const zip = new JSZip().file("../outside.txt", "bad")
    await expect(importProductAsset({ type: 40, fileName: "a.zip", docPath: "a.zip" }, {
      directory, baseUrl: "", api, signal: new AbortController().signal, fetch: response(await zip.generateAsync({ type: "arraybuffer" })),
    })).rejects.toThrow()
    expect(await readdir(directory)).toHaveLength(0)
    await expect(importProductAsset({ type: 40, fileName: "empty.zip", docPath: "empty.zip" }, {
      directory, baseUrl: "", api, signal: new AbortController().signal, fetch: response(await new JSZip().generateAsync({ type: "arraybuffer" })),
    })).rejects.toThrow("没有可引用的文件")
  })
})

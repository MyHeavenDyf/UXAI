import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, readFile, rename, rm, readdir, stat, writeFile } from "node:fs/promises"
import { join, dirname } from "node:path"
import { tmpdir } from "node:os"
import JSZip from "jszip"
import { assetDownloadSource, importProductAsset, migrateAssetMentions, safeAssetPath } from "./product-asset-import"
import { prepareAssetReferences } from "./asset-references"
import { EditorState } from "prosemirror-state"
import { history, redo, undo } from "prosemirror-history"
import { docFromJSON, editorSchema, extractMentionsFromDoc, getDocTextWithMentions } from "../components/prosemirror-editor/schema"
import { insertAddonMentions, removeAddonMention } from "./addon-mentions"
import { buildParagraphs, queuedMentions, splitMentions } from "./mention"

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
async function workspace() {
  const root = await mkdtemp(join(tmpdir(), "insight-assets-"))
  roots.push(root)
  return root
}
const api = {
  readFileBuffer: async (path: string) => { const bytes = await readFile(path); return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) },
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
    expect(result.reference).toEqual({ filename: expect.stringMatching(/^prototype \([\da-f]{8}\)\.zip$/), path: result.root, isFolder: true })
    const references = await migrateAssetMentions([{ ...result.reference, id: "asset-1" }], directory, "session", api.movePendingUploadToSession, moved)
    expect(moved.size).toBe(1)
    expect(await readFile(`${references[0].path}/index.html`, "utf8")).toContain('src="images/a.svg"')
    expect(await readFile(`${references[0].path}/images/a.svg`, "utf8")).toBe("<svg/>")
    expect(references).toHaveLength(1)
    expect(references[0].id).toBe("asset-1")
    expect(references[0].isFolder).toBe(true)
    expect(await migrateAssetMentions([{ ...result.reference, id: "asset-1" }], directory, "session", api.movePendingUploadToSession, moved)).toEqual(references)
    expect(prepareAssetReferences(`@${references[0].filename}`, references).text).toBe(`读取${references[0].path} 这个文件夹`)
  })
  test("已有会话直接导入 uploads，同名两次不覆盖", async () => {
    const directory = await workspace()
    const options = { directory, sessionId: "s1", baseUrl: "", api, signal: new AbortController().signal, fetch: response(new TextEncoder().encode("data").buffer) }
    const file = { type: 40, fileName: "材料.txt", docPath: "a.txt" }
    const a = await importProductAsset(file, options)
    const b = await importProductAsset(file, options)
    expect(a.root).not.toBe(b.root)
    expect(a.reference.filename).not.toBe(b.reference.filename)
    expect(a.reference.filename).toMatch(/^材料 \([\da-f]{8}\)\.txt$/)
    expect(a.root.replace(/\\/g, "/")).toContain("/.octo/s1/uploads/")
    expect(await readFile(a.reference.path, "utf8")).toBe("data")
  })
  test("ZIP 无法解压时与 design 一样保留原文件并引用文件地址", async () => {
    const directory = await workspace()
    const bytes = new TextEncoder().encode("asset source content").buffer
    const result = await importProductAsset({ type: 40, fileName: "source.zip", docPath: "source.zip" }, {
      directory, baseUrl: "", api, signal: new AbortController().signal, fetch: response(bytes),
    })
    expect(result.reference.isFolder).toBeUndefined()
    expect(result.reference.path).toBe(`${result.root}/source.zip`)
    expect(await readFile(result.reference.path, "utf8")).toBe("asset source content")
    expect(prepareAssetReferences(`@${result.reference.filename}`, [result.reference]).text).toBe(`读取${result.reference.path} 这个文件`)
  })
  test("ZIP 接口返回网页、JSON 或空内容时不写盘，并提示检查下载来源", async () => {
    const directory = await workspace()
    for (const content of ["<!DOCTYPE html><html>Login</html>", ' {"error":"unauthorized"}', ""]) {
      await expect(importProductAsset({ type: 40, fileName: "source.zip", docPath: "source.zip" }, {
        directory, baseUrl: "", api, signal: new AbortController().signal,
        fetch: response(new TextEncoder().encode(content).buffer),
      })).rejects.toThrow(content ? "请检查登录状态和资产下载地址" : "下载内容为空")
    }
    expect(await readdir(directory)).toHaveLength(0)
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
  test("201 文件 ZIP 仅一个胶囊，草稿及排队回填保持一个引用，发送只传目录地址", async () => {
    const directory = await workspace()
    const zip = new JSZip()
    Array.from({ length: 201 }, (_, index) => zip.file(`访谈/${index}.txt`, `正文 ${index}`))
    const result = await importProductAsset({ type: 40, fileName: "访谈.zip", docPath: "a.zip" }, {
      directory, sessionId: "s1", baseUrl: "", api, signal: new AbortController().signal, fetch: response(await zip.generateAsync({ type: "arraybuffer" })),
    })
    const base = EditorState.create({ schema: editorSchema, plugins: [history()] })
    let state = base.apply(insertAddonMentions(base, [{ type: "file", ...result.reference, id: "asset-1" }]))
    expect(extractMentionsFromDoc(state.doc)).toHaveLength(1)
    const restored = docFromJSON(JSON.parse(JSON.stringify(state.doc.toJSON())))
    expect(extractMentionsFromDoc(restored)[0]).toMatchObject({ id: "asset-1", isFolder: true, path: result.root })
    const mentions = extractMentionsFromDoc(restored).map(mention => ({ type: "file" as const, filename: mention.name, path: mention.path!, id: mention.id!, isFolder: mention.isFolder }))
    const split = splitMentions(mentions)
    expect(split.files).toHaveLength(1)
    const queued = { text: getDocTextWithMentions(restored), files: split.files }
    const refill = editorSchema.nodes.doc.create(null, buildParagraphs(queued.text, queuedMentions(queued)))
    expect(extractMentionsFromDoc(refill)).toEqual(extractMentionsFromDoc(restored))
    const prepared = prepareAssetReferences(queued.text, queued.files)
    expect(prepared.files).toHaveLength(0)
    expect(prepared.assets).toHaveLength(1)
    expect(prepared.text).toBe(`读取${result.root} 这个文件夹`)
    expect(await readFile(`${result.root}/访谈/200.txt`, "utf8")).toBe("正文 200")
    expect(await readdir(result.root)).toEqual(["访谈"])
    expect(undo(state, tr => { state = state.apply(tr) })).toBe(true)
    expect(extractMentionsFromDoc(state.doc)).toHaveLength(0)
    expect(redo(state, tr => { state = state.apply(tr) })).toBe(true)
    expect(extractMentionsFromDoc(state.doc)).toHaveLength(1)
    expect(extractMentionsFromDoc(state.apply(removeAddonMention(state, mentions[0])).doc)).toHaveLength(0)
  }, 30000)
  test("同名资产保持不同引用，排队回填及地址引用都不串包", async () => {
    const directory = await workspace()
    const options = { directory, sessionId: "s1", baseUrl: "", api, signal: new AbortController().signal, fetch: response(await new JSZip().file("a.txt", "data").generateAsync({ type: "arraybuffer" })) }
    const file = { type: 40, fileName: "访谈.zip", docPath: "a.zip" }
    const first = await importProductAsset(file, options)
    const second = await importProductAsset(file, options)
    const item = { text: `@${first.reference.filename} @${second.reference.filename}`, files: [first.reference, second.reference] }
    const doc = editorSchema.nodes.doc.create(null, buildParagraphs(item.text, queuedMentions(item)))
    expect(extractMentionsFromDoc(doc).map(mention => mention.path)).toEqual([first.root, second.root])
    const prepared = prepareAssetReferences(item.text, item.files)
    expect(prepared.text).toContain(first.root)
    expect(prepared.text).toContain(second.root)
    expect(prepared.files).toHaveLength(0)
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

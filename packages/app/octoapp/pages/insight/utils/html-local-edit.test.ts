import { afterEach, expect, test } from "bun:test"
import { mkdtemp, mkdir, readdir, readFile, stat, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { saveHtmlEdit } from "./html-local-edit"
import { createHtmlHistory } from "./html-history"
import type { DesktopApi } from "../lib/electron-api"

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) {
    const resolved = path.resolve(root)
    if (!resolved.startsWith(path.resolve(tmpdir()) + path.sep)) throw new Error("临时目录越界")
    await rm(resolved, { recursive: true, force: true })
  }
})
async function setup() {
  const root = await mkdtemp(path.join(tmpdir(), "insight-history-"))
  roots.push(root)
  const file = path.join(root, "page.html")
  await writeFile(file, "<h1>原始</h1>\n")
  const api: DesktopApi = {
    readFileBuffer: async file => {
      const bytes = await readFile(file)
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    },
    writeFileBuffer: async (file, bytes) => { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, new Uint8Array(bytes)) },
    dirExists: async folder => stat(folder).then(value => value.isDirectory(), () => false),
    listDirectory: async folder => (await readdir(folder, { withFileTypes: true })).map(entry => ({
      path: entry.name, type: entry.isFile() ? "file" as const : "directory" as const,
    })),
  }
  return { file, api, history: createHtmlHistory(file, api) }
}
test("局部修改落盘并保留可恢复的前后版本", async () => {
  const sample = await setup()
  await saveHtmlEdit(sample.file, "<h1>原始</h1>\n", "<h1>修改</h1>", sample.api, () => true)
  expect(await readFile(sample.file, "utf8")).toBe("<h1>修改</h1>")
  const entries = await sample.history.list()
  expect(entries).toHaveLength(2)
  await sample.history.restore(entries.find(entry => entry.actor === "init")!.id)
  expect(await readFile(sample.file, "utf8")).toBe("<h1>原始</h1>\n")
})

test("外部修改和失效的编辑会话不得覆盖文件", async () => {
  const sample = await setup()
  await expect(saveHtmlEdit(sample.file, "旧内容", "覆盖", sample.api, () => true)).rejects.toThrow("文件已发生变化")
  await expect(saveHtmlEdit(sample.file, "<h1>原始</h1>\n", "覆盖", sample.api, () => false)).rejects.toThrow("页面状态已变化")
  expect(await readFile(sample.file, "utf8")).toBe("<h1>原始</h1>\n")
  expect(await sample.history.list()).toHaveLength(0)
})

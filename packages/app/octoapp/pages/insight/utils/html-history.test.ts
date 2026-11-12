import { afterEach, expect, test } from "bun:test"
import { mkdtemp, mkdir, readdir, readFile, stat, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
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
test("原始快照、内容去重、模型版本和并发记录", async () => {
  const sample = await setup()
  const entries = await Promise.all([sample.history.record(), sample.history.record()])
  expect(entries[0].id).toBe(entries[1].id)
  expect(entries[0].actor).toBe("init")
  await writeFile(sample.file, "<h1>模型修改</h1>\n")
  await sample.history.record("agent")
  const list = await sample.history.list()
  expect(list).toHaveLength(2)
  expect(list[0].actor).toBe("agent")
  expect(await readFile(list[1].folderPath, "utf8")).toBe("<h1>原始</h1>\n")
})
test("恢复前备份未记录的当前文件，刷新后仍能找到所有版本", async () => {
  const sample = await setup()
  const initial = await sample.history.record()
  await writeFile(sample.file, "外部修改")
  await sample.history.restore(initial.id)
  expect(await readFile(sample.file, "utf8")).toBe("<h1>原始</h1>\n")
  const list = await createHtmlHistory(sample.file, sample.api).list()
  expect(list).toHaveLength(2)
  expect(await readFile(list[0].folderPath, "utf8")).toBe("外部修改")
  expect((await sample.history.record()).id).toBe(initial.id)
  expect(await sample.history.list()).toHaveLength(2)
})

test("反复切换及重新打开不新增版本，切换后的实际修改仍记录", async () => {
  const sample = await setup()
  const initial = await sample.history.record()
  await writeFile(sample.file, "修改后的内容")
  const edited = await sample.history.record("agent")
  for (const entry of [initial, edited, initial]) {
    await sample.history.restore(entry.id)
    expect(await readFile(sample.file, "utf8")).toBe(await readFile(entry.folderPath, "utf8"))
    const reopened = createHtmlHistory(sample.file, sample.api)
    expect((await reopened.record()).id).toBe(entry.id)
    expect(await reopened.list()).toHaveLength(2)
  }
  await writeFile(sample.file, "切换后继续编辑")
  const changed = await sample.history.record()
  expect(changed.id).not.toBe(initial.id)
  expect(changed.id).not.toBe(edited.id)
  expect(changed.actor).toBe("user")
  expect(await sample.history.list()).toHaveLength(3)
})
test("备份失败不覆盖当前文件，半成品不出现在版本列表", async () => {
  const sample = await setup()
  const initial = await sample.history.record()
  await writeFile(sample.file, "必须保留")
  const api = { ...sample.api, writeFileBuffer: async (file: string, bytes: ArrayBuffer) => {
    await sample.api.writeFileBuffer!(file, bytes.slice(0, 1))
    throw new Error("disk full")
  } }
  await expect(createHtmlHistory(sample.file, api).restore(initial.id)).rejects.toThrow("disk full")
  expect(await readFile(sample.file, "utf8")).toBe("必须保留")
  expect(await sample.history.list()).toHaveLength(1)
})
test("无法通过版本 ID 越界恢复；同目录不同文件隔离", async () => {
  const sample = await setup()
  await sample.history.record()
  await expect(sample.history.restore("../outside.html")).rejects.toThrow("不存在")
  const other = path.join(path.dirname(sample.file), "other.html")
  await writeFile(other, "other")
  const history = createHtmlHistory(other, sample.api)
  expect(await history.list()).toHaveLength(0)
  await history.record()
  expect(await sample.history.list()).toHaveLength(1)
})

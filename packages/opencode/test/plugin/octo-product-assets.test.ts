import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, rm, symlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { OctoProductAssets } from "../../src/agent/octo-product-assets"

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

async function asset() {
  const root = await mkdtemp(path.join(tmpdir(), "octo-product-asset-"))
  roots.push(root)
  const folder = path.join(root, "selected")
  await mkdir(folder)
  const file = path.join(folder, "interview.txt")
  await Bun.write(file, "selected interview")
  return { root, folder, file, reference: { filename: "interviews.zip", path: folder, isFolder: true } }
}

describe("产品资产地址授权", () => {
  test("只接收结构化绝对路径选择，忽略正文和无效元数据", () => {
    const reference = { filename: "a.txt", path: path.resolve("a.txt") }
    expect(OctoProductAssets.fromPart({ type: "text", metadata: { insightProductAssets: [reference, { filename: "bad", path: "relative" }] } })).toEqual([reference])
    expect(OctoProductAssets.fromPart({ type: "text" })).toEqual([])
  })

  test("路径边界包含目录本身与子文件，不包含同名前缀目录和上级", () => {
    const assets = [{ filename: "包", path: "C:\\project\\selected", isFolder: true }]
    expect(OctoProductAssets.contains("c:/PROJECT/selected/a.txt", assets)).toBe(true)
    expect(OctoProductAssets.contains("C:\\project\\selected2\\a.txt", assets)).toBe(false)
    expect(OctoProductAssets.contains("C:\\project\\selected\\..\\outside.txt", assets)).toBe(false)
  })

  test("只解析工具实际引用的文件，不展开目录和未引用文件", async () => {
    const source = await asset()
    await Bun.write(path.join(source.folder, "unused.txt"), "not selected by tool")
    const resolved = await OctoProductAssets.resolve({ download_links: [source.file] }, [source.reference])
    expect(resolved).toHaveLength(1)
    expect(resolved[0][0]).toBe(source.file)
    expect(await Bun.file(resolved[0][1]).text()).toBe("selected interview")
    expect(await OctoProductAssets.resolve({ unrelated: "nothing to read" }, [source.reference])).toEqual([])
  })

  test("目录不能作为上传文件，目录外路径不会进入映射", async () => {
    const source = await asset()
    await expect(OctoProductAssets.resolve({ download_links: [source.folder] }, [source.reference])).rejects.toThrow("不能传目录")
    expect(await OctoProductAssets.resolve({ download_links: [path.join(source.root, "outside.txt")] }, [source.reference])).toEqual([])
  })

  test.skipIf(process.platform === "win32")("符号链接不能把授权扩到目录外", async () => {
    const source = await asset()
    const outside = path.join(source.root, "outside")
    await mkdir(outside)
    await Bun.write(path.join(outside, "private.txt"), "outside selected asset")
    await symlink(outside, path.join(source.folder, "linked"), process.platform === "win32" ? "junction" : "dir")
    await expect(OctoProductAssets.resolve({ download_links: [path.join(source.folder, "linked", "private.txt")] }, [source.reference])).rejects.toThrow("目录外文件")
  })
})

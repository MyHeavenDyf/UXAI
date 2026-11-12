import { describe, expect, test } from "bun:test"
import path from "path"
import fs from "fs/promises"
import os from "os"
import { findProtectedDir } from "../../src/tool/protected-path"

async function mkBase(prefix: string) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix))
}

describe("protected-path guard", () => {
  test("blocks skill dir paths and path variants, allows everything else", async () => {
    const base = await mkBase("protected-path-")
    const skillDir = path.join(base, "skill")
    await fs.mkdir(path.join(skillDir, "my-skill"), { recursive: true })
    const file = path.join(skillDir, "my-skill", "SKILL.md")
    await Bun.write(file, "# x")

    try {
      expect(findProtectedDir(file, [skillDir])).toBe(skillDir)
      // 目录本身也算受保护
      expect(findProtectedDir(skillDir, [skillDir])).toBe(skillDir)
      // `..` 段
      expect(findProtectedDir(path.join(skillDir, "my-skill", "..", "my-skill", "SKILL.md"), [skillDir])).toBe(skillDir)
      // 新建文件(尾段尚不存在)
      expect(findProtectedDir(path.join(skillDir, "new-skill", "SKILL.md"), [skillDir])).toBe(skillDir)
      if (process.platform === "win32") {
        // 正反斜杠混用
        expect(findProtectedDir(file.replaceAll("\\", "/"), [skillDir])).toBe(skillDir)
        // 大小写变体
        expect(findProtectedDir(file.toUpperCase(), [skillDir])).toBe(skillDir)
      }

      // 目录外的路径不拦截
      expect(findProtectedDir(path.join(base, "other", "SKILL.md"), [skillDir])).toBeUndefined()
      // 同前缀目录不误伤(skilllib ≠ skill)
      expect(findProtectedDir(path.join(base, "skilllib", "x.md"), [skillDir])).toBeUndefined()
      // 祖先目录本身不拦截
      expect(findProtectedDir(base, [skillDir])).toBeUndefined()
    } finally {
      await fs.rm(base, { recursive: true, force: true })
    }
  })

  // Windows 创建目录符号链接需要特权,只在 posix 验证
  test.skipIf(process.platform === "win32")("resolves symlink aliases into the protected dir", async () => {
    const base = await mkBase("protected-path-link-")
    const realDir = path.join(base, "real-skill")
    const linkDir = path.join(base, "link-skill")
    await fs.mkdir(path.join(realDir, "s"), { recursive: true })
    await fs.symlink(realDir, linkDir)

    try {
      // 通过符号链接路径进入受保护目录
      expect(findProtectedDir(path.join(linkDir, "s", "SKILL.md"), [realDir])).toBe(realDir)
      // 经符号链接新建文件(尾段不存在)
      expect(findProtectedDir(path.join(linkDir, "s2", "SKILL.md"), [realDir])).toBe(realDir)
    } finally {
      await fs.rm(base, { recursive: true, force: true })
    }
  })
})

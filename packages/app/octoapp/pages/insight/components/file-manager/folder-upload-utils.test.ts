import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { folderRelativeDir, resolveFolderName } from "./folder-upload-utils"

// 文件夹流式上传纯逻辑的回归防线。抽到 folder-upload-utils.ts 便于直接单测,
// 避免 mock index.tsx 的 sdk / getDesktopApi / fetchInsightFiles 闭包依赖。
// 结构性不变量(streaming-first + base64 回退、前导斜杠去除、result.name 透传)
// 用源码扫描式,与同目录 empty-folder-header.test.ts / open-in-tab.test.ts 同款。
const SRC = readFileSync(join(import.meta.dir, "index.tsx"), "utf8")

describe("folderRelativeDir", () => {
  test("扁平文件(无斜杠)→ 空串", () => {
    expect(folderRelativeDir("file.txt")).toBe("")
  })
  test("一级子目录 → 取最后 / 之前", () => {
    expect(folderRelativeDir("sub/file.txt")).toBe("sub")
  })
  test("深路径 → 取最后 / 之前(保留中间 /)", () => {
    expect(folderRelativeDir("a/b/c/file.txt")).toBe("a/b/c")
  })
  test("前导斜杠已由调用方去除,但即便残留也只切到最后 / 之前", () => {
    // processDirectoryEntry 已对 relativePath 做 .replace(/^\/+/, ""),这里验证
    // 即便防御性地传入残留前导斜杠,dirPart 也不会越界(切片基于 lastIndexOf)。
    expect(folderRelativeDir("/sub/file.txt")).toBe("/sub")
  })
  test("空串 → 空串", () => {
    expect(folderRelativeDir("")).toBe("")
  })
  test("纯目录名(以 / 结尾)→ 去掉尾部斜杠的部分", () => {
    expect(folderRelativeDir("sub/")).toBe("sub")
  })
})

describe("resolveFolderName", () => {
  test("无撞名 → 原名", () => {
    expect(resolveFolderName("myFolder", new Set())).toBe("myFolder")
  })
  test("单次撞名 → folderName (1)", () => {
    expect(resolveFolderName("myFolder", new Set(["myFolder"]))).toBe("myFolder (1)")
  })
  test("连续撞名(1)(2)已占 → (3)", () => {
    expect(resolveFolderName("myFolder", new Set(["myFolder", "myFolder (1)", "myFolder (2)"]))).toBe("myFolder (3)")
  })
  test("跳号占用((1) 在但 (2) 不在)→ 仍取 (2)(与 server fs.exists 循环同口径,不回收空号)", () => {
    expect(resolveFolderName("myFolder", new Set(["myFolder", "myFolder (1)"]))).toBe("myFolder (2)")
  })
  test("撞名是文件而非文件夹也计入(occupied 不区分类型)", () => {
    expect(resolveFolderName("data", new Set(["data"]))).toBe("data (1)")
  })
  test("folderName 本身含括号不误判", () => {
    expect(resolveFolderName("report (draft)", new Set(["report (draft)"]))).toBe("report (draft) (1)")
  })
})

describe("index.tsx 结构不变量(源码扫描)", () => {
  test("handleFolderUpload / processDirectoryEntry 均 streaming-first + base64 回退", () => {
    // 两处都先 const streamed = await tryStreamFolderUpload(...); if (streamed) { ... return }
    const count = (SRC.match(/const streamed = await tryStreamFolderUpload\(/g) ?? []).length
    expect(count).toBe(2)
    // 两处都紧跟 if (streamed) { ... return } 后才走 base64 回退
    const fallbackCount = (SRC.match(/uploadInsightFolder\(sdk\.url/g) ?? []).length
    expect(fallbackCount).toBe(2)
  })

  test("processDirectoryEntry 对 relativePath 去前导斜杠", () => {
    // 用 String.raw 保留源码里的 \/ 字面量,避免 JS 字符串把 \/ 解释成 /。
    expect(SRC).toContain(String.raw`entry.fullPath.slice(1 + folderName.length).replace(/^\/+/, "")`)
  })

  test("base64 回退 toast 用 result.name(服务端撞名后的最终名),与流式 streamed.finalFolderName 对称", () => {
    const matches = SRC.match(/showFolderUploadResult\(result\.name, result\.fileCount/g) ?? []
    expect(matches.length).toBe(2)
    // 不应残留用原始 folderName 拼 toast 的旧写法
    expect(SRC).not.toMatch(/showFolderUploadResult\(folderName, result\.fileCount/)
  })

  test("tryStreamFolderUpload 空文件夹返回 null(让回退路径建空目录,与 base64 对称)", () => {
    expect(SRC).toMatch(/if \(files\.length === 0\) return null/)
  })

  test("部分失败 toast 展示错误计数 + console.warn 完整列表", () => {
    expect(SRC).toMatch(/errors\.length > 1 \? `\$\{errors\[0\]\} 等 \$\{errors\.length\} 个错误` : errors\[0\]/)
    expect(SRC).toMatch(/console\.warn\("\[octo:files\] folder-upload partial failures"/)
  })
})

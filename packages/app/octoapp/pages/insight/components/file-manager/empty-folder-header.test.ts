import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

// 回归防线:点开空文件夹时,头部(工具栏)+ 面包屑必须仍显示,否则用户无法返回上一层。
// 此前 bug 的根因:工具栏/面包屑/大空状态都绑在 hasAnyFiles() 上。空文件夹让两段文件
// 都为空,hasAnyFiles() 为 false,三者全被藏掉,转而显示整屏大空状态。修复引入
// showHeader(= hasAnyFiles || 非顶层),把头部/面包屑的显隐改由 showHeader 驱动,大空状态
// 仅在「顶层 + 无文件」时显示;空子文件夹则在 showHeader 分支内用 hasAnyFiles() fallback
// 渲染内联空状态(头顶仍有工具栏 + 面包屑)。
//
// 本用例扫描 index.tsx 源码锁住这套结构,防止有人把条件改回 hasAnyFiles() 又复现 bug。
// 与同目录 open-in-tab.test.ts 同属源码扫描式回归防线(本仓库 octoapp 测试按需运行,
// 不被 packages/app 的 test:unit——其只跑 ./src——收集)。
const SRC = readFileSync(join(import.meta.dir, "index.tsx"), "utf8")

describe("空文件夹仍显示头部 + 面包屑", () => {
  test("showHeader = hasAnyFiles() || 非顶层(空子文件夹也要显示头部)", () => {
    expect(SRC).toMatch(/const showHeader = createMemo\(\(\) => hasAnyFiles\(\) \|\| !fileStore\.isTopLevel\(\)\)/)
  })

  test("工具栏(头部)由 showHeader 显隐,而非 hasAnyFiles", () => {
    // <Show when={showHeader()}> 紧接 <FileManagerToolbar —— 头部在空子文件夹也显示
    expect(SRC).toMatch(/<Show when=\{showHeader\(\)\}>\s*<FileManagerToolbar/)
  })

  test("整屏大空状态仅在「顶层 + 无文件」显示:Match 用 !showHeader(),不得回退为 !hasAnyFiles()", () => {
    expect(SRC).toMatch(/<Match when=\{!showHeader\(\)\}>/)
    expect(SRC).not.toMatch(/<Match when=\{!hasAnyFiles\(\)\}>/)
  })

  test("面包屑 + 表格分支由 showHeader 显隐,而非 hasAnyFiles", () => {
    expect(SRC).toMatch(/<Match when=\{showHeader\(\)\}>/)
    expect(SRC).not.toMatch(/<Match when=\{hasAnyFiles\(\)\}>/)
  })

  test("面包屑落在 showHeader 分支内(空子文件夹可见,可返回上一层)", () => {
    const matchIdx = SRC.indexOf("<Match when={showHeader()}>")
    expect(matchIdx).toBeGreaterThan(-1)
    expect(SRC.indexOf("<Breadcrumb")).toBeGreaterThan(matchIdx)
  })

  test("空子文件夹在 showHeader 分支内用 hasAnyFiles() fallback 渲染内联空状态", () => {
    const matchIdx = SRC.indexOf("<Match when={showHeader()}>")
    expect(matchIdx).toBeGreaterThan(-1)
    expect(SRC.indexOf("<Show when={hasAnyFiles()} fallback=", matchIdx)).toBeGreaterThan(matchIdx)
  })
})

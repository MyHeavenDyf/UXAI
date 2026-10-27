import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

// 回归防线:侧栏「最近」区收起时,不得触发服务端分页加载更多。
// 此前 bug 的根因:inlineBeforeSection 模式(Insight 侧栏)收起「最近」时,
// SessionList 被卸载但滚动容器仍挂载,scrollHeight 骤降为小于 clientHeight;
// scroll 滚动条回弹、displayedRecentSessions 补页 effect、ResizeObserver 三条
// 自动补页路径都把「内容没填满视口」误判为需要下一页,循环拉取直到服务端游标
// 耗尽(把未加载的会话全部拉完),同时上报大量 load-more-sessions。
// 修复:collapsed() 作为所有自动补页路径的前置条件 —— 收起时一条请求都不发;
// 展开时恢复原有补页行为(effect 同时监听 collapsed 以便展开后重查填满视口)。
// 与 empty-folder-header.test.ts 同属源码扫描式回归防线(本仓库 octoapp 测试
// 按需运行,不被 packages/app 的 test:unit——其只跑 ./src——收集)。
//
// 另锁两处滚动行为回归防线:
// 1) 重命名自动滚回:handleSessionRenamed 原先没有 userScrolled 守卫,用户手动
//    滚动列表后从会话头部重命名当前会话,列表仍会被强制滚回该会话(顶部)。
//    修复对齐 cae0d7840 的 SSE 防护模式:入队与出队双检查。
// 2) 收起/展开滚动位置丢失:收起「最近」时 SessionList 卸载,浏览器把 scrollTop
//    钳到 0,再展开列表停在最顶部。修复:收起前保存 scrollTop,展开下一帧恢复,
//    并以 programmaticScroll 标记恢复动作,避免被当成用户手动滚动。
const SRC = readFileSync(join(import.meta.dir, "agent-sidebar.tsx"), "utf8")

describe("侧栏「最近」收起时不触发加载更多", () => {
  test("loadMoreFromServer 以 collapsed() 为前置条件(所有补页路径的汇总闸口)", () => {
    expect(SRC).toMatch(/const loadMoreFromServer = async \(fromScroll = false\) => \{\s*if \(collapsed\(\) \|\| loadingMoreSessions\(\) \|\| sessionCursor\(\) === undefined\) return/)
  })

  test("补页 effect 监听 collapsed:收起早退,展开后重查填满视口", () => {
    expect(SRC).toMatch(/createEffect\(on\(\[displayedRecentSessions, collapsed\], \(\) => \{\s*if \(collapsed\(\)\) return\s*requestAnimationFrame/)
  })

  test("onScroll 的加载分支以 !collapsed() 为前提", () => {
    expect(SRC).toMatch(/el\.scrollHeight - el\.scrollTop - el\.clientHeight < 100 && hasMoreSessions\(\) && !collapsed\(\)/)
  })

  test("ResizeObserver 的补页分支以 !collapsed() 为前提", () => {
    expect(SRC).toMatch(/el\.scrollHeight <= el\.clientHeight && !collapsed\(\)/)
  })

  test("collapsed 声明在 loadMoreFromServer 之前(供 effect 以 on([..., collapsed]) 直接引用,避免 TDZ)", () => {
    const collapsedDecl = SRC.indexOf("const [collapsed, setCollapsed] = createSignal(false)")
    expect(collapsedDecl).toBeGreaterThan(-1)
    expect(collapsedDecl).toBeLessThan(SRC.indexOf("const loadMoreFromServer"))
  })

  test("collapsed 只声明一次(旧位置的下移声明已删除)", () => {
    expect(SRC.match(/const \[collapsed, setCollapsed\] = createSignal\(false\)/g)).toHaveLength(1)
  })
})

describe("手动滚动后重命名不再强制滚回当前会话", () => {
  const RENAME = SRC.slice(SRC.indexOf("const handleSessionRenamed"), SRC.indexOf('window.addEventListener("octo:session-renamed"'))

  test("入队即检查 userScrolled(手动滚动后直接跳过)", () => {
    expect(RENAME).toMatch(/if \(!activeId \|\| userScrolled\) return/)
  })

  test("出队二次检查 userScrolled(防 500ms 防抖窗口内的滚动竞态),两个分支都要有", () => {
    expect(RENAME.match(/if \(!userScrolled\) scrollToSession\(id\)/g)).toHaveLength(2)
  })
})

describe("收起「最近」后展开恢复滚动位置", () => {
  const TOGGLE = SRC.slice(SRC.indexOf("function toggleRecentCollapse"), SRC.indexOf("function applySessionEvent"))
  const TOGGLE_END = TOGGLE.indexOf("}\n\n")

  test("收起前保存 scrollTop(必须在 setCollapsed 之前读取)", () => {
    expect(TOGGLE).toMatch(/if \(collapsing && scrollContainer\) savedCollapseScrollTop = scrollContainer\.scrollTop/)
    expect(TOGGLE.indexOf("savedCollapseScrollTop = scrollContainer.scrollTop")).toBeLessThan(TOGGLE.indexOf("setCollapsed(collapsing)"))
  })

  test("展开后下一帧恢复,并标记 programmaticScroll 避免被误判为用户手动滚动", () => {
    expect(TOGGLE).toMatch(/requestAnimationFrame\(\(\) => \{\s*if \(!scrollContainer\) return\s*programmaticScroll = true\s*scrollContainer\.scrollTop = savedCollapseScrollTop\s*armProgrammaticScrollReset\(\)/)
  })

  test("展开分支不得重复触发埋点(收起/展开共用一次 toggle-recent-section)", () => {
    expect(TOGGLE.slice(0, TOGGLE_END).match(/toggle-recent-section/g)).toHaveLength(1)
  })

  test("JSX 的 onToggleCollapse 使用具名函数(不得回退为内联 setCollapsed 翻转)", () => {
    expect(SRC).toMatch(/onToggleCollapse=\{toggleRecentCollapse\}/)
    expect(SRC).not.toMatch(/onToggleCollapse=\{\(\) => \{.*setCollapsed/)
  })
})

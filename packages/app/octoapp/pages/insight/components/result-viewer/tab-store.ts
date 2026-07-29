import { createSignal } from "solid-js"
import type { OutputCard } from "../insight-turn"
import type { OutputCardType } from "../../utils/output-type"
import { materializedLocalPath } from "../../utils/local-resource"

/** 路径比较用:统一分隔符(主进程返回的 Windows 路径与前端拼接的写法可能不一致)。 */
function samePath(a?: string, b?: string): boolean {
  if (!a || !b) return false
  return a.replace(/\\/g, "/") === b.replace(/\\/g, "/")
}

/**
 * tab 的**身份** —— 磁盘绝对路径(SPEC-INS-026 §5/§6)。落盘完成前为 undefined,
 * 此时 tab 用 `card.id` 作临时身份,由 `bindLocalPath` 在落盘完成后转正(§6.2)。
 *
 * uri tab 的 filePath 只在「开 tab 那一刻已落盘完成」时才填得上,但 eager 落盘是异步的
 * (downloadResourceToTemp 要把整个文件下完):几十 MB 的 xlsx 下载期间用户点开卡片,
 * 开出来的 uri tab 就没有 filePath。故这里**每次去重都重查注册表**,而不是只信 tab 上
 * 那份创建时的快照——否则「卡片一出现就点开(慢文件) → 稍后从文件管理打开同一文件」必然双开。
 */
export function tabLocalPath(t: ResultTab): string | undefined {
  if (t.filePath) return t.filePath
  return t.source === "uri" ? materializedLocalPath(t.id) : undefined
}

/** tab 类型 = 产物卡类型,同一套判定(SPEC-INS-026 §4.2)。 */
export type ResultTabType = OutputCardType

/** 视图模式:preview=渲染态(markmap/iframe/markdown),source=原始代码态。仅 toggle 类型有意义 */
export type TabViewMode = "preview" | "source"

// 静态支持「预览/代码」切换的类型:预览=渲染态,代码=原始源(shiki 高亮)。file 无源,不在其列。
// 注:json 卡是「按内容条件切换」——内容为思维导图 shape(树)时才出切换并默认 markmap 预览,
//     普通 JSON 单显源;该判定需读到内容,故放在 action-bar.showToggle(用 isMindmapJSON),不在本静态集合。
// 见 output-renderers.md §1 视图切换。
const TOGGLE_TYPES = new Set<ResultTabType>(["html", "markdown"])
export function isToggleType(type: ResultTabType): boolean {
  return TOGGLE_TYPES.has(type)
}

export type ResultTab = {
  id: string
  title: string
  type: ResultTabType
  source: "inline" | "uri" | "path"
  content?: string          // inline 必填;uri/path 模式下作为读取后的缓存(uri 懒填充;path 每次读盘)
  uri?: string              // uri 模式必填
  mimeType?: string         // uri 模式必填(影响渲染路由)
  fileName?: string         // uri 模式来自 resource_link.name,供下载默认文件名
  filePath?: string         // **身份**(§5):path 模式必填;uri 模式落盘完成后由 bindLocalPath 补上
  description?: string      // uri 模式来自 resource_link.description,可在 ActionBar 副标题展示
  viewMode?: TabViewMode    // 预览/代码 切换态(缺省视作 "preview");html/markdown + 思维导图 shape 的 json 用
  createdAt: Date
}

export function createTabStore() {
  const [tabs, setTabs] = createSignal<ResultTab[]>([])
  const [activeId, setActiveId] = createSignal<string | null>(null)

  // 返回「去重后实际生效的 tab id」:命中已有 tab 时返回已有 id,新建时返回 card.id。
  // 调用方据此激活真实存在的 tab —— 不能假定 card.id 一定进了 tabs(可能被去重掉),
  // 否则用 card.id 去 activate 会指向不存在的 tab,导致 activeTab() 为 null、右侧栏只剩标签栏空白。
  function openTab(incoming: OutputCard): string {
    // uri 卡若已 eager 落盘,补上磁盘路径 —— 那才是它的身份(§5)。对话区卡片与「文件管理打开的
    // 同一文件」本是磁盘同一份,但前者只有 uri、后者只有 filePath,不补就会开出两个 tab。
    // source 保持 "uri" 不变 —— FileFallback 的 isPath()、ActionBar 的下载语义都按 source 判定。
    const localPath = incoming.source === "uri" ? materializedLocalPath(incoming.id) : undefined
    const card: OutputCard = localPath ? { ...incoming, filePath: localPath } : incoming
    // 去重优先级(SPEC-INS-026 §6.1「一个磁盘文件 = 一个 tab,**去重不看 type**」):
    //   1. 磁盘路径命中 → 激活(身份相同即同一个 tab;含 uri 卡 ↔ 文件管理卡跨入口)
    //   2. uri 命中 → 激活(都还没落盘时的临时身份:同一资源被多张卡引用,如任务卡与查询结果卡)
    //   3. id 命中 → 激活(inline 模式 / 同入口重复点击)
    //   4. 都不命中 → 新建
    //
    // **命中一律保留已有 tab**(先开者胜),incoming 只贡献一次激活 —— 这条要显式定,
    // 否则会变成「谁先开谁赢」的隐式行为,同样两步操作换个顺序结果就不同(V6 顺序无关)。
    //
    // 此前保留的「同一 URI 不同 type 各留一个 tab」已废除:一个 resource_link 只产一张卡
    // (linkToOutputType 返回单值),同一 uri 出两张卡的场景现网不存在,那条规则在保护一个
    // 不存在的场景,却让同一份磁盘文件从两个入口打开时双开(PR #445)。多视图由 tab 内的
    // viewMode 切换承担,不靠多开 tab。
    const current = tabs()
    // 磁盘路径去重。已有 tab 一侧用 tabLocalPath() 比较:它可能开在落盘完成之前(慢文件),
    // filePath 是空的,要回查注册表才认得出它就是这个本地文件。
    if (card.filePath) {
      const incomingPath = card.filePath
      const byPath = current.find((t) => samePath(tabLocalPath(t), incomingPath))
      if (byPath) {
        console.log("[octo:tab] dedupe-by-path", {
          existingTabId: byPath.id,
          existingType: byPath.type,
          incomingCardId: card.id,
          incomingType: card.type,
          filePath: incomingPath,
        })
        setActiveId(byPath.id)
        return byPath.id
      }
    }
    if (card.uri) {
      const byUri = current.find((t) => t.uri === card.uri)
      if (byUri) {
        console.log("[octo:tab] dedupe-by-uri", {
          existingTabId: byUri.id,
          existingType: byUri.type,
          incomingCardId: card.id,
          incomingType: card.type,
          uri: card.uri,
        })
        setActiveId(byUri.id)
        return byUri.id
      }
    }
    const byId = current.find((t) => t.id === card.id)
    if (byId) {
      console.log("[octo:tab] dedupe-by-id", { tabId: card.id })
      setActiveId(card.id)
      return card.id
    }
    const tab: ResultTab = {
      id: card.id,
      title: card.title,
      type: card.type,
      source: card.source,
      content: card.content,
      uri: card.uri,
      mimeType: card.mimeType,
      fileName: card.fileName,
      filePath: card.filePath,
      description: card.description,
      createdAt: card.createdAt,
    }
    console.log("[octo:tab] openTab", {
      id: card.id,
      type: card.type,
      source: card.source,
      uri: card.uri,
      title: card.title,
    })
    setTabs((prev) => [...prev, tab])
    setActiveId(card.id)
    return card.id
  }

  /**
   * 落盘完成 → 把 pending 期间以 `card.id` 开出的临时 tab **绑定到磁盘路径**,身份转正(§6.2)。
   *
   * 三种情形,合并语义显式写死(不留「谁先谁后」的隐式行为):
   *   A. 没有该临时 tab(用户没点开过 / 已关掉)→ 什么都不做。
   *   B. 只有临时 tab → 补上 filePath,身份转正,tab 数不变。
   *   C. 已存在另一个指向同路径的 tab(用户在下载期间又从文件管理打开了同一文件)→ 合并成一个:
   *      **保留数组中靠前的那个**(先开者胜,与 openTab 的「命中已有则激活已有」同一条规则),
   *      关掉另一个;保留者补上 filePath;若被关掉的正是当前激活 tab,激活保留的那个。
   */
  function bindLocalPath(cardId: string, path: string): void {
    const prev = tabs()
    const tempIdx = prev.findIndex((t) => t.id === cardId)
    if (tempIdx === -1) return // A
    const diskIdx = prev.findIndex((t, i) => i !== tempIdx && samePath(tabLocalPath(t), path))
    if (diskIdx === -1) {
      // B
      if (samePath(prev[tempIdx].filePath, path)) return // 已绑定过,免去无谓的信号更新
      console.log("[octo:tab] bind-local-path", { tabId: cardId, path })
      setTabs((ts) => ts.map((t, i) => (i === tempIdx ? { ...t, filePath: path } : t)))
      return
    }
    // C
    const keepIdx = Math.min(tempIdx, diskIdx)
    const dropIdx = Math.max(tempIdx, diskIdx)
    const keep = prev[keepIdx]
    const drop = prev[dropIdx]
    console.log("[octo:tab] merge-on-bind", {
      keptTabId: keep.id,
      keptType: keep.type,
      closedTabId: drop.id,
      closedType: drop.type,
      path,
    })
    setTabs(prev.filter((_, i) => i !== dropIdx).map((t) => (t.id === keep.id ? { ...t, filePath: path } : t)))
    if (activeId() === drop.id) setActiveId(keep.id)
  }

  function closeTab(id: string) {
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.id === id)
      if (idx === -1) return prev
      const next = prev.filter((t) => t.id !== id)
      if (activeId() === id) {
        setActiveId(next[Math.max(0, idx - 1)]?.id ?? null)
      }
      return next
    })
  }

  function activate(id: string) {
    setActiveId(id)
  }

  function setViewMode(id: string, mode: TabViewMode) {
    setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, viewMode: mode } : t)))
  }

  function reset() {
    setTabs([])
    setActiveId(null)
  }

  // URI 模式下 fetch 完成后回写 content。
  // tab.type 在对话流出卡时已由 business_type / mimeType 确定,此处不再修改 type
  // (旧 retypeAs 参数已删除,详见 output-renderers.md §2.5.2 删除二次判断 retype 说明)
  function cacheContent(id: string, content: string) {
    setTabs((prev) =>
      prev.map((t) => (t.id === id ? { ...t, content } : t)),
    )
  }

  return { tabs, activeId, activate, openTab, closeTab, reset, cacheContent, setViewMode, bindLocalPath }
}

export type TabStore = ReturnType<typeof createTabStore>

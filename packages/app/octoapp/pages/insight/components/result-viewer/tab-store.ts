import { createSignal } from "solid-js"
import type { OutputCard } from "../insight-turn"
import { materializedLocalPath } from "../../utils/local-resource"

/** 路径比较用:统一分隔符(主进程返回的 Windows 路径与前端拼接的写法可能不一致)。 */
function samePath(a?: string, b?: string): boolean {
  if (!a || !b) return false
  return a.replace(/\\/g, "/") === b.replace(/\\/g, "/")
}

/**
 * tab 当前对应的本地文件路径。
 *
 * uri tab 的 filePath 只在「开 tab 那一刻已落盘完成」时才填得上,但 eager 落盘是异步的
 * (downloadResourceToTemp 要把整个文件下完):几十 MB 的 xlsx 下载期间用户点开卡片,
 * 开出来的 uri tab 就没有 filePath。故这里**每次去重都重查注册表**,而不是只信 tab 上
 * 那份创建时的快照——否则「卡片一出现就点开(慢文件) → 稍后从文件管理打开同一文件」必然双开。
 */
function tabLocalPath(t: ResultTab): string | undefined {
  if (t.filePath) return t.filePath
  return t.source === "uri" ? materializedLocalPath(t.id) : undefined
}

export type ResultTabType = "table" | "mindmap" | "markdown" | "file" | "json" | "html" | "code" | "image"

/** 视图模式:preview=渲染态(markmap/表格/iframe/markdown),source=原始代码态。仅 toggle 类型有意义 */
export type TabViewMode = "preview" | "source"

// 静态支持「预览/代码」切换的类型:预览=渲染态,代码=原始源(shiki 高亮)。file 无源,不在其列。
// 注:json 卡是「按内容条件切换」——内容为思维导图 shape(树)时才出切换并默认 markmap 预览,
//     普通 JSON 单显源;该判定需读到内容,故放在 action-bar.showToggle(用 isMindmapJSON),不在本静态集合。
// 见 output-renderers.md §1 视图切换。
const TOGGLE_TYPES = new Set<ResultTabType>(["mindmap", "html", "table", "markdown"])
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
  filePath?: string         // path 模式必填(write 工具目标路径,见 output-renderers.md §2.6)
  description?: string      // uri 模式来自 resource_link.description,可在 ActionBar 副标题展示
  viewMode?: TabViewMode    // 预览/代码 切换态(缺省视作 "preview");mindmap/html/table/markdown + 思维导图 shape 的 json 用
  createdAt: Date
}

export function createTabStore() {
  const [tabs, setTabs] = createSignal<ResultTab[]>([])
  const [activeId, setActiveId] = createSignal<string | null>(null)

  // 返回「去重后实际生效的 tab id」:命中已有 tab 时返回已有 id,新建时返回 card.id。
  // 调用方据此激活真实存在的 tab —— 不能假定 card.id 一定进了 tabs(可能被 (uri,type) 去重掉),
  // 否则用 card.id 去 activate 会指向不存在的 tab,导致 activeTab() 为 null、右侧栏只剩标签栏空白。
  function openTab(incoming: OutputCard): string {
    // uri 卡若已 eager 落盘,补上本地副本路径:对话区卡片与「文件管理打开的同一文件」本是磁盘同一份,
    // 但前者只有 uri、后者只有 filePath,去重键不相交 → 不补就会开出两个 tab(同文件双开)。
    // 补后两个入口都带 filePath,由下方 (filePath,type) 去重收敛到同一个 tab。
    // source 保持 "uri" 不变 —— 渲染路由 / FileFallback 的 isPath() 都按 source 判定,不受影响。
    const localPath = incoming.source === "uri" ? materializedLocalPath(incoming.id) : undefined
    const card: OutputCard = localPath ? { ...incoming, filePath: localPath } : incoming
    // 去重优先级(spec: task-card.md §3.5 入口冗余 ≠ tab 重复):
    //   1. (uri, type) 复合命中 → 激活(多入口指向同一产物 + 同一渲染视图)
    //   2. (filePath, type) 复合命中 → 激活(同一本地文件;含 uri 卡 ↔ 文件管理卡跨入口)
    //   3. id 命中 → 激活(inline 模式 / 同入口重复点击)
    //   4. 都不命中 → 新建
    // 同一 URI 不同 type 可并存(典型场景:mindmap JSON 文件既可走 json 高亮预览,
    // 也可走 mindmap 思维导图渲染——两个 tab 互不冲突)。
    const current = tabs()
    if (card.uri) {
      const byUriAndType = current.find((t) => t.uri === card.uri && t.type === card.type)
      if (byUriAndType) {
        console.log("[octo:tab] dedupe-by-uri-and-type", {
          existingTabId: byUriAndType.id,
          incomingCardId: card.id,
          uri: card.uri,
          type: card.type,
        })
        setActiveId(byUriAndType.id)
        return byUriAndType.id
      }
    }
    // (filePath, type) 去重:write 产物重复点开,以及「对话区 uri 卡 ↔ 文件管理同一文件」跨入口。
    // 比较用 tabLocalPath():已开的 uri tab 可能开在落盘完成之前(慢文件),filePath 是空的,
    // 要回查注册表才认得出它就是这个本地文件。
    if (card.filePath) {
      const byPathAndType = current.find((t) => samePath(tabLocalPath(t), card.filePath) && t.type === card.type)
      if (byPathAndType) {
        console.log("[octo:tab] dedupe-by-path-and-type", {
          existingTabId: byPathAndType.id,
          incomingCardId: card.id,
          filePath: card.filePath,
          type: card.type,
        })
        setActiveId(byPathAndType.id)
        return byPathAndType.id
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

  return { tabs, activeId, activate, openTab, closeTab, reset, cacheContent, setViewMode }
}

export type TabStore = ReturnType<typeof createTabStore>

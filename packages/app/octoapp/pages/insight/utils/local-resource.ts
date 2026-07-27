// 解析 tab 对应的「本地工作副本」路径 —— 卡片预览(UriMarkdownTabBody)、全屏编辑器(MarkdownEditor)、
// 本地打开共用同一份,避免文件名 / 落点规则漂移到两套(漂移会导致预览读 A、编辑写 B,看不到改动)。
//
// - path 源(write 工具产物):文件已在磁盘,直接用 filePath。
// - uri 源:downloadResourceToTemp 幂等落到 <projectDir>/.octo/<sessionId>/outputs/<file>(SPEC-INS-014 v2,扁平、撞名加后缀);
//   首次下原件、之后复用用户改过的那份(主进程按 namespace 记内存表,见 desktop/src/main/ipc.ts `result-materialize`)。
//   无 projectDir / 无 sessionId → 落 OS 临时目录(persistent=false,重启可能被清)。
// - inline / 缺桌面能力 → 抛错(调用方决定退回 fetch 只读 或 提示无法编辑)。
//
// **幂等键(namespace)一律传 `uri`,不能传 card.id / tab.id** —— 幂等键标识的是「哪个资源」,
// 不是「哪张卡引用了它」。同一份产物会被多个 id 引用:任务卡走 `task-<taskId>-<i>`、
// 「查询结果」turn 的路径 A 卡走 `card-<msgID>-<i>`(任务卡锚定首次 turn,后续 turn 拦不住路径 A,
// 经 resolveTaskLinks 换回同一批 URI),用 id 作键会让同一 URI 各落一份、第二份撞名成 `xxx (2)`,
// 且每查询一次多一份。传 uri 后无论哪条路径、哪张卡,同一资源只落一份;也顺带消除了各调用点
// filename 规则不一(补不补 .md)导致的重复落盘。
//
// 见 spec insight-markdown-editor.md §3。

import { createSignal } from "solid-js"
import { getDesktopApi } from "../lib/electron-api"
import type { ResultTab } from "../components/result-viewer/tab-store"
import { defaultFilename, ensureMarkdownExt } from "./local-file"

// eager 落盘产出的本地副本路径(card.id → outputs 下的绝对路径)。
// 用途:uri 卡与「文件管理打开的同一文件」本是磁盘同一份,但两者去重键不相交
// (uri 卡有 uri 无 filePath、文件管理卡有 filePath 无 uri),不登记就会开出两个 tab。
// openTab 据此给已落盘的 uri 卡补上 filePath,让 (filePath,type) 去重同时覆盖两个入口。
const materializedPaths = new Map<string, string>()

// 落盘登记的版本号信号:每次 materializedPaths.set 自增一次,使 materializedLocalPath 在响应式
// 上下文(如产物入口卡的展示名)里能感知「刚落盘」并重算——用磁盘真实 basename 对齐展示名。
// 命令式调用点(tab-store openTab)读它不订阅,行为不变。
const [materializeVersion, bumpMaterializeVersion] = createSignal(0)

function registerMaterialized(cardId: string, localPath: string): void {
  materializedPaths.set(cardId, localPath)
  bumpMaterializeVersion((v) => v + 1)
}

/**
 * 查 uri 卡落盘后的本地副本路径;未落盘(或落在 OS 临时目录)返回 undefined。
 * 响应式:读了 materializeVersion,落盘后调用方(入口卡展示名)自动重算。
 */
export function materializedLocalPath(cardId: string): string | undefined {
  materializeVersion()
  return materializedPaths.get(cardId)
}

// uri 卡落盘文件名:markdown 补 .md(点开走编辑器时命中同一份),其余类型保留 resource_link.name
// 原扩展名(json 落成 .json)。eager 落盘与预览读盘共用此规则,避免「下 A 读 B」两份漂移。
function landingFilename(card: { type: string; fileName?: string; uri?: string; title?: string }): string {
  const base = defaultFilename(card)
  return card.type === "markdown" ? ensureMarkdownExt(base) : base
}

/**
 * 确保 uri 卡有一份本地工作副本(落 <projectDir>/.octo/<sessionId>/outputs/,幂等按 uri),返回本地路径。
 * 与 ensureLocalMarkdownFile 同源,但按 card.type 决定扩展名(json 保留 .json,不强补 .md)——供**非
 * markdown** 的 uri 卡(json/html/table/mindmap)预览读盘用:读的就是「文件管理打开的同一份」,于是
 * 用户在磁盘上的改动能即时反映到卡片预览(修复:json 卡曾直接 fetch 远端原件、改了不生效)。
 * - path 源:文件已在磁盘,直接用 filePath。
 * - inline / 缺桌面能力 → 抛错(调用方退回 fetch 只读预览)。
 */
export async function ensureLocalResourceFile(
  tab: ResultTab,
  projectDir: string,
  sessionId: string,
): Promise<{ path: string; persistent: boolean }> {
  if (tab.source === "path" && tab.filePath) {
    return { path: tab.filePath, persistent: true }
  }
  if (tab.source === "uri" && tab.uri) {
    const api = getDesktopApi()
    if (typeof api?.downloadResourceToTemp !== "function") {
      throw new Error("缺少 window.api.downloadResourceToTemp,无法定位本地文件")
    }
    const filename = landingFilename(tab)
    const baseDir = projectDir || undefined
    // 幂等键传 uri(资源身份),不传 tab.id —— 见文件头说明。
    const localPath = await api.downloadResourceToTemp!(tab.uri, tab.uri, filename, baseDir, baseDir ? sessionId : undefined)
    // 登记本地副本路径:openTab 据此给 uri 卡补 filePath 去重;入口卡据此对齐展示名。
    if (baseDir) registerMaterialized(tab.id, localPath)
    return { path: localPath, persistent: !!baseDir }
  }
  throw new Error("该卡片无可编辑的本地文件(inline 内容)")
}

export async function ensureLocalMarkdownFile(
  tab: ResultTab,
  projectDir: string,
  sessionId: string,
): Promise<{ path: string; persistent: boolean }> {
  if (tab.source === "path" && tab.filePath) {
    return { path: tab.filePath, persistent: true }
  }
  if (tab.source === "uri" && tab.uri) {
    const api = getDesktopApi()
    if (typeof api?.downloadResourceToTemp !== "function") {
      throw new Error("缺少 window.api.downloadResourceToTemp,无法定位本地文件")
    }
    const filename = ensureMarkdownExt(defaultFilename(tab))
    const baseDir = projectDir || undefined
    // 幂等键传 uri(资源身份),不传 tab.id —— 见文件头说明。
    const localPath = await api.downloadResourceToTemp!(tab.uri, tab.uri, filename, baseDir, baseDir ? sessionId : undefined)
    if (baseDir) registerMaterialized(tab.id, localPath)
    return { path: localPath, persistent: !!baseDir }
  }
  throw new Error("该卡片无可编辑的本地文件(inline 内容)")
}

/**
 * eager 落地(SPEC-INS-014 v4):MCP `uri` 产物卡「出卡即落」进 <projectDir>/.octo/<sessionId>/outputs/,
 * 不等用户点开。覆盖所有 uri 卡类型(json/mindmap/html/table/markdown/file)——此前只有 markdown 卡在点开
 * 渲染时才落、其余 uri 卡走 UriTabBody 只 fetch 不落盘,故思维导图等产物永不进「文件管理」(见 v4 修订)。
 *
 * - 幂等:按 `uri` 作幂等键(主进程 result-materialize reuse-existing 内存表),重复调复用同一份、
 *   不覆盖用户已改的工作副本;同一 URI 被多张卡引用(任务卡 / 「查询结果」turn 的路径 A 卡)时也只落
 *   一份,见文件头。调用方另用 Set 按 card.id 去重,避免每次 signal 更新都发一轮 IPC。
 * - filename:markdown 补 .md(与 ensureLocalMarkdownFile 对齐,保证点开走编辑器时命中同一份),
 *   其余类型保留 resource_link.name 原扩展名(mindmap.json 落成 .json)。
 * - 降级 / 尽力而为:非桌面端 / 无 projectDir / 无 sessionId → 静默跳过(eager 只对可持久化落点有意义,
 *   不落 OS 临时目录);失败不抛(不阻断出卡 / 渲染)。inline / path 源直接跳过(非本函数职责)。
 */
export async function materializeUriCardToOutputs(
  card: { id: string; type: string; source: "inline" | "uri" | "path"; uri?: string; fileName?: string; title?: string },
  projectDir: string,
  sessionId: string,
): Promise<void> {
  if (card.source !== "uri" || !card.uri) return
  if (!projectDir || !sessionId) return
  const api = getDesktopApi()
  if (typeof api?.downloadResourceToTemp !== "function") return
  const filename = landingFilename(card)
  try {
    // 幂等键传 uri(资源身份),不传 card.id —— 见文件头说明。
    const localPath = await api.downloadResourceToTemp!(card.uri, card.uri, filename, projectDir, sessionId)
    // 登记本地副本路径:openTab 据此给 uri 卡补 filePath,与「文件管理打开同一文件」去重到同一个 tab。
    registerMaterialized(card.id, localPath)
    // 客户端触发侧日志(主进程落地本身另打 [octo:worktree] result-materialize);两者配对定位「出卡了没落盘」。
    console.log("[octo:resource] eager-materialize", { cardId: card.id, type: card.type, filename, sessionId, localPath })
  } catch (err) {
    console.warn("[octo:resource] eager-materialize-failed", { cardId: card.id, uri: card.uri, err })
  }
}

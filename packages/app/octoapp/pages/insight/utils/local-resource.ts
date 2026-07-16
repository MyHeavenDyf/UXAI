// 解析 tab 对应的「本地工作副本」路径 —— 卡片预览(UriMarkdownTabBody)、全屏编辑器(MarkdownEditor)、
// 本地打开共用同一份,避免文件名 / 落点规则漂移到两套(漂移会导致预览读 A、编辑写 B,看不到改动)。
//
// - path 源(write 工具产物):文件已在磁盘,直接用 filePath。
// - uri 源:downloadResourceToTemp 幂等落到 <projectDir>/insight/<sessionId>/outputs/<file>(SPEC-INS-014 v2,扁平、撞名加后缀);
//   首次下原件、之后复用用户改过的那份(主进程按 tab.id 记内存表,见 desktop/src/main/ipc.ts `result-materialize`)。
//   无 projectDir / 无 sessionId → 落 OS 临时目录(persistent=false,重启可能被清)。
// - inline / 缺桌面能力 → 抛错(调用方决定退回 fetch 只读 或 提示无法编辑)。
//
// 见 spec insight-markdown-editor.md §3。

import { getDesktopApi } from "../lib/electron-api"
import type { ResultTab } from "../components/result-viewer/tab-store"
import { defaultFilename, ensureMarkdownExt } from "./local-file"

// eager 落盘产出的本地副本路径(card.id → outputs 下的绝对路径)。
// 用途:uri 卡与「文件管理打开的同一文件」本是磁盘同一份,但两者去重键不相交
// (uri 卡有 uri 无 filePath、文件管理卡有 filePath 无 uri),不登记就会开出两个 tab。
// openTab 据此给已落盘的 uri 卡补上 filePath,让 (filePath,type) 去重同时覆盖两个入口。
const materializedPaths = new Map<string, string>()

/** 查 uri 卡 eager 落盘后的本地副本路径;未落盘(或落在 OS 临时目录)返回 undefined。 */
export function materializedLocalPath(cardId: string): string | undefined {
  return materializedPaths.get(cardId)
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
    const localPath = await api.downloadResourceToTemp!(tab.uri, tab.id, filename, baseDir, baseDir ? sessionId : undefined)
    return { path: localPath, persistent: !!baseDir }
  }
  throw new Error("该卡片无可编辑的本地文件(inline 内容)")
}

/**
 * eager 落地(SPEC-INS-014 v4):MCP `uri` 产物卡「出卡即落」进 <projectDir>/insight/<sessionId>/outputs/,
 * 不等用户点开。覆盖所有 uri 卡类型(json/mindmap/html/table/markdown/file)——此前只有 markdown 卡在点开
 * 渲染时才落、其余 uri 卡走 UriTabBody 只 fetch 不落盘,故思维导图等产物永不进「文件管理」(见 v4 修订)。
 *
 * - 幂等:按 card.id 作幂等键(主进程 result-materialize reuse-existing 内存表),重复调复用同一份、
 *   不覆盖用户已改的工作副本;调用方另用 Set 去重,避免每次 signal 更新都发一轮 IPC。
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
  const base = defaultFilename(card)
  const filename = card.type === "markdown" ? ensureMarkdownExt(base) : base
  try {
    const localPath = await api.downloadResourceToTemp!(card.uri, card.id, filename, projectDir, sessionId)
    // 登记本地副本路径:openTab 据此给 uri 卡补 filePath,与「文件管理打开同一文件」去重到同一个 tab。
    materializedPaths.set(card.id, localPath)
    // 客户端触发侧日志(主进程落地本身另打 [octo:worktree] result-materialize);两者配对定位「出卡了没落盘」。
    console.log("[octo:resource] eager-materialize", { cardId: card.id, type: card.type, filename, sessionId, localPath })
  } catch (err) {
    console.warn("[octo:resource] eager-materialize-failed", { cardId: card.id, uri: card.uri, err })
  }
}

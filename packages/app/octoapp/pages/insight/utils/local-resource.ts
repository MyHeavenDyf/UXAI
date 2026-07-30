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

/**
 * 主进程判定「文件名不合法、拒绝落盘」时的 message 前缀(SPEC-INS-026 §4.1)。
 * 与网络类失败的区别:拒绝重试无用,要响亮 toast 告诉用户这份产物拿不到本地副本。
 *
 * **跨进程边界的同步点**:主进程定义在 `packages/desktop/src/main/landing-name.ts` 的
 * `LANDING_NAME_REJECTED`。主进程不 import 渲染端包(见 worktree-layout.ts 文件头),
 * 只能两侧各留一份字面量,改一侧必须同步另一侧。
 */
const NAME_REJECTED_PREFIX = "[octo:name-rejected]"

function isNameRejected(reason: string): boolean {
  return reason.includes(NAME_REJECTED_PREFIX)
}

/**
 * 错误信息展示前剥掉机器标记(前缀只用于渲染端分流,不该出现在用户看到的文案里)。
 * 剥完剩下的是主进程写好的中文原因,如「文件名含路径分隔符:"a/b.json"」。
 */
export function describeResourceError(err: unknown): string {
  const reason = err instanceof Error ? err.message : String(err)
  return reason.replace(NAME_REJECTED_PREFIX, "").trim()
}

// eager 落盘产出的本地副本路径(card.id → outputs 下的绝对路径)。
// 用途:uri 卡与「文件管理打开的同一文件」本是磁盘同一份,但两者去重键不相交
// (uri 卡有 uri 无 filePath、文件管理卡有 filePath 无 uri),不登记就会开出两个 tab。
// openTab 据此给已落盘的 uri 卡补上 filePath,让 (filePath,type) 去重同时覆盖两个入口。
const materializedPaths = new Map<string, string>()

/** 查 uri 卡 eager 落盘后的本地副本路径;未落盘(或落在 OS 临时目录)返回 undefined。 */
export function materializedLocalPath(cardId: string): string | undefined {
  return materializedPaths.get(cardId)
}

// ── 落盘状态(uri 卡「下载中 → 就绪 / 失败」)──────────────────────────────
// 背景:uri 卡是**先出卡、后台再下载**(insight-turn 的 eager materialize effect),卡片出现那一刻
// 磁盘上还没有文件。旧实现对这段窗口零反馈——下载中点开只看到转圈,下载失败只有 console 知道,
// 用户完全不知道「有一份产物没拿到」。故把这段状态显式建模,由入口卡呈现(准备中 / 失败·重试)。
//
// 注:这是「身份两段式」的过渡态。产物身份收敛到磁盘路径后(见新 spec),状态机仍保留——
// pending→ready 是真实存在的生命周期,不是权宜之计。
export type MaterializeState = "pending" | "ready" | "failed"

type MaterializeEntry = { state: MaterializeState; error?: string }

const materializeStates = new Map<string, MaterializeEntry>()

// 状态变更版本号:Map 本身不是响应式的,靠这个信号让读取方(入口卡)在状态变化时重算。
// 命令式调用点(tab-store openTab)读 materializedLocalPath 时不在追踪上下文里,不受影响。
const [stateVersion, bumpStateVersion] = createSignal(0)

function setMaterializeState(cardId: string, entry: MaterializeEntry): void {
  materializeStates.set(cardId, entry)
  bumpStateVersion((v) => v + 1)
}

/**
 * 查 uri 卡的落盘状态。**响应式**:在 JSX / memo 里读会随状态变化自动重算。
 * 返回 undefined = 该卡不走落盘(inline / path 源),调用方按「就绪」处理。
 */
export function materializeStateOf(cardId: string): MaterializeEntry | undefined {
  stateVersion()
  return materializeStates.get(cardId)
}

/** 供 _dev 预览页构造三态样例;生产代码不要调用(状态由 materializeUriCardToOutputs 自己维护)。 */
export function __devSeedMaterializeState(cardId: string, entry: MaterializeEntry): void {
  setMaterializeState(cardId, entry)
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
 *
 * 返回结果供调用方决定是否提示用户(§4.1 拒绝类失败要 toast)。**本模块不 import UI**:它被
 * tab-store 依赖、进而进单测,拉进 toast 会让 solid/react 运行时解析失败拖垮整组测试。
 * 提示在 ./materialize-notify.ts。
 */
export type MaterializeResult =
  | { ok: true }
  /** skipped:不具备落盘条件(非 uri 卡 / 无项目目录 / 非桌面端),不是失败,不提示 */
  | { ok: false; skipped: true }
  | { ok: false; skipped?: false; filename: string; reason: string; nameRejected: boolean }

export async function materializeUriCardToOutputs(
  card: { id: string; type: string; source: "inline" | "uri" | "path"; uri?: string; fileName?: string; title?: string },
  projectDir: string,
  sessionId: string,
): Promise<MaterializeResult> {
  if (card.source !== "uri" || !card.uri) return { ok: false, skipped: true }
  if (!projectDir || !sessionId) return { ok: false, skipped: true }
  const api = getDesktopApi()
  if (typeof api?.downloadResourceToTemp !== "function") return { ok: false, skipped: true }
  const base = defaultFilename(card)
  const filename = card.type === "markdown" ? ensureMarkdownExt(base) : base
  setMaterializeState(card.id, { state: "pending" })
  try {
    // 幂等键传 uri(资源身份),不传 card.id —— 见文件头说明。
    const localPath = await api.downloadResourceToTemp!(card.uri, card.uri, filename, projectDir, sessionId)
    // 登记本地副本路径:openTab 据此给 uri 卡补 filePath,与「文件管理打开同一文件」去重到同一个 tab。
    materializedPaths.set(card.id, localPath)
    setMaterializeState(card.id, { state: "ready" })
    // 客户端触发侧日志(主进程落地本身另打 [octo:worktree] result-materialize);两者配对定位「出卡了没落盘」。
    console.log("[octo:resource] eager-materialize", { cardId: card.id, type: card.type, filename, sessionId, localPath })
    return { ok: true }
  } catch (err) {
    // 失败要能被用户看见并重试:入口卡据此渲染失败态(旧实现只 warn,产物静默消失)。
    const reason = err instanceof Error ? err.message : String(err)
    setMaterializeState(card.id, { state: "failed", error: reason })
    console.warn("[octo:resource] eager-materialize-failed", { cardId: card.id, uri: card.uri, reason })
    return { ok: false, filename, reason, nameRejected: isNameRejected(reason) }
  }
}

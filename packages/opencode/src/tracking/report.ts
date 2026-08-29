import { Effect } from "effect"
import type { Snapshot } from "@/snapshot"
import type { MessageV2 } from "@/session/message-v2"
import { SessionExtras } from "@/session/extras"

// 服务端产物打点(SPEC-INS-033 D3/D4/D5)——artifact-file-write / artifact-file-edit /
// artifact-mcp-return / artifact-output-outside 的服务端发射器。设计论证在 octo-agent 文档仓
// spec §6;此处只记实现要点:
//
//   - 为何在服务端:产物是**系统事实**(谁在哪个 turn 写了哪个文件),业界在产生它的进程上报。
//     前端 effect 版的三层补丁(baseline / showGenerating 守卫 / debounce)全部源于把触发器挂在
//     UI 组件生命周期上——切走会话即漏报;服务端在 summarize 之后发,组件在不在都照发。
//   - 事件名(D5):沿用原口径名 artifact-file-write / artifact-file-edit / artifact-mcp-return
//     (用户拍板「名字别改」),语义延续但实现与覆盖面升级——发送端迁服务端、per-file、
//     且归因兜底让 bash 等脚本通道也归入 write/edit(旧前端口径永远漏报这类)。
//     归因本身两层——先 tool part 精确匹配,匹配不上按 git status 兜底
//     (added→write / modified→edit,覆盖 bash/powershell 等脚本通道:diff 有、tool part 没有)。
//     原 artifact-file-write/edit/mcp-return 三条前端 effect 已删,由本模块接管同名事件。
//   - 协议:复刻前端 tracker(octoapp/utils/tracker.ts)的 /record/logger/interaction 契约,
//     端点无鉴权(裸 JSON POST),字段同构;browserName 固定 "server" 供分析侧区分来源。
//   - at-least-once:summarize 每个 finish-step 都跑,同一 turn 会发多轮;下游按
//     (name, messageId, file) 幂等去重取最新 status。本模块的已发 Set 只是省流量优化,
//     不承担正确性(进程重启即空,漏发由下一个 finish-step / 下一个 turn 的窗口补上)。
//   - base URL:OCTO_REPORT_BASE_URL(经 desktop createSidecarEnv 从 VITE_OCTO_REPORT_BASE_URL
//     桥接注入,同 OCTO_KB_BASE_URL 模式)。未配置(典型外网调试)→ mock 日志
//     [octo:tracker-server],且 account 缺失时用占位 "mock" 继续发(只打日志不真发,
//     不进真实数据管道——外网验证流程与前端 tracker-mock 对齐)。真实上报模式 account
//     缺失仍整批跳过(空 account 的行无法归属用户,只会制造脏数据)。
//
// 只服务 octo_insight 会话(summary.ts 挂钩处按 agent 守卫),make / studio 不报。

const REPORT_PATH = "/record/logger/interaction"
const TIMEOUT_MS = 10_000

function env(name: string) {
  return process.env[name]
}

export function reportBaseUrl(): string | undefined {
  const value = env("OCTO_REPORT_BASE_URL")?.trim()
  return value && value.length > 0 ? value : undefined
}

// 平台字段映射:前端 tracker 从 navigator.userAgent 解析(1=Windows 2=macOS 3=Linux),
// 服务端没有浏览器,按 process.platform 取同值;browserName 固定 "server"。
function platformNumber(): number {
  if (process.platform === "win32") return 1
  if (process.platform === "darwin") return 2
  return 3
}

function platformName(): string {
  if (process.platform === "win32") return "Windows"
  if (process.platform === "darwin") return "macOS"
  return "Linux"
}

/** 合成 datas[].path:复刻前端路由 /insight/:id?(octo.tsx)的 URL 形态;extend 同带 sessionId,
 *  会话归属不依赖 path 解析。 */
export function synthPath(sessionID: string): string {
  return `http://localhost/insight/${sessionID}`
}

// payload 构造(纯函数,单测覆盖):与前端 tracker.ts 的 interaction 报文同构。
export function buildPayload(input: {
  account: string
  name: string
  extend: Record<string, unknown>
}): Record<string, unknown> {
  return {
    account: input.account,
    browserName: "server",
    browserVersion: "",
    os: platformName(),
    platform: platformNumber(),
    project: "octo-agent",
    userAgent: "octo-agent-server",
    module: "insight",
    datas: [
      {
        type: "interaction",
        subType: "click",
        name: input.name,
        path: synthPath(String(input.extend.sessionID ?? "")),
        extend: JSON.stringify(input.extend),
      },
    ],
  }
}

/** 单条事件发送(Effect,错误吞掉只留日志——打点不参与业务、不能反噬 turn)。 */
export function sendOne(input: { account: string; name: string; extend: Record<string, unknown> }): Effect.Effect<void> {
  const payload = buildPayload(input)
  const base = reportBaseUrl()
  if (!base) {
    console.log("[octo:tracker-server] mock", JSON.stringify(payload))
    return Effect.void
  }
  return Effect.promise(async () => {
    // 打点不参与业务:任何网络失败只留日志,绝不反噬 turn。
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
      try {
        const res = await fetch(`${base.replace(/\/$/, "")}${REPORT_PATH}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
          signal: controller.signal,
        })
        if (!res.ok) console.error("[octo:tracker-server] failed", { status: res.status, name: input.name })
      } finally {
        clearTimeout(timer)
      }
    } catch (err) {
      console.error("[octo:tracker-server] error", { name: input.name, err: err instanceof Error ? err.message : String(err) })
    }
  })
}

/** diff 路径是否属于本会话产物区 `.octo/<sessionId>/`(SPEC-INS-014 §2)。镜像原前端
 *  worktree-layout.ts 判据(前端副本已随事件迁服务端删除):
 *  git diff 路径相对仓库根、projectDir 可能是仓库子目录,故按「最后一个 .octo 段的
 *  下一段是否等于本 sessionId」判,不能 startsWith(".octo/")。 */
export function isSessionArtifactPath(filePath: string, sessionId: string): boolean {
  const segs = filePath.split(/[\\/]/)
  const i = segs.lastIndexOf(".octo")
  return i !== -1 && segs[i + 1] === sessionId
}

/** 文件类型判定(SPEC-INS-026 §4.2 六值枚举的服务端镜像)。与前端口径一致:
 *  扩展名优先、无扩展名 / 未知类型归 file;代码类扩展归 code;csv 归 file(与前端一致)。 */
export function outputTypeOf(filename: string): string {
  const ext = filename.slice(filename.lastIndexOf(".") + 1).toLowerCase()
  if (filename.lastIndexOf(".") === -1) return "file"
  if (["md", "markdown"].includes(ext)) return "markdown"
  if (ext === "html" || ext === "htm") return "html"
  if (ext === "json") return "json"
  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico"].includes(ext)) return "image"
  if (
    [
      "ts", "tsx", "js", "jsx", "mjs", "cjs", "py", "rb", "go", "rs", "java", "kt", "swift",
      "c", "h", "cpp", "hpp", "cs", "php", "sh", "bash", "ps1", "sql", "lua", "r", "txt", "log",
    ].includes(ext)
  ) {
    return "code"
  }
  return "file"
}

// ── 归因(D4):tool part 精确 → resource_link basename → git status 兜底 ──────────────────
//
// 归因结果分派到事件名(D5:沿用原口径名,分析侧按行即得来源):
//   artifact-file-write :write 工具(含覆盖写,工具优先于 status)或脚本新建(status=added)
//   artifact-file-edit  :edit 工具或脚本修改(status=modified)
//   artifact-mcp-return :MCP resource_link 落盘文件(带 tool = business_type 业务工具名)
// 兜底归因覆盖 bash/powershell/python 等脚本通道:diff 里有、tool part 里没有的文件,
// 按 git status 的 added/modified 语义天然分到 write/edit——git 权威判定,不嗅探命令文本。

type Attribution = { event: "write" | "edit" | "mcp"; tool?: string }

/** 归因结果 → 事件名(D5:沿用原 artifact-file-write/edit、artifact-mcp-return 口径名)。 */
const EVENT_NAMES = {
  write: "artifact-file-write",
  edit: "artifact-file-edit",
  mcp: "artifact-mcp-return",
} as const

/** 工具 bare 名(write/edit 可能带 MCP 前缀如 `clientName_write`)。 */
function bareToolName(tool: unknown): string {
  if (typeof tool !== "string") return ""
  return tool.includes(":") ? (tool.split(":").pop() ?? "") : tool
}

/** 是否「写盘类」工具(write/edit 及带前缀变体)——归因只关心它们;read/bash 等工具
 *  的 part 虽然也可能带 metadata.filepath,但与产物落点无关,先过滤掉。 */
function isFileWriteToolName(bare: string): boolean {
  return bare === "write" || bare === "edit" || bare.endsWith("_write") || bare.endsWith("_edit")
}

/** 工具 part 的落点路径(completed 态):优先 state.metadata.filepath(服务端写盘的权威
 *  绝对路径,write/edit 均返回),兜底 state.input.filePath。仅写盘类工具。 */
function readToolPartPath(part: Record<string, unknown>): { tool: string; path: string } | undefined {
  if (part.type !== "tool") return undefined
  const bare = bareToolName(part.tool)
  if (!isFileWriteToolName(bare)) return undefined
  const state = part.state as Record<string, unknown> | undefined
  if (state?.status !== "completed") return undefined
  const fromMeta = (state.metadata as Record<string, unknown> | undefined)?.filepath
  if (typeof fromMeta === "string" && fromMeta.length > 0) return { tool: bare, path: fromMeta }
  const input = state.input as Record<string, unknown> | undefined
  const fromInput = input?.filePath ?? input?.path ?? input?.file_path
  return typeof fromInput === "string" && fromInput.length > 0 ? { tool: bare, path: fromInput } : undefined
}

/** 路径后缀匹配:tool part 是绝对路径(含 .octo/<sessionId>/ 前缀),diff file 是仓库相对路径
 *  (也含 .octo/<sessionId>/ 前缀)——统一分隔符 + 大小写不敏感比较「后段是否相等」。 */
function pathSuffixMatch(toolPath: string, diffFile: string): boolean {
  const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+/g, "/").toLowerCase()
  const a = norm(toolPath)
  const b = norm(diffFile)
  return a === b || a.endsWith("/" + b) || b.endsWith("/" + a)
}

/** 从 resource_link part 提取 {name, business_type}(形态镜像前端 findResourceLinks:
 *  独立 part type=resource_link 主路径 + tool part metadata.content[] 兜底)。 */
function collectResourceLinks(parts: unknown[]): Array<{ name: string; tool: string }> {
  const out: Array<{ name: string; tool: string }> = []
  for (const part of parts) {
    if (!part || typeof part !== "object") continue
    const p = part as Record<string, unknown>
    if (p.type === "resource_link" && typeof p.name === "string") {
      out.push({ name: p.name, tool: readBusinessType(p) })
      continue
    }
    const state = p.state as Record<string, unknown> | undefined
    const meta = state?.metadata as Record<string, unknown> | undefined
    const contents = meta?.content
    if (Array.isArray(contents)) {
      for (const item of contents) {
        if (!item || typeof item !== "object") continue
        const c = item as Record<string, unknown>
        if (c.type === "resource_link" && typeof c.name === "string") out.push({ name: c.name, tool: readBusinessType(c) })
      }
    }
  }
  return out
}

function readBusinessType(obj: Record<string, unknown>): string {
  const v = obj.business_type
  return typeof v === "string" && v.length > 0 ? v : "unknown"
}

/** resource_link 文件名匹配:eager 落盘用 link.name(markdown 补 .md、撞名加 `-N` 后缀,
 *  均为 best-effort 前缀关系),用「裸名相同 + 可选 -N 后缀 + 相同扩展名」匹配。 */
export function linkNameMatch(linkName: string, diffFile: string): boolean {
  const base = (diffFile.replace(/\\/g, "/").split("/").pop() ?? "").toLowerCase()
  if (!base) return false
  const name = linkName.toLowerCase()
  if (base === name) return true
  // markdown 补扩展名:link 名「报告」→ 落盘「报告.md」
  if (base === name + ".md") return true
  // 撞名加后缀:「报告.md」→「报告-1.md」;配合补扩展名:「报告」→「报告-1.md」
  const stem = name.replace(/\.md$/, "")
  return new RegExp(`^${stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(-\\d+)?\\.(md|[a-z0-9]+)$`).test(base)
}

/** 三层归因(纯函数,单测覆盖):对一条 diff 返回它该走的事件。
 *  优先级:write/edit 工具 part 精确匹配 > resource_link basename > status 兜底。 */
export function attributeDiff(
  diff: Pick<Snapshot.FileDiff, "file" | "status">,
  toolParts: Array<{ tool: string; path: string }>,
  resourceLinks: Array<{ name: string; tool: string }>,
): Attribution {
  for (const t of toolParts) {
    if (!pathSuffixMatch(t.path, diff.file)) continue
    if (t.tool === "write" || t.tool.endsWith("_write")) return { event: "write" }
    return { event: "edit" }
  }
  for (const link of resourceLinks) {
    if (linkNameMatch(link.name, diff.file)) return { event: "mcp", tool: link.tool }
  }
  return { event: diff.status === "added" ? "write" : "edit" }
}

/** 从 turn messages(含 parts)提取归因原料(仅 assistant 消息:user 的附件 part 与归因无关)。 */
export function collectAttributionSources(messages: MessageV2.WithParts[]): {
  toolParts: Array<{ tool: string; path: string }>
  resourceLinks: Array<{ name: string; tool: string }>
} {
  const toolParts: Array<{ tool: string; path: string }> = []
  const assistantParts: unknown[] = []
  for (const m of messages) {
    if (m.info.role !== "assistant") continue
    assistantParts.push(...(m.parts as unknown[]))
  }
  for (const part of assistantParts) {
    if (!part || typeof part !== "object") continue
    const hit = readToolPartPath(part as Record<string, unknown>)
    if (hit) toolParts.push(hit)
  }
  return { toolParts, resourceLinks: collectResourceLinks(assistantParts) }
}

// 已发键 `messageID:file`(省流量层,见文件头)。跨 turn 场景:同一文件在后续 turn 再被改,
// messageID 不同 → 键不同 → 照发,不受影响。
const sentKeys = new Set<string>()

/** summarize 挂钩入口:把一个 turn 的 FileDiff[] 归因后 per-file 发送。
 *  - 会话目录内、非 deleted:按归因分派到 artifact-output-write / -edit / -mcp
 *  - 会话目录外:汇总一条 artifact-output-outside(噪声桶,只计数)
 *  - account:真实上报模式取不到(登录态丢失/服务重启后 extra 空)整批跳过;mock 模式
 *    (未配 base URL,外网验证)用占位 "mock" 继续发(只打日志,不进真实管道)。 */
export function reportDiffs(input: {
  sessionID: string
  messageID: string
  diffs: Snapshot.FileDiff[]
  messages: MessageV2.WithParts[]
}): Effect.Effect<void> {
  const mockMode = !reportBaseUrl()
  const account = SessionExtras.readExtraString(input.sessionID, "account")
  if (!account && !mockMode) {
    console.warn("[octo:tracker-server] account missing, skip artifact-output", {
      sessionID: input.sessionID,
      messageID: input.messageID,
    })
    return Effect.void
  }
  const effectiveAccount = account ?? "mock"

  const { toolParts, resourceLinks } = collectAttributionSources(input.messages)
  let outside = 0
  const effects: Effect.Effect<void>[] = []
  for (const d of input.diffs) {
    if (d.status === "deleted") continue
    const key = `${input.messageID}:${d.file}`
    if (sentKeys.has(key)) continue
    sentKeys.add(key)
    if (!isSessionArtifactPath(d.file, input.sessionID)) {
      outside++
      continue
    }
    const attr = attributeDiff(d, toolParts, resourceLinks)
    const extend: Record<string, unknown> = {
      sessionID: input.sessionID,
      messageId: input.messageID,
      file: d.file,
      type: outputTypeOf(d.file),
      status: d.status ?? "modified",
    }
    if (attr.tool) extend.tool = attr.tool
    effects.push(sendOne({ account: effectiveAccount, name: EVENT_NAMES[attr.event], extend }))
  }
  if (outside > 0) {
    effects.push(
      sendOne({
        account: effectiveAccount,
        name: "artifact-output-outside",
        extend: { sessionID: input.sessionID, messageId: input.messageID, outside },
      }),
    )
  }
  return Effect.all(effects, { concurrency: 4 }).pipe(Effect.asVoid)
}

export * as Tracking from "./report"

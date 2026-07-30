import type { AssistantMessage, Message } from "@opencode-ai/sdk/v2/client"
import type { SessionStatus } from "@opencode-ai/sdk/v2"
import { SessionTurn } from "@opencode-ai/ui/session-turn"
import { useData, useI18n, I18nProvider, type UiI18n } from "@opencode-ai/ui/context"
import { createEffect, createMemo, For, Show } from "solid-js"
import type { JSX } from "solid-js"
import { useProjectDir } from "@/hooks/use-project-dir"
import { materializeUriCardToOutputs } from "../utils/local-resource"
import { notifyMaterializeFailure } from "../utils/materialize-notify"
import { OutputEntryCard } from "./output-entry-card"
import { scanFencedHtml, type HtmlFenceBlock } from "../utils/detect"
import { isMindmapJSON } from "../utils/mindmap-adapter"
import { findResourceLinks, linkToOutputType, type ResourceLink } from "../utils/resource-link"
import { findWriteCards, basename } from "../utils/write-output"
import { readTaskInfo, businessToolBareName, type TaskCardEntry, type TaskInfo } from "../utils/task-detect"
import { TaskCardView } from "./task-card"
import { parseUploadedFiles } from "../lib/upload"
import { fileTypeIconUrl } from "../icons/illustrations"
import { tracker } from "@/utils/tracker"

export type OutputCardType = "table" | "mindmap" | "markdown" | "file" | "json" | "html" | "code" | "image"

export type OutputCard = {
  id: string
  title: string
  type: OutputCardType
  source: "inline" | "uri" | "path"
  content?: string          // inline 必填;uri/path 模式下可空(fetch/读盘后填到 tab cache)
  uri?: string              // uri 模式必填(MCP resource_link.uri)
  mimeType?: string         // uri 模式必填(影响渲染路由)
  fileName?: string         // uri 模式来自 resource_link.name
  filePath?: string         // path 模式必填(write 工具目标路径,见 output-renderers.md §2.6)
  description?: string      // uri 模式来自 resource_link.description,卡片副标题
  createdAt: Date
}

// eager 落地去重(SPEC-INS-014 v4):记已触发落盘的 uri 卡 id,避免同一卡在 memo 反复重算 / 多 turn 实例
// 重挂时重复发 IPC(主进程本身按 card.id 幂等,这层只是省无谓 IPC)。card.id 全局唯一(含 messageID)。
const eagerMaterializedCardIds = new Set<string>()

// write 工具产物不再出卡(路径 C 退役,见 output-renderers.md §2.6):文件已在磁盘,由独立扫盘的
// 文件管理面板呈现/预览。此 set 只用于「write 完成 → 通知文件管理刷新」的去重(按 messageID:filePath),
// 避免 memo 重算 / 多 turn 实例重挂时重复发刷新。
const refreshedWritePaths = new Set<string>()

// 「服务端真实使用」打点去重(server-mcp-used / server-skill-used):记已上报过的 usage key,
// 跨 turn 实例重挂 / memo 重算都只报一次。key 全局唯一(mcp:<taskId> / skill:<partId>)。
// 注意:这只解决「同一 usage 不重复报」;「页面刷新后不把历史 usage 当新事件重报」由 InsightTurn
// 内的 baseline 快照(首次观测即视为历史,不报)负责——两层配合才不会在每次加载会话时虚增计数。
const trackedServerUsageKeys = new Set<string>()

/** 识别 skill 工具调用 part。skill 是内置工具(无 MCP 前缀),完成后 state.metadata.name = 解析出的技能名。 */
function readSkillUsage(part: unknown): { partId: string; skill: string } | undefined {
  if (!part || typeof part !== "object") return undefined
  const p = part as Record<string, unknown>
  if (p.type !== "tool" || p.tool !== "skill") return undefined
  const id = typeof p.id === "string" ? p.id : undefined
  const state = p.state as Record<string, unknown> | undefined
  if (!id || state?.status !== "completed") return undefined
  const meta = state.metadata as Record<string, unknown> | undefined
  const name = meta?.name
  return typeof name === "string" && name.length > 0 ? { partId: id, skill: name } : undefined
}

// 路径 B 嗅探规则:table / mindmap / json / html 互相独立,允许同时命中
// (典型:内网 mindmap MCP 返回的 JSON 既符合 plainJSON 又符合 mindmap shape → 出双卡)
// 详见 docs/specs/ui/output-renderers.md §2。直接在 outputCards memo 内顺序判断,
// 不再走"按优先级取一个"的旧路径。

// 工具调用过程的显示名映射(SPEC-INS-021 §4):上游 SessionTurn 用 i18n 键取工具标题
// (message-part.tsx getToolInfo),这里给面向研究员的人话覆盖,不动上游实现——只在本组件
// 子树内生效,其余键透传外层 i18n。extract_document 是自研工具,title 已在工具侧直接中文化。
const TOOL_TITLE_OVERRIDES: Record<string, string> = {
  "ui.tool.read": "读取文件",
  "ui.tool.grep": "检索内容",
  "ui.tool.glob": "查找文件",
  "ui.messagePart.title.write": "写入产物",
  "ui.tool.agent": "子任务分析",
  "ui.tool.agent.default": "子任务分析",
}

function withInsightToolTitles(outer: UiI18n): UiI18n {
  return {
    locale: outer.locale,
    t: (key, params) => {
      // extract_document 无专属渲染器,走 GenericTool 的「调用了 `<tool>`」模板;此处按参数特例
      if (key === "ui.basicTool.called" && params?.tool === "extract_document") return "提取文档正文"
      return TOOL_TITLE_OVERRIDES[key] ?? outer.t(key, params)
    },
  }
}


export function InsightTurn(props: {
  sessionID: string
  messageID: string
  status: SessionStatus
  active: boolean
  onOpenResult: (card: OutputCard) => void
  /** 锚点 = 本 turn 的 user message 下挂着的长任务卡片(每个 task_id 一张)。spec: task-card.md §3.3 */
  taskCards: TaskCardEntry[]
  /** 任务卡片操作(由 InsightPage 接线 LLM 触发) */
  onTaskRefresh: (taskId: string) => void
  onTaskStop: (taskId: string) => void
  onTaskOpenResult: (taskId: string) => void
  /**
   * 给定 task_id 返回该任务「首次完成时确定的产物链接」(跨 turn 聚合后的稳定结果)。
   * 用于 get_task_result 重复查询 turn:server 每次重查可能返回一批新 URI,
   * 这里据 task_id 换回最初那批文件,保证每次查询回答下方挂的都是同一批产物(spec: task-card.md 重复查询不重生成)。
   */
  resolveTaskLinks?: (taskId: string) => ResourceLink[] | undefined
  /** 生成文件落盘后通知刷新文件管理表格 */
  onFilesRefresh?: () => void
}): JSX.Element {
  const data = useData()
  const i18n = useI18n()

  // 取该用户消息之后的第一条 assistant 消息
  const assistantMsg = createMemo((): AssistantMessage | undefined => {
    const messages = ((data.store.message as Record<string, Message[]>)?.[props.sessionID] ?? [])
    const idx = messages.findIndex((m) => m.id === props.messageID)
    if (idx === -1) return undefined
    for (let i = idx + 1; i < messages.length; i++) {
      const m = messages[i]
      if (m.role === "assistant") return m as AssistantMessage
      if (m.role === "user") break
    }
    return undefined
  })

  // 出卡扫描必须聚合本 turn 内**所有** assistant 消息的 parts,而非仅第一条:
  // 多步 Agent(如先 read 探索→再 write)会产生多条 assistant 消息,
  // write/resource_link 可能落在靠后的消息里;只读第一条会漏掉(见 output-renderers.md §2.6 多步 turn)。
  const turnAssistantParts = createMemo(() => {
    const messages = (data.store.message as Record<string, Message[]>)?.[props.sessionID] ?? []
    const idx = messages.findIndex((m) => m.id === props.messageID)
    if (idx === -1) return []
    const partStore = data.store.part as Record<string, { type: string; text?: string }[]>
    const out: { type: string; text?: string }[] = []
    for (let i = idx + 1; i < messages.length; i++) {
      const m = messages[i]
      if (m.role === "user") break
      if (m.role === "assistant") out.push(...(partStore?.[m.id] ?? []))
    }
    return out
  })

  // 本 turn user 消息的全部 part(附件清单文本块 + 图片 FilePart 都从这里取)。
  const turnParts = createMemo(
    () =>
      (data.store.part as Record<
        string,
        Array<{ type: string; text?: string; synthetic?: boolean; mime?: string; url?: string; filename?: string }>
      >)?.[props.messageID] ?? [],
  )

  // 非图片附件(SPEC-INS-015 ②④):从 synthetic [附件] 清单解析(filename + 本地路径),只取 filename 渲染文件卡片。
  // 必须按 "[附件]" 头定位:chip turn(SPEC-INS-017)还有 [MCP触发指令] / [MCP声明] 两个 synthetic part,
  // 拿错 part 会把模板行误解析成文件卡片。
  const inputAttachments = createMemo((): Array<{ filename: string; path: string }> => {
    const block = turnParts().find(
      (p) => p.type === "text" && p.synthetic && typeof p.text === "string" && p.text.startsWith("[附件]"),
    )
    if (!block?.text) return []
    return parseUploadedFiles(block.text)
  })

  // 图片附件(③):从本 turn 的图片 FilePart(type=file + mime=image/*) 取 url 渲染缩略图。
  // 按 url 去重:同一张图的 optimistic FilePart(本地 part id)与 server 回传 FilePart(server part id)
  // 因 id 不同无法在 sync 层互相替换,会并存于同一 messageID 的 part 数组;两者 url 相同(同一 S3 对象),
  // 按 url 去重即只显示一张(用户真的粘两张不同图时 url 不同,不会被误合并)。
  const inputImages = createMemo((): Array<{ filename: string; url: string }> => {
    const seen = new Set<string>()
    const out: Array<{ filename: string; url: string }> = []
    for (const p of turnParts()) {
      if (p.type !== "file" || typeof p.mime !== "string" || !p.mime.startsWith("image/") || typeof p.url !== "string") continue
      if (seen.has(p.url)) continue
      seen.add(p.url)
      out.push({ filename: p.filename ?? "image", url: p.url })
    }
    return out
  })

  // 本轮是否是最新的（最后一条）用户消息 —— 仅对最新轮次显示生成中占位
  const isLatestTurn = createMemo(() => {
    const messages = ((data.store.message as Record<string, Message[]>)?.[props.sessionID] ?? [])
    const lastUser = [...messages].reverse().find((m) => m.role === "user")
    return lastUser?.id === props.messageID
  })

  // session busy 且是最新轮次，才显示生成中
  const showGenerating = createMemo(() => props.active && isLatestTurn())

  // 同 turn 的 OutputCard 列表(支持 0~N 张,对应 MCP completed 返回的 1~N 个 resource_link)
  // 注意:parts 必须在 showGenerating 判断之前读,确保 SolidJS 始终追踪该依赖;
  // 若先 return [] 则 turnAssistantParts() 从未被追踪,session idle 后 memo 不会因 parts 变化重新触发。
  //
  // 两类路径(spec: output-renderers.md §0):
  //   A. MCP 强契约 — resource_link part → 必出卡 / 多卡(spec: §2.5)
  //   B. 自由文本嗅探 — text part → fence/shape 兜底(spec: §2)
  // 同 turn A 命中则 B 不执行(避免重复)。
  const outputCards = createMemo((): OutputCard[] => {
    // 聚合本 turn 所有 assistant 消息的 parts(多步 Agent:read→write 跨消息,见 turnAssistantParts)
    const parts = turnAssistantParts() as Array<{ type: string; text?: string }>
    const msgDate = new Date(assistantMsg()?.time?.created ?? Date.now())
    if (showGenerating()) return []

    // 同 turn 有任务卡片就抑制 OutputCard:completed 由 TaskCardView 内的"查看完整结果"按钮触发 openTab
    // (spec: docs/specs/ui/task-card.md §3.4 优先级)
    if (props.taskCards.length > 0) return []

    // ── 路径 A:MCP resource_link part(强契约,零嗅探)──
    // 一个 resource_link = 一张卡,类型按 linkToOutputType(business_type 优先,mimeType 兜底)。
    //   - "mindmap" → 单张 mindmap 卡(打开后 预览/代码 切换看 markmap 或原始 JSON)
    //   - 其他(key_findings / search_reports / run_*_analysis 等)→ 按 mimeType 路由
    // 详见 output-renderers.md §1 视图切换 / §2.5.2 + mcp-contract.md §business_type
    //
    // get_task_result 重复查询:优先换回该任务「首次确定的产物链接」——用户每次「查询任务 X 进度」
    // 都会重调 get_task_result,server 可能每次返回一批新 URI;按 task_id 取最初那批,保证每次查询
    // 回答下方挂的都是同一批原始产物,而非"又重新生成"的新文件。
    //
    // ⚠️ 只在本 turn 真正观测到该任务 completed 时才回填(问题2修复):readTaskInfo 对「处理中」的
    // get_task_result 也会返回 taskId,若不 gate,最终产物卡会被回填到每一次「处理中」查询回答下方
    // (跨 turn 聚合的 resolveTaskLinks 一旦任务完成就恒返回那批产物)。gate 在 completed 上 →
    // 产物卡只出现在真正查到结果的那一次 turn。非任务结果(无 completed task)走本 turn 原始 links。
    const completedTask = parts.reduce<TaskInfo | undefined>((acc, part) => {
      if (acc) return acc
      const info = readTaskInfo(part)
      return info?.status === "completed" ? info : undefined
    }, undefined)
    const canonical = completedTask ? props.resolveTaskLinks?.(completedTask.taskId) : undefined
    const links = canonical && canonical.length > 0 ? canonical : findResourceLinks(parts)
    // ── 路径 C:write 工具产物,收窄为 md/html 扩展名白名单出卡(SPEC-INS-014 v6 / output-renderers §2.6)──
    // #384 曾整条退役路径 C——因无法确定性区分「交付物 vs 脚本/scratch」(gen_word.ps1 被误出卡)。
    // 现按扩展名白名单收窄:只有 md/html 出卡(它们有应用内专用预览 md→编辑器 / html→iframe,且几乎不会是
    // scratch),其余 write 产物(docx/py/脚本…)仍不出卡、只走文件管理。纯扩展名判定,不猜意图。
    // 与路径 A 并列(来源不重叠:A=MCP resource_link,C=本地 write)。落点由 write-output resolveCardPath 取
    // metadata.filepath(#368 重定向后的真实写盘路径),点开时 PathTabBody 走 SDK file.read 读盘。
    // 白名单外的 write 产物照样落 outputs(#368)、并由下方独立 effect 刷新文件管理——只是不在对话流出卡。
    const writeCards: OutputCard[] = findWriteCards(parts)
      .filter((w) => w.type === "markdown" || w.type === "html")
      .map((w, idx) => {
        const name = basename(w.filePath)
        return {
          id: `card-${props.messageID}-write-${idx}`,
          title: name,
          type: w.type,
          source: "path" as const,
          filePath: w.filePath,
          fileName: name, // 供入口卡按扩展名命中图标 + 下载默认文件名
          createdAt: msgDate,
        }
      })
    if (links.length > 0 || writeCards.length > 0) {
      console.log("[octo:card] resource_links + write(md/html)", {
        linkCount: links.length,
        writeCount: writeCards.length,
        links: links.map((l) => ({ mime: l.mimeType, name: l.name, uri: l.uri, business_type: l.business_type })),
        writes: writeCards.map((w) => ({ filePath: w.filePath, type: w.type })),
        msgID: props.messageID,
      })
      const linkCards: OutputCard[] = links.map((link, idx) => ({
        id: `card-${props.messageID}-${idx}`,
        title: link.name || `分析结果 ${idx + 1}`,
        type: linkToOutputType(link),
        source: "uri" as const,
        uri: link.uri,
        mimeType: link.mimeType,
        fileName: link.name,
        description: link.description,
        createdAt: msgDate,
      }))
      return [...linkCards, ...writeCards]
    }

    // ── 路径 B:自由文本嗅探(规则收紧版,spec §2.1)──
    const textParts = parts.filter((p) => p.type === "text" && typeof p.text === "string")
    const summary = textParts.length === 0
      ? ""
      : ((textParts[textParts.length - 1]?.text ?? "").slice(0, 80))
    console.log("[octo:detect] start", {
      msgID: props.messageID,
      partsCount: parts.length,
      textPartsCount: textParts.length,
      summary,
    })

    if (textParts.length === 0) {
      console.log("[octo:detect] reject", { msgID: props.messageID, reason: "no text part" })
      return []
    }

    const cards: OutputCard[] = []

    // B-1. HTML fence 多卡(扫所有 part,支持未闭合 fence)
    const htmlBlocks: HtmlFenceBlock[] = scanFencedHtml(textParts)
    if (htmlBlocks.length > 0) {
      console.log("[octo:detect] html-fence-found", {
        msgID: props.messageID,
        count: htmlBlocks.length,
        blocks: htmlBlocks.map((b) => ({ closed: b.closed, len: b.html.length, partIndex: b.partIndex })),
      })
      htmlBlocks.forEach((block, idx) => {
        const heading = block.html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim()
        cards.push({
          id: `card-${props.messageID}-html-${idx}`,
          title: heading || (htmlBlocks.length > 1 ? `可视化页面 ${idx + 1}` : "可视化页面"),
          type: "html",
          source: "inline",
          content: block.html,
          createdAt: msgDate,
        })
      })
    }

    // B-2. 非 HTML 规则:取最后一条 text part 跑一次
    //   - mindmap shape JSON → mindmap 入口卡(markmap 思维导图渲染)
    //   - 其他 JSON / 代码 / markdown / **markdown 表格** → **不出卡**(对话区 opencode <Markdown> 原渲染已足够)
    // 设计:出卡的唯一目的是"追加预览能力";普通 JSON / 代码段 / markdown 表格有 shiki 高亮 + 复制即够,无追加价值。
    // 注:md 表格曾在路径 B 嗅探成 table 卡,2026-06 移除——业务表格走路径 A(text/csv resource_link),
    //    对话里 LLM 直出的 md 表格由上游 <Markdown> 原样渲染已足够;详见 output-renderers.md §2.1。
    const lastText = (textParts[textParts.length - 1]?.text ?? "").trim()
    if (lastText.length >= 10) {
      const matched: string[] = []
      if (isMindmapJSON(lastText)) {
        matched.push("mindmap")
        cards.push({
          id: `card-${props.messageID}-mindmap`,
          title: lastText.match(/^#{1,3}\s+(.+)/m)?.[1]?.trim() ?? "思维导图",
          type: "mindmap",
          source: "inline",
          content: lastText,
          createdAt: msgDate,
        })
      }
      if (matched.length > 0) {
        console.log("[octo:detect] match", {
          msgID: props.messageID,
          rules: matched,
          textLen: lastText.length,
        })
      }
    }

    if (cards.length === 0) {
      console.log("[octo:detect] reject", {
        msgID: props.messageID,
        reason: "no rule matched (length-tail-only fallback removed per spec §2.1)",
        lastTextPreview: lastText.slice(0, 200),
      })
    }
    return cards
  })

  // 对话区永远保留 opencode <Markdown> 原渲染(含 shiki 代码高亮 / markdown 表格 / 复制按钮)。
  // 入口卡片(下方紧凑条)作为"附加预览能力",绝不替代对话内容。
  // 业界对照:Claude.ai Artifacts / ChatGPT Canvas / Cursor 均保留对话原貌,不抹掉。
  // 历史 ADR-010 路线 A(CSS suppress)已作废,详见 docs/specs/ui/output-renderers.md §0。

  // eager 落地(SPEC-INS-014 v4):本 turn 路径 A 的 MCP `uri` 产物卡「出卡即落」进 outputs,不等点开;
  // path 源(write 工具产物)已在磁盘,只需通知文件管理表格刷新即可拉到(对齐 make 的 autoSaveArtifact)。
  // (任务产物走 index.tsx 的 taskCards effect;此处覆盖非任务的直接 resource_link。)inline 卡不落
  // (对话附加预览,前端不搬运)。dedup 跨 turn 实例共享,card.id 全局唯一(含 messageID)。
  const eagerProjectDir = useProjectDir()
  createEffect(() => {
    const dir = eagerProjectDir()
    for (const card of outputCards()) {
      if (eagerMaterializedCardIds.has(card.id)) continue
      // 只落地路径 A 的 uri 产物(需从 S3 下载进 outputs);路径 C 的 path 源卡(md/html write)已在磁盘、
      // inline 卡不落盘——两者都在此跳过,文件管理刷新由下方独立 effect 覆盖全部 write 产物。
      if (card.source !== "uri" || !card.uri) continue
      if (!dir || !props.sessionID) continue
      eagerMaterializedCardIds.add(card.id)
      void materializeUriCardToOutputs(card, dir, props.sessionID).then((r) => {
        notifyMaterializeFailure(r)
        props.onFilesRefresh?.()
      })
    }
  })

  // 失败卡「重试」:eagerMaterializedCardIds 是「已发起过」的去重集,重试要先摘掉这张卡的记号,
  // 否则上面的 effect 认为已发起、不会再跑。摘完直接重新发起一次(不依赖 effect 重跑,
  // 用户点了就该立刻有反应),状态由 materializeUriCardToOutputs 自己置回 pending。
  function retryMaterialize(card: OutputCard): void {
    const dir = eagerProjectDir()
    if (!dir || !props.sessionID) return
    eagerMaterializedCardIds.delete(card.id)
    eagerMaterializedCardIds.add(card.id)
    void materializeUriCardToOutputs(card, dir, props.sessionID).then((r) => {
      notifyMaterializeFailure(r)
      props.onFilesRefresh?.()
    })
  }

  // 文件管理刷新覆盖**全部** write 产物(不止出卡的 md/html):任何 write 都落 outputs,写完要通知文件
  // 管理刷新,否则新文件要用户手点刷新才出现。故此处仍扫全量 findWriteCards(不按白名单过滤),与出卡的
  // 白名单是两条正交的线。按 messageID:filePath 去重只发一次;生成中不扫,turn 落定后再刷。
  createEffect(() => {
    const parts = turnAssistantParts()
    if (showGenerating()) return
    let fresh = false
    for (const w of findWriteCards(parts)) {
      const key = `${props.messageID}:${w.filePath}`
      if (refreshedWritePaths.has(key)) continue
      refreshedWritePaths.add(key)
      fresh = true
    }
    if (fresh) props.onFilesRefresh?.()
  })

  // 「服务端真实使用」打点(与常规用户操作打点区分,统一 server- 前缀,清单见 docs/tracking.md):
  //   - server-mcp-used:某业务 MCP 工具真实被模型调用并提交长任务(每 task_id 一次),extend {tool,taskId}
  //   - server-skill-used:某 skill 真实被模型调用(每 skill part 一次),extend {skill}
  // 与用户主动打点(message-send 等)的关键差异:这是「模型/服务端」驱动的行为,统计 MCP/skill 真实被用到。
  //
  // 为何不在全局 event-reducer 消费 skill.used 事件:该事件不带 sessionID/agent,无法区分 insight 与
  // make/studio(它们也绑了 skill),会误标 module。改在 insight turn 内从本轮 parts / taskCards 识别,
  // 天然 insight 作用域,且对齐「生成内容回显到会话中」的语义(只统计真的出现在会话里的调用)。
  //
  // baseline 快照(usageBaselineTaken):首次观测本 turn 实例时,把当前已存在的 usage 全部记为「历史」
  // 不上报——否则每次刷新/切回会话重挂 turn,历史里的 MCP/skill 调用会被当成新事件重报,虚增计数。
  // 之后新到达的 usage(实时提交 / 实时调用)才上报一次(跨重挂由 trackedServerUsageKeys 兜底去重)。
  let usageBaselineTaken = false
  createEffect(() => {
    const usages: Array<{ key: string; kind: "mcp" | "skill"; tool?: string; taskId?: string; skill?: string }> = []
    for (const t of props.taskCards) {
      const bare = businessToolBareName(t.toolName)
      if (bare) usages.push({ key: `mcp:${t.taskId}`, kind: "mcp", tool: bare, taskId: t.taskId })
    }
    for (const part of turnAssistantParts()) {
      const skill = readSkillUsage(part)
      if (skill) usages.push({ key: `skill:${skill.partId}`, kind: "skill", skill: skill.skill })
    }

    // server-mcp-result:server-mcp-used 的「完成侧」对偶——业务 MCP 任务跑出终态时打一次成败,
    // 与提交侧用 taskId 成对(算成功率 / 时延)。只在 completed(success) / failed(failure) 两个终态打;
    // stopped(用户终止,已由 task-stop 覆盖)、pending / processing(未出结果)不打。key 用 mcp-result: 前缀
    // 与提交侧 mcp: 区分,同样纳入 baseline 快照 + trackedServerUsageKeys 去重(避免刷新历史会话虚增)。
    const results: Array<{ key: string; tool: string; taskId: string; status: "success" | "failure" }> = []
    for (const t of props.taskCards) {
      const bare = businessToolBareName(t.toolName)
      if (!bare) continue
      if (t.status !== "completed" && t.status !== "failed") continue
      results.push({
        key: `mcp-result:${t.taskId}`,
        tool: bare,
        taskId: t.taskId,
        status: t.status === "completed" ? "success" : "failure",
      })
    }

    if (!usageBaselineTaken) {
      usageBaselineTaken = true
      for (const u of usages) trackedServerUsageKeys.add(u.key)
      for (const r of results) trackedServerUsageKeys.add(r.key)
      return
    }

    for (const u of usages) {
      if (trackedServerUsageKeys.has(u.key)) continue
      trackedServerUsageKeys.add(u.key)
      if (u.kind === "mcp") {
        tracker.interaction({
          module: "insight",
          name: "server-mcp-used",
          extend: JSON.stringify({ tool: u.tool, taskId: u.taskId }),
        })
      } else {
        tracker.interaction({
          module: "insight",
          name: "server-skill-used",
          extend: JSON.stringify({ skill: u.skill }),
        })
      }
    }

    for (const r of results) {
      if (trackedServerUsageKeys.has(r.key)) continue
      trackedServerUsageKeys.add(r.key)
      tracker.interaction({
        module: "insight",
        name: "server-mcp-result",
        extend: JSON.stringify({ tool: r.tool, taskId: r.taskId, status: r.status }),
      })
    }
  })

  return (
    <div class="flex flex-col mb-4">
      {/* 用户附件(贴合用户气泡上方,右对齐)——非图片走文件卡片,图片走缩略图,替代在气泡里暴露裸路径/URL */}
      <Show when={inputAttachments().length > 0 || inputImages().length > 0}>
        <div class="octo-input-attachments">
          <For each={inputAttachments()}>
            {(f) => (
              <div class="octo-input-attachment-card" title={f.filename}>
                <img class="octo-input-attachment-card__icon" src={fileTypeIconUrl(f.filename)} width={24} height={24} alt="" aria-hidden="true" />
                <span class="octo-input-attachment-card__name">{f.filename}</span>
              </div>
            )}
          </For>
          <For each={inputImages()}>
            {(img) => (
              <img
                src={img.url}
                title={img.filename}
                alt={img.filename}
                style={{ width: "48px", height: "48px", "object-fit": "cover", "border-radius": "8px", "flex-shrink": "0" }}
              />
            )}
          </For>
        </div>
      </Show>

      {/* I18nProvider 薄包一层:仅覆盖工具标题键(TOOL_TITLE_OVERRIDES),把过程展示换成人话 */}
      <I18nProvider value={withInsightToolTitles(i18n)}>
        <SessionTurn
          sessionID={props.sessionID}
          messageID={props.messageID}
          status={props.status}
          active={props.active || (props.status.type === "retry" && isLatestTurn())}
          classes={{ root: "px-3" }}
        />
      </I18nProvider>

      <Show when={showGenerating()}>
        <div
          class="mx-3 mb-3 p-3"
          style={{
            "border-radius": "var(--octo-radius-md)",
            border: "1.5px dashed var(--octo-brand-a25)",
            background: "var(--octo-brand-a3)",
          }}
        >
          <span class="text-sm" style={{ color: "var(--octo-text-secondary)" }}>⏳ 正在生成…</span>
        </div>
      </Show>

      {/* 紧凑预览入口卡(spec: output-renderers.md §6.B)
          - 对话区已由上游 <Markdown> 原样渲染代码段 / markdown 表格,完整可读
          - 入口卡是"附加预览能力",不替代对话内容
          - 类型差异化文案:html 称"可视化"、mindmap 称"思维导图"、table 称"表格"等 */}
      <For each={outputCards()}>
        {(card) => (
          <OutputEntryCard
            card={card}
            onClick={() => props.onOpenResult(card)}
            onRetry={() => retryMaterialize(card)}
          />
        )}
      </For>

      {/* 长任务卡片(spec: docs/specs/ui/task-card.md §5) */}
      <Show when={props.taskCards.length > 0}>
        <For each={props.taskCards}>
          {(task) => (
            <TaskCardView
              card={task}
              busy={props.active}
              onRefresh={props.onTaskRefresh}
              onStop={props.onTaskStop}
              onOpenResult={props.onTaskOpenResult}
            />
          )}
        </For>
      </Show>
    </div>
  )
}

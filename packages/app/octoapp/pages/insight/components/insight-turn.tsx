import type { AssistantMessage, Message } from "@opencode-ai/sdk/v2/client"
import type { SessionStatus } from "@opencode-ai/sdk/v2"
import { SessionTurn } from "@opencode-ai/ui/session-turn"
import { useData } from "@opencode-ai/ui/context"
import { createMemo, For, Show } from "solid-js"
import type { JSX } from "solid-js"
import { OutputEntryCard } from "./output-entry-card"
import { scanFencedHtml, type HtmlFenceBlock } from "../utils/detect"
import { isMindmapJSON } from "../utils/mindmap-adapter"
import { findResourceLinks, linkToOutputType, type ResourceLink } from "../utils/resource-link"
import { findWriteCards, basename } from "../utils/write-output"
import { readTaskInfo, type TaskCardEntry } from "../utils/task-detect"
import { TaskCardView } from "./task-card"
import { parseUploadedFiles } from "../lib/upload"
import { fileTypeIconUrl } from "../icons/illustrations"

export type OutputCardType = "table" | "mindmap" | "markdown" | "file" | "json" | "html" | "code"

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

// 路径 B 嗅探规则:table / mindmap / json / html 互相独立,允许同时命中
// (典型:内网 mindmap MCP 返回的 JSON 既符合 plainJSON 又符合 mindmap shape → 出双卡)
// 详见 docs/specs/ui/output-renderers.md §2。直接在 outputCards memo 内顺序判断,
// 不再走"按优先级取一个"的旧路径。


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
}): JSX.Element {
  const data = useData()

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
  const inputAttachments = createMemo((): Array<{ filename: string; path: string }> => {
    const block = turnParts().find((p) => p.type === "text" && p.synthetic && typeof p.text === "string")
    if (!block?.text) return []
    return parseUploadedFiles(block.text)
  })

  // 图片附件(③):从本 turn 的图片 FilePart(type=file + mime=image/*) 取 url 渲染缩略图。
  const inputImages = createMemo((): Array<{ filename: string; url: string }> => {
    return turnParts()
      .filter((p) => p.type === "file" && typeof p.mime === "string" && p.mime.startsWith("image/") && typeof p.url === "string")
      .map((p) => ({ filename: p.filename ?? "image", url: p.url! }))
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
    // get_task_result 重复查询 turn 优先换回该任务「首次确定的产物链接」:
    // 用户每次「查询任务 X 进度」都会重调 get_task_result,server 可能每次返回一批新 URI(i,j…);
    // 若直接用本 turn 原始 links,会让最新查询回答下方挂出"又重新生成"的新文件。改为按 task_id
    // 取最初那批(x,y),保证每次查询回答下方挂的都是同一批原始产物。非任务结果(无 task_id)走原 links。
    const taskId = parts.reduce<string | undefined>((acc, part) => acc ?? readTaskInfo(part)?.taskId, undefined)
    const canonical = taskId ? props.resolveTaskLinks?.(taskId) : undefined
    const links = canonical && canonical.length > 0 ? canonical : findResourceLinks(parts)
    // ── 路径 C:write 工具产物(强契约,零嗅探,见 output-renderers.md §2.6)──
    // 与路径 A 并列追加(来源不重叠:A 来自 MCP resource_link,C 来自本地 write tool part)。
    // 内容在本地磁盘,出卡阶段只带 filePath,点开时由 PathTabBody 走 SDK file.read 读盘。
    const writes = findWriteCards(parts)
    if (links.length > 0 || writes.length > 0) {
      console.log("[octo:card] resource_links + writes (no task)", {
        linkCount: links.length,
        writeCount: writes.length,
        links: links.map((l) => ({ mime: l.mimeType, name: l.name, uri: l.uri, business_type: l.business_type })),
        writes: writes.map((w) => ({ filePath: w.filePath, type: w.type })),
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
      const writeCards: OutputCard[] = writes.map((w, idx) => {
        const name = basename(w.filePath)
        return {
          id: `card-${props.messageID}-write-${idx}`,
          title: name,
          type: w.type,
          source: "path" as const,
          filePath: w.filePath,
          fileName: name,   // 供入口卡图标按扩展名命中 + 下载默认文件名
          createdAt: msgDate,
        }
      })
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

      <SessionTurn
        sessionID={props.sessionID}
        messageID={props.messageID}
        status={props.status}
        active={props.active || (props.status.type === "retry" && isLatestTurn())}
        classes={{ root: "px-3" }}
      />

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
        {(card) => <OutputEntryCard card={card} onClick={() => props.onOpenResult(card)} />}
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

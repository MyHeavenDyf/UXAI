import "./octo-tokens.css"
import type { Message, Part, Session, SessionStatus, UserMessage } from "@opencode-ai/sdk/v2/client"
import type { TextPartInput, FilePartInput } from "@opencode-ai/sdk/v2/client"
import { DataProvider } from "@opencode-ai/ui/context/data"
import { createAutoScroll } from "@opencode-ai/ui/hooks"
import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  ErrorBoundary,
  For,
  on,
  onCleanup,
  onMount,
  Show,
} from "solid-js"
import { produce } from "solid-js/store"
import { useNavigate, useParams } from "@solidjs/router"
import { useGlobalSDK } from "@/context/global-sdk"
import { useLayout } from "@/context/layout"
import { Binary } from "@opencode-ai/core/util/binary"
import { useProjectDir } from "@/hooks/use-project-dir"
import { SDKProvider, useSDK } from "@/context/sdk"
import { SyncProvider, useSync } from "@/context/sync"
import { INSIGHT_AGENT } from "@/constants/agent"
import { Identifier } from "@/utils/id"
import { same } from "@/utils/same"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { useTheme } from "@opencode-ai/ui/theme/context"
import { resolveThemeVariant, themeToCss } from "@opencode-ai/ui/theme"
import { LocalProvider, useLocal } from "@/context/local"
import { useTabModel } from "@/hooks/use-tab-model"
import { syncSessionModel } from "@/pages/session/session-model-helpers"
import { useLanguage } from "@/context/language"
import { ModelSelectorPopover } from "@/components/dialog-select-model"
import { AttachmentBar, type Attachment } from "./components/attachment-bar"
import { ConversationHeader } from "./components/conversation-header"
import { InsightSidebar } from "./sidebar"
import { SidebarFooter } from "./components/sidebar-footer"
import { ProjectInfo } from "@/components/project-info"
import { InsightTurn, type OutputCard } from "./components/insight-turn"
import { InsightPermissionDock } from "./components/permission-dock"
import { InsightQuestionDock } from "./components/question-dock"
import { McpChip } from "./components/mcp-chip"
import { ResultViewer } from "./components/result-viewer/index"
import { createTabStore } from "./components/result-viewer/tab-store"
import { materializeUriCardToOutputs } from "./utils/local-resource"
import { notifyMaterializeFailure } from "./utils/materialize-notify"
import { PRESET_PROMPTS } from "./store/preset-prompts"
import {
  buildChipDeclaration,
  buildChipTemplate,
  buildToolGate,
  mcpToolKey,
  type McpSelection,
} from "./store/mcp-trigger"
import { IllustrationInsightEmpty, IconSendBlue, IconStopBlue } from "./icons/illustrations"
import { NewSessionView } from "@/components/session"
import { uploadFile, validateFile, formatUploadsForPrompt, parseUploadedFiles, isImageFile, isTextInlineFile, UploadError, ALLOWED_EXT, MAX_UPLOAD_SIZE } from "./lib/upload"
import { encodeFilePath } from "../../context/file/path"
import { installInsightDebug, type SendRecord } from "./lib/debug-observer"
import { getDesktopApi } from "./lib/electron-api"
import { copyLastError, recordError, setBeaconContext } from "./lib/error-beacon"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import { aggregateTaskCards, readTaskInfo, toolDisplayName, type TaskCardEntry } from "./utils/task-detect"
import { tracker } from "@/utils/tracker"
import { linkToOutputType } from "./utils/resource-link"
import { markRefreshed, isInCooldown } from "./utils/task-refresh"
import { sessionQueue, updateSessionQueue, clearSessionQueue } from "./utils/send-queue"
import { splitMentions, queuedMentions } from "./utils/mention"
import { showToast } from "@opencode-ai/ui/toast"
import { extToOutputType } from "./utils/write-output"
import { isPendingUploadPath } from "./utils/worktree-layout"
import type { InsightFile, InsightFileEntry } from "./utils/insight-file-api"
import { mimeForName, pathToLocalUrl, fetchInsightFiles } from "./utils/insight-file-api"
import { type MentionSelection, type MentionSkill } from "./components/mention-popover"
import { ProseMirrorEditor, type InsightEditorRef, type MentionAttrs } from "./components/prosemirror-editor"
import { loadSkillsFromPanel } from "@/utils/skill-config"

// 稳定空数组:作为 userMessages memo 的初值与无 id 时的返回,配合 equals:same 避免每帧吐新空数组
const EMPTY_MESSAGES: Message[] = []

/**
 * InsightPage —— 用研 agent 页面
 *
 * 数据层完全复用 opencode 原生 globalSync / sync.session.sync / event-reducer，
 * 不再自建本地 dataStore + SSE listener。详见 SPEC-INS-005
 * (docs/specs/ui/insight-data-layer-reuse.md)。
 *
 * 外层 InsightPage：负责拼装 SDKProvider + SyncProvider（依赖 projectDir 就绪）。
 * 内层 InsightContent：所有业务逻辑，可读写 useSync() / useSDK()。
 */
export default function InsightPage() {
  // 数据/事件层、建会话、列表三处必须用同一个目录(= 用户所选目录),否则白屏 / 列表空。
  // 关键事实(已核对服务端):event.directory = AppFileSystem.resolve(客户端传入 directory),
  // 与 VCS worktree 无关(instance-store.ts boot:ctx.directory = input.directory);session.list
  // 也按该 directory 解析出的 project 过滤。只要三处传同一个目录:事件就路由到同一 child store、
  // 会话建在该目录下、列表也查得到。之前白屏是因数据层喂了 worktree(≠建会话用的目录),key 对不上;
  // 之前"记录建到根目录"是因数据层/建会话用 home 而列表用所选目录,两边项目不同。
  // 用 useProjectDir():跟随所选项目目录(insight 路由无 :dir → 取 server.projects.last(),回退 home),
  // 与 session-list 的 useProjectDir() 完全同源,保证三处一致。
  const projectDir = useProjectDir()

  // 切目录后回新建空态的守卫不在这里:旧方案在此监听 server.projects.last() 过渡再 navigate,
  // 但 effect 跑在 render(keyed 重挂)之后,且 prev 判空在 store 水合时序下会吞掉首个过渡、
  // 在 make/_shell 切目录时本组件未挂载监听不存在 → 偶现旧目录会话串台。
  // 现改为 InsightContent 挂载时对比模块级 lastInsightDir 的确定性守卫(见 InsightContent 顶部)。

  // projectDir 异步就绪(home/projects 来自 globalSync)。等就绪再挂 SDK/Sync providers,
  // 否则 useSDK 拿到空字符串 directory 会异常。keyed: dir 变化时整体重挂,确保状态干净。
  return (
    <Show when={projectDir()} keyed>
      {(dir) => (
        <SDKProvider directory={() => dir}>
          <SyncProvider>
            {/* 模型选择统一走 useLocal().model(SPEC-INS-010 D2):自带
                会话级→agent 默认→全局兜底 回退链,初次进入不再"显示未选却可发送"。
                原 InsightModelSelectionProvider/隔离 store 已删除。
                这里不再套自己的 <ModelsProvider>:模型可见性(设置-模型 switch)持久化是
                全局的(Persist.global("model")),但每个 ModelsProvider 是独立的 createStore
                实例,运行期不互相响应。insight 已在 RouterRoot 外层 ModelsProvider 之内
                (octo.tsx),且设置弹窗经 dialog.show 以调用处 owner 运行(runWithOwner),
                若此处再嵌套一层,insight 的设置开关会绑到这层隔离 store,与 design/chat
                的外层 store 不打通。复用外层 ModelsProvider 即三端共享同一 store。 */}
            <LocalProvider>
              {/* §SPEC-INS-011 §9 钩子3:整页崩兜底。fallback 记 beacon + 给「复制错误」按钮——
                  整页崩时 console 往往够不着(白屏),这是唯一带 UI 的地方(§9.5 对 §0 的有意例外)。 */}
              <ErrorBoundary fallback={(err) => <InsightCrashFallback error={err} />}>
                <InsightContent />
              </ErrorBoundary>
            </LocalProvider>
          </SyncProvider>
        </SDKProvider>
      )}
    </Show>
  )
}

// 单轮对话最多上传文件数(超出提示分多轮处理)
const MAX_ATTACHMENTS = 10

// 文件选择器 accept:从 ALLOWED_EXT 派生(与 validateFile 同一事实源)。
// 仅是原生弹窗的预过滤提示,不做强制——拖拽绕过它,校验仍以 validateFile 为准。
const UPLOAD_ACCEPT = ALLOWED_EXT.map((e) => `.${e}`).join(",")

// 添加附件按钮的 tooltip 提示:支持的文件类型 + 大小 + 数量上限(均从常量派生)。
const UPLOAD_HINT = `支持 ${ALLOWED_EXT.join("、")}，单个 ≤ ${Math.round(MAX_UPLOAD_SIZE / 1024 / 1024)}MB，最多 ${MAX_ATTACHMENTS} 个`

// 刷新保路由:打包态 Electron 走 file://(dev 的 electron reload 同样不走 SPA 兜底),整页
// 重载会丢失 /insight/:id 路由、回退到首页。这里把"当前所在对话"持久化,boot 落在无 id 的
// 首页态时恢复到上次位置——实现浏览器式"原地刷新"。
// 值为 JSON {dir, id}(id 空串 = 上次在新建空态):id 绑定其所属目录,恢复时目录不符不跳——
// 服务端 session.get 按 id 全局查(不按 project 过滤),仅靠存在性校验拦不住跨目录复活旧会话。
const LAST_SESSION_KEY = "octo:insight:last-session"
// 兼容历史纯 id 字符串记录:无目录信息无法校验归属,视为无记录(宁可落空态,不串台)。
function readLastSession(): { dir: string; id: string } | undefined {
  const raw = localStorage.getItem(LAST_SESSION_KEY)
  if (!raw) return undefined
  try {
    const parsed = JSON.parse(raw) as { dir?: string; id?: string }
    if (typeof parsed?.dir === "string" && typeof parsed?.id === "string") return { dir: parsed.dir, id: parsed.id }
  } catch { /* 历史格式/损坏 → 视为无记录 */ }
  return undefined
}
// 每次整页加载只恢复一次(模块级,页面 reload 时自然重置);避免 keyed 重挂导致重复跳转。
let didBootRestore = false
// 上次挂载 InsightContent 时的目录:keyed 重挂时与之对比,检测"用户切了项目目录"。
// 整页 reload 时自然重置为 undefined → 首挂不触发守卫,不影响上面的刷新保路由。
let lastInsightDir: string | undefined

// §SPEC-INS-011 §9.5:整页崩兜底 UI。组件体在错误被捕获那一刻执行一次 → 记 boundary beacon;
// 「复制错误」= lastError(),让用户在崩溃态(console 够不着)也能一键带出,用于问题排查。
function InsightCrashFallback(props: { error: unknown }) {
  recordError("boundary", props.error)
  const [copied, setCopied] = createSignal(false)
  const message = (props.error as { message?: string })?.message ?? String(props.error)
  const onCopy = () => {
    copyLastError(1)
    setCopied(true)
    showToast({ title: "错误信息已复制" })
  }
  return (
    <div style={{ padding: "32px", display: "flex", "flex-direction": "column", gap: "12px", "max-width": "640px", margin: "0 auto" }}>
      <div style={{ "font-size": "16px", "font-weight": "600" }}>页面出错了</div>
      <div style={{ "font-size": "13px", color: "#666", "word-break": "break-word" }}>{message}</div>
      <div style={{ display: "flex", gap: "8px" }}>
        <button type="button" onClick={onCopy} style={{ padding: "6px 14px", "border-radius": "6px", border: "1px solid #ccc", cursor: "pointer" }}>
          {copied() ? "已复制 ✓" : "复制错误"}
        </button>
        <button type="button" onClick={() => location.reload()} style={{ padding: "6px 14px", "border-radius": "6px", border: "1px solid #ccc", cursor: "pointer" }}>
          刷新重试
        </button>
      </div>
    </div>
  )
}

function InsightContent() {
  const params = useParams<{ id?: string }>()
  const navigate = useNavigate()
  const sdk = useSDK()
  const sync = useSync()
  const local = useLocal()
  useTabModel("insight")
  const language = useLanguage()
  const themeCtx = useTheme()
  const globalSDK = useGlobalSDK()
  const layout = useLayout()

  // §SPEC-INS-011 阶段1:旁路观测层(自包含;不动上游;无 UI 入口)
  const insightDebug = installInsightDebug({
    globalSDK: {
      url: globalSDK.url,
      event: globalSDK.event as unknown as Parameters<typeof installInsightDebug>[0]["globalSDK"]["event"],
    },
    syncData: sync.data as unknown as Parameters<typeof installInsightDebug>[0]["syncData"],
    currentSessionID: () => params.id,
  })
  onCleanup(() => insightDebug.dispose())

  // §SPEC-INS-011 §9:错误信标随响应式上下文更新,使自动捕获的 beacon 带当时 directory/session
  createEffect(() => setBeaconContext({ directory: sdk.directory, sessionID: params.id }))

  // Insight 暂不适配暗色模式：mount 时注入全局亮色 token 覆盖（selector 为 html 自身），
  // 使 portal（模型选择弹窗等）也能被覆盖到；insight 是全屏页，不影响其他页面。
  // html[data-color-scheme="dark"] 比 :root 优先级高（attribute selector），可覆盖 ThemeProvider。
  // 覆盖 token 来自 oc-2 light variant，与 ThemeProvider 写入 :root 的来源一致。
  onMount(() => {
    const oc2 = themeCtx.themes()["oc-2"]
    if (!oc2) return
    const css = themeToCss(resolveThemeVariant(oc2.light, false))
    const style = document.createElement("style")
    style.id = "oc-insight-force-light"
    style.textContent = [
      `html[data-color-scheme="dark"] {`,
      `  color-scheme: light;`,
      `  --text-mix-blend-mode: multiply;`,
      `  ${css}`,
      `}`,
    ].join("\n")
    document.head.appendChild(style)
    onCleanup(() => { document.getElementById("oc-insight-force-light")?.remove() })
  })

  onMount(() => { tracker.page({ module: "insight", name: "insight-page" }) })

  // 数据/事件层目录:直接用 SDKProvider 注入的 sdk.directory(= keyed 的所选项目目录),
  // 保证与数据层 child store、以及所有 sdk.client 请求的 directory 是同一个值。
  // 关键:会话操作(create/prompt/abort/get)必须走 scoped sdk.client —— 它带 directory;
  // 绝不能用 globalSDK.client(不带 directory),否则 promptAsync 会跑在 cwd(=home)实例,
  // 事件 event.directory=home 落到 home 的 store 而非所选目录的 store → 聊天区收不到回复 → 白屏。
  // 这正是 insight 之前在非 home 目录白屏、而 make(用 scoped sdk)无此问题的根因。
  const projectDir = () => sdk.directory

  // ── 切目录守卫:回新建空态(确定性,取代旧的 last() 过渡监听)────
  // 切换项目目录只触发 keyed 重挂(render 阶段),不会自动改路由——url 仍停在旧目录的
  // /insight/:oldId;而服务端 session.get 按 id 全局查,旧会话在新目录下照样加载 → 串台。
  // 这里只看"重挂 + 目录确实变了"这一确定事实:不依赖 store 水合时序,也覆盖在
  // make/_shell 切目录后返回 insight 的路径。目录变了且 url 还带旧会话 id → 立即 replace 回空态。
  // 注:重挂首帧下方 sync effect 可能仍对旧 id 多发一次请求,无害(数据进 store 但已不渲染)。
  const prevInsightDir = lastInsightDir
  lastInsightDir = sdk.directory
  onMount(() => {
    if (prevInsightDir === undefined || prevInsightDir === sdk.directory || !params.id) return
    console.log("[octo:sync] dir-switched", { from: prevInsightDir, to: sdk.directory, staleSessionID: params.id })
    navigate("/insight", { replace: true })
  })

  // ── 刷新保路由 ─────────────────────────────────────────────
  // bootSaved:在下方 save effect 覆盖前,同步捕获"刷新前"存的记录。
  const bootSaved = readLastSession()
  onMount(() => {
    if (didBootRestore) return
    didBootRestore = true
    // 仅当本次整页加载落在"无 id 首页态"且上次确实在某对话时才尝试恢复。
    // 若上次就在新建空态(id 为空串)→ 不跳,保持空态(浏览器式原地刷新)。
    if (params.id || !bootSaved?.id) return
    const dir = projectDir() // InsightContent 仅在 sdk.directory 就绪后挂载,理论恒有值
    if (!dir) return
    // 目录不符不恢复:上次对话属于别的目录(如在其他页面切过目录后整页重载),
    // 跨目录复活旧会话即串台 → 保持新目录的空态。
    if (bootSaved.dir !== dir) return
    // 先校验上次会话仍存在再跳(replace 不污染历史):避免跳到已删会话卡在加载态。
    // directory 由 sdk.client 注入,无需显式传。
    void sdk.client.session
      .get({ sessionID: bootSaved.id })
      .then((r: { data?: unknown }) => {
        const session = r?.data as Session | undefined
        // parentID 有值 = task 子会话:不恢复(SPEC-INS-021 §1 追加)。导航拦截之外的兜底——
        // 历史遗留记录 / 直接 URL 仍可能把子会话写进 LAST_SESSION_KEY,恢复进去就是"没有记录的对话"。
        if (session && !session.parentID) navigate(`/insight/${bootSaved.id}`, { replace: true })
        else localStorage.removeItem(LAST_SESSION_KEY) // 已删/子会话 → 留首页 + 清记录
      })
      .catch(() => { /* 网络/未知错误:不跳,保持首页,记录留待下次 */ })
  })
  // 记录当前所在对话(id 空 = 新建空态)及其所属目录,供下次整页加载恢复。
  createEffect(() => {
    localStorage.setItem(LAST_SESSION_KEY, JSON.stringify({ dir: projectDir(), id: params.id ?? "" }))
  })

  // 记录当前对话到 cowork tab 的"上次会话",供顶栏切回 Cowork(insight)时恢复最后对话窗口。
  // 与 studio/make/chat 各 tab 一致(它们都调用 setStudio/setMake/setChat)。
  createEffect(() => {
    const id = params.id
    if (id) layout.lastSessionPerTab.setCowork(id)
    else layout.lastSessionPerTab.clearCowork()
  })

  // 切 session 时触发原生 sync 加载（带 inflight 去重 + cache + optimistic 合并）
  // event-reducer 已在 GlobalSyncProvider 内部全局唯一注册，无需我们再监听 SSE
  //
  // 依赖同时取 params.id 和「message[id] 是否缺失」：
  // - 切到新 id → message[id] 为 undefined → 触发 sync
  // - 放置一段时间后 sync 缓存被清（连接重置/驱逐），message[id] 变回 undefined 但 id 未变
  //   → 这里仍会重新触发 sync，避免中间聊天区永久空白（白屏 bug）。
  //   sync.session.sync 自带 inflight 去重，重复调用安全；加载完 message[id] 有值后不再触发。
  createEffect(
    on(
      () => [params.id, sync.data.message[params.id ?? ""] === undefined] as const,
      ([id, missing]) => {
        if (!id || !missing) return
        console.log("[octo:sync] session.sync", { sessionID: id })
        void sync.session.sync(id)
      },
    ),
  )

  // equals: same — 生成回复时 sync.data.message[id] 每个 token 都会变,若不做浅比较,
  // 这个 memo 每帧都吐新数组,下游 <Show>/<For>/各 memo 全部空转重算 → 闪烁。
  const userMessages = createMemo(
    (): Message[] => {
      const id = params.id
      if (!id) return EMPTY_MESSAGES
      return ((sync.data.message[id] ?? []) as Message[]).filter((m) => m.role === "user")
    },
    EMPTY_MESSAGES,
    { equals: same },
  )

  // 消息列表按**稳定的 messageID 字符串**迭代(对齐上游 message-timeline 的 rendered):
  // <For> 用引用做 key,直接迭代 message 对象时,流式更新一旦换了对象引用就会整轮 DOM 重建,
  // 滚动容器内容塌掉再重建 → scrollTop 归零(弹回顶部)+ 闪烁。改用 id 字符串值做 key 即稳定。
  const userMessageIDs = createMemo(
    () => userMessages().map((m) => m.id),
    [] as string[],
    { equals: same },
  )

  // Sync session model when last user message changes (same as session.tsx).
  // Populates saved.session[session] so scope() returns the correct model per conversation.
  const lastUserMessage = createMemo(() => userMessages().at(-1) as UserMessage | undefined)

  createEffect(
    on(
      () => lastUserMessage()?.id,
      () => {
        const msg = lastUserMessage()
        if (!msg) return
        syncSessionModel(local, msg)
        // Sync tab key so new conversations inherit this session's model.
        if (msg.model?.providerID && msg.model?.modelID) {
          local.model.set(msg.model, { recent: true })
        }
      },
    ),
  )

  // Populate saved.session[session] from user messages immediately.
  // syncSessionModel only runs when lastUserMessage changes; this effect
  // runs on every params.id change and checks if messages are already loaded.
  createEffect(
    on(
      () => params.id,
      (id) => {
        if (!id) return
        // Check if messages are already loaded for this session.
        const messages = (sync.data.message[id] ?? []) as Message[]
        const lastUser = [...messages].reverse().find((m) => m.role === "user")
        if (!lastUser?.model) return
        local.session.restore({
          sessionID: id,
          agent: lastUser.agent ?? "",
          model: {
            providerID: lastUser.model.providerID,
            modelID: lastUser.model.modelID,
            variant: lastUser.model.variant,
          },
        })
        // Sync tab key so new conversations inherit this session's model.
        local.model.set(
          { providerID: lastUser.model.providerID, modelID: lastUser.model.modelID },
          { recent: true },
        )
      },
    ),
  )

  // Reset draft when switching from session to new conversation.
  createEffect(
    on(
      () => ({ dir: sdk.directory, id: params.id }),
      (next, prev) => {
        if (!prev) return
        if (next.dir === prev.dir && next.id === prev.id) return
        if (prev.id && !next.id) local.session.reset()
      },
      { defer: true },
    ),
  )

  // 会话消息是否已加载:切到"未加载过的已存在会话"时 message[id] 为 undefined,
  // 期间不渲染首页空态(否则会闪一下 Octo Insight 首页),等加载完再按是否为空决定。
  // 无 id(全新/首页)视作已加载,正常显示首页空态。
  const sessionMessagesLoaded = createMemo(() => {
    const id = params.id
    return !id || sync.data.message[id] !== undefined
  })

  // ── 长任务卡片聚合(spec: docs/specs/ui/task-card.md §3.3)──
  // 扫所有 assistant message 的 part,按 task_id 分组取最新状态;锚点 = 最早 part 所在 user message
  const taskCards = createMemo((): Map<string, TaskCardEntry> => {
    const id = params.id
    if (!id) return new Map()
    const messages = (sync.data.message[id] ?? []) as Message[]
    const items: Parameters<typeof aggregateTaskCards>[0] = []
    let lastUserMsgID = ""
    for (const msg of messages) {
      if (msg.role === "user") {
        lastUserMsgID = msg.id
        continue
      }
      if (msg.role !== "assistant" || !lastUserMsgID) continue
      const parts = sync.data.part[msg.id] ?? []
      const msgTime = (msg as { time?: { created?: number } }).time?.created ?? Date.now()
      for (const part of parts) {
        const info = readTaskInfo(part)
        if (!info) continue
        items.push({
          taskId: info.taskId,
          status: info.status,
          message: info.message,
          toolName: info.toolName,
          resultText: info.resultText,
          resourceLinks: info.resourceLinks,
          userMsgID: lastUserMsgID,
          time: msgTime,
        })
      }
    }
    return aggregateTaskCards(items)
  })

  // 按 anchor userMessageID 分组,InsightTurn 接收"挂在自己 turn 下"的卡片
  const taskCardsByAnchor = createMemo((): Map<string, TaskCardEntry[]> => {
    const out = new Map<string, TaskCardEntry[]>()
    for (const card of taskCards().values()) {
      const arr = out.get(card.anchorUserMessageID) ?? []
      arr.push(card)
      out.set(card.anchorUserMessageID, arr)
    }
    return out
  })

  const sessionStatus = createMemo((): SessionStatus => {
    const id = params.id
    if (!id) return { type: "idle" }
    return sync.data.session_status[id] ?? { type: "idle" }
  })

  // 状态变化日志：busy ↔ idle 切换观测点
  createEffect(
    on(
      sessionStatus,
      (status) => {
        console.log("[octo:sync] status", { sessionID: params.id, type: status.type })
      },
      { defer: true },
    ),
  )

  const isBusy = createMemo(() => sessionStatus().type === "busy")

  // AI 正在工作(busy 或 retry):retry 也算"忙"——否则重试期间停止键会置灰,
  // 一旦无限重试就再也无法终止该轮、对话彻底卡死。停止/排队判定都用它。
  const isWorking = createMemo(() => {
    const t = sessionStatus().type
    return t === "busy" || t === "retry"
  })

  // busy → idle 时:把刚结束的最新 assistant 消息原始内容完整 dump 到 console。
  // 内网无法抓 SSE network 时,把这条 console 粘到外网即可定位"LLM 究竟返回了什么"。
  createEffect(on(isBusy, (busy, prev) => {
    if (busy || !prev) return  // 只在 idle 切换那一刻打,不在初始 idle 打
    const sid = params.id
    if (!sid) return
    const messages = (sync.data.message[sid] ?? []) as Message[]
    const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant")
    if (!lastAssistant) return
    const parts = (sync.data.part[lastAssistant.id] ?? []) as Part[]

    const textParts = parts.filter((p) => p.type === "text") as Array<Part & { text?: string }>
    const toolParts = parts.filter((p) => p.type === "tool") as Array<
      Part & { tool?: string; state?: { status?: string; output?: string; metadata?: unknown } }
    >

    console.log("[octo:assistant] turn-complete", {
      sessionID: sid,
      msgID: lastAssistant.id,
      partsCount: parts.length,
      textPartsCount: textParts.length,
      toolPartsCount: toolParts.length,
      toolNames: toolParts.map((p) => p.tool),
    })

    // 每个 text part 单独打,完整内容(不截断)
    for (let i = 0; i < textParts.length; i++) {
      const p = textParts[i]
      console.log("[octo:assistant] text-part-detail", {
        msgID: lastAssistant.id,
        partIdx: i,
        partID: p.id,
        textLen: typeof p.text === "string" ? p.text.length : 0,
        text: p.text,
      })
    }

    // 每个 tool part 单独打,含完整 state(output JSON + metadata + status)
    for (let i = 0; i < toolParts.length; i++) {
      const p = toolParts[i]
      const state = p.state ?? {}
      let parsedOutput: unknown
      try {
        parsedOutput = typeof state.output === "string" ? JSON.parse(state.output) : state.output
      } catch {
        parsedOutput = state.output  // 非 JSON,保持原样
      }
      console.log("[octo:assistant] tool-part-detail", {
        msgID: lastAssistant.id,
        partIdx: i,
        partID: p.id,
        toolName: p.tool,
        status: state.status,
        metadata: state.metadata,
        outputRaw: state.output,
        outputParsed: parsedOutput,
      })
    }

    // SPEC-INS-017 §5:本地解析失败埋点(extract_document 按失败原因分布,本地线缺口输入)
    for (const p of toolParts) {
      if (!p.tool || !(p.tool === "extract_document" || p.tool.endsWith("_extract_document"))) continue
      const meta = (p.state?.metadata ?? {}) as { error?: string; chars?: number }
      const reason = meta.error ?? (meta.chars === 0 ? "empty-text" : undefined)
      if (reason) {
        tracker.interaction({ module: "insight", name: "extract-failure", extend: JSON.stringify({ reason }) })
      }
    }

    // SPEC-INS-017 §5:chip turn 工具调用结果对账(是否调用/成败;「args 是否被插件矫正」在
    // server 端 [octo:inject] chip-declaration 日志,前端拿不到,两处合看)
    if (pendingChipResult) {
      const pending = pendingChipResult
      pendingChipResult = null
      const uIdx = messages.findIndex((m) => m.id === pending.messageID)
      if (uIdx >= 0) {
        const states: string[] = []
        for (let i = uIdx + 1; i < messages.length; i++) {
          const m = messages[i]
          if (m.role === "user") break
          if (m.role !== "assistant") continue
          const mParts = (sync.data.part[m.id] ?? []) as Array<Part & { tool?: string; state?: { status?: string } }>
          for (const p of mParts) {
            if (p.type === "tool" && p.tool === pending.toolKey) states.push(p.state?.status ?? "unknown")
          }
        }
        const called = states.length > 0
        // not-called 不一定是失败:调用与否归模型判断(可能在向用户要材料/确认分桶/回应别的意图),
        // 埋点原样上报,命中率结论交给内网评测(结合用户是否复述"你调一下"看)。激活态不做任何自动清除。
        const status = states.includes("error") ? "error" : called ? "completed" : "not-called"
        console.log("[octo:chip] chip-result", { functionId: pending.functionId, toolKey: pending.toolKey, called, status })
        tracker.interaction({
          module: "insight",
          name: "mcp-chip-result",
          extend: JSON.stringify({ functionId: pending.functionId, called, status }),
        })
      }
    }
  }, { defer: true }))

  const [prompt, setPrompt] = createSignal("")
  // MCP「研究工具」chip 选择(SPEC-INS-017):非空 = 解析模式开启——若模型发起 MCP 业务调用,
  // 只能是所选工具(范围限制);是否调用由模型按用户消息判断。纯常驻:只有手动 × 才取消,
  // 无任何自动清除副作用(重复提交由模板判断规则 + 查询仪式防,非客户端状态机)。
  const [mcpSelection, setMcpSelection] = createSignal<McpSelection | null>(null)
  // chip turn 结果对账记录:chip 发送后记 user messageID,busy→idle 时对账工具调用结果(spec §5 埋点)。
  let pendingChipResult: { messageID: string; functionId: string; toolKey: string } | null = null
  // queue:busy 期间用户继续发送,先入队,idle 后按 FIFO 逐条自动 flush(SPEC-INS-007 §3.3.3)
  // 多容量:入队 push 追加(不再覆盖);abort 时清空当前 session 队列。
  // 存储提到模块级(utils/send-queue):按 sessionID 分桶,跨 session 且跨顶层 tab
  // (chat/design/insight)切换常驻——insight 页切走 tab 会卸载,组件内 signal 会被销毁
  // 导致排队丢失;天然隔离,A 的排队不会错发到 B(SPEC-INS-007 §3.3.5)。
  // 当前所视 session 的队列(空 id 视为空队列)
  const queue = createMemo(() => sessionQueue(params.id))
  const setQueueFor = updateSessionQueue
  /** 清空当前所视 session 的队列(abort 用) */
  const clearQueue = () => clearSessionQueue(params.id)
  const [attachments, setAttachments] = createSignal<Attachment[]>([])
  const [isDragOver, setIsDragOver] = createSignal(false)
  // 首次带附件发送会 createAndNavigate 改 params.id,触发下方 session 切换 effect 清空附件草稿。
  // 但首次发送的这批附件要留给 doSendPrompt consume,不能被 effect 抢清 → 用此 flag 标记
  // "发送导致的导航",effect 消费一次后跳过清空(其余新建/切换 session 正常清)。
  let sendingNavigation = false

  // 聊天区宽度：从 localStorage 恢复，无存储值时取约 50% 可用宽（扣除侧边栏约 240px）
  const CHAT_WIDTH_KEY = "octo:insight:chat-width"
  function getInitialChatWidth(): number {
    const stored = localStorage.getItem(CHAT_WIDTH_KEY)
    if (stored) {
      const n = parseInt(stored, 10)
      if (!isNaN(n) && n >= 345 && n <= 720) return n
    }
    return 460 // 参考 UX AI make 的对话面板默认宽
  }
  const [chatWidth, setChatWidth] = createSignal(getInitialChatWidth())

  function handleDividerPointerDown(e: PointerEvent) {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = chatWidth()
    const target = e.currentTarget as HTMLElement
    // pointer capture:确保 pointermove / pointerup 即使光标移出 webview 也照常派发到本元素,
    // 避免 mouseup 丢失导致 body 样式(userSelect/cursor/overflow) stuck → 输入框看似不可 focus
    target.setPointerCapture(e.pointerId)
    document.body.style.cursor = "col-resize"
    document.body.style.userSelect = "none"
    document.body.style.overflow = "hidden"
    const restore = () => {
      document.body.style.cursor = ""
      document.body.style.userSelect = ""
      document.body.style.overflow = ""
      localStorage.setItem(CHAT_WIDTH_KEY, String(chatWidth()))
    }
    const onMove = (ev: PointerEvent) => {
      setChatWidth(Math.max(345, Math.min(720, startWidth + ev.clientX - startX))) // 钳制参考 UX AI make
    }
    const cleanup = () => {
      restore()
      target.removeEventListener("pointermove", onMove)
      target.removeEventListener("pointerup", cleanup)
      target.removeEventListener("pointercancel", cleanup)
      try { target.releasePointerCapture(e.pointerId) } catch { /* noop */ }
    }
    target.addEventListener("pointermove", onMove)
    target.addEventListener("pointerup", cleanup)
    target.addEventListener("pointercancel", cleanup)
  }

  const tabStore = createTabStore()

  // SPEC-INS-014 §10:tabs/files 页面级切换,默认 files——进入会话就有"文件管理"可看,
  // 不必等第一个产物 tab 打开(Make 模块同款默认)。
  const [resultViewMode, setResultViewMode] = createSignal<"tabs" | "files">("files")

  // 文件管理表格外部刷新触发:对话上传文件落地会话目录(insight/<sid>/uploads/)后递增,
  // 驱动 ResultViewer → InsightFileManager 的 refreshKey effect 重拉文件列表(对齐 make 模块的 filesRefreshKey)。
  const [filesRefreshKey, setFilesRefreshKey] = createSignal(0)

  // ── @ 引用面板(SPEC-INS-023,方案 B:ProseMirror 行内胶囊)────────────────
  // 已选引用(技能 / 文件):由编辑器 syncPlugin 从 doc 中的 mention 节点派生,发送时拆桶注入;发送后随清空。
  const [mentionSelections, setMentionSelections] = createSignal<MentionSelection[]>([])
  // 两处输入框各持一个编辑器引用(welcome 态 / 对话态,同一时刻只挂载一个);发送后清空、排队回填走它。
  let pmRefWelcome: InsightEditorRef | undefined
  let pmRefConv: InsightEditorRef | undefined
  /** 清空当前输入框(两个 ref 都调,未挂载/已销毁的被 isConnected 守卫跳过) */
  function clearComposers() {
    pmRefWelcome?.clear()
    pmRefConv?.clear()
    setPrompt("")
  }
  /** 覆盖回填输入框(排队项回填):文本 + 引用一起还原,@名 重新变回胶囊 */
  function setComposerContent(text: string, mentions: MentionAttrs[]) {
    pmRefWelcome?.setContent(text, mentions)
    pmRefConv?.setContent(text, mentions)
  }
  /** 聚焦当前输入框(模型选择器关闭等场景回焦) */
  function focusComposer() {
    requestAnimationFrame(() => {
      pmRefWelcome?.focus()
      pmRefConv?.focus()
    })
  }
  // 技能面板数据:平台(octo_insight)+ 自定义(common),@ 首次触发时惰性加载一次。
  const [insightSkills, setInsightSkills] = createSignal<{ platform: MentionSkill[]; custom: MentionSkill[] }>({
    platform: [],
    custom: [],
  })
  let skillsLoaded = false
  // 加载态单独暴露:首次 @ 唤起时列表还没到,面板要显示「正在加载」而不是「暂无技能」(后者是错误陈述)
  const [skillsLoading, setSkillsLoading] = createSignal(false)
  async function loadInsightSkills() {
    if (skillsLoaded) return
    skillsLoaded = true
    setSkillsLoading(true)
    try {
      const [platform, custom] = await Promise.all([
        loadSkillsFromPanel("octo_insight"),
        loadSkillsFromPanel("common"),
      ])
      setInsightSkills({ platform, custom })
    } catch (err) {
      skillsLoaded = false
      console.error("[octo:mention] load skills failed", err)
    } finally {
      setSkillsLoading(false)
    }
  }

  // 会话文件数据源:生成 = outputs、上传 = uploads;挂 filesRefreshKey(带附件发送后自动重拉)。
  const [mentionFiles] = createResource(
    () => ({ sid: params.id, url: sdk.url, dir: sdk.directory, refreshKey: filesRefreshKey() }),
    async ({ sid, url, dir }) => {
      if (!sid) return null
      try {
        const [outputs, uploads] = await Promise.all([
          fetchInsightFiles(url, dir, sid, "outputs"),
          fetchInsightFiles(url, dir, sid, "uploads"),
        ])
        return {
          generated: outputs.filter((f) => !f.isFolder),
          uploaded: uploads.filter((f) => !f.isFolder),
        }
      } catch (err) {
        console.error("[octo:mention] load files failed", err)
        return null
      }
    },
  )

  // 打点:面板首次唤起 / 选中一项(编辑器内部触发回调,transition 判据在编辑器里)
  function trackMentionOpen() {
    tracker.interaction({ module: "insight", name: "mention-open" })
  }
  function trackMentionSelect(sel: MentionSelection) {
    tracker.interaction({ module: "insight", name: "mention-select", extend: JSON.stringify({ type: sel.type }) })
  }

  // ── 任务面板按需弹出 + 过渡动画 (SPEC-INS-009;v2 常驻可见改动见 SPEC-INS-014 §10) ────
  // panelCollapsed:用户手动收起(保留 tab,仅隐藏容器);与"无产物"区分两种收起来源。
  // panelVisible = 有会话 且 未手动收起(v2:不再要求 tabs.length>0——文件管理常驻,
  // 进入会话就有内容可看,不必等第一个产物 tab 打开)。无会话时聊天居中铺满。
  const [panelCollapsed, setPanelCollapsed] = createSignal(false)

  // ── 响应式布局(对齐 Claude;草案,待设计确认)────────────────────────────────
  // 全局窗口 minWidth 已降到 600(见 packages/desktop windows.ts)。窗口变窄时:
  //   1) 先挤压聊天列,右侧面板守住 PANEL_MIN(effectiveChatWidth 钳制实现);
  //   2) 可用宽(对话↔面板容器)< CHAT_MIN+PANEL_MIN → 收起右侧面板,顶栏按钮唤出右侧抽屉(无遮罩);
  //   3) 窗口 < 侧栏宽(296)+CHAT_MIN → 收起左侧栏,汉堡唤出左侧抽屉(无遮罩)。
  // 断点动态(随侧栏拖拽自适应),不用固定 media-query 数值,避免与最小宽互相打架。
  const CHAT_MIN = 450
  const PANEL_MIN = 480
  const [containerWidth, setContainerWidth] = createSignal(0) // 对话↔面板容器实测宽(≈ 窗口 − 侧栏)
  const [sidebarOverlayOpen, setSidebarOverlayOpen] = createSignal(false)
  const [panelOverlayOpen, setPanelOverlayOpen] = createSignal(false)

  const observePageArea = (el: HTMLDivElement) => {
    const ro = new ResizeObserver((entries) => {
      // 忽略 0 宽:切到别的模块时本页被隐藏(display:none)会量到 0,
      // 不能让它污染 containerWidth → 保留最后已知宽,切回来不闪。
      for (const e of entries) if (e.contentRect.width > 0) setContainerWidth(e.contentRect.width)
    })
    ro.observe(el)
    onCleanup(() => ro.disconnect())
  }

  // 右侧面板:可用宽不足以同时容纳「聊天最小 + 面板最小」时收起
  const responsivePanelCollapsed = createMemo(() => containerWidth() > 0 && containerWidth() < CHAT_MIN + PANEL_MIN)
  createEffect(on(responsivePanelCollapsed, (c) => { if (!c) setPanelOverlayOpen(false) }))

  // 左侧栏:窗口 < 侧栏宽 + 聊天最小(296 + 450 ≈ 746)时收起
  const [responsiveSidebarHidden, setResponsiveSidebarHidden] = createSignal(false)
  createEffect(() => {
    const mql = window.matchMedia("(max-width: 745px)")
    const update = () => {
      setResponsiveSidebarHidden(mql.matches)
      if (!mql.matches) setSidebarOverlayOpen(false)
    }
    update()
    mql.addEventListener("change", update)
    onCleanup(() => mql.removeEventListener("change", update))
  })

  // 导航切换会话时关闭两个抽屉
  createEffect(on(() => params.id, () => { setSidebarOverlayOpen(false); setPanelOverlayOpen(false) }))

  const panelVisible = createMemo(() => !!params.id && !panelCollapsed() && !responsivePanelCollapsed())

  // 聊天列有效宽:在 [CHAT_MIN, 容器宽 − PANEL_MIN] 内钳制用户拖拽宽,保证面板恒 ≥ PANEL_MIN → 窄屏先挤聊天
  const effectiveChatWidth = createMemo(() => {
    const cw = containerWidth()
    if (cw <= 0) return chatWidth()
    return Math.max(CHAT_MIN, Math.min(chatWidth(), cw - PANEL_MIN))
  })

  // 两个抽屉互斥(<746 时左右都收起,可能同时被唤起 → 开一个自动关另一个,避免透明点击层跨容器叠加)
  const toggleSidebarDrawer = () => { setPanelOverlayOpen(false); setSidebarOverlayOpen((v) => !v) }
  const togglePanelDrawer = () => { setSidebarOverlayOpen(false); setPanelOverlayOpen((v) => !v) }

  // 面板挂载/聊天宽度直接跟 panelVisible(无过渡动画)。
  // 旧版的 panelMounted/panelExpanded/panelAnimating + 双 rAF 动画状态机已移除:
  // 它与响应式 containerWidth 会在"切走→切回/快速改宽"时竞态(漏取消的 rAF 把 expanded
  // 拉回 true 却已卸载面板 → 右侧灰底)。鲁棒性优先,去掉动画,状态无从 desync。

  /** 打开/激活产物时统一清掉手动收起态,确保面板滑入(即便之前被收起) */
  function revealPanel() {
    if (panelCollapsed()) setPanelCollapsed(false)
    // 窄屏收起态(面板不 inline)下打开产物 → 唤起右侧抽屉,避免"点了卡片没反应"的不可用
    if (responsivePanelCollapsed()) { setSidebarOverlayOpen(false); setPanelOverlayOpen(true) }
  }

  // 打开产物 tab 后统一切到 tabs 视图并展开面板。viewMode 默认停在「文件管理」(files),
  // 若只 revealPanel 不切 viewMode,tab 虽已加入却不显示——用户点对话产物卡片后仍停在文件管理
  // 空态、看不到内容(SPEC-INS-014 §10 引入 viewMode 后的回归)。凡"打开+激活 tab"都走这里。
  function focusResultTabs() {
    setResultViewMode("tabs")
    revealPanel()
  }

  // SPEC-INS-014 §10:文件管理面板里点文件 → 复用 tabStore.openTab 的 (filePath,type) 去重逻辑
  // (重复打开同一文件只会激活已有 tab),再切回 tabs 视图、确保面板展开可见。
  function openFileFromManager(file: InsightFileEntry) {
    // extToOutputType 已将 png/jpg/gif/svg 等映射到 "image"(走 ImageRenderer),
    // psd/ai/sketch/fig 等不可浏览器渲染的归 "file"(走 FileFallback),其余分流到 file/code。
    const type = extToOutputType(file.name)
    // fileName / mimeType 必须带上:FileFallback 的类型图标按这两者派生(fileTypeIconUrl),
    // 缺失会让 xlsx/docx 等一律落到「其他」兜底图标(title 只用于标签页文案,不参与图标)。
    const mime = mimeForName(file.name)
    tabStore.openTab({
      id: crypto.randomUUID(),
      title: file.name,
      type,
      source: "path",
      filePath: file.path,
      fileName: file.name,
      mimeType: mime,
      createdAt: new Date(),
    })
    focusResultTabs()
  }

  // SPEC-INS-014 §10.1:文件管理面板操作回调(对齐 Design)。
  /** 添加至会话区:作为已就绪附件加入输入区。图片走 ③ S3 上传(拿 url),非图片带 path 进 [附件] 清单。 */
  async function addInsightFileToSession(file: InsightFile) {
    if (attachments().some((a) => a.path === file.path)) {
      showToast({ title: "已添加", description: file.name })
      return
    }
    if (maxAttachments()) {
      showToast({ title: "附件数量已达上限", description: `最多 ${MAX_ATTACHMENTS} 个附件` })
      return
    }
    const id = crypto.randomUUID()
    // 图片必须走 ③ vision FilePart{url:S3}:发送时 imageFiles 过滤要求 url,而文件管理里的图片只有本地 path。
    // 先读盘 → 构造 File → 复用输入框选图那条 doImageUpload 链路(含 uploading 态 / 失败重试 / S3 上传拿 url)。
    // 不这么做,图片会同时漏出 imageFiles(无 url)和 localFiles(isImageFile 被排除)两个分流 → 静默丢失。
    if (file.kind === "image") {
      const api = getDesktopApi()
      const buffer = typeof api?.readFileBuffer === "function" ? await api.readFileBuffer(file.path) : null
      if (!buffer) {
        console.warn("[octo:upload] add-to-session read image failed", { path: file.path })
        showToast({ title: "添加失败", description: "无法读取图片文件，请重试", variant: "error" })
        return
      }
      const imgFile = new File([buffer], file.name, { type: file.mime || "image/png" })
      filesById.set(id, imgFile) // 重试用(retryUpload 从 filesById 取原 File 重传)
      setAttachments((prev) => [...prev, {
        id,
        filename: file.name,
        mime: file.mime || "image/png",
        size: file.size,
        status: "uploading",
        path: file.path, // 供去重(a.path === file.path)与删文件后按路径清附件;imageFiles 分流只认 url
        // 图片给 local:// 缩略图(附件条 FileTypeIcon 有 previewUrl 时渲染缩略图)。
        previewUrl: pathToLocalUrl(file.path),
      }])
      void doImageUpload(id, imgFile) // 成功 → done + url;失败 → error + 可重试
      return
    }
    // 非图片(已落盘):直接作为已就绪附件进 [附件] 清单(给 ②extract_document 拿路径 / ④MCP 引用)。
    setAttachments((prev) => [...prev, {
      id,
      filename: file.name,
      mime: file.mime || "application/octet-stream",
      size: file.size,
      status: "done",
      path: file.path,
    }])
    showToast({ title: "已添加附件", description: file.name, variant: "success", duration: 2000 })
  }

  /** 按路径关闭 ResultViewer tab(删除文件后清理已打开的同路径 tab)。 */
  function closeTabsByPath(paths: string[]) {
    const set = new Set(paths.map((p) => p.replace(/\\/g, "/")))
    for (const tab of tabStore.tabs()) {
      if (tab.filePath && set.has(tab.filePath.replace(/\\/g, "/"))) tabStore.closeTab(tab.id)
    }
  }

  /** 按路径移除输入区附件(删除文件后清理已添加的同路径附件)。 */
  function removeAttachmentsByPath(paths: string[]) {
    const set = new Set(paths.map((p) => p.replace(/\\/g, "/")))
    setAttachments((prev) => prev.filter((a) => !a.path || !set.has(a.path.replace(/\\/g, "/"))))
  }

  /** 切 tab:仅在切到不同 tab 时打点(避免重复点击当前 tab 也计数) */
  function handleActivateTab(id: string) {
    if (tabStore.activeId() !== id) {
      const tab = tabStore.tabs().find((t) => t.id === id)
      tracker.interaction({ module: "insight", name: "result-tab-switch", extend: JSON.stringify({ tabType: tab?.type }) })
    }
    tabStore.activate(id)
  }

  /** 关 tab:若关掉的是最后一个,复位 collapsed 以便下次产物干净滑入,并落回文件视图(SPEC-INS-014 §10) */
  function handleCloseTab(id: string) {
    const tab = tabStore.tabs().find((t) => t.id === id)
    tracker.interaction({ module: "insight", name: "result-tab-close", extend: JSON.stringify({ tabType: tab?.type }) })
    tabStore.closeTab(id)
    if (tabStore.tabs().length === 0) {
      setPanelCollapsed(false)
      setResultViewMode("files")
    }
  }

  // 自动滚动：session busy 时保持对话区随新内容跟随到底部
  const autoScroll = createAutoScroll({ working: isBusy })

  // 切换 session 时重置 ResultViewer tabs / 自动 openTab 记录 / 未发送附件 / 输入框草稿
  // queue 不清:已按 sessionID 分桶,切走再切回同一 session 必须延续其排队;
  //   分桶天然隔离,A 的排队不会错发到 B(SPEC-INS-007 §3.3.5)。
  // 附件草稿与输入框草稿必须清:在 session A 输入未发送的内容,新建/切换 session 后不应残留(设计确认)。
  //   例外:首次发送触发的导航(sendingNavigation)——那批附件留给 doSendPrompt consume,跳过一次。
  // 任务卡片刷新冷却(task-refresh)不清:per task_id 全局唯一,切走再切回必须延续倒计时
  //   (否则切换 session 可绕过 3 分钟防抖,spec task-card.md §7.1)。
  createEffect(on(() => params.id, () => {
    tabStore.reset()
    setPanelCollapsed(false)
    setResultViewMode("files")
    autoOpenedTaskIds.clear()
    lastTaskSnapshot = new Map()
    if (sendingNavigation) {
      sendingNavigation = false
    } else {
      revokeAllPreviews()
      filesById.clear()
      setAttachments([])
      clearComposers()
      setMcpSelection(null)
    }
    console.log("[octo:task] session switched, view state reset (refresh cooldown preserved)", { sessionID: params.id })
  }, { defer: true }))

  // 切换 / 打开 session 后把对话区滚到底部：消息异步加载(message[id] 先 undefined),
  // 必须等 sessionMessagesLoaded 翻真、InsightTurn 的 parts 渲染撑开高度后再定位,
  // 否则会滚到尚为空的容器。
  //
  // 单次 rAF 不够:切到"已完成会话"时任务卡片/各类 part renderer(图表/mermaid/html)
  // 渐进撑高,高度在首帧之后还在涨;而 session 非 busy → autoScroll 的 ResizeObserver
  // 不会再补滚(它只在 active() 时跟随)。所以这里自己盯一个 settle 窗口:每帧强制贴底,
  // 直到 scrollHeight 连续两帧不再变化(高度稳定),或超时兜底。切换/卸载时取消上一轮。
  let scrollContainerEl: HTMLElement | undefined
  let settleScrollRAF: number | undefined
  const cancelSettleScroll = () => {
    if (settleScrollRAF !== undefined) {
      cancelAnimationFrame(settleScrollRAF)
      settleScrollRAF = undefined
    }
  }
  onCleanup(cancelSettleScroll)
  createEffect(on(
    () => [params.id, sessionMessagesLoaded()] as const,
    ([id, loaded]) => {
      cancelSettleScroll()
      if (!id || !loaded) return
      const SETTLE_MS = 600
      const start = performance.now()
      let lastHeight = -1
      let stableFrames = 0
      const step = () => {
        const height = scrollContainerEl?.scrollHeight ?? 0
        autoScroll.forceScrollToBottom()
        stableFrames = height === lastHeight ? stableFrames + 1 : 0
        lastHeight = height
        // 连续两帧高度不变 = 内容已稳定;或超时兜底,停止盯防
        if (stableFrames >= 2 || performance.now() - start > SETTLE_MS) {
          settleScrollRAF = undefined
          return
        }
        settleScrollRAF = requestAnimationFrame(step)
      }
      settleScrollRAF = requestAnimationFrame(step)
    },
  ))

  // ── session 操作 ──────────────────────────────────────────

  // task 子会话不是用户级对话(SPEC-INS-021 §1 追加):它不在侧栏列表里,跳进去就是
  // "没有记录的对话"。所有会话导航入口(task 卡片点击 / href / 刷新恢复)都经此判定拦截,
  // 过程仍由 turn 内联的 task 卡片透明展示(§4),只是不 fork 出第二个对话入口。
  function isChildSession(sessionID: string): boolean {
    const sessions = sync.data.session as Session[]
    const match = Binary.search(sessions, sessionID, (s) => s.id)
    const target = match.found ? sessions[match.index] : undefined
    return !!target?.parentID
  }

  async function createAndNavigate(): Promise<string | undefined> {
    const dir = projectDir()
    if (!dir) return
    try {
      const result = await sdk.client.session.create({ agent: INSIGHT_AGENT })
      const session = result.data as Session | undefined
      if (session) {
        // 导航前先把新会话 seed 进 sync store。否则 navigate 触发的 sync.session.sync
        // 会发出 REST session.get,其返回的默认标题可能晚于 SSE session.updated 到达,
        // 把 LLM 已生成的标题覆盖回默认值(标题偶发不更新的竞态)。seed 后 hasSession=true,
        // 该 REST 请求被跳过,标题完全由 SSE 驱动。插入逻辑与原生 session.get 命中分支一致。
        sync.set(
          "session",
          produce((draft) => {
            const match = Binary.search(draft, session.id, (s) => s.id)
            if (!match.found) draft.splice(match.index, 0, session)
          }),
        )
        local.session.promote(dir, session.id)
        navigate(`/insight/${session.id}`)
        tracker.interaction({ module: "insight", name: "new-session" })
        return session.id
      }
    } catch (err) {
      console.error("[InsightPage] session.create failed", err)
      showToast({
        title: "新建会话失败",
        description: errorDescription(err),
      })
    }
    return undefined
  }

  /**
   * 错误信息提取(参考 packages/app/src/components/prompt-input/submit.ts errorMessage)
   * SDK 错误通常带 data.message,其次取 err.message,最后回落到通用提示
   */
  function errorDescription(err: unknown): string {
    if (err && typeof err === "object" && "data" in err) {
      const data = (err as { data?: { message?: string } }).data
      if (data?.message) return data.message
    }
    if (err instanceof Error) return err.message
    return "请稍后重试"
  }

  // 发送后"无反馈"探测:promptAsync 成功返回后启动,NO_FEEDBACK_WATCHDOG_MS 内若 session
  // 既未进入 busy、也无新 assistant 响应,打一条显眼 warning —— 专门定位"发消息后既无思考中、
  // 也无回复"的现象。状态没翻 busy 多半是 SSE/event 没到或 server 未启动该轮,据此分流排查。
  const NO_FEEDBACK_WATCHDOG_MS = 8000
  function armNoFeedbackWatchdog(sessionId: string, messageID: string) {
    const assistantBefore = ((sync.data.message[sessionId] ?? []) as Message[]).filter((m) => m.role === "assistant").length
    window.setTimeout(() => {
      const status = sync.data.session_status[sessionId]?.type ?? "idle"
      const msgs = (sync.data.message[sessionId] ?? []) as Message[]
      const assistantNow = msgs.filter((m) => m.role === "assistant").length
      if (status !== "busy" && assistantNow <= assistantBefore) {
        console.warn(
          `[octo:prompt] no-feedback ⚠️ 发送后 ${NO_FEEDBACK_WATCHDOG_MS}ms 内 session 未进入 busy 且无新 assistant 响应`,
          {
            sessionID: sessionId,
            messageID,
            status,
            messageCount: msgs.length,
            assistantBefore,
            assistantNow,
            hint: "status 没翻 busy → 查 globalSync 事件流(SSE)是否在收 / server 是否启动了该轮;若 model 为 undefined 且 agent 无默认模型也可能不启动",
          },
        )
      } else {
        console.log("[octo:prompt] feedback-ok", { sessionID: sessionId, messageID, status, assistantBefore, assistantNow })
      }
    }, NO_FEEDBACK_WATCHDOG_MS)
  }

  /**
   * 共享的 prompt 调用底层(SPEC-INS-007 §3.2 改用 promptAsync + optimistic)
   *   - consumeAttachments=true(用户手动发送):附件随消息发送,发送后清空附件状态
   *   - consumeAttachments=false(刷新/终止/follow-up 按钮 inject):不消费附件,保留用户正在选的附件状态
   * spec: docs/specs/ui/task-card.md §6.1 + docs/specs/ui/insight-prompt-redesign.md §3.2
   */
  async function doSendPrompt(
    sessionId: string,
    text: string,
    opts: {
      consumeAttachments: boolean
      source: string
      /** SPEC-INS-017 chip turn:注入 [MCP解析模式] 模板 + [MCP声明],tools gate 只放行所选工具。
       *  text 参数即用户键入原文(空输入不可发送,气泡文案 = user_prompt 原文,无回落) */
      chip?: { selection: McpSelection }
      /** SPEC-INS-023 @ 引用:技能 → 注入 SKILL.md synthetic;文件 → 注入 [引用文件] synthetic(均气泡不显) */
      mentions?: { skills: string[]; files: Array<{ filename: string; path: string }> }
    },
  ) {
    // SPEC-INS-015 文件传参路由:发送时按「文件类 × 用途」分流(spec docs/specs/infra/insight-file-passing.md)。
    const done = opts.consumeAttachments ? attachments().filter((a) => a.status === "done") : []
    // 非图片(已导入 worktree、有本地 path):进 [附件] 清单(给 ②extract_document 拿路径 / ④MCP 引用)。
    // 降级场景(无 projectDir/非桌面)拿不到 path → 不进清单(本地读 + MCP 都用不了)。
    const localFiles = done.filter((a) => !isImageFile(a.filename) && a.path)
    // 图片(已 change 即传拿到 S3 url):走 ③ vision FilePart{url},不进 [附件] 清单。
    const imageFiles = done.filter((a) => isImageFile(a.filename) && a.url)

    // SPEC-INS-014 §4.1.2(v2 新增):发送前把还落在预会话落地区(.octo/tmps/)的附件
    // rename 进真实会话目录(.octo/<sessionId>/uploads/)——此时 sessionId 已经 resolve。
    // rename 是本地文件系统原子操作,失败(源文件在拷贝完成后被删/移动,极少见)不阻断发送,
    // 该附件在 [附件] 清单里退化为指向预会话区的旧路径,仍可读。
    const movedPaths = new Map<string, string>()
    {
      const api = getDesktopApi()
      const baseDir = projectDir()
      if (baseDir && typeof api?.movePendingUploadToSession === "function") {
        await Promise.all(
          localFiles
            .filter((a) => a.path && isPendingUploadPath(a.path))
            .map(async (a) => {
              try {
                const newPath = await api.movePendingUploadToSession!(a.path!, baseDir, sessionId)
                movedPaths.set(a.id, newPath)
              } catch (err) {
                console.warn("[octo:worktree] upload-move failed, keep pending path", { id: a.id, path: a.path, err })
              }
            }),
        )
        if (movedPaths.size > 0) {
          setAttachments((prev) => prev.map((x) => (movedPaths.has(x.id) ? { ...x, path: movedPaths.get(x.id) } : x)))
        }
      }
    }
    const resolvedPath = (a: Attachment) => movedPaths.get(a.id) ?? a.path!

    // 这次发送带了本地附件 → 通知文件管理表格重拉(挂载只刷一次的回归)。
    // gate 在「有无本地附件」而非「movedPaths 是否非空」:刷新只依赖可靠事实(有附件),不耦合到
    // 搬迁判据(isPendingUploadPath)是否为真——判据一旦再脱节(如 v7 那次),附件进不去已是 bug,
    // 不该连带把可见性刷新也一起哑掉、放大故障。刷新幂等且廉价(纯文本发送 localFiles 为空、不触发)。
    if (localFiles.length > 0) setFilesRefreshKey(k => k + 1)

    // [附件] 清单:独立 synthetic text part(server toModelMessages 不过滤 → 模型可见;上游气泡不渲染
    // synthetic;InsightTurn 解析渲染成文件卡片)。清单只给文件名+本地路径,**不触发上传**。
    const uploadBlock = formatUploadsForPrompt(
      localFiles.map((a) => ({ filename: a.filename, path: resolvedPath(a) })),
    )
    const cleanTextPart: TextPartInput = { type: "text", text }
    const parts: Array<TextPartInput | FilePartInput> = [cleanTextPart]
    if (uploadBlock) parts.push({ type: "text", text: uploadBlock, synthetic: true })
    // 落点重定向:write 产物进 .octo/<sessionId>/outputs/ 由服务端插件 octo-outputs-redirect 确定性完成
    // (相对路径 → 会话 outputs/,只对 octo_insight 会话生效)。此前这里每轮注入 `[输出目录] 绝对路径`
    // synthetic 指令纠偏,弱模型会把它当当前任务复述(空问候"你好"也触发、把路径暴露给用户),故删除。
    // SPEC-INS-017 chip turn:模板(功能指令 + 文件名 + 迁入的 MCP 仪式段落)与机器可读声明段,
    // 均为 synthetic(气泡不显示、模型可见;声明由 server 端 octo-upload-inject 读取并强制对齐文件参数)。
    // 注意顺序:必须在 [附件] 清单之后 —— InsightTurn 按 "[附件]" 头定位清单渲染文件卡片。
    const chipTemplate = opts.chip ? buildChipTemplate(opts.chip.selection, text) : undefined
    const chipDeclaration = opts.chip ? buildChipDeclaration(opts.chip.selection, text) : undefined
    if (chipTemplate && chipDeclaration) {
      parts.push({ type: "text", text: chipTemplate, synthetic: true })
      parts.push({ type: "text", text: chipDeclaration, synthetic: true })
    }
    // SPEC-INS-023 @ 引用注入:技能读 SKILL.md、文件列引用清单,均 synthetic(模型可见、气泡不显、不暴露路径)。
    // 3b:不走 session.command,自读 SKILL.md 作 synthetic 注入 → 技能指令每轮确定进上下文。
    const mentionBlocks: string[] = []
    // 读不到 SKILL.md 的技能要显式告知:胶囊已在气泡里,若静默跳过,用户会以为技能已生效(实际没进上下文)。
    // 覆盖三种失败:SKILL.md 缺失({success:false})、IPC 抛错、非 Electron 渠道(getSkillContent 不存在 → res undefined)。
    const failedSkills: string[] = []
    if (opts.mentions?.skills.length) {
      const api = getDesktopApi()
      for (const name of opts.mentions.skills) {
        try {
          const res = await api?.getSkillContent?.(name)
          if (res?.success && res.content) {
            mentionBlocks.push(`<skill_content name="${name}">\n${res.content}\n</skill_content>`)
          } else {
            failedSkills.push(name)
            console.warn("[octo:mention] skill content missing, skip inject", { name, ok: res?.success })
          }
        } catch (err) {
          failedSkills.push(name)
          console.warn("[octo:mention] getSkillContent failed, skip inject", { name, err })
        }
      }
    }
    if (failedSkills.length) {
      showToast({
        title: "技能未生效",
        description: `${failedSkills.map((n) => `「${n}」`).join("")}的技能内容读取失败,本轮未纳入上下文`,
        variant: "error",
        duration: 4000,
      })
    }
    if (opts.mentions?.files.length) {
      mentionBlocks.push(
        [
          "[引用文件] 用户本轮引用了以下已存在的会话文件,需要时用 extract_document 按路径读取:",
          ...opts.mentions.files.map((f) => `- ${f.filename}: ${f.path}`),
        ].join("\n"),
      )
    }
    for (const b of mentionBlocks) parts.push({ type: "text", text: b, synthetic: true })
    // ① txt/md → FilePart(file://, text/plain):opencode 组 prompt 时自动 Read 内联正文给本地模型读。
    //   (office 不走此路 —— FilePart 二进制会被 base64,② 由模型调 extract_document 读。)
    for (const a of localFiles) {
      if (!isTextInlineFile(a.filename)) continue
      parts.push({ type: "file", mime: "text/plain", url: `file://${encodeFilePath(resolvedPath(a))}`, filename: a.filename })
    }
    // ③ 图片 → vision FilePart{url:S3}:交多模态模型看(非多模态由 opencode stripMedia 换占位)。
    const imageParts: FilePartInput[] = imageFiles.map((a) => ({
      type: "file" as const,
      mime: a.mime || "image/png",
      url: a.url!,
      filename: a.filename,
    }))
    parts.push(...imageParts)
    const messageID = Identifier.ascending("message")
    const agent = INSIGHT_AGENT

    // 当前选中模型(useLocal().model.current():会话级→agent 默认→全局兜底 回退链)
    const currentModel = local.model.current()
    const model = currentModel ? {
      modelID: currentModel.id,
      providerID: currentModel.provider.id,
    } : undefined

    // optimistic user message —— 立即写入 sync.data,UI 瞬时反馈
    // directory 不传 → 走 scoped sdk.client 注入的所选目录;model 不传 → 服务端按 agent 默认配置
    const optimisticMessage: Message = {
      id: messageID,
      sessionID: sessionId,
      role: "user",
      time: { created: Date.now() },
      model,
    } as Message
    // optimistic 镜像发送的 parts:干净文本 + (有附件时)synthetic 上传块。
    // synthetic part 同样写入 optimistic,使乐观渲染就与 server 回传一致(气泡只显示干净文本)。
    const optimisticParts: Part[] = [
      {
        id: Identifier.ascending("part"),
        sessionID: sessionId,
        messageID,
        type: "text",
        text,
      } as Part,
    ]
    if (uploadBlock) {
      optimisticParts.push({
        id: Identifier.ascending("part"),
        sessionID: sessionId,
        messageID,
        type: "text",
        text: uploadBlock,
        synthetic: true,
      } as Part)
    }
    // chip 模板/声明 + @ 引用块镜像进 optimistic:与 server 回传同构,替换无闪烁(气泡本就不渲染 synthetic)
    for (const t of [chipTemplate, chipDeclaration, ...mentionBlocks]) {
      if (!t) continue
      optimisticParts.push({
        id: Identifier.ascending("part"),
        sessionID: sessionId,
        messageID,
        type: "text",
        text: t,
        synthetic: true,
      } as Part)
    }
    // 图片 FilePart 也写入 optimistic → 缩略图乐观即显(InsightTurn 从图片 part 渲染);
    // server 回传同构,替换后无闪烁。txt/md FilePart 不入(InsightTurn 不从 part 渲染它们,由 [附件] 卡片覆盖)。
    for (const p of imageParts) {
      optimisticParts.push({
        id: Identifier.ascending("part"),
        sessionID: sessionId,
        messageID,
        type: "file",
        mime: p.mime,
        url: p.url,
        filename: p.filename,
      } as Part)
    }

    console.log("[octo:prompt] send", {
      source: opts.source,
      sessionID: sessionId,
      messageID,
      agent,
      model,                          // undefined ⇒ 服务端按 agent 默认配置;无默认时可能不启动该轮
      modelResolved: !!model,
      statusAtSend: sync.data.session_status[sessionId]?.type ?? "idle",
      text: text.length > 120 ? `${text.slice(0, 120)}…` : text,
      textLen: text.length,
      attachmentsCount: done.length,
      localFiles: localFiles.map((a) => ({ name: a.filename, path: resolvedPath(a) })),
      images: imageFiles.map((a) => ({ name: a.filename, url: a.url })),
    })
    // 完整 text 单独 dump(不截断),便于内网把怪 case 粘到外网定位
    console.log("[octo:prompt] send-full", {
      source: opts.source,
      messageID,
      cleanText: text,         // 用户可见文本
      uploadBlock,             // synthetic 上传块(喂给 LLM,气泡不显示)
      chipTemplate,            // SPEC-INS-017 chip 注入模板(非 chip turn 为 undefined)
      chipDeclaration,         // SPEC-INS-017 机器可读声明段
    })

    // turn 级工具 gate(SPEC-INS-017 §3 方案 A):每次发送都带,非 chip turn 隐藏全部 MCP 业务工具,
    // chip turn 只放行所选那一个。服务端会把它转成 session.permission,逐 turn 覆盖。
    const toolGate = buildToolGate(opts.chip?.selection.preset.expectedTool)
    if (opts.chip) {
      console.log("[octo:chip] chip-send", {
        sessionID: sessionId,
        messageID,
        functionId: opts.chip.selection.preset.id,
        textLen: text.length,
        toolGate,
      })
    }

    // 回灌 send 记录到 debug-observer 环形缓冲（§SPEC-INS-011）
    insightDebug.recordSend({
      ts: Date.now(),
      source: opts.source,
      sessionID: sessionId,
      messageID,
      model,
      modelResolved: !!model,
      statusAtSend: sync.data.session_status[sessionId]?.type ?? "idle",
      cleanText: text,
      uploadBlock,
      attachmentsCount: done.length,
      endpoint: `${sdk.url}/session/${sessionId}/prompt_async`,
    } satisfies SendRecord)

    sync.session.optimistic.add({
      sessionID: sessionId,
      message: optimisticMessage,
      parts: optimisticParts,
    })
    console.log("[octo:prompt] optimistic added", { messageID, partsCount: optimisticParts.length })

    if (opts.consumeAttachments) {
      revokeAllPreviews()
      filesById.clear()
      setAttachments([])
    }

    try {
      const result = await sdk.client.session.promptAsync({
        sessionID: sessionId,
        agent,
        model,
        parts,
        messageID,
        tools: toolGate,
      })
      // chip turn 结果对账登记(spec §5:chip turn 工具调用结果):busy→idle 时消费
      if (opts.chip) {
        pendingChipResult = {
          messageID,
          functionId: opts.chip.selection.preset.id,
          toolKey: mcpToolKey(opts.chip.selection.preset.expectedTool),
        }
      }
      console.log("[octo:prompt] sent (async)", {
        messageID,
        sessionID: sessionId,
        statusAfterSend: sync.data.session_status[sessionId]?.type ?? "idle",
        response: (result as { data?: unknown })?.data ?? result,
      })
      // server 已受理,启动无反馈探测(8s 内未 busy 且无 assistant 响应 → warn)
      armNoFeedbackWatchdog(sessionId, messageID)
    } catch (err) {
      console.error("[octo:prompt] failed", { source: opts.source, messageID, err })
      sync.session.optimistic.remove({ sessionID: sessionId, messageID })
      showToast({
        title: "发送失败",
        description: errorDescription(err),
      })
    }
  }

  function sendMessage(
    sessionId: string,
    text: string,
    chip?: { selection: McpSelection },
    mentions?: { skills: string[]; files: Array<{ filename: string; path: string }> },
  ) {
    return doSendPrompt(sessionId, text, { consumeAttachments: true, source: chip ? "mcp-chip" : "user", chip, mentions })
  }

  /** 任务卡片"刷新 / 终止 / follow-up"按钮通过本函数 inject prompt;不消费附件状态 */
  function sendInjectedPrompt(sessionId: string, text: string, source: string) {
    return doSendPrompt(sessionId, text, { consumeAttachments: false, source })
  }

  // ── MCP chip(SPEC-INS-017)─────────────────────────────────
  // 可引用文件 = 会话历史所有 [附件] 清单聚合 + 本次待发送的非图片附件(按文件名去重)。
  // 名集与 server 端 octo-upload-inject 的引用键表同源(清单文件名),声明只写这些名 → 插件必精确命中。
  const mcpCandidateFiles = createMemo((): string[] => {
    const seen = new Set<string>()
    const names: string[] = []
    const add = (name: string) => {
      if (name && !seen.has(name)) {
        seen.add(name)
        names.push(name)
      }
    }
    for (const m of userMessages()) {
      const parts = (sync.data.part[m.id] ?? []) as Array<{ type?: string; synthetic?: boolean; text?: string }>
      for (const p of parts) {
        if (p.type !== "text" || !p.synthetic || typeof p.text !== "string" || !p.text.startsWith("[附件]")) continue
        for (const f of parseUploadedFiles(p.text)) add(f.filename)
      }
    }
    for (const a of attachments()) {
      if (a.status === "done" && !isImageFile(a.filename) && a.path) add(a.filename)
    }
    return names
  })

  function handleMcpSelect(sel: McpSelection) {
    setMcpSelection(sel)
    console.log("[octo:chip] chip-select", {
      functionId: sel.preset.id,
      candidateCount: mcpCandidateFiles().length,
    })
    // spec §5 chip 点击:功能 + 所选文件 token 估算。客户端估算只覆盖本次待发送附件(有字节数);
    // 历史轮文件客户端拿不到大小,不计入 —— 精确值以 server 端 [octo:extract] 为准。
    const pendingBytes = attachments()
      .filter((a) => a.status === "done" && !isImageFile(a.filename) && a.path)
      .reduce((sum, a) => sum + a.size, 0)
    tracker.interaction({
      module: "insight",
      name: "mcp-chip-select",
      extend: JSON.stringify({
        functionId: sel.preset.id,
        fileCount: mcpCandidateFiles().length,
        pendingBytes,
        tokenEstimate: Math.round(pendingBytes / 4),
      }),
    })
    focusComposer()
  }

  function handleMcpClear() {
    const sel = mcpSelection()
    if (!sel) return
    setMcpSelection(null)
    console.log("[octo:chip] chip-clear", { functionId: sel.preset.id })
    tracker.interaction({ module: "insight", name: "mcp-chip-clear", extend: JSON.stringify({ functionId: sel.preset.id }) })
  }

  async function handleSubmit(trigger: "button" | "enter" = "button") {
    const text = prompt().trim()
    const chipSel = mcpSelection()
    // SPEC-INS-023 @ 引用:发送前拆桶(技能 / 文件),清空选择;可见文本保持 @名 原样(text 已含,不额外处理)。
    const { skills: mentionSkills, files: mentionFileRefs } = splitMentions(mentionSelections())
    const mentionsPayload =
      mentionSkills.length || mentionFileRefs.length ? { skills: mentionSkills, files: mentionFileRefs } : undefined
    // 空输入一律不可发送(与业界一致,chip 选中也不豁免):气泡与 user_prompt 恒为用户原话。
    // @引用会把 @名 留在 text 里,故有引用时 text 必非空,无需额外豁免。
    if (!text || hasUploadingAttachments()) return

    // 未选模型时提示并中止,与 chat 一致(prompt-input/submit.ts handleSubmit);输入内容保留不清空
    if (!local.model.current()) {
      tracker.interaction({
        module: "insight",
        name: "message-send-blocked",
        extend: JSON.stringify({ reason: "no_model" }),
      })
      showToast({
        title: language.t("prompt.toast.modelAgentRequired.title"),
        description: language.t("prompt.toast.modelAgentRequired.description"),
      })
      return
    }

    // ── chip turn(SPEC-INS-017):不设文件门槛——缺材料由模型在对话里向用户索取(我们做的是
    // Agent 不是表单);多角色分桶归模型(拿不准时先向用户确认)。chip 是常驻模式,busy 时照常
    // 入队,chip 选择态在入队那一刻固化进队列项(SPEC-INS-027),drain 时原样携带,无需特殊拦截。──
    const chipPayload = chipSel ? { selection: chipSel } : undefined

    // welcome 入口(无会话或会话尚无用户消息)vs 对话内继续追问,用 source 区分
    const source = params.id && userMessages().length > 0 ? "conversation" : "welcome"
    tracker.interaction({
      module: "insight",
      name: "message-send",
      extend: JSON.stringify({
        trigger,
        source,
        attachmentCount: attachments().length,
        textLength: text.length,
        mcpFunction: chipPayload?.selection.preset.id,
      }),
    })

    clearComposers()
    setMentionSelections([]) // @引用已拆桶进 mentionsPayload,清空选择态
    // chip 不随发送复位(纯常驻,对齐 GPT/Gemini 工具模式,只手动 × 取消)

    // busy/retry 时入队(SPEC-INS-007 §3.3.3):FIFO 多容量,push 追加,idle 后逐条 flush。
    // SPEC-INS-023:队列项带 skills/files,flush 时重新注入,排队不丢 @引用。
    // SPEC-INS-027:drain 已迁到全局 runner(insight 页可能已卸载),故入队即固化发送所需的
    // directory / model / chip——不能再等到 flush 时读页面态(那时可能没有页面)。
    if (isWorking()) {
      const m = local.model.current()
      setQueueFor(params.id, (q) => [
        ...q,
        {
          text,
          skills: mentionSkills,
          files: mentionFileRefs,
          directory: projectDir(),
          model: m ? { modelID: m.id, providerID: m.provider.id } : undefined,
          chip: chipPayload,
        },
      ])
      console.log("[octo:queue] enqueued", {
        sessionID: params.id,
        len: text.length,
        depth: queue().length,
        hasChip: !!chipPayload,
      })
      return
    }

    let sid = params.id
    if (!sid) {
      // 首次发送:navigate 会触发 session 切换 effect,标记一下让它别抢清这批待发送附件
      sendingNavigation = true
      sid = await createAndNavigate()
      if (!sid) { sendingNavigation = false; return }
    }
    autoScroll.forceScrollToBottom()
    await sendMessage(sid, text, chipPayload, mentionsPayload)
  }

  // SPEC-INS-027:队列 flush(drain)已迁到应用根常驻的全局 runner(pages/insight/queue-runner.tsx +
  // octoapp/utils/session-queue-runner.ts)。此前这里有两处 in-page flush 触发器——
  //   ① `on(isBusy,…,{defer})` busy→idle 边沿触发;② `on(()=>params.id,…)` 切会话补触发——
  // 都随 insight 页面卸载被 dispose,导致「切到 /skills 或相邻 agent tab 后会话跑完、排队卡死」
  // (根因/方案见 SPEC-INS-027)。现由全局 runner level-triggered + per-session in-flight 守卫接管,
  // 页面组件只负责入队(handleSubmit)/ 展示(队列条)/ 取消(removeQueued / handleAbort)。

  // 单条移除:剔除该条;输入框为空时回填便于编辑,非空则直接丢弃不覆盖草稿(SPEC-INS-007 §3.3.4)
  function removeQueued(index: number) {
    const item = queue()[index]
    if (item === undefined) return
    setQueueFor(params.id, (q) => q.filter((_, i) => i !== index))
    // 输入框为空才回填(编辑器覆盖式);非空不覆盖草稿。
    // 引用随文本一并还原成胶囊 —— 只回填文本会让 @名 变成失效的纯文本残留,用户无从察觉引用已丢。
    if (!prompt().trim()) setComposerContent(item.text, queuedMentions(item))
    console.log("[octo:queue] removed", { index, remaining: queue().length })
  }

  async function handleAbort() {
    const sid = params.id
    if (!sid) return
    tracker.interaction({ module: "insight", name: "message-abort" })
    // 先清空整个队列，避免 abort 完成后 idle 触发器自动 flush(abort = 全部停下，不回填)
    if (queue().length) clearQueue()
    try {
      await sdk.client.session.abort({ sessionID: sid })
    } catch {
      // session_status 事件自动同步状态，忽略网络错误
    }
  }

  // 输入框空 + AI 忙(含 retry)→ 发送键变为停止键;retry 期间同样可点终止
  const stopping = createMemo(() => isWorking() && !prompt().trim() && !hasUploadingAttachments())

  // 发送键禁用:空输入或附件上传中(chip 选中不豁免——空输入一律不可发送,与业界一致)
  const sendDisabled = createMemo(() => !stopping() && (!prompt().trim() || hasUploadingAttachments()))

  // 注:方案 B 换 ProseMirror 后,输入法合成、Enter 发送、退格删胶囊、@ 面板开关均由编辑器内部处理
  // (Enter keymap → onSubmit;atomKeymap 退格删原子节点;mention-trigger 插件管面板);此处不再需要 textarea 版键盘/合成逻辑。

  // ── 附件管理 ─────────────────────────────────────────────

  let fileInputRef!: HTMLInputElement
  // id -> File，保留原 File 引用以支持重传（不进 Attachment 类型避免污染 chip 渲染）
  const filesById = new Map<string, File>()

  // 释放当前所有图片附件的缩略图 objectURL（避免内存泄漏）。清空附件前调用。
  function revokeAllPreviews() {
    for (const a of attachments()) if (a.previewUrl) URL.revokeObjectURL(a.previewUrl)
  }

  function addAttachments(files: File[], method: "picker" | "drop" | "paste") {
    const slots = MAX_ATTACHMENTS - attachments().length
    // 超过 10 个:提示并截断到剩余槽位(单次超额取前 N 个);已满则只提示不新增
    if (files.length > slots) {
      showToast("请保持上传文件不超过10个或分多轮对话处理")
    }
    if (slots <= 0) return
    const toAdd = files.slice(0, slots)
    for (const rawFile of toAdd) {
      // 不再做客户端文件名清洗（原为防内网上传服务把原始名拼进 URL）：字符集安全改由服务端
      // 合同 v2 保证（uuid key + 下载走自有域名，见 file-upload.md 顶部提案）。
      const file = rawFile
      const id = crypto.randomUUID()
      const mime = file.type || "application/octet-stream"
      const ext = file.name.includes(".") ? file.name.split(".").pop()!.toLowerCase() : ""
      tracker.interaction({
        module: "insight",
        name: "attachment-add",
        extend: JSON.stringify({ method, fileType: ext, fileSize: file.size }),
      })
      const validationErr = validateFile(file)
      if (validationErr) {
        // 客户端校验失败:不存 File,标 retriable=false → chip 不显示重试,只能删除重选
        console.warn("[octo:upload] client-validate rejected", {
          id, filename: file.name, code: validationErr.code, message: validationErr.message,
        })
        setAttachments((prev) => [
          ...prev,
          { id, filename: file.name, mime, size: file.size, status: "error", error: validationErr.message, retriable: false },
        ])
        continue
      }
      // SPEC-INS-015 路由分流(spec docs/specs/infra/insight-file-passing.md):
      //   图片(③)→ change 即传 S3 + 本地 objectURL 缩略图;非图片 → 导入 worktree(本地路径,供 ②/④)。
      const image = isImageFile(file.name)
      if (image) {
        // filesById 存原 file(重传用);objectURL 本地秒显缩略图。
        filesById.set(id, file)
        const previewUrl = URL.createObjectURL(file)
        setAttachments((prev) => [
          ...prev,
          { id, filename: file.name, mime, size: file.size, status: "uploading", previewUrl },
        ])
        void doImageUpload(id, file)
      } else {
        // filesById 存原始 rawFile:导入靠它取真实本地路径,重试复用。展示名走 filename。
        filesById.set(id, rawFile)
        setAttachments((prev) => [
          ...prev,
          { id, filename: file.name, mime, size: file.size, status: "uploading" },
        ])
        // 非图片不 eager 上传:只拷进 .octo/tmps(预会话落地区本地副本,SPEC-INS-014 §4.1.2)。
        // done 带 path,发送时进 [附件] 清单 + rename 进 .octo/<sessionId>/uploads(见 doSendPrompt);
        // 插件在模型调 MCP 时才按需上传(④)。
        void doImport(id, rawFile, file.name)
      }
    }
  }

  // ③ 图片:change 即传 S3。成功 → done + url(发送时产出 vision FilePart{url});失败 → retriable。
  // 不拷进 uploads、不进 [附件] 清单——图片只供模型"看",不参与本地读 / MCP。
  async function doImageUpload(id: string, file: File) {
    try {
      const result = await uploadFile(file)
      tracker.interaction({ module: "insight", name: "attachment-upload-result", extend: JSON.stringify({ success: true, kind: "image" }) })
      setAttachments((prev) =>
        prev.map((a) => (a.id === id ? { ...a, status: "done", url: result.url, error: undefined } : a)),
      )
    } catch (err) {
      const message = err instanceof UploadError ? err.message : err instanceof Error ? err.message : "上传失败"
      console.error("[octo:upload] image-upload failed", { id, filename: file.name, err })
      tracker.interaction({
        module: "insight",
        name: "attachment-upload-result",
        extend: JSON.stringify({ success: false, kind: "image", errorCode: err instanceof UploadError ? err.code : "UNKNOWN" }),
      })
      setAttachments((prev) =>
        prev.map((a) => (a.id === id ? { ...a, status: "error", error: message, retriable: true } : a)),
      )
    }
  }

  // 把源文件导入 worktree 的 .octo/tmps/(SPEC-INS-014 §4.1 磁盘流式拷贝,原样不转格式,预会话落地区),
  // 拿到本地绝对路径写进附件(SPEC-INS-015:供 [本地文件] 注入块,插件按需上传 S3)。
  //   - 成功:status=done + path
  //   - 真失败(copyFileToWorktree 抛错):status=error + retriable,chip 显示重试
  //   - 降级(无 projectDir / 非桌面 / 拿不到真实路径,如剪贴板内存 blob):status=done 但**无 path**,
  //     不报错(不破坏 __dev),该文件不进注入块、MCP 不可用
  async function doImport(id: string, rawFile: File, filename: string) {
    try {
      const dest = await copySourceToWorktree(filename, rawFile)
      tracker.interaction({
        module: "insight",
        name: "attachment-import-result",
        extend: JSON.stringify({ success: true, localized: !!dest }),
      })
      if (!dest) {
        console.warn("[octo:upload] imported without local path (degraded: no projectDir / non-desktop / blob)", {
          id, filename,
        })
      }
      // 展示名/清单名对齐磁盘落地名(sanitize + 撞名后缀以磁盘为准)。三名不一致时,模型可能从
      // extract_document 的路径里抄到磁盘 basename,而插件键表里只有清单名 → 不替换、裸文件名直通 MCP。
      // split 兼容 Windows 反斜杠路径(渲染进程无 node:path)。
      const landedName = dest?.split(/[\\/]/).pop()
      setAttachments((prev) =>
        prev.map((a) =>
          a.id === id
            ? { ...a, status: "done", path: dest ?? undefined, filename: landedName || a.filename, error: undefined }
            : a,
        ),
      )
    } catch (err) {
      console.error("[octo:upload] import to worktree failed", { id, filename, err })
      tracker.interaction({
        module: "insight",
        name: "attachment-import-result",
        extend: JSON.stringify({ success: false }),
      })
      // 已发起过导入(rawFile 在 filesById):标 retriable=true → chip 显示重试
      setAttachments((prev) =>
        prev.map((a) => (a.id === id ? { ...a, status: "error", error: "导入失败，请重试", retriable: true } : a)),
      )
    }
  }

  // 把源文件拷贝进 worktree 的 .octo/tmps/(预会话落地区,磁盘流式拷贝,原样不转格式),返回本地绝对路径。
  // 不需要 sessionId——选中时可能还没有真实会话(欢迎页);发送时统一由 doSendPrompt rename 进真会话目录(§4.1.2)。
  //   - 无 projectDir / 非桌面端(无 getPathForFile / copyFileToWorktree)/ 拿不到真实路径 → 返回 null(降级)
  //   - copyFileToWorktree 抛错(真失败)→ 向上抛,由 doImport 转成可重试错误
  async function copySourceToWorktree(filename: string, srcFile: File): Promise<string | null> {
    const api = getDesktopApi()
    const baseDir = projectDir()
    if (!baseDir || typeof api?.getPathForFile !== "function" || typeof api?.copyFileToWorktree !== "function") return null
    let srcPath = ""
    try {
      srcPath = api.getPathForFile(srcFile)
    } catch {
      // 取不到真实路径(如剪贴板内存 blob,无落盘来源)→ 降级
    }
    if (!srcPath) return null
    // copyFileToWorktree 返回落地后的本地绝对路径(撞名已加后缀);抛错则上抛
    return api.copyFileToWorktree(srcPath, baseDir, filename)
  }

  function removeAttachment(id: string) {
    const att = attachments().find((a) => a.id === id)
    tracker.interaction({
      module: "insight",
      name: "attachment-remove",
      extend: JSON.stringify({ stage: att?.status === "done" ? "uploaded" : "pending" }),
    })
    if (att?.previewUrl) URL.revokeObjectURL(att.previewUrl) // 释放图片缩略图 objectURL
    filesById.delete(id)
    setAttachments((prev) => prev.filter((a) => a.id !== id))
  }

  function retryUpload(id: string) {
    const file = filesById.get(id)
    const att = attachments().find((a) => a.id === id)
    if (!file || !att) {
      // 客户端 validate 失败的 chip 没有原 File，无法重试；用户应删除重新选。
      // 正常情况下这类 chip 已隐藏重试按钮(retriable=false),走到这里属兜底,打日志便于排查。
      console.warn("[octo:upload] retry skipped: no original File (client-validation chip)", { id })
      return
    }
    tracker.interaction({ module: "insight", name: "attachment-retry" })
    setAttachments((prev) =>
      prev.map((a) => (a.id === id ? { ...a, status: "uploading", error: undefined, retriable: undefined } : a)),
    )
    // 按文件类型走对应重试:图片重传 S3,非图片重新导入 worktree。
    if (isImageFile(att.filename)) {
      console.log("[octo:upload] retry image-upload", { id, filename: att.filename })
      void doImageUpload(id, file)
    } else {
      console.log("[octo:upload] retry import", { id, filename: att.filename })
      void doImport(id, file, att.filename)
    }
  }

  function handleFileInputChange(e: Event) {
    const input = e.currentTarget as HTMLInputElement
    if (input.files?.length) {
      addAttachments(Array.from(input.files), "picker")
      input.value = ""
    }
  }

  // 拖动页面内 <img>/网页图片时 Chromium 也会把图片本体塞进 dataTransfer.files,
  // drop 时靠 files 无法与外部文件区分;只能在 types 上判别——从 OS 拖文件进来
  // 只有 "Files",页面元素/网页图片拖动会附带 text/uri-list。带 uri-list 的一律拒收。
  function isExternalFileDrag(e: DragEvent) {
    const types = e.dataTransfer?.types ?? []
    return types.includes("Files") && !types.includes("text/uri-list")
  }

  function handleDragOver(e: DragEvent) {
    e.preventDefault()
    if (!isExternalFileDrag(e)) {
      // dropEffect=none:显示禁止光标,且 drop 不触发,顺带挡掉 textarea 默认的 URI 文本插入
      if (e.dataTransfer) e.dataTransfer.dropEffect = "none"
      return
    }
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy"
    setIsDragOver(true)
  }

  function handleDragLeave() {
    setIsDragOver(false)
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault()
    setIsDragOver(false)
    if (!isExternalFileDrag(e)) return
    const files = Array.from(e.dataTransfer?.files ?? [])
    if (files.length > 0) addAttachments(files, "drop")
  }

  // 粘贴文件(与 chat 一致):截获剪贴板里的文件本体走附件上传,格式是否支持交给
  // addAttachments→validateFile 把关——白名单内(txt/md/docx/xlsx)正常上传,白名单外
  // (含图片)照常落「不支持的格式」错误 chip,与拖拽/选择器行为一致。
  // 纯文本/含文字的粘贴没有 file item,不拦截,交给 textarea 默认行为。
  function handlePaste(e: ClipboardEvent) {
    const files = Array.from(e.clipboardData?.items ?? [])
      .filter((item) => item.kind === "file")
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file))
    if (files.length === 0) return
    e.preventDefault()
    addAttachments(files, "paste")
  }

  async function handleOpenResult(card: OutputCard) {
    tracker.interaction({
      module: "insight",
      name: "result-card-open",
      extend: JSON.stringify({ cardType: card.type }),
    })
    if (card.source === "path" && card.filePath) {
      const api = getDesktopApi()
      if (api?.fileExists && !(await api.fileExists(card.filePath))) {
        showToast({ title: "文件不存在", description: card.fileName ?? card.title, variant: "error", duration: 3000 })
        return
      }
    }
    tabStore.openTab(card)
    focusResultTabs()
  }

  // ── 长任务卡片操作(spec: docs/specs/ui/task-card.md §6) ──────

  function handleTaskRefresh(taskId: string) {
    const sid = params.id
    if (!sid) return
    if (isBusy()) {
      console.log("[octo:task] refresh blocked: busy", { taskId })
      return
    }
    if (isInCooldown(taskId)) {
      console.log("[octo:task] refresh blocked: cooldown", { taskId })
      return
    }
    markRefreshed(taskId)
    tracker.interaction({ module: "insight", name: "task-refresh", extend: JSON.stringify({ taskId }) })
    void sendInjectedPrompt(sid, `查询任务 ${taskId} 的进度`, "task-refresh")
  }

  function handleTaskStop(taskId: string) {
    const sid = params.id
    if (!sid) return
    if (isBusy()) {
      console.log("[octo:task] stop blocked: busy", { taskId })
      return
    }
    tracker.interaction({ module: "insight", name: "task-stop", extend: JSON.stringify({ taskId }) })
    void sendInjectedPrompt(sid, `终止任务 ${taskId}`, "task-stop")
  }

  /**
   * 把 completed task 转成 1~N 个 OutputCard,每个 resource_link 一张;
   * 无 resource_link 但有 resultText 时,fallback 为单张 markdown inline 卡;
   * 无任何产物时返回空数组(尚未 completed 或异常)。
   */
  function buildOutputCardsFromTask(card: TaskCardEntry): OutputCard[] {
    if (card.status !== "completed") return []
    const baseTitle = `${toolDisplayName(card.toolName)} 结果`
    if (card.resourceLinks.length > 0) {
      return card.resourceLinks.map((link, idx) => ({
        id: `task-${card.taskId}-${idx}`,
        title: link.name || `${baseTitle} ${idx + 1}`,
        type: linkToOutputType(link),
        source: "uri" as const,
        uri: link.uri,
        mimeType: link.mimeType,
        fileName: link.name,
        description: link.description,
        createdAt: card.lastUpdatedAt,
      }))
    }
    if (card.resultText && card.resultText.length > 0) {
      return [{
        id: `task-${card.taskId}`,
        title: baseTitle,
        type: "markdown",
        source: "inline",
        content: card.resultText,
        createdAt: card.lastUpdatedAt,
      }]
    }
    return []
  }

  // 「查看结果」点击时本地还没有产物 → 记下待兑现的 taskId,异步查询拿回文件后由下方 effect 打开
  const [pendingOpenTaskId, setPendingOpenTaskId] = createSignal<string | null>(null)

  function handleTaskOpenResult(taskId: string) {
    const card = taskCards().get(taskId)
    if (!card) {
      console.warn("[octo:task] openResult: card not found", { taskId })
      return
    }
    const ocs = buildOutputCardsFromTask(card)
    if (ocs.length === 0) {
      // completed 但本地无交付物:典型场景是「对已完成任务点过终止」,拿回的是 stop_task 控制响应而非文件,
      // 用户也从未调过 get_task_result。此时主动发起一次查询,产物到达后由 pendingOpen effect 兑现打开,
      // 而不是让右侧栏空白或显示控制文案。(需求 #72)
      console.warn("[octo:task] openResult: no deliverable yet, querying", { taskId, status: card.status })
      const sid = params.id
      if (sid && card.status === "completed" && !isBusy()) {
        setPendingOpenTaskId(taskId)
        tracker.interaction({ module: "insight", name: "task-open-result", extend: JSON.stringify({ taskId, deferred: true }) })
        void sendInjectedPrompt(sid, `查询任务 ${taskId} 的进度`, "task-open-result")
      }
      return
    }
    console.log("[octo:task] openResult", {
      taskId,
      count: ocs.length,
      tabs: ocs.map((oc) => ({ type: oc.type, source: oc.source, file: oc.fileName })),
    })
    tracker.interaction({ module: "insight", name: "task-open-result", extend: JSON.stringify({ taskId }) })
    // 多文件:全部 openTab,激活第一张。
    // 注意:openTab 会按 (uri,type) 去重,ocs[0].id 不一定真进了 tabs(可能命中已有 tab),
    // 故用 openTab 返回的「实际生效 id」激活,避免 activate 指向不存在的 tab 导致右侧栏空白。
    const openedIds = ocs.map((oc) => tabStore.openTab(oc))
    tabStore.activate(openedIds[0])
    focusResultTabs()
  }

  // ── eager 落地(SPEC-INS-014 v4):completed 任务的 MCP 产物「出卡即落」进 outputs,不等用户点开 ──
  // 文件管理「生成文件」段列的是 outputs 磁盘真实文件;此前 uri 产物只在点开渲染时才(部分)落盘,
  // 导致「生成了但没点开」的产物(典型:思维导图 json)在文件管理查无此文件。这里在 taskCards 拿到
  // completed 产物 links 时就落盘,与 UI 是否打开解耦。inline / path 卡不在此列(见 v4:inline 不落盘;
  // path/write 产物由 agent 提示词约定直接写 outputs,前端不搬运)。
  const eagerMaterializedCardIds = new Set<string>()
  createEffect(() => {
    const dir = projectDir()
    const sid = params.id
    // taskCards() 必须先读:早退在它之前会让 Solid 追踪不到该依赖,后续任务产物到达时 effect 不重跑
    // (与 insight-turn outputCards memo 里 parts 先读同一个道理)。
    const cards = [...taskCards().values()]
    if (!dir || !sid) return
    for (const card of cards) {
      if (card.status !== "completed") continue
      for (const oc of buildOutputCardsFromTask(card)) {
        if (oc.source !== "uri" || !oc.uri) continue
        if (eagerMaterializedCardIds.has(oc.id)) continue
        eagerMaterializedCardIds.add(oc.id)
        // 落盘后通知文件管理表格重拉:否则任务产物进了 outputs 目录,列表仍要手动切面板才看得到。
        void materializeUriCardToOutputs(oc, dir, sid).then((r) => {
          notifyMaterializeFailure(r)
          setFilesRefreshKey((k) => k + 1)
        })
      }
    }
  })

  // ── 兑现「查看结果」:上面的查询返回真实产物后,把 pendingOpen 的那张任务结果打开并激活 ──
  createEffect(() => {
    const tid = pendingOpenTaskId()
    if (!tid) return
    const card = taskCards().get(tid)
    if (!card) return
    const ocs = buildOutputCardsFromTask(card)
    if (ocs.length === 0) return // 仍未拿到产物,等下一次 taskCards 更新
    setPendingOpenTaskId(null)
    console.log("[octo:task] openResult fulfilled after query", { taskId: tid, count: ocs.length })
    const openedIds = ocs.map((oc) => tabStore.openTab(oc))
    tabStore.activate(openedIds[0])
    focusResultTabs()
  })

  // ── 自动 openTab(ResultViewer 当前为空时,把会话内所有 completed 任务的产物一次性全开;spec §8.3)──
  // 一进对话右侧栏就铺满本会话生成的全部文件(x,y,m,n…),而不是只开第一个任务、要求用户逐个叉掉
  // 才看到下一个。autoOpenedTaskIds 已记录开过的 task,用户手动关掉后不会再被重新弹开。
  const autoOpenedTaskIds = new Set<string>()
  createEffect(() => {
    if (tabStore.tabs().length > 0) return
    let firstOpenedId: string | undefined
    for (const card of taskCards().values()) {
      if (card.status !== "completed") continue
      if (autoOpenedTaskIds.has(card.taskId)) continue
      const ocs = buildOutputCardsFromTask(card)
      if (ocs.length === 0) continue
      autoOpenedTaskIds.add(card.taskId)
      console.log("[octo:task] auto-openResult (viewer empty)", {
        taskId: card.taskId,
        count: ocs.length,
        tabs: ocs.map((oc) => ({ type: oc.type, file: oc.fileName })),
      })
      const openedIds = ocs.map((oc) => tabStore.openTab(oc))
      if (firstOpenedId === undefined) firstOpenedId = openedIds[0]
    }
    if (firstOpenedId !== undefined) {
      tabStore.activate(firstOpenedId)  // 激活首个任务的首张,其余作为待选 tab 并存
      focusResultTabs()
    }
  })

  // ── 全链路 console diff:taskCards 变化时打快照 ──────────────
  let lastTaskSnapshot = new Map<string, string>()
  createEffect(() => {
    const current = taskCards()
    const currentSnap = new Map<string, string>()
    for (const [id, card] of current) {
      currentSnap.set(id, `${card.status}|${card.message ?? ""}`)
    }
    // diff:状态变化的卡片
    const changes: Array<{ taskId: string; from: string | null; to: string }> = []
    for (const [id, sig] of currentSnap) {
      const prev = lastTaskSnapshot.get(id) ?? null
      if (prev !== sig) changes.push({ taskId: id, from: prev, to: sig })
    }
    for (const id of lastTaskSnapshot.keys()) {
      if (!currentSnap.has(id)) changes.push({ taskId: id, from: lastTaskSnapshot.get(id)!, to: "gone" })
    }
    if (changes.length > 0) {
      console.log("[octo:task] aggregate diff", {
        sessionID: params.id,
        total: current.size,
        changes,
        snapshot: Array.from(current.values()).map((c) => ({
          taskId: c.taskId,
          tool: c.toolName,
          status: c.status,
          message: c.message,
          anchor: c.anchorUserMessageID,
          resourceLinkCount: c.resourceLinks.length,
          hasResultText: !!c.resultText,
        })),
      })
    }
    lastTaskSnapshot = currentSnap
  })

  // (方案 B)ProseMirror 编辑器自带 min/max-height + overflow 自适应,不再需要 textarea 版高度计算。

  const maxAttachments = () => attachments().length >= MAX_ATTACHMENTS
  function hasUploadingAttachments() {
    return attachments().some((a) => a.status === "uploading")
  }

  // ResultViewer 渲染在两处复用:常态 inline(收起按钮=手动收起)与窄屏抽屉(收起按钮=关抽屉)。
  // 二者按宽度互斥挂载(抽屉仅在 responsivePanelCollapsed 时可开,此时 inline 的 panelVisible 恒为 false)。
  const renderResultViewer = (onCollapse: () => void) => (
    <ResultViewer
      tabs={tabStore.tabs()}
      activeId={tabStore.activeId()}
      onActivate={handleActivateTab}
      onClose={handleCloseTab}
      onCacheContent={tabStore.cacheContent}
      onCollapse={onCollapse}
      onSetViewMode={tabStore.setViewMode}
      viewMode={resultViewMode()}
      onViewModeChange={setResultViewMode}
      onOpenLocalFile={openFileFromManager}
      onAddToSession={addInsightFileToSession}
      onCloseTabsByPath={closeTabsByPath}
      onRemoveAttachmentsByPath={removeAttachmentsByPath}
      refreshKey={filesRefreshKey()}
      onFilesRefresh={() => setFilesRefreshKey((k) => k + 1)}
    />
  )

  return (
    <DataProvider
      data={sync.data}
      directory={projectDir() || ""}
      onNavigateToSession={(sessionID: string) => {
        // 子会话导航拦截(SPEC-INS-021 §1 追加,isChildSession 注释详述)
        if (isChildSession(sessionID)) {
          console.log("[octo:task] child-session navigation blocked", { sessionID })
          return
        }
        navigate(`/insight/${sessionID}`)
      }}
      // 子会话给空串:上游 sessionLink 对 falsy 走路径兜底(/insight 无 /session 段 → 无 href),
      // 与点击拦截配套,堵住 cmd/中键经 <a href> 绕行的口
      onSessionHref={(sessionID: string) => (isChildSession(sessionID) ? "" : `/insight/${sessionID}`)}
    >
      <div class="size-full flex overflow-hidden relative">
        {/* 左侧会话栏(SPEC-INS-010 §11:侧栏归 insight,单独第一列,不混入对话↔面板的 flex) */}
        {/* top 槽注入 UXAI 自家的项目/产品切换器(走 ProjectInfo → DialogProjectOnboarding,
            与 _shell/sidebar.tsx + make/sidebar.tsx 同一实例,onboarding 元数据持久化共用)。
            octo-agent 同位置注入的是同事 fcd100b 那套简版 ProjectInfo(在 project-selector/),
            两仓注入物不同但 InsightSidebar 接口相同,不影响同步。*/}
        <Show when={!responsiveSidebarHidden()}>
          <InsightSidebar top={<ProjectInfo />} bottom={<SidebarFooter />} />
        </Show>
        {/* 窄屏(<746px)左侧栏抽屉:无可见遮罩(对齐 Claude),经汉堡唤出,贴左侧。
            透明点击层兜住抽屉外点击 → 点空白/导航/再点汉堡都关闭。 */}
        <Show when={responsiveSidebarHidden() && sidebarOverlayOpen()}>
          <div class="absolute inset-0 z-20" onClick={() => setSidebarOverlayOpen(false)} />
          <div class="absolute left-0 top-0 bottom-0 z-30" style={{ "box-shadow": "8px 0 24px rgba(0,0,0,0.12)" }}>
            <InsightSidebar top={<ProjectInfo />} bottom={<SidebarFooter />} />
          </div>
        </Show>

        {/* 对话↔任务面板区(data-page 作用域;拖拽分隔线相对它左边缘绝对定位,故侧栏必须在它之外)
            ref 观测容器实测宽 → 驱动 responsivePanelCollapsed / effectiveChatWidth */}
        <div ref={observePageArea} class="flex-1 min-w-0 flex overflow-hidden relative" data-page="insight">

        {/* ── 左栏：对话面板 ────
             面板可见时:宽度 = effectiveChatWidth(用户拖拽宽,被容器宽钳制;窄屏先挤聊天、面板守 480)。
             面板不可见(收起/无会话)时:撑满 100%,内容居中 reading-width。任务面板 flex:1 跟随重排。
             无 width 过渡动画(直接跟 panelVisible),分隔线拖拽跟手。 */}
        <div
          class="flex flex-col overflow-hidden relative"
          style={{
            width: panelVisible() ? `${effectiveChatWidth()}px` : "100%",
            flex: "0 0 auto",
            "min-width": "0",
            background: isDragOver() ? "var(--octo-brand-a3)" : "var(--octo-surface-page)",
            outline: isDragOver() ? "inset 0 0 0 2px var(--octo-brand-a25)" : "none",
          }}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
            <Show when={responsiveSidebarHidden() && !(params.id && userMessages().length > 0)}>
              <button
                type="button"
                onClick={toggleSidebarDrawer}
                title="侧栏"
                class="absolute top-3 left-3 z-10 flex items-center justify-center size-8 rounded-md transition-colors"
                style={{ color: "var(--octo-text-secondary)", background: sidebarOverlayOpen() ? "var(--octo-surface-hover)" : "transparent" }}
              >
                <Icon name="menu" class="size-5" />
              </button>
            </Show>
            <Show
              when={params.id && userMessages().length > 0}
              fallback={
                <Show
                  when={sessionMessagesLoaded()}
                  fallback={
                    /* 已有 id 但消息缓存未就绪：显示加载占位,绝不渲染空白。
                       否则切回已存在会话、缓存被清时中间区会整块空白(白屏 bug)。 */
                    <div class="size-full flex items-center justify-center">
                      <div class="octo-spinner" />
                    </div>
                  }
                >
                <div class="size-full flex flex-col items-center justify-center px-8 py-10 overflow-y-auto">
                  <NewSessionView worktree="" title="Octo Insight" subtitle="AI辅助用户洞察研究" />

                  <div style={{ width: "100%", "max-width": "800px" }}>
                    {/* @ 面板走 Portal + fixed(编辑器内),脱离本胶囊裁剪 → 胶囊可保留 overflow-hidden 圆角 */}
                    <div
                      class="rounded-[24px] transition-all duration-300 relative group flex flex-col overflow-hidden"
                      style={{
                        border: "1px solid transparent",
                        background: `
                          linear-gradient(var(--octo-surface-page), var(--octo-surface-page)) padding-box,
                          linear-gradient(135deg,
                            rgba(246, 97, 23, 1) 1%,
                            rgba(95, 45, 255, 1) 8%,
                            rgba(61, 93, 255, 1) 22%,
                            rgba(104, 138, 255, 1) 43%,
                            rgba(28, 171, 111, 1) 54%,
                            rgba(61, 93, 255, 1) 87%,
                            rgba(206, 7, 232, 1) 92%) border-box`,
                        "box-shadow": "0 0 5px rgba(0, 0, 0, 0.08), 0 0 10px rgba(74, 81, 255, 0.18), 0 0 20px rgba(89, 74, 255, 0.12)",
                        "min-height": "150px",
                      }}
                    >
                      {/* 附件条在胶囊内部顶部:单行横向滚动,不撑开胶囊 */}
                      <AttachmentBar
                        attachments={attachments()}
                        onRemove={removeAttachment}
                        onRetry={retryUpload}
                      />
                      {/* SPEC-INS-023 方案 B:ProseMirror 编辑器(行内 @ 灰胶囊 + 内置 @ 面板) */}
                      <ProseMirrorEditor
                        ref={(el) => (pmRefWelcome = el)}
                        autofocus
                        platformSkills={insightSkills().platform}
                        customSkills={insightSkills().custom}
                        files={mentionFiles() ?? null}
                        skillsLoading={skillsLoading()}
                        filesLoading={mentionFiles.loading}
                        mentionSelections={mentionSelections()}
                        setMentionSelections={setMentionSelections}
                        placeholder={mcpSelection()?.preset.placeholder ?? "请描述您的需求..."}
                        onContentChange={setPrompt}
                        onSubmit={() => void handleSubmit("enter")}
                        onTriggerMention={loadInsightSkills}
                        onMentionOpen={trackMentionOpen}
                        onMentionSelect={trackMentionSelect}
                        onPaste={handlePaste}
                      />

                      <div class="flex items-center gap-2 px-4 pb-4 relative z-10">
                        <input
                          ref={fileInputRef!}
                          type="file"
                          multiple
                          class="hidden"
                          accept={UPLOAD_ACCEPT}
                          onChange={handleFileInputChange}
                        />
                        <Tooltip
                          placement="top"
                          class="flex-shrink-0"
                          value={maxAttachments() ? `最多 ${MAX_ATTACHMENTS} 个文件` : UPLOAD_HINT}
                          contentStyle={{ "white-space": "nowrap", "max-width": "none" }}
                        >
                          <button
                            type="button"
                            onClick={() => { if (!maxAttachments()) fileInputRef.click() }}
                            disabled={maxAttachments()}
                            class="flex flex-shrink-0 items-center justify-center size-8 rounded-full transition-colors hover:bg-black/5 active:bg-black/10 text-gray-800 hover:text-black disabled:text-gray-400"
                            aria-label="添加附件"
                          >
                            <Icon name="plus" class="size-5" />
                          </button>
                        </Tooltip>

                        <ModelSelectorPopover
                          model={local.model}
                          triggerAs="button"
                          triggerProps={{
                            class: "flex items-center gap-1.5 min-w-0 max-w-[200px] bg-[#f3f3f3] hover:bg-[#e8e8e8] active:bg-[#dedede] transition-colors px-3 py-1.5 rounded-full text-[13px] text-gray-800 font-medium group",
                            "data-action": "prompt-model",
                          }}
                          onClose={() => focusComposer()}
                        >
                          {/* 不渲染 ProviderIcon:内网自部署的 provider id 不在 ui sprite 内会落到
                              synthetic 占位图标,跟 UXAI chat 一致(屏蔽 icon 只显示模型名)。 */}
                          <span class="truncate">
                            {local.model.current()?.name ?? "选择模型"}
                          </span>
                          <Icon name="chevron-down" class="size-3.5 shrink-0 opacity-60 transition-transform duration-200 group-data-[expanded]:rotate-180" />
                        </ModelSelectorPopover>

                        {/* 「研究工具」MCP 显式入口(SPEC-INS-017 §1,设计稿:位于模型选择器右侧) */}
                        <McpChip
                          functions={PRESET_PROMPTS}
                          selection={mcpSelection()}
                          onSelect={handleMcpSelect}
                          onClear={handleMcpClear}
                          onOpenMenu={() => tracker.interaction({ module: "insight", name: "mcp-chip-open" })}
                        />

                        <button
                          type="button"
                          onClick={() => stopping() ? void handleAbort() : void handleSubmit("button")}
                          disabled={sendDisabled()}
                          title={stopping() ? "停止生成" : (hasUploadingAttachments() ? "请等待附件上传完成" : (isWorking() ? "LLM 响应中,发送会进入排队" : undefined))}
                          class="flex-shrink-0 ml-auto"
                          style={{
                            "width": "32px",
                            "height": "32px",
                            "border-radius": "50%",
                            "background-image": stopping() ? "url(/pauseIcon.svg)" : "url(/IconSend-blue.svg)",
                            "background-size": "48.4px auto",
                            "background-position": "-8px -3.5px",
                            "background-repeat": "no-repeat",
                            "background-color": "transparent",
                            "border": "none",
                            "opacity": sendDisabled() ? "0.6" : "1",
                            "cursor": sendDisabled() ? "not-allowed" : "pointer",
                          }}
                        />
                      </div>
                    </div>
                  </div>
                </div>
                </Show>
              }
            >
              {/* 对话面板顶部标题栏（会话标题 + 改名 + 删除） */}
              {/* 收起态唤回浮标：放进 header 行内，与三点菜单同行，避免绝对定位遮挡三点按钮 */}
              <ConversationHeader
                sidebarToggle={responsiveSidebarHidden() ? (
                  <button
                    type="button"
                    onClick={toggleSidebarDrawer}
                    title="侧栏"
                    class="flex items-center justify-center size-6 rounded-md transition-colors"
                    style={{ color: "var(--octo-text-secondary)", background: sidebarOverlayOpen() ? "var(--octo-surface-hover)" : "transparent" }}
                  >
                    <Icon name="menu" class="size-4" />
                  </button>
                ) : undefined}
                panelToggle={!!params.id ? (
                  <button
                    type="button"
                    onClick={() => { if (responsivePanelCollapsed()) togglePanelDrawer(); else setPanelCollapsed((v) => !v) }}
                    title="文件面板"
                    class="flex items-center justify-center size-6 rounded-md transition-colors hover:bg-black/5 active:bg-black/10"
                    style={{ color: "var(--octo-text-secondary)" }}
                  >
                    {/* 统一面板开关(对齐 Claude):所有宽度都可开合——宽屏 inline 收/显、窄屏抽屉。
                        图标实心=面板当前展开、描边=已收起。 */}
                    <Icon name={(responsivePanelCollapsed() ? panelOverlayOpen() : !panelCollapsed()) ? "layout-right-full" : "layout-right"} class="size-4" />
                  </button>
                ) : undefined}
              />

              {/* 消息列表（autoScroll 挂在 scrollRef 容器，contentRef 挂在内容 div） */}
              <div class="relative flex-1 min-h-0">
                <ScrollView
                  class="h-full"
                  style={{ background: "var(--octo-surface-page)", padding: "0 12px" }}
                  viewportRef={(el) => {
                    scrollContainerEl = el
                    autoScroll.scrollRef(el)
                  }}
                  onScroll={autoScroll.handleScroll}
                  onMouseUp={autoScroll.handleInteraction}
                >
                  <div
                    ref={autoScroll.contentRef}
                    class="py-3 flex flex-col gap-0 w-full mx-auto"
                    style={{ "max-width": "800px" }}
                  >
                    <For each={userMessageIDs()}>
                      {(msgID) => (
                        <InsightTurn
                          sessionID={params.id!}
                          messageID={msgID}
                          status={sessionStatus()}
                          active={isBusy()}
                          onOpenResult={handleOpenResult}
                          taskCards={taskCardsByAnchor().get(msgID) ?? []}
                          onTaskRefresh={handleTaskRefresh}
                          onTaskStop={handleTaskStop}
                          onTaskOpenResult={handleTaskOpenResult}
                          resolveTaskLinks={(taskId) => taskCards().get(taskId)?.resourceLinks}
                          onFilesRefresh={() => setFilesRefreshKey(k => k + 1)}
                        />
                      )}
                    </For>
                  </div>
                </ScrollView>
                <div
                  class="absolute bottom-0 left-0 right-0 pointer-events-none z-[1]"
                  style={{
                    height: "24px",
                    background: "linear-gradient(180deg, rgba(255,255,255,0) 0%, rgba(255,255,255,1) 100%)",
                  }}
                />
              </div>

              {/* 输入区(居中 reading-width,与消息列表对齐) */}
              <div class="shrink-0 p-4 w-full mx-auto" style={{ "max-width": "800px" }}>
                {/* 权限询问 Dock(SPEC-INS-021 §2):如读取工作区以外的文件需用户确认,
                    否则服务端 ask 阻塞、界面停在「正在探索」(spec §0.2 贴路径卡死) */}
                <InsightPermissionDock sessionID={params.id} />
                {/* 答题 Dock(SPEC-INS-025):模型调 question 工具时服务端阻塞等答复,
                    此前 insight 无答题入口 → 会话永久挂起。与上面的权限 Dock 是同级兄弟节点,
                    两者可同时 pending(并行 tool call / task 子代理),正常纵向堆叠、不重叠。 */}
                <InsightQuestionDock sessionID={params.id} />
                {/* 队列提示条:busy 时点了发送会先入队,FIFO 多条逐行列出 (SPEC-INS-007 §3.3.4) */}
                <Show when={queue().length > 0}>
                  <div class="octo-queue-banner">
                    <span class="octo-queue-banner-label">排队中 {queue().length}</span>
                    <div class="octo-queue-banner-list">
                      <For each={queue()}>
                        {(item, i) => (
                          <div class="octo-queue-banner-item">
                            <span class="octo-queue-banner-index">{i() + 1}</span>
                            <span class="octo-queue-banner-text">{item.text}</span>
                            <button
                              type="button"
                              onClick={() => removeQueued(i())}
                              class="octo-queue-banner-cancel"
                              title="移除这条(输入框为空时回填,便于编辑)"
                              aria-label="移除排队项"
                            >
                              ×
                            </button>
                          </div>
                        )}
                      </For>
                    </div>
                  </div>
                </Show>

                {/* @ 面板走 Portal + fixed(编辑器内),脱离本胶囊裁剪 → 胶囊可保留 overflow-hidden 圆角 */}
                <div
                  class="rounded-[16px] transition-all duration-300 relative group flex flex-col overflow-hidden"
                  style={{
                    border: "1px solid transparent",
                    background: `
                      linear-gradient(var(--octo-surface-page), var(--octo-surface-page)) padding-box,
                      linear-gradient(135deg,
                        rgba(246, 97, 23, 0.7) 1%,
                        rgba(95, 45, 255, 0.7) 8%,
                        rgba(61, 93, 255, 0.7) 22%,
                        rgba(104, 138, 255, 0.7) 43%,
                        rgba(28, 171, 111, 0.7) 54%,
                        rgba(61, 93, 255, 0.7) 87%,
                        rgba(206, 7, 232, 0.7) 92%) border-box`,
                    "box-shadow": "0 0 5px rgba(0, 0, 0, 0.08), 0 0 10px rgba(74, 81, 255, 0.18), 0 0 20px rgba(89, 74, 255, 0.12)",
                    "min-height": "150px",
                    "margin-top": attachments().length > 0 ? "6px" : "0",
                  }}
                >
                  {/* 附件条在胶囊内部顶部:单行横向滚动,不撑开胶囊 */}
                  <AttachmentBar
                    attachments={attachments()}
                    onRemove={removeAttachment}
                    onRetry={retryUpload}
                  />
                  {/* SPEC-INS-023 方案 B:ProseMirror 编辑器(行内 @ 灰胶囊 + 内置 @ 面板) */}
                  <ProseMirrorEditor
                    ref={(el) => (pmRefConv = el)}
                    autofocus
                    platformSkills={insightSkills().platform}
                    customSkills={insightSkills().custom}
                    files={mentionFiles() ?? null}
                    skillsLoading={skillsLoading()}
                    filesLoading={mentionFiles.loading}
                    mentionSelections={mentionSelections()}
                    setMentionSelections={setMentionSelections}
                    placeholder={mcpSelection()?.preset.placeholder ?? "请描述您的需求..."}
                    onContentChange={setPrompt}
                    onSubmit={() => void handleSubmit("enter")}
                    onTriggerMention={loadInsightSkills}
                    onMentionOpen={trackMentionOpen}
                    onMentionSelect={trackMentionSelect}
                    onPaste={handlePaste}
                  />

                  <div class="flex items-center gap-2 px-4 pb-4 relative z-10">
                    <input
                      ref={fileInputRef!}
                      type="file"
                      multiple
                      class="hidden"
                      accept={UPLOAD_ACCEPT}
                      onChange={handleFileInputChange}
                    />
                    <Tooltip
                      placement="top"
                      class="flex-shrink-0"
                      value={maxAttachments() ? `最多 ${MAX_ATTACHMENTS} 个文件` : UPLOAD_HINT}
                      contentStyle={{ "white-space": "nowrap", "max-width": "none" }}
                    >
                      <button
                        type="button"
                        onClick={() => { if (!maxAttachments()) fileInputRef.click() }}
                        disabled={maxAttachments()}
                        class="flex flex-shrink-0 items-center justify-center size-8 rounded-full transition-colors hover:bg-black/5 active:bg-black/10 text-gray-800 hover:text-black disabled:text-gray-400"
                        aria-label="添加附件"
                      >
                        <Icon name="plus" class="size-5" />
                      </button>
                    </Tooltip>

                    <ModelSelectorPopover
                      model={local.model}
                      triggerAs="button"
                      triggerProps={{
                        class: "flex items-center gap-1.5 min-w-0 max-w-[200px] bg-[#f3f3f3] hover:bg-[#e8e8e8] active:bg-[#dedede] transition-colors px-3 py-1.5 rounded-full text-[13px] text-gray-800 font-medium group",
                        "data-action": "prompt-model",
                      }}
                      onClose={() => focusComposer()}
                    >
                      {/* 不渲染 ProviderIcon:内网自部署的 provider id 不在 ui sprite 内会落到
                          synthetic 占位图标,跟 UXAI chat 一致(屏蔽 icon 只显示模型名)。 */}
                      <span class="truncate">
                        {local.model.current()?.name ?? "选择模型"}
                      </span>
                      <Icon name="chevron-down" class="size-3.5 shrink-0 opacity-60 transition-transform duration-200 group-data-[expanded]:rotate-180" />
                    </ModelSelectorPopover>

                    {/* 「研究工具」MCP 显式入口(SPEC-INS-017 §1,设计稿:位于模型选择器右侧) */}
                    <McpChip
                      functions={PRESET_PROMPTS}
                      selection={mcpSelection()}
                      onSelect={handleMcpSelect}
                      onClear={handleMcpClear}
                      onOpenMenu={() => tracker.interaction({ module: "insight", name: "mcp-chip-open" })}
                    />

                    <button
                      type="button"
                      onClick={() => stopping() ? void handleAbort() : void handleSubmit()}
                      disabled={sendDisabled()}
                      title={stopping() ? "停止生成" : (hasUploadingAttachments() ? "请等待附件上传完成" : (isWorking() ? "LLM 响应中,发送会进入排队" : undefined))}
                      class="flex-shrink-0 ml-auto"
                      style={{
                        "width": "32px",
                        "height": "32px",
                        "border-radius": "50%",
                        "background-image": stopping() ? "url(/pauseIcon.svg)" : "url(/IconSend-blue.svg)",
                        "background-size": "48.4px auto",
                        "background-position": "-8px -3.5px",
                        "background-repeat": "no-repeat",
                        "background-color": "transparent",
                        "border": "none",
                        "opacity": sendDisabled() ? "0.6" : "1",
                        "cursor": sendDisabled() ? "not-allowed" : "pointer",
                      }}
                    />
                  </div>
                </div>
              </div>
            </Show>

        </div>

        {/* ── 任务面板:有产物且未收起时挂载;收起动画播完才卸载(SPEC-INS-009) ── */}
        <Show when={panelVisible()}>
          {/* 聊天/结果 拖拽分隔线（半侧贴边胶囊）
              top/bottom 缩进 20px：避免与 Windows classic 滚动条两端箭头（~17px）热区重合 */}
          <div
            class="absolute flex items-center justify-center group"
            style={{ top: "20px", bottom: "20px", left: `${effectiveChatWidth() - 4}px`, width: "8px", cursor: "col-resize", "z-index": 10 }}
            onPointerDown={handleDividerPointerDown}
          >
            {/* 拖拽手柄视觉胶囊已隐藏(dev-yfy d8bc3d4):保留热区与拖拽手感,仅去掉胶囊视觉
            <div
              class="absolute right-[10px] flex items-center justify-center bg-white transition-shadow duration-200"
              style={{
                width: "12px",
                height: "36px",
                "border-radius": "10px 0 0 10px",
                "box-shadow": "-2px 0 4px rgba(0,0,0,0.04), inset 1px 0 0 rgba(0,0,0,0.02)",
                border: "1px solid var(--octo-border-divider)",
                "border-right": "none",
              }}
            >
              <div
                class="w-[2px] h-[14px] rounded-full mr-[2px]"
                style={{ background: "var(--octo-border-input, #c9c9c9)" }}
              />
            </div> */}
          </div>

          {/* 中栏：ResultViewer(flex:1 跟随聊天列宽度重排) */}
          {renderResultViewer(() => setPanelCollapsed(true))}
        </Show>

        {/* 窄屏收起后的右侧面板抽屉:无可见遮罩(对齐 Claude),经顶栏按钮唤出,贴右侧滑出(480 宽,守住内容不折叠);
            盖在聊天右侧、左侧聊天仍可见。透明点击层兜住抽屉外点击 → 点空白/切会话/再点按钮都关闭。 */}
        <Show when={responsivePanelCollapsed() && panelOverlayOpen()}>
          <div class="absolute inset-0 z-20" onClick={() => setPanelOverlayOpen(false)} />
          <div
            class="absolute right-0 top-0 bottom-0 z-30 flex"
            style={{ width: `${PANEL_MIN}px`, "max-width": "100%", background: "var(--octo-surface-page)", "box-shadow": "-8px 0 24px rgba(0,0,0,0.12)" }}
          >
            {renderResultViewer(() => setPanelOverlayOpen(false))}
          </div>
        </Show>
        </div>
      </div>
    </DataProvider>
  )
}


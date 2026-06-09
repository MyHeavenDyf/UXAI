import "./pattern-tokens.css"
import type { Message, Part, Session, SessionStatus } from "@opencode-ai/sdk/v2/client"
import { DataProvider } from "@opencode-ai/ui/context/data"
import { createAutoScroll } from "@opencode-ai/ui/hooks"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Button } from "@opencode-ai/ui/button"
import { InlineInput } from "@opencode-ai/ui/inline-input"
import { showToast, Toast } from "@opencode-ai/ui/toast"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  For,
  on,
  onCleanup,
  Show,
  type JSX,
} from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { useNavigate, useParams } from "@solidjs/router"
import { useGlobalSync } from "@/context/global-sync"
import { SDKProvider, useSDK } from "@/context/sdk"
import { SyncProvider, useSync } from "@/context/sync"
import { LocalProvider, useLocal } from "@/context/local"
import { useLayout } from "@/context/layout"
import { useLanguage } from "@/context/language"
import { octoSessionsDir } from "@/hooks/use-project-dir"
import { sessionTitle } from "@/utils/session-title"
import { AttachmentBar, type Attachment } from "./components/attachment-bar"
import { InsightTurn, type OutputCard } from "./components/insight-turn"
import { DesignSystemPicker } from "./components/design-system-picker"
import { Spinner } from "@opencode-ai/ui/spinner"
import { Icon } from "@opencode-ai/ui/icon"
import { ModelSelectorPopover } from "@/components/dialog-select-model"
import { runProtoTriage } from "./agents/proto_triage"
import { runProtoIntent } from "./agents/proto_intent"
import { runProtoIntentAudit } from "./agents/proto_intent_audit"
import { runProtoPlannerCreate } from "./agents/proto_planner_create"
import { runProtoModuleCreate } from "./agents/proto_module_create"
import { mergeModules } from "./agents/merge"
import { buildIntentPrompt, detectCatalog, detectA2UIJson, type ComponentCatalog } from "./utils/a2ui-protocol"

const AGENT_NAME = "proto_triage"

export default function PatternPage() {
  const globalSync = useGlobalSync()
  const homeDir = () => globalSync.data.path.home

  return (
    <Show when={homeDir()} keyed>
      {(dir) => (
        <SDKProvider directory={() => dir}>
          <SyncProvider>
            <LocalProvider>
              <PatternContent />
            </LocalProvider>
          </SyncProvider>
        </SDKProvider>
      )}
    </Show>
  )
}

function PatternContent() {
  const params = useParams<{ id?: string }>()
  const navigate = useNavigate()
  const sdk = useSDK()
  const sync = useSync()
  const layout = useLayout()
  const language = useLanguage()
  const dialog = useDialog()
  const globalSync = useGlobalSync()

  const local = useLocal()
  const currentModel = () => local.model.current()
  const activeModelKey = createMemo(() => {
    const m = currentModel()
    if (!m) return null
    return { providerID: m.provider.id, modelID: m.id }
  })

  const [sessionInfo, { refetch: refetchSession }] = createResource(
    () => params.id ?? "",
    async (id) => {
      if (!id) return null as Session | null
      try {
        const result = await sdk.client.session.get({ sessionID: id })
        return (result.data as Session | undefined) ?? null
      } catch {
        return null as Session | null
      }
    },
  )

  const [titleState, setTitleState] = createStore({
    editing: false,
    draft: "",
    menuOpen: false,
    pendingRename: false,
  })
  let titleRef: HTMLInputElement | undefined

  function openTitleEditor() {
    const info = sessionInfo()
    setTitleState({ editing: true, draft: sessionTitle(info?.title) ?? "" })
    requestAnimationFrame(() => titleRef?.focus())
  }

  async function saveTitleEditor() {
    const id = params.id
    if (!id) return
    const draft = titleState.draft.trim()
    if (!draft) { setTitleState("editing", false); return }
    try {
      await sdk.client.session.update({ sessionID: id, title: draft })
      void refetchSession()
    } catch (err) {
      showToast({ title: "重命名失败", description: err instanceof Error ? err.message : String(err) })
    }
    setTitleState("editing", false)
  }

  async function deleteSession(sessionID: string) {
    try {
      await sdk.client.session.delete({ sessionID })
      navigate("/pattern")
    } catch (err) {
      showToast({ title: "删除失败", description: err instanceof Error ? err.message : String(err) })
    }
  }

  function handleDeleteSession() {
    const id = params.id
    if (!id) return
    dialog.show(() => <PatternDialogDeleteSession sessionID={id} name={sessionTitle(sessionInfo()?.title) ?? "Pattern"} onDelete={deleteSession} />)
  }

  createEffect(
    on(
      () => params.id,
      (id) => {
        if (id) layout.lastSessionPerTab.setPattern(id)
        setSending(false)
        setPhase("idle")
        requestAnimationFrame(() => autoScroll.forceScrollToBottom())
      },
    ),
  )

  createEffect(
    on(
      () => params.id,
      (id) => {
        if (!id) return
        void sync.session.sync(id)
      },
    ),
  )

  const userMessages = createMemo((): Message[] => {
    const id = params.id
    if (!id) return []
    return ((sync.data.message[id] ?? []) as Message[]).filter((m) => m.role === "user")
  })

  const sessionStatus = createMemo((): SessionStatus => {
    const id = params.id
    if (!id) return { type: "idle" }
    return sync.data.session_status[id] ?? { type: "idle" }
  })

  const isBusy = createMemo(() => {
    if (sessionStatus().type !== "idle") return true
    const id = params.id
    if (!id) return false
    const msgs = (sync.data.message[id] ?? []) as Message[]
    const lastAssistant = msgs.findLast((m) => m.role === "assistant")
    return !!lastAssistant && typeof lastAssistant.time.completed !== "number"
  })

  const [prompt, setPrompt] = createSignal("")
  const [sending, setSending] = createSignal(false)
  const [phase, setPhase] = createSignal<"idle" | "intent" | "audit" | "planner" | "module">("idle")
  const [detectedCatalog, setDetectedCatalog] = createSignal<ComponentCatalog>("desktop")
  const [attachments, setAttachments] = createSignal<Attachment[]>([])
  const [isDragOver, setIsDragOver] = createSignal(false)
  const [selectedDesignSystem, setSelectedDesignSystem] = createSignal<string | null>(null)
  const hasContent = () => !!(params.id && userMessages().length > 0)

  const CHAT_WIDTH_KEY = "octo:pattern:chat-width"
  function getInitialChatWidth(): number {
    const stored = localStorage.getItem(CHAT_WIDTH_KEY)
    if (stored) {
      const n = parseInt(stored, 10)
      if (!isNaN(n) && n >= 345 && n <= 720) return n
    }
    return 460
  }
  const [chatWidth, setChatWidth] = createSignal(getInitialChatWidth())
  const [focusMode, setFocusMode] = createSignal(false)
  const MIN_CHAT = 345
  const MAX_CHAT = 720

  let dragCleanup: (() => void) | null = null

  function handleDividerMouseDown(e: MouseEvent) {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = chatWidth()
    document.body.style.cursor = "col-resize"
    document.body.style.userSelect = "none"
    document.body.style.overflow = "hidden"
    const resetBody = () => {
      document.body.style.cursor = ""
      document.body.style.userSelect = ""
      document.body.style.overflow = ""
      dragCleanup = null
    }
    const onMove = (ev: MouseEvent) => {
      setChatWidth(Math.max(MIN_CHAT, Math.min(MAX_CHAT, startWidth + ev.clientX - startX)))
    }
    const onUp = () => {
      resetBody()
      localStorage.setItem(CHAT_WIDTH_KEY, String(chatWidth()))
      document.removeEventListener("mousemove", onMove)
      document.removeEventListener("mouseup", onUp)
    }
    document.addEventListener("mousemove", onMove)
    document.addEventListener("mouseup", onUp)
    dragCleanup = () => {
      resetBody()
      document.removeEventListener("mousemove", onMove)
      document.removeEventListener("mouseup", onUp)
    }
  }

  onCleanup(() => { dragCleanup?.() })

  const autoScroll = createAutoScroll({ working: isBusy })

  let previewIframeRef: HTMLIFrameElement | undefined
  let previewPaneRef: HTMLDivElement | undefined
  const [previewScale, setPreviewScale] = createSignal(1)

  const TARGET_WIDTH = 1920
  const TARGET_HEIGHT = 1080

  function updatePreviewScale() {
    if (!previewPaneRef) return
    const containerWidth = previewPaneRef.clientWidth - 40
    const containerHeight = previewPaneRef.clientHeight - 40
    const scaleX = containerWidth / TARGET_WIDTH
    const scaleY = containerHeight / TARGET_HEIGHT
    setPreviewScale(Math.min(scaleX, scaleY, 1))
  }

  let previewResizeObserver: ResizeObserver | undefined
  onCleanup(() => previewResizeObserver?.disconnect())

  function bindPreviewPaneRef(el: HTMLDivElement) {
    previewPaneRef = el
    updatePreviewScale()
    previewResizeObserver?.disconnect()
    previewResizeObserver = new ResizeObserver(() => updatePreviewScale())
    previewResizeObserver.observe(el)
  }

  function sendToPreview(data: unknown) {
    if (!previewIframeRef?.contentWindow) return
    previewIframeRef.contentWindow.postMessage({ type: "A2UI_UPDATE", payload: data }, "*")
  }

  function getLastAssistantText(sessionId: string): string | null {
    const messages = (sync.data.message[sessionId] ?? []) as Message[]
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i]
      if (msg.role !== "assistant") continue
      const parts = (sync.data.part[msg.id] ?? []) as Array<{ type: string; text?: string }>
      for (const p of [...parts].reverse()) {
        if (p.type === "text" && p.text) return p.text
      }
    }
    return null
  }

  function extractJsonFromText(text: string): Record<string, unknown> | null {
    try {
      const raw = text.includes("```json")
        ? text.match(/```json\s*\n([\s\S]*?)\n?```/)?.[1] ?? text
        : text
      const parsed = JSON.parse(raw.trim())
      if (parsed && typeof parsed === "object") return parsed
    } catch {}
    return null
  }

  async function waitForAssistant(sessionId: string, signal: AbortSignal): Promise<string> {
    while (!signal.aborted) {
      await new Promise((r) => setTimeout(r, 2000))
      if (signal.aborted) throw new Error("aborted")
      try {
        const res = await sdk.client.session.messages({ sessionID: sessionId, limit: 10 })
        const items = res.data as Array<{ info: Message; parts: Part[] }> | undefined
        if (!items) continue
        for (let i = items.length - 1; i >= 0; i--) {
          const msg = items[i].info
          if (msg.role !== "assistant") continue
          if (msg.time.completed == null) continue
          const parts = items[i].parts
          for (let j = parts.length - 1; j >= 0; j--) {
            // @ts-ignore
            if (parts[j].type === "text" && parts[j].text) return parts[j].text
          }
        }
      } catch (err) {
        console.warn("[Pattern] poll error:", err)
      }
    }
    throw new Error("aborted")
  }

  async function callSubAgent(parentSid: string, agentName: string, promptText: string, signal: AbortSignal): Promise<string> {
    const modelKey = activeModelKey()
    if (!modelKey) throw new Error("no model")

    const childResult = await sdk.client.session.create({
      directory: sdk.directory!,
      parentID: parentSid,
      agent: agentName,
    })
    const childSession = childResult.data as Session | undefined
    if (!childSession) throw new Error("failed to create child session")

    await sdk.client.session.promptAsync({
      sessionID: childSession.id,
      agent: agentName,
      ...(modelKey ? { model: modelKey } : {}),
      parts: [{ type: "text", text: promptText }],
    })

    const text = await waitForAssistant(childSession.id, signal)
    return text
  }

  async function handleSubmit() {
    const text = prompt().trim()
    if (!text || sending() || !activeModelKey()) return
    console.log("开始--------------------", text)
    setSending(true)
    setPrompt("")
    const submitSessionId = params.id
    const controller = new AbortController()
    const mk = activeModelKey()!
    try {
      let sid = submitSessionId
      debugger
      if (!sid) {
        const dir = sdk.directory
        if (!dir) { console.log("[Pattern] no directory, abort"); return }
        const result = await sdk.client.session.create({ directory: dir, agent: AGENT_NAME })
        const session = result.data as Session | undefined
        if (!session) { console.log("[Pattern] session.create returned no session"); return }
        navigate(`/pattern/${session.id}`)
        sid = session.id
      }

      const existing = sessionInfo()?.title
      if (!existing || existing.startsWith("New session")) {
        await sdk.client.session.update({ sessionID: sid, title: text.slice(0, 60) }).catch(() => {})
      }

      const ctx = {
        sdk: { client: sdk.client },
        directory: sdk.directory!,
        modelKey: mk,
        parentSessionId: sid,
        abortSignal: controller.signal,
      }

      // ── Step 0: triage → 判断首次还是修改 ──
      const existingText = getLastAssistantText(sid)
      const genuiJson = existingText ? extractJsonFromText(existingText) : null
      debugger
      const triage = await runProtoTriage({
        sdk: { client: sdk.client },
        directory: sdk.directory!,
        modelKey: mk,
        userRequest: text,
        genuiJson,
        layoutPlanner: null,
        moduleResults: null,
        sessionId: genuiJson ? sid : undefined,
        abortSignal: controller.signal,
      })
      console.log("[Pattern] triage:", triage.routing, triage.reason)
      console.log("[Pattern] triage output:", JSON.stringify(triage, null, 2))

      if (triage.routing === "modify") {
        console.log("[Pattern] modify flow (not implemented)")
        setPhase("idle")
        return
      }

      // ── Step 1: proto_intent → 生成蓝图 ──
      setPhase("intent")
      debugger
      const intentResult = await runProtoIntent({ ...ctx, input: { userRequest: text } })
//       const intentResult = JSON.parse(`{
//   "userInput": "简易小卡片",
//   "intentAnalysis": "该界面是一个轻量级卡片式概览面板，面向内部团队成员或管理者，用于在一个简洁统一的视图中快速掌握关键业务指标、团队成员动态及待办事项。核心痛点在于信息碎片化——用户需要在多个系统页面间切换才能获取完整信息。本界面通过将多种信息类型（指标数据、人员状态、任务进度）统一收敛为视觉一致的小卡片形态，帮助用户实现「一屏览全局」的效率提升。",
//   "layoutDescription": "页面采用上下垂直布局模式：顶部为通栏标题栏（含欢迎语、全局搜索与用户入口），下方为主体区域，主体区域从上至下依次为指标卡片行和多功能卡片网格区。整体布局紧凑，聚焦于卡片信息的快速扫描与消费。",
//   "sections": [
//     {
//       "id": "pageHeader",
//       "name": "页面顶部标题栏",
//       "description": "页面最顶部的全局导航与状态区域，提供欢迎问候、全局搜索入口、通知提醒及用户信息展示，是用户进入页面的第一视觉锚点。"
//     },
//     {
//       "id": "metricsCards",
//       "name": "核心指标卡片行",
//       "description": "横向排列的4个关键业务指标小卡片，以极简的视觉风格展示总用户数、月活跃用户、本月收入和任务完成率的当前数值与变化趋势，帮助用户快速感知业务健康度。"
//     },
//     {
//       "id": "mixedCardGrid",
//       "name": "多功能卡片网格",
//       "description": "一个3列的卡片网格区域，混合展示团队成员卡片、待办任务卡片和动态通知卡片，每种卡片类型拥有统一的视觉基调和差异化的信息结构，集中呈现协作维度的关键信息。"
//     }
//   ],
//   "sectionDetailList": [
//     {
//       "id": "pageHeader",
//       "name": "页面顶部标题栏",
//       "intent": "提供页面级全局导航与用户状态入口，让用户快速定位到搜索内容、查看通知或进入个人中心。",
//       "function": "1. 显示个性化欢迎语；2. 提供全局搜索框；3. 展示未读通知数并提供点击入口；4. 展示当前登录用户头像与名称。",
//       "layout": "水平通栏布局，采用左中右三段式结构：左侧为欢迎语文本，中间为搜索框，右侧为通知按钮和用户头像的组合。",
//       "elements": "左侧：标题文本组件；中间：Input搜索输入框（带Search图标）；右侧：Badge包裹的Bell图标按钮 + 用户头像Image组件。",
//       "data": {
//         "welcomeMessage": "早上好，欢迎回来 👋",
//         "searchPlaceholder": "搜索卡片、项目或用户...",
//         "notificationConfig": {
//           "bellIcon": "Bell",
//           "unreadCount": 5,
//           "notificationTooltip": "你有 5 条未读通知"
//         },
//         "userInfo": {
//           "avatarImage": "https://randomuser.me/api/portraits/men/32.jpg",
//           "userName": "张明",
//           "userRole": "高级产品经理"
//         }
//       }
//     },
//     {
//       "id": "metricsCards",
//       "name": "核心指标卡片行",
//       "intent": "在视觉最优先的区域集中呈现4个最关键的量化业务指标，让用户无需任何操作即可完成对当前业务状态的全局评估。",
//       "function": "展示4个并排的指标小卡片，每张卡片包含：指标名称、当前数值与单位、趋势方向图标、环比变化率、对比时间段文本。",
//       "layout": "水平等分布局，4张卡片占据一整行，每张卡片宽度相等，内部采用上下结构：指标名称在上，数值居中，趋势与变化率在底部。",
//       "elements": "4个结构一致的指标卡片组件。每个卡片内部包含：指标名称文本、大号数值文本、单位文本、趋势图标（Lucide: TrendingUp / TrendingDown）、变化率文本、对比时段文本。",
//       "data": {
//         "cardTitle": "核心指标",
//         "metrics": [
//           {
//             "cardTitle": "总用户数",
//             "currentValue": 28473,
//             "unit": "人",
//             "trendIcon": "TrendingUp",
//             "changeRate": "+12.5%",
//             "periodText": "较上月增长"
//           },
//           {
//             "cardTitle": "月活跃用户",
//             "currentValue": 12580,
//             "unit": "人",
//             "trendIcon": "TrendingUp",
//             "changeRate": "+8.3%",
//             "periodText": "较上月增长"
//           },
//           {
//             "cardTitle": "本月收入",
//             "currentValue": 458600,
//             "unit": "元",
//             "trendIcon": "TrendingDown",
//             "changeRate": "-3.2%",
//             "periodText": "较上月下降"
//           },
//           {
//             "cardTitle": "任务完成率",
//             "currentValue": 87,
//             "unit": "%",
//             "trendIcon": "TrendingUp",
//             "changeRate": "+5.7%",
//             "periodText": "较上月提升"
//           }
//         ]
//       }
//     },
//     {
//       "id": "mixedCardGrid",
//       "name": "多功能卡片网格",
//       "intent": "在一个统一的卡片网格中聚合展示多维度信息（人员、任务、通知），使团队成员能在同一视图中完成人员联络、任务追踪和动态阅览，减少上下文切换成本。",
//       "function": "提供3列等宽卡片网格，包含三种类型的卡片：1) 团队成员卡片（头像、姓名、职位、在线状态、任务数）；2) 待办任务卡片（任务标题、优先级标签、截止日期、完成进度）；3) 动态通知卡片（通知图标、标题、摘要、时间戳）。",
//       "layout": "3列等宽网格布局，卡片高度随内容自适应，卡片之间保持均匀间距。三种卡片类型在网格中混合排列，视觉上通过卡片顶部的彩色标识条区分类型。",
//       "elements": "12张结构清晰的小卡片，分为三类：1) UserCard：包含avatarImage、userName文本、userRole文本、Tag状态标签、currentTaskCount和completedProjectCount统计；2) TaskCard：包含taskTitle文本、priorityTag标签（高/中/低）、deadline文本、Progress条形进度条、assigneeAvatar头像；3) NotificationCard：包含notifyIcon图标、notifyTitle文本、summary文本、timestamp文本、isUnread未读标记。",
//       "data": {
//         "cardTitle": "团队动态",
//         "items": [
//           {
//             "cardType": "user",
//             "id": "u-001",
//             "avatarImage": "https://randomuser.me/api/portraits/women/44.jpg",
//             "userName": "林小溪",
//             "userRole": "高级前端工程师",
//             "department": "技术部",
//             "statusTag": "在线",
//             "statusTagColor": "green",
//             "currentTaskCount": 12,
//             "completedProjectCount": 8,
//             "email": "lin.xiao@example.com"
//           },
//           {
//             "cardType": "task",
//             "id": "t-001",
//             "taskTitle": "用户中心模块重构",
//             "priorityTag": "高",
//             "priorityTagColor": "red",
//             "deadline": "2026-06-15",
//             "progressPercent": 65,
//             "assigneeAvatar": "https://randomuser.me/api/portraits/men/22.jpg",
//             "assigneeName": "王强",
//             "description": "完成用户中心前后端分离架构升级"
//           },
//           {
//             "cardType": "notification",
//             "id": "n-001",
//             "notifyIcon": "GitPullRequest",
//             "notifyTitle": "代码合并请求",
//             "summary": "李华 提交了一个 PR #1423 到 main 分支，涉及支付模块优化",
//             "timestamp": "10 分钟前",
//             "isUnread": true
//           },
//           {
//             "cardType": "user",
//             "id": "u-002",
//             "avatarImage": "https://randomuser.me/api/portraits/men/45.jpg",
//             "userName": "陈思远",
//             "userRole": "后端架构师",
//             "department": "技术部",
//             "statusTag": "忙碌",
//             "statusTagColor": "orange",
//             "currentTaskCount": 8,
//             "completedProjectCount": 15,
//             "email": "chen.siyuan@example.com"
//           },
//           {
//             "cardType": "task",
//             "id": "t-002",
//             "taskTitle": "数据看板 V2.0 设计",
//             "priorityTag": "中",
//             "priorityTagColor": "blue",
//             "deadline": "2026-06-20",
//             "progressPercent": 30,
//             "assigneeAvatar": "https://randomuser.me/api/portraits/women/28.jpg",
//             "assigneeName": "赵雨涵",
//             "description": "设计并实现新版数据可视化看板的所有图表组件"
//           },
//           {
//             "cardType": "notification",
//             "id": "n-002",
//             "notifyIcon": "MessageCircle",
//             "notifyTitle": "新消息",
//             "summary": "设计团队在「首页改版」项目中 @了你，请查看最新设计稿",
//             "timestamp": "1 小时前",
//             "isUnread": true
//           },
//           {
//             "cardType": "user",
//             "id": "u-003",
//             "avatarImage": "https://randomuser.me/api/portraits/women/68.jpg",
//             "userName": "李美琪",
//             "userRole": "UI/UX 设计师",
//             "department": "设计部",
//             "statusTag": "离线",
//             "statusTagColor": "default",
//             "currentTaskCount": 5,
//             "completedProjectCount": 22,
//             "email": "li.meiqi@example.com"
//           },
//           {
//             "cardType": "task",
//             "id": "t-003",
//             "taskTitle": "性能优化——首屏加载速度",
//             "priorityTag": "高",
//             "priorityTagColor": "red",
//             "deadline": "2026-06-10",
//             "progressPercent": 85,
//             "assigneeAvatar": "https://randomuser.me/api/portraits/men/55.jpg",
//             "assigneeName": "刘伟",
//             "description": "将首屏加载时间从 3.2s 优化至 1.5s 以内"
//           },
//           {
//             "cardType": "notification",
//             "id": "n-003",
//             "notifyIcon": "CalendarCheck",
//             "notifyTitle": "会议提醒",
//             "summary": "「Sprint 回顾会」将于今天 15:00 在 3楼会议室举行，请准时参加",
//             "timestamp": "2 小时前",
//             "isUnread": false
//           },
//           {
//             "cardType": "user",
//             "id": "u-004",
//             "avatarImage": "https://randomuser.me/api/portraits/men/75.jpg",
//             "userName": "周建国",
//             "userRole": "测试主管",
//             "department": "质量保障部",
//             "statusTag": "在线",
//             "statusTagColor": "green",
//             "currentTaskCount": 15,
//             "completedProjectCount": 30,
//             "email": "zhou.jianguo@example.com"
//           },
//           {
//             "cardType": "task",
//             "id": "t-004",
//             "taskTitle": "自动化测试脚本编写",
//             "priorityTag": "中",
//             "priorityTagColor": "blue",
//             "deadline": "2026-06-25",
//             "progressPercent": 45,
//             "assigneeAvatar": "https://randomuser.me/api/portraits/women/33.jpg",
//             "assigneeName": "孙婷婷",
//             "description": "为核心业务模块编写不少于 200 个 E2E 自动化测试用例"
//           },
//           {
//             "cardType": "notification",
//             "id": "n-004",
//             "notifyIcon": "AlertTriangle",
//             "notifyTitle": "系统告警",
//             "summary": "线上支付服务响应时间异常（P99: 2.8s），已触发自动扩容流程",
//             "timestamp": "30 分钟前",
//             "isUnread": true
//           }
//         ]
//       }
//     }
//   ]
// }`)
      console.log("[Pattern] intent done, sections:", intentResult.sections.length)
      console.log("[Pattern] intent output:", JSON.stringify(intentResult, null, 2))

      // ── Step 2: proto_intent_audit → 审核（最多重试 2 次）──
      setPhase("audit")
      let currentIntent = intentResult
      // for (let attempt = 0; attempt < 2; attempt++) {
      //   debugger
      //   const audit = await runProtoIntentAudit({
      //     ...ctx,
      //     input: { userRequest: text, blueprint: JSON.stringify(currentIntent) },
      //   })
      //   console.log("[Pattern] audit:", audit.isPass, audit.feedback.slice(0, 80))
      //   console.log("[Pattern] audit output:", JSON.stringify(audit, null, 2))
      //   if (audit.isPass) break
      //   debugger
      //   currentIntent = await runProtoIntent({
      //     ...ctx,
      //     input: { userRequest: text, previousBlueprint: currentIntent, auditFeedback: audit.feedback },
      //   })
      //   console.log("[Pattern] intent retry", attempt + 1)
      // }

      // ── Step 3: proto_planner_create → 生成布局 + slots ──
      setPhase("planner")
      debugger
      const planner = JSON.parse(`{
  "rootId": "rootCardDashboard",
  "elements": [
    {
      "id": "rootCardDashboard",
      "component": "div",
      "props": {
        "className": "flex flex-col min-h-screen bg-surface-container-lowest"
      },
      "children": [
        "pageHeaderSection",
        "mainContentArea"
      ]
    },
    {
      "id": "pageHeaderSection",
      "component": "header",
      "props": {
        "className": "bg-surface-container-highest shadow-sm"
      },
      "children": []
    },
    {
      "id": "mainContentArea",
      "component": "main",
      "props": {
        "className": "flex-1 flex flex-col gap-section p-page"
      },
      "children": [
        "metricsCardsSection",
        "mixedCardGridSection"
      ]
    },
    {
      "id": "metricsCardsSection",
      "component": "section",
      "props": {
        "className": "flex flex-row gap-gutter"
      },
      "children": []
    },
    {
      "id": "mixedCardGridSection",
      "component": "section",
      "props": {
        "className": "grid grid-cols-3 gap-gutter"
      },
      "children": []
    }
  ],
  "slots": [
    {
      "section_id": "pageHeader",
      "element_id": "pageHeaderSection",
      "id_prefix": "pgHdr"
    },
    {
      "section_id": "metricsCards",
      "element_id": "metricsCardsSection",
      "id_prefix": "metCd"
    },
    {
      "section_id": "mixedCardGrid",
      "element_id": "mixedCardGridSection",
      "id_prefix": "mixGd"
    }
      ]}`)
      // const planner = await runProtoPlannerCreate({
      //   ...ctx,
      //   input: { blueprint: currentIntent as unknown as Record<string, unknown> },
      // })
      console.log("[Pattern] planner done, slots:", planner.slots.length)
      console.log("[Pattern] planner output:", JSON.stringify(planner, null, 2))

      const plannerJson = detectA2UIJson(JSON.stringify(planner))
      // if (plannerJson) sendToPreview(plannerJson)

      // ── Step 4: proto_module_create → 逐模块生成 A2UI JSON ──
      setPhase("module")
      const modules: Array<{ rootId: string; elements: Array<{ id: string; component: string; props?: Record<string, unknown>; children?: string[] }>; state?: Record<string, unknown> }> = []
      // for (const slot of planner.slots) {
      //   console.log("[Pattern] module_create:", slot.section_id)
      //   debugger
      //   const moduleResult = await runProtoModuleCreate({
      //     ...ctx,
      //     input: {
      //       intentDescription: currentIntent,
      //       layoutPlanner: planner as unknown as Record<string, unknown>,
      //       sectionId: slot.section_id,
      //       elementId: slot.element_id,
      //       idPrefix: slot.id_prefix,
      //     },
      //   })
      //   console.log("[Pattern] module_create output [" + slot.section_id + "]:", JSON.stringify(moduleResult.uiJson, null, 2))
      //   console.log(JSON.stringify(moduleResult, null, 2))
      //   modules.push(moduleResult.uiJson as typeof modules[number])
      // }
      for (let i = 0; i < planner.slots.length; i++) {
        const slot = planner.slots[i]
        const mod = await import(`./slot${i + 1}.json`)
        const uiJson = mod.default.rootId && mod.default.elements ? mod.default : mod.default.uiJson
        if (uiJson.rootId !== slot.element_id) {
          const target = (uiJson.elements as Array<{ id: string }>)?.find((e) => e.id === uiJson.rootId)
          if (target) {
            target.id = slot.element_id
            uiJson.rootId = slot.element_id
          }
        }
        modules.push(uiJson)
      }
      const merged = mergeModules(
        { rootId: planner.rootId, elements: planner.elements },
        modules,
      )
      console.log("[Pattern] ========== MERGED A2UI JSON ==========")
      console.log(JSON.stringify(merged, null, 2))
      const mergedJson = detectA2UIJson(JSON.stringify(merged))
      if (mergedJson) sendToPreview(mergedJson)

      setPhase("idle")
      console.log("结束---------------")
    } catch (err: unknown) {
      if (err instanceof Error && err.message === "aborted") return
      console.error("[PatternPage] handleSubmit failed", err)
      setPhase("idle")
    } finally {
      if (!submitSessionId || params.id === submitSessionId) {
        setSending(false)
      }
    }
  }

  async function halt() {
    const sid = params.id
    if (!sid) return
    await sdk.client.session.abort({ sessionID: sid }).catch(() => {})
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      void handleSubmit()
    }
  }

  let fileInputRef!: HTMLInputElement

  function addAttachments(files: File[]) {
    const slots = 5 - attachments().length
    const toAdd = files.slice(0, slots)
    for (const file of toAdd) {
      const reader = new FileReader()
      reader.onload = (ev) => {
        const dataUrl = ev.target?.result as string
        setAttachments((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            filename: file.name,
            mime: file.type || "application/octet-stream",
            dataUrl,
          },
        ])
      }
      reader.readAsDataURL(file)
    }
  }

  function removeAttachment(id: string) {
    setAttachments((prev) => prev.filter((a) => a.id !== id))
  }

  function handleFileInputChange(e: Event) {
    const input = e.currentTarget as HTMLInputElement
    if (input.files?.length) {
      addAttachments(Array.from(input.files))
      input.value = ""
    }
  }

  function handleDragOver(e: DragEvent) {
    e.preventDefault()
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy"
    setIsDragOver(true)
  }

  function handleDragLeave() {
    setIsDragOver(false)
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault()
    setIsDragOver(false)
    const files = Array.from(e.dataTransfer?.files ?? [])
    if (files.length > 0) addAttachments(files)
  }

  function handleOpenResult(card: OutputCard) {
    const doc = detectA2UIJson(card.content)
    if (doc) sendToPreview(doc)
  }

  const inputDisabled = () => sending() || isBusy() || !activeModelKey()
  const maxAttachments = () => attachments().length >= 5

  const inputBox = (rows: number | undefined) => (
    <div
      class="rounded-[16px] transition-all duration-300 relative group"
      style={{
        border: "1px solid transparent",
        background: `
          linear-gradient(var(--octo-surface-page), var(--octo-surface-page)) padding-box,
          linear-gradient(135deg,
            rgba(0, 103, 209, 0.7) 1%,
            rgba(46, 134, 222, 0.7) 22%,
            rgba(0, 103, 209, 0.7) 54%,
            rgba(0, 78, 168, 0.7) 87%,
            rgba(0, 103, 209, 0.7) 92%) border-box`,
        "box-shadow": "0 0 5px rgba(0, 0, 0, 0.08), 0 0 10px rgba(0, 103, 209, 0.18), 0 0 20px rgba(0, 78, 168, 0.12)",
        "margin-top": attachments().length > 0 ? "6px" : "0",
        ...(rows === undefined ? { height: "150px" } : {}),
      }}
    >
      <textarea
        value={prompt()}
        onInput={(e) => setPrompt(e.currentTarget.value)}
        onKeyDown={handleKeyDown}
        placeholder="描述你想要的界面，按 Enter 生成 A2UI JSON…"
        rows={rows}
        disabled={inputDisabled()}
        class="w-full resize-none bg-transparent text-14-regular text-text-strong outline-none relative z-10 p-4"
        style={{
          "font-family": "var(--octo-font)",
          ...(rows === undefined ? { flex: "1", "max-height": "none", "overflow-y": "auto" } : { "max-height": "120px", "overflow-y": "auto" }),
        }}
      />
      <div class="flex items-center justify-between px-4 pb-4 relative z-10 overflow-hidden">
        <div class="flex items-center gap-1 min-w-0">
          <DesignSystemPicker
            selected={selectedDesignSystem()}
            onSelect={setSelectedDesignSystem}
          />
          <input
            ref={fileInputRef!}
            type="file"
            multiple
            class="hidden"
            accept="*/*"
            onChange={handleFileInputChange}
          />
          <button
            type="button"
            onClick={() => { if (!maxAttachments()) fileInputRef.click() }}
            disabled={maxAttachments()}
            class="flex flex-shrink-0 items-center justify-center size-8 rounded-full transition-colors hover:bg-black/5 active:bg-black/10 text-gray-800 hover:text-black disabled:text-gray-400"
            title={maxAttachments() ? "最多 5 个文件" : "添加附件"}
          >
            <Icon name="plus" class="size-5" />
          </button>
          <ModelSelectorPopover
            model={local.model}
            triggerAs="button"
            triggerProps={{
              class: "flex items-center gap-1.5 min-w-0 bg-[#f3f3f3] hover:bg-[#e8e8e8] active:bg-[#dedede] transition-colors px-3 py-1.5 rounded-full text-[13px] text-gray-800 font-medium group overflow-hidden focus-visible:outline-none",
              "data-action": "prompt-model",
            }}
          >
            <span class="truncate">
              {currentModel()?.name ?? "选择模型"}
            </span>
            <Icon name="chevron-down" class="size-3.5 shrink-0 transition-transform duration-150 group-aria-[expanded=true]:-rotate-180" style="color: #000" />
          </ModelSelectorPopover>
        </div>
        <IconButton
          data-action="prompt-submit"
          type="submit"
          icon={isBusy() ? "stop" : "arrow-up"}
          class="size-8 flex-shrink-0"
          onClick={isBusy() ? () => void halt() : () => void handleSubmit()}
          disabled={!isBusy() && (!prompt().trim() || inputDisabled())}
          aria-label={isBusy() ? "停止生成" : undefined}
        />
      </div>
    </div>
  )

  return (
    <DataProvider data={sync.data} directory={sdk.directory || ""}>
      <Toast.Region />
      <div
        class="octo-split bg-background-base"
        data-focus={focusMode() ? "true" : undefined}
        style={{
          "grid-template-columns": !focusMode()
            ? hasContent()
              ? `${chatWidth()}px 8px minmax(400px, 1fr)`
              : "1fr"
            : undefined,
        }}
      >
        <Show when={!focusMode()}>
          <div
            class="flex flex-col overflow-hidden"
            style={{
              background: isDragOver() ? "var(--octo-brand-a3)" : "#fff",
              outline: isDragOver() ? "inset 0 0 0 2px var(--octo-brand-a25)" : "none",
            }}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <Show when={hasContent()}>
              <div
                class="shrink-0 flex items-center justify-between"
                style={{ padding: "12px 24px", background: "#fff" }}
              >
                <div class="flex items-center gap-2 min-w-0 flex-1 pr-3">
                  <Show when={isBusy()}>
                    <div class="shrink-0">
                      <Spinner class="size-4" />
                    </div>
                  </Show>
                  <Show
                    when={!titleState.editing}
                    fallback={
                      <InlineInput
                        ref={(el) => { titleRef = el }}
                        value={titleState.draft}
                        class="text-14-medium text-text-strong grow-1 min-w-0 rounded-[6px] pl-1 -ml-1"
                        onInput={(e) => setTitleState("draft", e.currentTarget.value)}
                        onKeyDown={(e) => {
                          e.stopPropagation()
                          if (e.key === "Enter") { e.preventDefault(); void saveTitleEditor() }
                          if (e.key === "Escape") { e.preventDefault(); setTitleState("editing", false) }
                        }}
                        onBlur={() => void saveTitleEditor()}
                      />
                    }
                  >
                    <h1
                      class="truncate min-w-0"
                      style={{ "font-size": "14px", "line-height": "22px", "font-weight": "600", color: "#191919" }}
                      onDblClick={openTitleEditor}
                    >
                      {sessionTitle(sessionInfo()?.title) ?? "Pattern"}
                    </h1>
                  </Show>
                </div>
                <DropdownMenu
                  gutter={4}
                  placement="bottom-end"
                  open={titleState.menuOpen}
                  onOpenChange={(open) => setTitleState("menuOpen", open)}
                >
                  <DropdownMenu.Trigger
                    as={IconButton}
                    icon="dot-grid"
                    variant="ghost"
                    class="size-6 rounded-md data-[expanded]:bg-surface-base-active"
                    aria-label={language.t("common.moreOptions")}
                  />
                  <DropdownMenu.Portal>
                    <DropdownMenu.Content style={{ "min-width": "104px" }}>
                      <DropdownMenu.Item onSelect={() => { setTitleState("menuOpen", false); openTitleEditor() }}>
                        <DropdownMenu.ItemLabel>{language.t("common.rename")}</DropdownMenu.ItemLabel>
                      </DropdownMenu.Item>
                      <DropdownMenu.Separator />
                      <DropdownMenu.Item onSelect={handleDeleteSession}>
                        <DropdownMenu.ItemLabel>{language.t("common.delete")}</DropdownMenu.ItemLabel>
                      </DropdownMenu.Item>
                    </DropdownMenu.Content>
                  </DropdownMenu.Portal>
                </DropdownMenu>
              </div>
            </Show>

            <Show when={hasContent()} fallback={
              <div class="flex-1 flex flex-col items-center justify-center min-h-0">
                <ChatEmptyState />
                <div class="w-full max-w-[800px] px-8">
                  <AttachmentBar attachments={attachments()} onRemove={removeAttachment} />
                  {inputBox(undefined)}
                </div>
              </div>
            }>
              <ScrollView
                class="flex-1 min-h-0"
                style={{ background: "#fff" }}
                viewportRef={autoScroll.scrollRef}
                onScroll={autoScroll.handleScroll}
                onMouseUp={autoScroll.handleInteraction}
              >
                <div ref={autoScroll.contentRef} class="py-3 flex flex-col gap-0">
                  <For each={userMessages()}>
                    {(msg) => (
                      <InsightTurn
                        sessionID={params.id!}
                        messageID={msg.id}
                        status={sessionStatus()}
                        active={isBusy()}
                        onOpenResult={handleOpenResult}
                      />
                    )}
                  </For>
                </div>
              </ScrollView>

              <div class="shrink-0" style={{ padding: "24px", background: "#fff" }}>
                <AttachmentBar attachments={attachments()} onRemove={removeAttachment} />
                {inputBox(3)}
              </div>
            </Show>
          </div>
        </Show>

        <Show when={hasContent() && !focusMode()}>
          <div class="octo-split-handle" onMouseDown={handleDividerMouseDown} />
        </Show>

        <Show when={hasContent()}>
          <div ref={bindPreviewPaneRef} class="flex flex-col overflow-hidden" style="position:relative">
            <div class="absolute right-[12px] top-[12px] flex gap-[6px]" style={{ "z-index": 10 }}>
              <button
                class="preview-action-btn"
                title="历史版本"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="16" height="16">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </button>
              <button
                class="preview-action-btn"
                title="刷新"
                onClick={() => { if (previewIframeRef) previewIframeRef.src = "http://127.0.0.1:8989" }}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="16" height="16">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>
              <button
                class="preview-action-btn"
                title="全屏"
                onClick={() => {
                  if (previewPaneRef?.requestFullscreen) previewPaneRef.requestFullscreen()
                }}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="16" height="16">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                </svg>
              </button>
            </div>
            <div style={{ flex: "1", "min-height": "0", overflow: "hidden", display: "flex", "justify-content": "center", "align-items": "center", padding: "20px", position: "relative" }}>
              <div class="preview-iframe-wrapper" style={{ width: `${TARGET_WIDTH}px`, height: `${TARGET_HEIGHT}px`, transform: `scale(${previewScale()})` }}>
                <iframe
                  ref={(el) => { previewIframeRef = el }}
                  src="http://127.0.0.1:8989"
                />
              </div>
            </div>
          </div>
        </Show>
      </div>
    </DataProvider>
  )
}

function ChatEmptyState(): JSX.Element {
  return (
    <div class="flex flex-col items-center gap-4 text-center pb-8 px-6">
      <svg width="80" height="80" viewBox="0 0 80 80" fill="none">
        <rect x="8" y="8" width="64" height="64" rx="16" stroke="var(--octo-brand-a40)" stroke-width="2" fill="none" />
        <rect x="20" y="20" width="16" height="16" rx="4" fill="var(--octo-brand-a20)" />
        <rect x="44" y="20" width="16" height="16" rx="4" fill="var(--octo-brand-a20)" />
        <rect x="20" y="44" width="16" height="16" rx="4" fill="var(--octo-brand-a20)" />
        <rect x="44" y="44" width="16" height="16" rx="4" fill="var(--octo-brand-a20)" />
      </svg>
      <div class="flex flex-col items-center gap-2">
        <div style={{ color: "#191919", "font-size": "24px", "font-weight": "600", "line-height": "36px" }}>Octo Pattern</div>
        <div style={{ color: "#6e737a", "font-size": "14px", "line-height": "20px" }}>
          描述界面需求，生成 A2UI JSON
        </div>
      </div>
    </div>
  )
}

function PatternDialogDeleteSession(props: { sessionID: string; name: string; onDelete: (id: string) => Promise<void> }): JSX.Element {
  const language = useLanguage()
  const dialog = useDialog()
  return (
    <Dialog title={language.t("session.delete.title")} fit>
      <div class="flex flex-col gap-4 pl-6 pr-2.5 pb-3">
        <span class="text-14-regular text-text-strong">
          {language.t("session.delete.confirm", { name: props.name })}
        </span>
        <div class="flex justify-end gap-2">
          <Button variant="ghost" size="large" onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            size="large"
            onClick={() => void props.onDelete(props.sessionID).then(() => dialog.close())}
          >
            {language.t("session.delete.button")}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}


import { createMemo, createSignal, createEffect, on, Show, Switch, Match, For } from "solid-js"
import type { JSX } from "solid-js"
import { Markdown } from "@opencode-ai/ui/markdown"
import { showToast } from "@opencode-ai/ui/toast"
import type { ResultTab } from "./tab-store"
import type { ViewportPreset, PaletteId, InspectTarget } from "./html-renderer"
import type { VersionEntry } from "../../utils/history-store"
import { TabBar } from "./tab-bar"
import { ActionBar } from "./action-bar"
import { TableRenderer } from "./table-renderer"
import { HtmlRenderer } from "./html-renderer"
import { DeckRenderer } from "./deck-renderer"
import { SvgRenderer } from "./svg-renderer"
import { ReactComponentRenderer } from "./react-component-renderer"
import { DiagramRenderer } from "./diagram-renderer"
import { ImageRenderer } from "./image-renderer"
import { VideoRenderer } from "./video-renderer"
import { AudioRenderer } from "./audio-renderer"
import { PdfRenderer } from "./pdf-renderer"
import { TextRenderer } from "./text-renderer"
import { DesignPlanRenderer } from "./design-plan-renderer"
import { StrategyFormRenderer } from "./strategy-form-renderer"
import { PrototypeCtxMenu } from "./prototype-ctx-menu"
import { PrototypePropertyEditor } from "./prototype-property-editor"
import type { StrategyFormData } from "../../utils/strategy-form-scanner"
import { IllustrationResultEmpty } from "../../icons/illustrations"
import { annotateElementsWithIds } from "../../utils/srcdoc-builder"
import { DesignFilesPanel } from "../design-files"
import { useGlobalSDK } from "@/context/global-sdk"
import { artifactFileToOutputCard, type ArtifactFile, getArtifactRelativePath } from "../../utils/artifact-file-api"
import { saveArtifactContent } from "../../utils/artifact-auto-save"
import type { OutputCard } from "../insight-turn"
import { tracker } from "@/utils/tracker"
import { createC2DZip } from "../../utils/canvas-to-design"
import { usePixsoTransport } from "@/utils/useZipTransport"
import { getDesktopApi } from "../../lib/electron-api"
import { useFeatureMutex } from "../../utils/use-feature-mutex"
import { getSubtypeHandler } from "../../utils/subtype-registry"
import type { LocalEditSavePayload } from "../../subtype-handlers/types"
import { disposeAllPrototypeSessions } from "../../utils/prototype-utils"

function extractCodeBlock(text: string, lang: string): string {
  const re = new RegExp("```" + lang + "\\s*\\n([\\s\\S]*?)\\n?```", "i")
  const m = text.match(re)
  return m ? m[1].trim() : text.trim()
}

function JsonRenderer(props: { content: string }): JSX.Element {
  const code = createMemo(() => {
    const raw = extractCodeBlock(props.content, "json")
    try {
      return JSON.stringify(JSON.parse(raw), null, 2)
    } catch {
      return raw
    }
  })
  return (
    <div class="p-4 h-full overflow-auto">
      <pre
        class="text-sm text-[var(--octo-text-primary)] p-4 rounded-lg overflow-auto"
        style={{ background: "rgba(243,244,246,1)", "font-family": "monospace" }}
      >
        {code()}
      </pre>
    </div>
  )
}

function MarkdownRenderer(props: { content: string }): JSX.Element {
  return (
    <div class="p-4 h-full overflow-auto prose prose-sm max-w-none">
      <Markdown text={props.content} />
    </div>
  )
}

export function ResultViewer(props: {
  tabs: ResultTab[]
  activeId: string | null
  onActivate: (id: string) => void
  onClose: (id: string) => void
  onContentChange?: (id: string, content: string) => Promise<void>
  sessionId?: string
  onOpenArtifact?: (card: OutputCard) => void
  viewMode: "tabs" | "files" | "plan"
  onViewModeChange: (mode: "tabs" | "files" | "plan") => void
  onAddArtifactToSession?: (file: ArtifactFile) => void
  onRemoveAttachmentsByPath?: (paths: string[]) => void
  onRenameTabByPath?: (oldPath: string, newPath: string, newTitle: string) => void
  onRenameAttachmentPath?: (oldPath: string, newPath: string, newFilename: string) => void
  sdkDirectory?: string
  focusMode?: boolean
  onFocusModeToggle?: () => void
  onHistoryToggle?: () => void
  historyActive?: boolean
  historyEntries?: VersionEntry[]
  currentVersionId?: string | null
  onModeChange?: (mode: "preview" | "edit") => void
  onHistorySwitch?: (entry: VersionEntry) => void
  onConfirmPlan?: (identifier?: string) => void
  onAdjustPlan?: () => void
  isPlanConfirmed?: () => boolean
  filesRefreshKey?: number
  onFilesRefresh?: () => void
  /** 设计规划内容 (plan 模式使用) */
  planCard?: OutputCard | null
  /** 两步走工作流：当前阶段 */
  planPhase?: "strategy" | "generate"
  /** 策略表单数据 */
  strategyFormData?: StrategyFormData
  /** 策略表单字段变更回调 */
  onStrategyFieldChange?: (field: keyof StrategyFormData, value: string) => void
  /** 策略生成按钮回调 */
  onGenerateStrategy?: () => void
  /** 返回策略准备阶段回调 */
  onBackToStrategy?: () => void
  /** 策略是否正在生成中 */
  isGenerating?: boolean
  /** 确认后等待主 agent 响应的过渡状态 */
  planConfirmPending?: boolean
  /** 子 agent 最终确认状态（基于 childSessionIDs 消息流扫描） */
  childPlanConfirmed?: boolean
  /** 右侧面板抽屉展开时,头部右侧收起按钮回调 */
  onCollapseDrawer?: () => void
  /** 子 session 的 session_status（用于检测子 agent 是否已完成但未输出有效 plan） */
  childSessionStatus?: { type: string }
  /** 子 session 是否正在生成中（模型输出期间禁用按钮和表单） */
  childBusy?: boolean
  /** 设计规划是否已结束（退出或确认），plan 视图只读 */
  planEnded?: boolean
  /** 设计规划流程是否活跃（即使 plan artifact 尚未生成） */
  planActive?: boolean
}): JSX.Element {
  const globalSDK = useGlobalSDK()
  const activeTab = createMemo(() =>
    props.tabs.find((t) => t.id === props.activeId) ?? null
  )

  /**
   * 取设计规划的实际内容（优先 tabStore 中该 plan tab 的最新编辑，
   * 回退到消息流扫描的 planCard）。编辑走 handleContentChange 会更新
   * tabStore，再点 [预览] 时若不读 tabStore，编辑会丢失。
   */
  const planContent = createMemo(() => {
    const plan = props.planCard
    if (!plan?.id) return ""
    const tab = props.tabs.find((t) => t.id === plan.id)
    return tab ? tab.content : (plan.content ?? "")
  })

  /**
   * 当前激活的 plan tab（编辑态时优先用它在 tabStore 中的最新内容）。
   * 用于 tab 栏点击 design-plan tab 后切换到 tabs 模式渲染，保证编辑不被回退。
   */
  const activePlanTab = createMemo(() => {
    const tab = activeTab()
    if (tab?.type === "design-plan") return tab
    return null
  })

  const [htmlModes, setHtmlModes] = createSignal<Record<string, "preview" | "edit">>({})
  const [viewport, setViewport] = createSignal<ViewportPreset>("desktop")
  const [palette, setPalette] = createSignal<PaletteId | null>(null)
  const featureMutex = useFeatureMutex()
  createEffect(on(() => props.activeId, () => {
    disposeAllPrototypeSessions()
    featureMutex.disableAll()
  }, { defer: true }))
  const [inspectTarget, setInspectTarget] = createSignal<InspectTarget | null>(null)
  const [refreshKey, setRefreshKey] = createSignal(0)
  // 当前 HTML tab 已加载的资源 URL getter（由 HtmlRenderer 注册）
  let observedUrlsGetter: (() => string[]) | null = null
  // 向当前 HTML tab 的 iframe contentWindow 发送 postMessage 的函数（由 HtmlRenderer 注册）
  let iframePostMessage: ((data: unknown) => void) | null = null
  // 当前 HTML tab 的 iframe 元素 getter（由 HtmlRenderer 注册，用于坐标换算/source 匹配）
  let iframeElementGetter: (() => HTMLIFrameElement | undefined) | null = null
  const combinedRefreshKey = createMemo(() => refreshKey() + (props.filesRefreshKey ?? 0))

  const handleViewportChange = (vp: ViewportPreset) => {
    tracker.interaction({ module: "design", name: "change-viewport", extend: JSON.stringify({ viewport: vp }) })
    setViewport(vp)
    featureMutex.disableAll()
  }

  const handleCanvasToDesign = async () => {
    tracker.interaction({ module: "design", name: "canvas-to-design" })
    try {
      const tab = activeTab()
      if (!tab || tab.type !== "html") {
        showToast({ title: "请先打开HTML文件" })
        return
      }

      const handler = getSubtypeHandler(tab.subtype)
      const ctx = buildSubtypeCtx()!

      if (handler?.handleCanvasEdit) {
        const handled = await handler.handleCanvasEdit(ctx)
        if (handled === true) return
      }

      const isLoggedIn = !!localStorage.getItem('uiplusToken')

      if (!isLoggedIn) {
        showToast({ title: "生成ZIP文件..." })
        const htmlContent = extractCodeBlock(tab.content, "html")
        const zipBlob = await createC2DZip({
          htmlContent,
          htmlFilePath: tab.filePath || "",
          tabTitle: tab.title,
          observedUrls: observedUrlsGetter?.() || [],
        })
        const fileName = `${tab.title}-c2d.zip`
        const url = URL.createObjectURL(zipBlob)
        const a = document.createElement("a")
        a.href = url
        a.download = fileName
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
        showToast({ title: "生成完成", description: "ZIP文件已下载" })
        return
      }

      const result = usePixsoTransport({
        getZip: async () => {
          showToast({ title: "生成ZIP文件..." })
          const htmlContent = extractCodeBlock(tab.content, "html")
          return await createC2DZip({
            htmlContent,
            htmlFilePath: tab.filePath || "",
            tabTitle: tab.title,
            observedUrls: observedUrlsGetter?.() || [],
          })
        },
        downloadHtml: async (data) => {
          const api = getDesktopApi()
          const baseDir = props.sdkDirectory
          const sessionId = tab.sessionId || props.sessionId
          
          if (!baseDir || !sessionId || !api?.writeFileBuffer) {
            showToast({ title: "无法保存文件", variant: "error" })
            return
          }
          
          const uploadsDir = `${baseDir}/.octo/${sessionId}/uploads`
          let finalFilename = data.filename
          
          if (api.fileExists) {
            let counter = 0
            const baseName = data.filename.replace(/\.html$/i, '')
            while (await api.fileExists(`${uploadsDir}/${finalFilename}`)) {
              counter++
              finalFilename = `${baseName}(${counter}).html`
            }
          }
          
          const buffer = Uint8Array.from(atob(data.base64), c => c.charCodeAt(0))
          await api.writeFileBuffer(`${uploadsDir}/${finalFilename}`, buffer.buffer)
          showToast({ title: "已保存", description: finalFilename })
        },
        config: {
          designName: tab.title,
          sessionId: tab.sessionId || props.sessionId || "",
        },
      })

      console.log('pixso result', result)
    } catch (error) {
      console.error("[handleCanvasToDesign] Error:", error)
      showToast({ title: "操作失败", description: String(error) })
    }
  }

  const buildSubtypeCtx = () => {
    const tab = activeTab()
    if (!tab) return null
    return {
      tab,
      sessionId: tab.sessionId ?? props.sessionId,
      showToast,
      tracker,
      getDesktopApi,
      extractCodeBlock,
      observedUrlsGetter: observedUrlsGetter ? () => observedUrlsGetter!() : undefined,
      usePixsoTransport,
      postMessageToIframe: iframePostMessage ? (data: unknown) => iframePostMessage!(data) : undefined,
      iframeElementGetter: iframeElementGetter ? () => iframeElementGetter!() : undefined,
      sdkDirectory: props.sdkDirectory,
    }
  }

  createEffect(on(() => featureMutex.state.editing, (editing, prev) => {
    if (prev && !editing) {
      const ctx = buildSubtypeCtx()
      const handler = ctx && getSubtypeHandler(ctx.tab.subtype)
      if (handler?.handleLocalEditDisable) void handler.handleLocalEditDisable(ctx!)
    }
  }))

  const handleLocalEditToggle = async () => {
    const ctx = buildSubtypeCtx()
    if (!ctx) return
    const handler = getSubtypeHandler(ctx.tab.subtype)
    if (handler?.handleLocalEdit) {
      const handled = await handler.handleLocalEdit(ctx)
      if (handled === true) return
    }
    const nextEditing = !featureMutex.state.editing
    featureMutex.toggleFeature('editing')
    tracker.interaction({ module: "design", name: "toggle-edit-mode", extend: JSON.stringify({ action: nextEditing ? "open" : "close" }) })
  }

  const handleDrawToggle = async () => {
    const ctx = buildSubtypeCtx()
    if (!ctx) return
    const handler = getSubtypeHandler(ctx.tab.subtype)
    if (handler?.handleDrawEdit) {
      const handled = await handler.handleDrawEdit(ctx)
      if (handled === true) return
    }
    const nextDrawing = !featureMutex.state.drawing
    featureMutex.toggleFeature('drawing')
    tracker.interaction({ module: "design", name: "toggle-draw-mode", extend: JSON.stringify({ action: nextDrawing ? "open" : "close" }) })
  }

  const handleCommentToggle = async () => {
    const ctx = buildSubtypeCtx()
    if (!ctx) return
    const handler = getSubtypeHandler(ctx.tab.subtype)
    if (handler?.handleComment) {
      const handled = await handler.handleComment(ctx)
      if (handled === true) return
    }
    const nextCommenting = !featureMutex.state.commenting
    featureMutex.toggleFeature('commenting')
    tracker.interaction({ module: "design", name: "toggle-comment-mode", extend: JSON.stringify({ action: nextCommenting ? "open" : "close" }) })
  }

  const handleArchiveToggle = async () => {
    const ctx = buildSubtypeCtx()
    if (!ctx) return
    const handler = getSubtypeHandler(ctx.tab.subtype)
    if (handler?.handleArchive) {
      const handled = await handler.handleArchive(ctx)
      if (handled === true) return
    }
    const nextArchiving = !featureMutex.state.archiving
    featureMutex.toggleFeature('archiving')
    tracker.interaction({ module: "design", name: "toggle-archive-mode", extend: JSON.stringify({ action: nextArchiving ? "open" : "close" }) })
  }

  const handleLocalEditSave = async (payload: LocalEditSavePayload): Promise<boolean> => {
    const tab = activeTab()
    if (!tab) {
      return false
    }

    const handler = getSubtypeHandler(tab.subtype)
    if (!handler?.handleLocalEditSave) {
      return false
    }

    const ctx = {
      tab,
      showToast,
      tracker,
      getDesktopApi,
      extractCodeBlock,
      usePixsoTransport,
      edit: payload,
    }

    const handled = await handler.handleLocalEditSave(ctx)
    return handled === true
  }

  const getHtmlMode = (id: string) => htmlModes()[id] ?? "preview"

  const toggleHtmlMode = (id: string) => {
    const current = getHtmlMode(id)
    const nextMode = current === "preview" ? "edit" : "preview"
    tracker.interaction({ module: "design", name: "toggle-preview-source", extend: JSON.stringify({ mode: nextMode }) })
    setHtmlModes((prev) => ({ ...prev, [id]: nextMode }))
    if (nextMode === "edit") {
      featureMutex.disableAll()
    }
    props.onModeChange?.(nextMode)
  }

  const canToggleMode = (tab: ResultTab) => tab.type === "html"

  createEffect(() => {
    const activeTabIds = new Set(props.tabs.map(t => t.id))
    const currentModes = htmlModes()
    const cleanedModes: Record<string, "preview" | "edit"> = {}
    
    for (const [id, mode] of Object.entries(currentModes)) {
      if (activeTabIds.has(id)) {
        cleanedModes[id] = mode
      }
    }
    
    if (Object.keys(currentModes).length !== Object.keys(cleanedModes).length) {
      setHtmlModes(cleanedModes)
    }
  })

  const handleRefresh = () => {
    tracker.interaction({ module: "design", name: "refresh-preview" })
    setRefreshKey((prev) => prev + 1)
  }

  const handleFocusModeToggle = () => {
    tracker.interaction({ module: "design", name: "toggle-focus-mode", extend: JSON.stringify({ action: props.focusMode ? "close" : "open" }) })
    props.onFocusModeToggle?.()
  }

const applyInspectOverrides = async (tabId: string, overrides: Array<{ elementId: string; prop: string; value: string }>) => {
    const tab = props.tabs.find(t => t.id === tabId)
    if (!tab || overrides.length === 0) return

    const rawContent = tab.content
    const htmlContent = extractCodeBlock(rawContent, "html")
    const isMarkdown = rawContent.includes("```html")

    const annotatedHtml = annotateElementsWithIds(htmlContent)

    const parser = new DOMParser()
    const doc = parser.parseFromString(annotatedHtml, "text/html")

    for (const { elementId, prop, value } of overrides) {
      const el = doc.querySelector(`[data-od-id="${elementId}"]`)
      if (el && el instanceof HTMLElement) {
        el.style.setProperty(prop, value, "important")
      }
    }

    const isFullDocument = htmlContent.includes("<html") || htmlContent.includes("<body")
    const updatedHtml = isFullDocument
      ? doc.documentElement.outerHTML
      : doc.body.innerHTML

    const cleanHtml = updatedHtml.replace(/ data-od-id="[^"]*"/g, '')

    const finalContent = isMarkdown
      ? "```html\n" + cleanHtml + "\n```"
      : cleanHtml

    await props.onContentChange?.(tabId, finalContent)
  }

  const handleOpenArtifactFile = (file: ArtifactFile) => {
    const card = artifactFileToOutputCard(file)
    props.onOpenArtifact?.(card)
    // file 类型不支持预览,handleOpenResult 会弹窗提示,不打开 tab。
    // 这里不能切到 tabs 模式,否则右侧会显示空 ResultViewer("对话产出将在这里展示")。
    if (card.type !== "file") {
      props.onViewModeChange("tabs")
    }
  }

  const handleCloseTabsByPath = (paths: string[]) => {
    const normalizedPaths = paths.map(p => p.replace(/\\/g, "/"))
    const pathSet = new Set(normalizedPaths)
    
    for (const tab of props.tabs) {
      const normalizedAbsolute = tab.absoluteFilePath?.replace(/\\/g, "/")
      if (normalizedAbsolute && pathSet.has(normalizedAbsolute)) {
        props.onClose(tab.id)
        continue
      }
      
      const normalizedFile = tab.filePath?.replace(/\\/g, "/")
      if (normalizedFile && pathSet.has(normalizedFile)) {
        props.onClose(tab.id)
      }
    }
  }

  return (
    <div
      class="flex flex-col flex-1 min-w-0 min-h-0"
      style={{ background: "var(--octo-surface-result)" }}
    >
      <Show when={props.tabs.length > 0 || props.viewMode === "files" || props.viewMode === "plan"} fallback={<ResultViewerEmpty />}>
        <TabBar
          tabs={props.tabs}
          activeId={props.activeId}
          onActivate={props.onActivate}
          onClose={props.onClose}
          viewMode={props.viewMode}
          onViewModeChange={props.sessionId ? props.onViewModeChange : undefined}
          showPlanEntry={!!props.planCard}
          planActive={props.planActive}
          planConfirmed={props.isPlanConfirmed?.()}
          planEnded={props.planEnded}
          onCollapseDrawer={props.onCollapseDrawer}
        />

        <Show when={props.sessionId}>
          {(sid) => (
            <div
              class="flex flex-col flex-1 min-h-0"
              style={{ display: props.viewMode === "files" ? "flex" : "none" }}
            >
              <DesignFilesPanel
                sessionId={sid()}
                refreshKey={props.filesRefreshKey ?? 0}
                onOpenFile={handleOpenArtifactFile}
                onAddToSession={props.onAddArtifactToSession}
                onCloseTabsByPath={handleCloseTabsByPath}
                onRemoveAttachmentsByPath={props.onRemoveAttachmentsByPath}
                onFilesRefresh={props.onFilesRefresh}
              />
            </div>
          )}
        </Show>

        {/* plan 模式 — 已退出/已结束，只读显示 plan 内容 */}
        <Show when={props.viewMode === "plan" && props.planEnded && !props.planConfirmPending}>
          <Show when={props.planCard} keyed>
            {(plan) => (
              <div class="flex flex-col flex-1 min-h-0 overflow-hidden">
                <DesignPlanRenderer
                  content={plan.content}
                  title={plan.title}
                  artifactIdentifier={plan.artifactIdentifier}
                  confirmed={true}
                  disabled={true}
                  onConfirm={() => {}}
                  onContentChange={undefined}
                  onBackToStrategy={() => {}}
                  currentStep={2}
                />
              </div>
            )}
          </Show>
          <Show when={!props.planCard}>
            <div class="flex flex-col items-center justify-center flex-1 gap-3" style="background: var(--octo-surface-result);">
              <span style="color: var(--octo-text-secondary); font-size: 14px;">设计规划已结束</span>
            </div>
          </Show>
        </Show>

        {/* plan 模式 — 策略准备阶段（排除已确认和已结束状态） */}
        <Show when={props.viewMode === "plan" && props.planPhase === "strategy" && !props.childPlanConfirmed && !props.planConfirmPending && !props.planEnded}>
          <div class="flex flex-col flex-1 min-h-0 overflow-hidden">
            <StrategyFormRenderer
              formData={props.strategyFormData ?? {
                需求背景: "", 设计目标: "", 设计方法: "", 其他: "",
                用户画像: "", 用户旅程: "", 研究报告: "",
              }}
              onFieldChange={(field, value) => props.onStrategyFieldChange?.(field, value)}
              onGenerate={() => props.onGenerateStrategy?.()}
              isGenerating={props.isGenerating}
              disabled={props.childBusy}
              currentStep={1}
            />
          </div>
        </Show>

        {/* plan 模式 — 设计规划生成阶段,有 planCard 时渲染（未确认/未结束状态） */}
        <Show when={props.viewMode === "plan" && props.planPhase !== "strategy" && !props.planConfirmPending && !props.childPlanConfirmed && !props.planEnded}>
          <Show when={props.planCard}>
            <div class="flex flex-col flex-1 min-h-0 overflow-hidden">
              <DesignPlanRenderer
                content={planContent()}  // 优先取 tabStore，保留编辑
                title={props.planCard?.title ?? ""}
                artifactIdentifier={props.planCard?.artifactIdentifier}
                confirmed={props.isPlanConfirmed?.() ?? false}
                disabled={props.childBusy}
                onConfirm={() => props.onConfirmPlan?.(props.planCard?.artifactIdentifier)}
                onContentChange={(content) => {
                  if (props.onContentChange && props.planCard?.id) {
                    props.onContentChange(props.planCard.id, content)
                  }
                }}
                onBackToStrategy={() => props.onBackToStrategy?.()}
                currentStep={2}
              />
            </div>
          </Show>
        </Show>

        {/* plan 模式 — 方案已确认，等待主 agent 生成 HTML（按钮禁用状态，内容只读） */}
        <Show when={props.viewMode === "plan" && props.planConfirmPending}>
          <Show when={props.planCard} keyed>
            {(plan) => (
              <div class="flex flex-col flex-1 min-h-0 overflow-hidden">
                <DesignPlanRenderer
                  content={plan.content}
                  title={plan.title}
                  artifactIdentifier={plan.artifactIdentifier}
                  confirmed={true}
                  disabled={true}
                  onConfirm={() => {}}
                  onContentChange={undefined}
                  onBackToStrategy={() => {}}
                  currentStep={2}
                />
                <div class="flex items-center justify-center gap-2 shrink-0" style="padding: 12px 24px; border-top: 1px solid rgba(0,0,0,0.06); background: var(--octo-surface-page);">
                  <span class="i-svg-spinners-clock size-4" />
                  <span style="color: var(--octo-text-secondary); font-size: 13px;">方案已确认，正在通知主 agent 生成 HTML...</span>
                </div>
              </div>
            )}
          </Show>
          {/* planCard 尚未同步时的兜底 */}
          <Show when={!props.planCard}>
            <div class="flex flex-col items-center justify-center flex-1 gap-3" style="background: var(--octo-surface-result);">
              <div class="flex items-center gap-2">
                <span class="i-svg-spinners-clock size-5" />
                <span style="color: var(--octo-text-secondary); font-size: 14px;">方案已确认，正在生成 HTML...</span>
              </div>
            </div>
          </Show>
        </Show>

        {/* plan 模式 — 已确认的第二阶段（跨重启后/已结束），按钮禁用，内容只读 */}
        <Show when={props.viewMode === "plan" && props.childPlanConfirmed && !props.planConfirmPending}>
          <Show when={props.planCard} keyed>
            {(plan) => (
              <div class="flex flex-col flex-1 min-h-0 overflow-hidden">
                <DesignPlanRenderer
                  content={plan.content}
                  title={plan.title}
                  artifactIdentifier={plan.artifactIdentifier}
                  confirmed={true}
                  disabled={true}
                  onConfirm={() => {}}
                  onContentChange={undefined}
                  onBackToStrategy={() => {}}
                  currentStep={2}
                />
              </div>
            )}
          </Show>
        </Show>

        {/* plan 模式 — 生成阶段等待子 agent 输出 design-plan（排除已确认/已结束状态） */}
        <Show when={props.viewMode === "plan" && props.planPhase !== "strategy" && !props.planCard && !props.childPlanConfirmed && !props.planConfirmPending && !props.planEnded}>
          <Show when={props.childSessionStatus?.type === "idle" && props.childSessionStatus !== undefined}
            fallback={
              <div class="flex flex-col items-center justify-center flex-1 gap-3" style="background: var(--octo-surface-result);">
                <div class="flex items-center gap-2">
                  <span class="i-svg-spinners-clock size-5" />
                  <span style="color: var(--octo-text-secondary); font-size: 14px;">设计规划子 agent 正在生成中...</span>
                </div>
              </div>
            }>
            <div class="flex flex-col items-center justify-center flex-1 gap-3" style="background: var(--octo-surface-result);">
              <div class="flex flex-col items-center gap-2">
                <span style="color: var(--octo-text-secondary); font-size: 14px;">模型生成的策略格式异常，请重新生成</span>
                <button
                  type="button"
                  onClick={() => props.onBackToStrategy?.()}
                  class="text-[14px] font-medium rounded-[999px] transition-colors cursor-pointer"
                  style={{
                    height: "32px",
                    padding: "0 16px",
                    "line-height": "22px",
                    background: "#0a59f7",
                    color: "white",
                    border: "none",
                    "margin-top": "8px",
                  }}
                >
                  返回策略准备
                </button>
              </div>
            </div>
          </Show>
        </Show>

        <Show when={props.viewMode === "tabs"}>
          <Show when={activeTab()?.id} keyed>
            {(tabId) => {
              const tab = props.tabs.find(t => t.id === tabId)!
              const tabType = tab.type
            const canToggle = canToggleMode(tab)
            const htmlMode = createMemo(() => getHtmlMode(tabId))
            const showRefresh = true
            const showFocusToggle = tabType !== "design-plan"

            return (
              <div class="flex flex-col flex-1 min-w-0 overflow-hidden">
                <Show when={tabType !== "design-plan"}>
<ActionBar
                    tab={tab}
                    mode={canToggle ? htmlMode() : undefined}
                    onModeChange={canToggle ? () => toggleHtmlMode(tabId) : undefined}
                    viewport={viewport()}
                    onViewportChange={handleViewportChange}
                    palette={palette()}
                    onPaletteChange={setPalette}
                    editing={featureMutex.state.editing}
                    onEditToggle={htmlMode() === "edit" ? undefined : handleLocalEditToggle}
                    drawing={featureMutex.state.drawing}
                    onDrawToggle={htmlMode() === "edit" ? undefined : handleDrawToggle}
                    commenting={featureMutex.state.commenting}
                    onCommentToggle={htmlMode() === "edit" ? undefined : handleCommentToggle}
                    archiving={featureMutex.state.archiving}
                    onArchiveToggle={htmlMode() === "edit" ? undefined : handleArchiveToggle}
                     onCanvasToDesign={handleCanvasToDesign}
                     onRefresh={handleRefresh}
                    observedResourceUrls={() => observedUrlsGetter?.() || []}
                    focusMode={props.focusMode}
                    onFocusModeToggle={tabType !== "design-plan" ? handleFocusModeToggle : undefined}
                    historyActive={props.historyActive}
                    historyEntries={props.historyEntries}
                    currentVersionId={props.currentVersionId}
                    onHistorySwitch={props.onHistorySwitch}
                    onHistoryToggle={props.onHistoryToggle}
                  />
                </Show>
                <div class="flex-1 min-h-0 min-w-0 overflow-hidden">
                  <Switch
                    fallback={
                      <div class="p-4 overflow-auto h-full">
                        <pre class="text-sm text-[var(--octo-text-primary)] whitespace-pre-wrap font-mono">{tab.content}</pre>
                      </div>
                    }
                  >
                    <Match when={tabType === "table"}>
                      <TableRenderer content={tab.content} />
                    </Match>
                    <Match when={tabType === "markdown" || tabType === "markdown-document"}>
                      <MarkdownRenderer content={tab.content} />
                    </Match>
                    <Match when={tabType === "mindmap" || tabType === "diagram"}>
                      <DiagramRenderer content={tab.content} />
                    </Match>
                    <Match when={tabType === "json"}>
                      <JsonRenderer content={tab.content} />
                    </Match>
<Match when={tabType === "html"}>
<HtmlRenderer
                           content={tab.content}
                           mode={htmlMode()}
                           viewport={viewport()}
                           palette={palette()}
                           inspecting={featureMutex.state.inspecting}
                           editing={featureMutex.state.editing && !getSubtypeHandler(tab.subtype)?.handleLocalEdit}
                           drawing={featureMutex.state.drawing}
                           commenting={featureMutex.state.commenting}
                           archiving={featureMutex.state.archiving}
                           onDrawActiveChange={(active) => active ? featureMutex.enableFeature('drawing') : featureMutex.toggleFeature('drawing')}
                           onResetArchiving={() => featureMutex.toggleFeature('archiving')}
                           inspectPanel={true}
                           onInspectTarget={setInspectTarget}
                           onSaveOverrides={(overrides) => applyInspectOverrides(tabId, overrides)}
                           onContentChange={async (content) => { await props.onContentChange?.(tabId, content) }}
                           refreshKey={combinedRefreshKey()}
                           filePath={tab.filePath}
                           commentFilePath={tab.commentFilePath}
                           sessionId={tab.sessionId ?? props.sessionId}
                           sdkUrl={globalSDK.url}
                           sdkDirectory={props.sdkDirectory}
                           onSaveFile={async (content) => {
                             if (!tab.filePath) return
                             const html = extractCodeBlock(content, "html")
                             await saveArtifactContent(tab.filePath, html)
                           }}
                           onRefreshNeeded={handleRefresh}
                           tabTitle={tab.title}
                            onSaveLocalEdit={getSubtypeHandler(tab.subtype)?.handleLocalEditSave ? handleLocalEditSave : undefined}
                            observedUrlsGetter={(g) => { observedUrlsGetter = g }}
                            registerIframePostMessage={(fn) => { iframePostMessage = fn }}
                            iframeElementGetter={(g) => { iframeElementGetter = g }}
                          />
                    </Match>
                    <Match when={tabType === "deck"}>
                      <DeckRenderer content={tab.content} />
                    </Match>
                    <Match when={tabType === "svg"}>
                      <iframe
                        src={`local:///${tab.filePath?.replace(/\\/g, '/')}?v=${combinedRefreshKey()}`}
                        style={{ width: "100%", height: "100%", border: "none" }}
                      />
                    </Match>
                    <Match when={tabType === "react-component"}>
                      <ReactComponentRenderer content={tab.content} title={tab.title} />
                    </Match>
                    <Match when={tabType === "design-plan"}>
                      <DesignPlanRenderer
                        content={tab.content}
                        title={tab.title}
                        artifactIdentifier={tab.artifactIdentifier}
                        confirmed={props.isPlanConfirmed?.() ?? false}
                        disabled={props.planEnded}
                        onConfirm={() => props.onConfirmPlan?.(tab.artifactIdentifier)}
                        onContentChange={props.planEnded ? undefined : (content) => { props.onContentChange?.(tabId, content) }}
                      />
                    </Match>
                    <Match when={tabType === "local-file"}>
                      <iframe
                        src={tab.absoluteFilePath?.match(/^https?:\/\//i)
                          ? tab.absoluteFilePath
                          : `local:///${tab.absoluteFilePath?.replace(/\\/g, '/')}`}
                        style={{ width: "100%", height: "100%", border: "none" }}
                      />
                    </Match>
                    <Match when={tabType === "image"}>
                      <ImageRenderer filePath={tab.filePath!} refreshKey={combinedRefreshKey()} />
                    </Match>
                    <Match when={tabType === "video"}>
                      <VideoRenderer filePath={tab.filePath!} refreshKey={combinedRefreshKey()} />
                    </Match>
                    <Match when={tabType === "audio"}>
                      <AudioRenderer filePath={tab.filePath!} refreshKey={combinedRefreshKey()} />
                    </Match>
                    <Match when={tabType === "pdf"}>
                      <PdfRenderer filePath={tab.filePath!} refreshKey={combinedRefreshKey()} />
                    </Match>
                    <Match when={tabType === "text"}>
                      <TextRenderer filePath={tab.filePath!} refreshKey={combinedRefreshKey()} />
                    </Match>
                    <Match when={tabType === "file"}>
                      <div class="flex items-center justify-center h-full">
                        <span style={{ color: "var(--octo-text-secondary)", "font-size": "14px" }}>
                          此格式不支持预览
                        </span>
                      </div>
                    </Match>
                  </Switch>
                </div>
              </div>
            )
          }}
        </Show>
      </Show>
    </Show>
    <PrototypeCtxMenu />
    <PrototypePropertyEditor />
  </div>
)
}

function ResultViewerEmpty(): JSX.Element {
  return (
    <div class="flex flex-col items-center justify-center h-full gap-2 text-center px-8">
      <IllustrationResultEmpty width={80} height={80} />
      <div class="text-[13px]" style={{ color: "var(--octo-text-secondary)" }}>对话产出将在这里展示</div>
      <div class="text-[12px]" style={{ color: "var(--octo-text-disabled)" }}>点击左侧输出卡片即可打开</div>
    </div>
  )
}

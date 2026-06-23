import { createMemo, createResource, createSignal, Show, Switch, Match } from "solid-js"
import { Portal } from "solid-js/web"
import type { JSX } from "solid-js"
import { Markdown } from "@opencode-ai/ui/markdown"
import { showToast } from "@opencode-ai/ui/toast"
import type { ResultTab, TabViewMode } from "./tab-store"
import { TabBar } from "./tab-bar"
import { ActionBar } from "./action-bar"
import { TableRenderer } from "./table-renderer"
import { MindmapRenderer } from "./mindmap-renderer"
import { HtmlRenderer } from "./html-renderer"
import { IllustrationResultEmpty, fileTypeIconUrl } from "../../icons/illustrations"
import { stripCodeFence } from "../../utils/detect"
import { extractTableMarkdown } from "../../utils/markdown-table"
import { isMindmapJSON } from "../../utils/mindmap-adapter"
import { fetchResourceText } from "../../utils/resource-link"
import { defaultFilename as defaultLocalFilename } from "../../utils/local-file"
import { ensureLocalMarkdownFile } from "../../utils/local-resource"
import { MarkdownEditor } from "../markdown-editor"
import { MarkdownPreview } from "../markdown-editor/markdown-preview"
import { langFromPath, canOpenLocally } from "../../utils/write-output"
import { getDesktopApi } from "../../lib/electron-api"
import { tracker } from "@/utils/tracker"
import { useSDK } from "@/context/sdk"
import { useProjectDir } from "@/hooks/use-project-dir"
import folderBlueUrl from "../../icons/IconFolderBlue.svg?url"

// ── 源码渲染器 ──────────────────────────────────────────────────
// 复用上游 <Markdown> 的 shiki 高亮:把内容包成 ```lang fence 喂给它,
// 自动获得 syntax highlight + 复制按钮(跟对话区的代码段视觉完全一致)。
function SourceCodeView(props: { content: string; lang: string }): JSX.Element {
  const fenced = createMemo(() => {
    // stripCodeFence 只对「内容本身可能被 ```lang 整段包裹」的来源(json/html,如 LLM 直出)有意义;
    // 对 markdown / code 源**不能** strip —— md 源里合法存在代码围栏,strip 会把整篇抠成第一个围栏的内容
    // (曾导致 md「代码」视图只剩一行,见 spec §8/output-renderers §1)。故仅 json/html 走 strip。
    const stripable = props.lang === "json" || props.lang === "html"
    const raw = stripable ? stripCodeFence(props.content) : props.content
    let body = raw
    if (props.lang === "json") {
      try { body = JSON.stringify(JSON.parse(raw), null, 2) } catch { /* 解析失败保持原样,shiki 容错 */ }
    }
    return "```" + props.lang + "\n" + body + "\n```"
  })
  return (
    <div class="octo-source-code-view p-4 h-full overflow-auto">
      <Markdown text={fenced()} />
    </div>
  )
}

// ── Markdown 渲染器 ──────────────────────────────────────────
// 用 Vditor 的渲染引擎(MarkdownPreview),与全屏编辑器**同一套渲染**,保证卡片预览与编辑预览
// 效果一致(加粗/表格/代码块等);取代旧的上游 <Markdown>(渲染效果与编辑器有出入)。
// 见 spec insight-markdown-editor.md §6.3。
function MarkdownRenderer(props: { content: string }): JSX.Element {
  return <MarkdownPreview content={props.content} />
}

// ── 主容器 ────────────────────────────────────────────────────
export function ResultViewer(props: {
  tabs: ResultTab[]
  activeId: string | null
  onActivate: (id: string) => void
  onClose: (id: string) => void
  /** URI 模式 fetch 完成后回写缓存 */
  onCacheContent?: (id: string, content: string) => void
  /** 收起任务面板(保留 tab,仅隐藏容器);见 SPEC-INS-009 */
  onCollapse?: () => void
  /** 切换 预览/代码 视图(仅 toggle 类型) */
  onSetViewMode?: (id: string, mode: TabViewMode) => void
}): JSX.Element {
  const activeTab = createMemo(() => props.tabs.find((t) => t.id === props.activeId) ?? null)
  const projectDir = useProjectDir()
  // 正在全屏编辑的 tab id(markdown 编辑器 overlay)。用 id 而非 tab 对象,
  // 这样内容回写(cacheContent 换新对象)后仍指向同一 tab。
  const [editingId, setEditingId] = createSignal<string | null>(null)
  const editingTab = createMemo(() => {
    const id = editingId()
    return id ? props.tabs.find((t) => t.id === id) ?? null : null
  })

  return (
    <div
      class="flex flex-col flex-1 min-w-0 overflow-hidden"
      style={{ background: "var(--octo-surface-result)", "border-left": "1px solid var(--octo-border-divider)" }}
    >
      <Show when={props.tabs.length > 0} fallback={<ResultViewerEmpty />}>
        <TabBar
          tabs={props.tabs}
          activeId={props.activeId}
          onActivate={props.onActivate}
          onClose={props.onClose}
          onCollapse={props.onCollapse}
        />
        <Show when={activeTab()}>
          {(tab) => (
            <div class="flex flex-col flex-1 min-h-0 overflow-hidden">
              <ActionBar
                tab={tab()}
                viewMode={tab().viewMode ?? "preview"}
                onSetViewMode={(mode) => props.onSetViewMode?.(tab().id, mode)}
                onEdit={() => setEditingId(tab().id)}
              />
              <div class="flex-1 overflow-hidden">
                <TabBody tab={tab()} onCacheContent={props.onCacheContent} />
              </div>
            </div>
          )}
        </Show>
      </Show>

      {/* 全屏 markdown 编辑器:Portal 到 body,盖住整个 insight 三栏布局。
          关闭后把编辑内容回写 tab(cacheContent),使「预览/代码」显示编辑后内容。见 §2.2 / §2.3。 */}
      <Show when={editingTab()}>
        {(tab) => (
          <Portal>
            <MarkdownEditor
              tab={tab()}
              projectDir={projectDir() || ""}
              onClose={(latest) => {
                props.onCacheContent?.(tab().id, latest)
                setEditingId(null)
              }}
            />
          </Portal>
        )}
      </Show>
    </div>
  )
}

// ── Tab 内容容器:按 source 分流(inline 直渲染 / uri 走 fetch / path 走 SDK 读盘) ──
function TabBody(props: {
  tab: ResultTab
  onCacheContent?: (id: string, content: string) => void
}): JSX.Element {
  return (
    <Switch fallback={<TabContent tab={props.tab} />}>
      {/* path 模式(路径 C,write 文本产物):走 SDK file.read 读盘取最新内容,不复用快照。
          见 output-renderers.md §2.6.3。file 类型(表格/office/二进制)不读盘,直接 fallback 到
          TabContent → FileFallback(本地 openPath / showItemInFolder)。 */}
      <Match when={props.tab.source === "path" && props.tab.type !== "file"}>
        <PathTabBody tab={props.tab} onCacheContent={props.onCacheContent} />
      </Match>
      {/* uri markdown 卡:不直接 fetch(url),而是先把产物落成本地「工作副本」(download-resource-to-temp
          已幂等:首次下原件、之后复用用户改过的那份),再读这份本地文件。于是卡片预览 / 编辑 / 重开卡
          看到的都是同一份;要原件走「下载原件」(ActionBar)。见 spec insight-markdown-editor.md §3。 */}
      <Match when={props.tab.source === "uri" && props.tab.type === "markdown" && !props.tab.content}>
        <UriMarkdownTabBody tab={props.tab} onCacheContent={props.onCacheContent} />
      </Match>
      {/* 其余 uri 模式(json/html/table/mindmap/file)未缓存:fetch → 回写 cache → 父层切到 inline 分支 */}
      <Match when={props.tab.source === "uri" && !props.tab.content}>
        <UriTabBody tab={props.tab} onCacheContent={props.onCacheContent} />
      </Match>
    </Switch>
  )
}

// path 模式:write 工具写到本地的文件,用 opencode SDK `file.read` 读盘(零新增 IPC,
// 与 review-tab.tsx 的 readFile 同源)。每次挂载都重读 → 文件被后续 write 覆盖也能反映最新。
// 读到 text 后走与 uri/inline 完全相同的按 type 分发(TabContent)。见 output-renderers.md §2.6.3。
function PathTabBody(props: {
  tab: ResultTab
  onCacheContent?: (id: string, content: string) => void
}): JSX.Element {
  const sdk = useSDK()
  // source 必须返回稳定的 path 字符串(而非新对象):createResource 按值比较,
  // 字符串不变就不会重 fetch。否则 onCacheContent 回写 content → props.tab 换新对象
  // → source 重跑返回新对象 → 触发重 fetch → 又回写 → 死循环(path 分支常挂载断不了)。
  const [resource, { refetch }] = createResource(
    () => props.tab.filePath ?? null,
    async (path) => {
      console.log("[octo:path] read start", { path })
      const res = await sdk.client.file.read({ path })
      const data = res.data as unknown
      // 兼容 SDK 返回 string(直接内容)或 FileContent({ content })两种形态
      const text = typeof data === "string" ? data : ((data as { content?: string } | null)?.content ?? "")
      console.log("[octo:path] read ok", { path, bytes: text.length })
      // 回写 cache 供 ActionBar 复制/下载;显示仍由本组件渲染 resource() 保证已读最新
      props.onCacheContent?.(props.tab.id, text)
      return text
    },
  )

  return (
    <Show
      when={!resource.error}
      fallback={<PathErrorFallback tab={props.tab} error={resource.error} onRetry={() => refetch()} />}
    >
      <Show when={!resource.loading} fallback={<ResourceLoading />}>
        <TabContent tab={{ ...props.tab, content: resource() ?? "" }} />
      </Show>
    </Show>
  )
}

// URI 模式 + 未缓存:fetch → 回写 cache → 由父层 Show 自动切到 inline 分支渲染。
// tab.type 在对话流出卡阶段已由 business_type(优先) / mimeType(兜底)确定(spec: output-renderers.md §2.5.2);
// 此处不再做"application/json 二次判断 retype"——服务端 business_type 显式声明即真理,客户端零嗅探。
function UriTabBody(props: {
  tab: ResultTab
  onCacheContent?: (id: string, content: string) => void
}): JSX.Element {
  const [resource, { refetch }] = createResource(
    () => (props.tab.uri ? { id: props.tab.id, uri: props.tab.uri } : null),
    async (src) => {
      const text = await fetchResourceText(src.uri)
      props.onCacheContent?.(src.id, text)
      return text
    },
  )

  return (
    <Show
      when={!resource.error}
      fallback={
        <ResourceErrorFallback
          tab={props.tab}
          error={resource.error}
          onRetry={() => {
            tracker.interaction({ module: "insight", name: "result-retry", extend: JSON.stringify({ tabType: props.tab.type }) })
            void refetch()
          }}
        />
      }
    >
      <Show when={!resource.loading} fallback={<ResourceLoading />}>
        {/* fetch 成功后 onCacheContent 已把 tab.content 写回,父层 Show 会切到 inline 分支;
            此处兜底:若 onCacheContent 未传(测试场景),直接用 resource() 渲染 */}
        <Show when={!props.onCacheContent}>
          <TabContent tab={{ ...props.tab, content: resource() }} />
        </Show>
      </Show>
    </Show>
  )
}

// uri markdown 模式:先把产物落成本地工作副本(download-resource-to-temp 幂等),再读这份本地文件,
// 使「卡片预览 / 编辑 / 本地打开 / 重开卡」回显的都是同一份(含用户改动)。要原件走「下载原件」。
// 落点 <projectDir>/.octo/downloads/<namespace>/<file>;无项目目录时落 OS 临时目录(非持久,重启可能丢)。
// 桌面端能力缺失(浏览器 __dev / 测试)时退回直接 fetch(url) 只读预览。见 insight-markdown-editor.md §3。
function UriMarkdownTabBody(props: {
  tab: ResultTab
  onCacheContent?: (id: string, content: string) => void
}): JSX.Element {
  const projectDir = useProjectDir()
  const [resource, { refetch }] = createResource(
    () => (props.tab.uri ? { id: props.tab.id, uri: props.tab.uri, dir: projectDir() || "" } : null),
    async (src) => {
      const api = getDesktopApi()
      if (typeof api?.downloadResourceToTemp !== "function" || typeof api?.readFileBuffer !== "function") {
        // 非桌面端:无本地落地能力,退回直接 fetch url(只读,不持久)
        const text = await fetchResourceText(src.uri)
        props.onCacheContent?.(src.id, text)
        return text
      }
      // 与编辑器共用 ensureLocalMarkdownFile → 命中同一份本地工作副本(幂等:已落地复用,不重复下载)
      const { path: localPath } = await ensureLocalMarkdownFile(props.tab, src.dir)
      const buf = await api.readFileBuffer!(localPath)
      const text = buf ? new TextDecoder("utf-8").decode(new Uint8Array(buf)) : ""
      console.log("[octo:resource] md-local", { localPath, bytes: text.length })
      props.onCacheContent?.(src.id, text)
      return text
    },
  )

  return (
    <Show
      when={!resource.error}
      fallback={
        <ResourceErrorFallback
          tab={props.tab}
          error={resource.error}
          onRetry={() => {
            tracker.interaction({ module: "insight", name: "result-retry", extend: JSON.stringify({ tabType: props.tab.type }) })
            void refetch()
          }}
        />
      }
    >
      <Show when={!resource.loading} fallback={<ResourceLoading />}>
        <Show when={!props.onCacheContent}>
          <TabContent tab={{ ...props.tab, content: resource() }} />
        </Show>
      </Show>
    </Show>
  )
}

// 实际内容渲染(content 已就位,inline 或缓存后均走这里)
// toggle 类型(mindmap/html/table/markdown):viewMode==="source" 走 SourceCodeView(原始源),否则渲染态。
// json 单视图(源),file 单视图(本地打开/下载)。见 output-renderers.md §1 视图切换。
function TabContent(props: { tab: ResultTab }): JSX.Element {
  const content = () => props.tab.content ?? ""
  const isSource = () => (props.tab.viewMode ?? "preview") === "source"
  return (
    <Switch
      fallback={
        <div class="p-4 overflow-auto h-full">
          <pre class="text-sm text-[var(--octo-text-primary)] whitespace-pre-wrap font-mono">{content()}</pre>
        </div>
      }
    >
      <Match when={props.tab.type === "table"}>
        {/* table 卡四视图(预览/代码/复制/下载)统一只呈现表格本体:
            预览抽 table token、复制/下载走 extractTableMarkdown,代码视图同样抽表格源,
            避免把上方对话正文带进来(全文仍在对话区 + 磁盘文件)。 */}
        <Show when={!isSource()} fallback={<SourceCodeView content={extractTableMarkdown(content())} lang="markdown" />}>
          <TableRenderer content={content()} />
        </Show>
      </Match>
      <Match when={props.tab.type === "markdown"}>
        <Show when={!isSource()} fallback={<SourceCodeView content={content()} lang="markdown" />}>
          <MarkdownRenderer content={content()} />
        </Show>
      </Match>
      <Match when={props.tab.type === "mindmap"}>
        {/* 预览态仅在内容真能渲染成思维导图时走 MindmapRenderer;否则(源码态 / 内容非 mindmap shape)
            直接降级为代码视图看原始 JSON —— 服务端 business_type:"mindmap" 但内容违约时,
            不出空的错误占位、也不另起新卡(原始 JSON 就在这张卡里)。详见 output-renderers.md §6.A。 */}
        <Show
          when={!isSource() && isMindmapJSON(content())}
          fallback={<SourceCodeView content={content()} lang="json" />}
        >
          <MindmapRenderer content={content()} />
        </Show>
      </Match>
      <Match when={props.tab.type === "html"}>
        <Show when={!isSource()} fallback={<SourceCodeView content={content()} lang="html" />}>
          <HtmlRenderer content={content()} />
        </Show>
      </Match>
      <Match when={props.tab.type === "json"}>
        <SourceCodeView content={content()} lang="json" />
      </Match>
      <Match when={props.tab.type === "code"}>
        {/* 路径 C 通用代码/纯文本(.py/.ts/.csv/.txt/…):shiki 按扩展名高亮,单视图。
            lang 从 filePath 推断(见 write-output.langFromPath)。 */}
        <SourceCodeView content={content()} lang={langFromPath(props.tab.filePath ?? "")} />
      </Match>
      <Match when={props.tab.type === "file"}>
        <FileFallback tab={props.tab} />
      </Match>
    </Switch>
  )
}

function ResourceLoading(): JSX.Element {
  return (
    <div class="flex items-center justify-center h-full">
      <div class="text-sm" style={{ color: "var(--octo-text-secondary)" }}>
        正在加载结果…
      </div>
    </div>
  )
}

function ResourceErrorFallback(props: {
  tab: ResultTab
  error: unknown
  onRetry: () => void
}): JSX.Element {
  const message = () => (props.error instanceof Error ? props.error.message : String(props.error))
  return (
    <div class="flex flex-col items-center justify-center h-full gap-3 px-8 text-center">
      <div class="text-sm" style={{ color: "var(--octo-text-secondary)" }}>
        加载失败
      </div>
      <div class="text-xs" style={{ color: "var(--octo-text-disabled)" }}>
        {message()}
      </div>
      <div class="flex gap-2 mt-1">
        <button
          type="button"
          onClick={() => props.onRetry()}
          class="px-3 py-1 text-xs rounded"
          style={{ border: "1px solid var(--octo-border-default)", color: "var(--octo-text-primary)" }}
        >
          重试
        </button>
        <Show when={props.tab.uri}>
          <button
            type="button"
            onClick={() => navigator.clipboard.writeText(props.tab.uri!).catch(console.error)}
            class="px-3 py-1 text-xs rounded"
            style={{ border: "1px solid var(--octo-border-default)", color: "var(--octo-text-primary)" }}
          >
            复制链接
          </button>
        </Show>
      </div>
    </div>
  )
}

// path 模式读盘失败(文件被删 / 路径不存在 / SDK 异常):显示路径 + 重试。
function PathErrorFallback(props: {
  tab: ResultTab
  error: unknown
  onRetry: () => void
}): JSX.Element {
  const message = () => (props.error instanceof Error ? props.error.message : String(props.error))
  return (
    <div class="flex flex-col items-center justify-center h-full gap-3 px-8 text-center">
      <div class="text-sm" style={{ color: "var(--octo-text-secondary)" }}>读取本地文件失败</div>
      <div class="text-xs break-all" style={{ color: "var(--octo-text-disabled)" }}>
        {props.tab.filePath}
      </div>
      <div class="text-xs" style={{ color: "var(--octo-text-disabled)" }}>{message()}</div>
      <button
        type="button"
        onClick={() => props.onRetry()}
        class="px-3 py-1 text-xs rounded mt-1"
        style={{ border: "1px solid var(--octo-border-default)", color: "var(--octo-text-primary)" }}
      >
        重试
      </button>
    </div>
  )
}

// 二进制 / 未识别 mimeType:不在内嵌渲染,提供三按钮(用本地应用打开 / 在文件夹中打开 / 另存为)。
// spec: docs/specs/ui/output-renderers.md §6.A,决策: ADR-009。
//
// 返回桌面壳缺失的 API 方法名列表(便于 toast 给用户精确报错 + 知会开发团队补壳)。
// SOT: packages/app/src/pages/insight/lib/electron-api.ts;handoff 同步清单见 docs/intranet-handoff.md §1.6。
type ApiKey = "openPath" | "saveFilePicker" | "downloadResource" | "downloadResourceToTemp" | "showItemInFolder"
function missingDesktopApi(required: ApiKey[]): string[] {
  const api = getDesktopApi()
  if (!api) return required.slice()
  return required.filter((k) => typeof (api as Record<string, unknown>)[k] !== "function")
}
function notifyMissingApi(missing: string[]): void {
  showToast({
    title: "桌面端能力缺失",
    description: `缺少 window.api.${missing.join(" / ")},请联系开发团队补齐桌面壳`,
    variant: "error",
  })
}

function FileFallback(props: { tab: ResultTab }): JSX.Element {
  const [openBusy, setOpenBusy] = createSignal(false)
  const [downloadBusy, setDownloadBusy] = createSignal(false)
  const [revealBusy, setRevealBusy] = createSignal(false)
  // 选了项目目录就把 MCP 文件落进 <projectDir>/.octo/downloads/ 持久保留;否则走 OS 临时目录。
  const projectDir = useProjectDir()

  // 文件类型维度:优先取文件名扩展名,兜底 mimeType,供打点区分用户在不同类型文件上的操作偏好
  function trackFileType(): string {
    const fn = props.tab.fileName ?? ""
    const ext = fn.includes(".") ? fn.split(".").pop()!.toLowerCase() : ""
    return ext || props.tab.mimeType || ""
  }

  // 默认落地文件名:复用共享 util(与 markdown 编辑器同一套规则,见 utils/local-file.ts)
  const defaultFilename = () => defaultLocalFilename(props.tab)

  // path 源(write 产物):文件已在本地磁盘,直接 openPath(filePath),无需下载。
  const isPath = () => props.tab.source === "path" && !!props.tab.filePath

  async function handleOpenInApp() {
    if (openBusy()) return
    tracker.interaction({ module: "insight", name: "file-open-in-app", extend: JSON.stringify({ fileType: trackFileType() }) })
    if (isPath()) {
      const missing = missingDesktopApi(["openPath"])
      if (missing.length > 0) { notifyMissingApi(missing); return }
      const api = getDesktopApi()!
      setOpenBusy(true)
      const filePath = props.tab.filePath!
      console.log("[octo:path] open-local", { filePath })
      try {
        const openResult = (await api.openPath!(filePath)) as unknown as string | undefined
        if (typeof openResult === "string" && openResult.length > 0) {
          console.error("[octo:path] open-failed", { filePath, reason: openResult })
          showToast({ title: "唤起本地应用失败", description: "请安装对应应用或在系统设置中关联打开方式", variant: "error" })
        }
      } catch (err) {
        console.error("[octo:path] open-failed", { filePath, err })
        showToast({ title: "无法打开文件", description: err instanceof Error ? err.message : String(err), variant: "error" })
      } finally {
        setOpenBusy(false)
      }
      return
    }
    if (!props.tab.uri) return
    const missing = missingDesktopApi(["downloadResourceToTemp", "openPath"])
    if (missing.length > 0) {
      notifyMissingApi(missing)
      return
    }
    const api = getDesktopApi()!
    setOpenBusy(true)
    const fname = defaultFilename()
    console.log("[octo:office] download-start", {
      uri: props.tab.uri,
      namespace: props.tab.id,
      filename: fname,
      mime: props.tab.mimeType,
      mode: "to-temp",
    })
    try {
      const localPath = await api.downloadResourceToTemp!(props.tab.uri, props.tab.id, fname, projectDir() || undefined)
      console.log("[octo:office] download-ok", { localPath })
      console.log("[octo:office] open-path", { localPath })
      // shell.openPath 返回值约定: 空字符串 = 成功,非空 = 错误说明。
      // preload types 声明为 Promise<void>,但实际透传 string;运行时按 string 处理。
      const openResult = (await api.openPath!(localPath)) as unknown as string | undefined
      if (typeof openResult === "string" && openResult.length > 0) {
        console.error("[octo:office] open-failed", { localPath, reason: openResult })
        showToast({
          title: "唤起本地应用失败",
          description: "请安装 Excel / WPS 或在系统设置中关联打开方式",
          variant: "error",
        })
      }
    } catch (err) {
      console.error("[octo:office] open-failed", { uri: props.tab.uri, err })
      showToast({
        title: "无法打开文件",
        description: err instanceof Error ? err.message : String(err),
        variant: "error",
      })
    } finally {
      setOpenBusy(false)
    }
  }

  async function handleSaveAs() {
    if (!props.tab.uri || downloadBusy()) return
    tracker.interaction({ module: "insight", name: "file-save-as", extend: JSON.stringify({ fileType: trackFileType() }) })
    const missing = missingDesktopApi(["saveFilePicker", "downloadResource"])
    if (missing.length > 0) {
      notifyMissingApi(missing)
      return
    }
    const api = getDesktopApi()!
    setDownloadBusy(true)
    try {
      // 另存为默认路径:有项目目录则落项目内,无则让 OS 弹空白(用户自选)
      const projectBase = projectDir()
      const defaultPath = projectBase ? `${projectBase}/${defaultFilename()}` : defaultFilename()
      const chosen = await api.saveFilePicker!({ defaultPath })
      if (!chosen) {
        setDownloadBusy(false)
        return
      }
      console.log("[octo:office] saveas-start", { uri: props.tab.uri, destPath: chosen })
      await api.downloadResource!(props.tab.uri, chosen)
      console.log("[octo:office] saveas-ok", { destPath: chosen })
      showToast({ description: "已另存", variant: "success", duration: 2000 })
    } catch (err) {
      console.error("[octo:office] saveas-failed", { uri: props.tab.uri, err })
      showToast({
        title: "另存失败",
        description: err instanceof Error ? err.message : String(err),
        variant: "error",
      })
    } finally {
      setDownloadBusy(false)
    }
  }

  // 在系统文件管理器中定位本地副本(如未下载先 download-to-temp,与"用本地应用打开"共用缓存)。
  // 微信桌面端模式:让用户能找到打开过 / 改过的本地文件,自己 cp 到正式位置。
  async function handleRevealInFolder() {
    if (revealBusy()) return
    tracker.interaction({ module: "insight", name: "file-reveal-folder", extend: JSON.stringify({ fileType: trackFileType() }) })
    if (isPath()) {
      const missing = missingDesktopApi(["showItemInFolder"])
      if (missing.length > 0) { notifyMissingApi(missing); return }
      const api = getDesktopApi()!
      const filePath = props.tab.filePath!
      console.log("[octo:path] reveal-local", { filePath })
      try {
        api.showItemInFolder!(filePath)
      } catch (err) {
        console.error("[octo:path] reveal-failed", { filePath, err })
        showToast({ title: "无法定位文件", description: err instanceof Error ? err.message : String(err), variant: "error" })
      }
      return
    }
    if (!props.tab.uri) return
    const missing = missingDesktopApi(["downloadResourceToTemp", "showItemInFolder"])
    if (missing.length > 0) {
      notifyMissingApi(missing)
      return
    }
    const api = getDesktopApi()!
    setRevealBusy(true)
    const fname = defaultFilename()
    console.log("[octo:office] reveal-start", { uri: props.tab.uri, namespace: props.tab.id, filename: fname })
    try {
      const localPath = await api.downloadResourceToTemp!(props.tab.uri, props.tab.id, fname, projectDir() || undefined)
      console.log("[octo:office] reveal-show", { localPath })
      api.showItemInFolder!(localPath)
    } catch (err) {
      console.error("[octo:office] reveal-failed", { uri: props.tab.uri, err })
      showToast({
        title: "无法定位文件",
        description: err instanceof Error ? err.message : String(err),
        variant: "error",
      })
    } finally {
      setRevealBusy(false)
    }
  }

  const iconUrl = () => fileTypeIconUrl(props.tab.fileName ?? "", props.tab.mimeType ?? "")
  const displayName = () => props.tab.fileName || props.tab.title || "文件"

  return (
    <div
      class="relative flex flex-col items-center justify-center h-full overflow-hidden"
      style={{ background: "var(--octo-surface-result)" }}
    >
      <div class="relative z-10 flex flex-col items-center" style={{ width: "560px", "min-width": "560px" }}>
        <img src={iconUrl()} width={72} height={72} alt="" aria-hidden="true" style={{ "margin-bottom": "20px" }} />

        <div style={{ "font-size": "20px", "font-weight": 700, color: "var(--octo-text-strong, #0a0a0a)", "line-height": 1.4, "text-align": "center", "word-break": "break-all", "margin-bottom": "8px", "max-width": "500px" }}>
          {displayName()}
        </div>

        <div style={{ "font-size": "14px", color: "var(--octo-text-secondary, #6b7280)", "margin-bottom": "20px", "text-align": "center" }}>
          文档已生成完成，可选择以下方式查看
        </div>

        <div style={{ width: "100%", "max-width": "400px", height: "1px", background: "linear-gradient(90deg, transparent 0%, rgba(0,0,0,0.07) 50%, transparent 100%)", "margin-bottom": "20px" }} />

        <Show when={props.tab.uri || isPath()} fallback={
          <div style={{ "font-size": "13px", color: "var(--octo-text-disabled)" }}>无文件地址，无法打开 / 下载</div>
        }>
          <div style={{ display: "flex", gap: "12px", "flex-wrap": "wrap", "justify-content": "center" }}>
            {/* path 源的可执行/库类(canOpenLocally=false)隐藏"本地打开",只留"文件夹打开" */}
            <Show when={!isPath() || canOpenLocally(props.tab.filePath ?? "")}>
              <button
                type="button"
                onClick={() => void handleOpenInApp()}
                disabled={openBusy()}
                style={{ height: "32px", padding: "0 16px", "border-radius": "4px", border: "none", background: "rgb(10,89,247)", color: "#fff", "font-size": "13px", "font-weight": 500, cursor: openBusy() ? "not-allowed" : "pointer", opacity: openBusy() ? 0.5 : 1, display: "flex", "align-items": "center", gap: "6px" }}
              >
                <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true">
                  <rect x="1" y="2" width="14" height="10" rx="1.5" stroke="#fff" stroke-width="1.4"/>
                  <path d="M5.5 14.5h5" stroke="#fff" stroke-width="1.4" stroke-linecap="round"/>
                  <path d="M8 12v2.5" stroke="#fff" stroke-width="1.4" stroke-linecap="round"/>
                </svg>
                {openBusy() ? "打开中…" : "本地打开"}
              </button>
            </Show>
            <button
              type="button"
              onClick={() => void handleRevealInFolder()}
              disabled={revealBusy()}
              style={{ height: "32px", padding: "0 16px", "border-radius": "4px", border: "1px solid var(--octo-border-default, #e5e7eb)", background: "rgba(243,243,243,1)", color: "rgba(10,89,247,1)", "font-size": "13px", cursor: revealBusy() ? "not-allowed" : "pointer", opacity: revealBusy() ? 0.5 : 1, display: "flex", "align-items": "center", gap: "6px" }}
            >
              <img src={folderBlueUrl} width={14} height={12} alt="" aria-hidden="true" />
              {revealBusy() ? "定位中…" : "文件夹打开"}
            </button>
            {/* 另存为仅 uri 源(远程产物 downloadResource);path 源文件已在本地,用"文件夹打开"代替,见 §2.6 差异表 */}
            <Show when={!isPath()}>
              <button
                type="button"
                onClick={() => void handleSaveAs()}
                disabled={downloadBusy()}
                style={{ height: "32px", padding: "0 16px", "border-radius": "4px", border: "1px solid var(--octo-border-default, #e5e7eb)", background: "rgba(243,243,243,1)", color: "rgba(10,89,247,1)", "font-size": "13px", cursor: downloadBusy() ? "not-allowed" : "pointer", opacity: downloadBusy() ? 0.5 : 1, display: "flex", "align-items": "center", gap: "6px" }}
              >
                <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true">
                  <path d="M8 2v8M5 7.5l3 3 3-3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
                  <path d="M2.5 11.5v1A1.5 1.5 0 004 14h8a1.5 1.5 0 001.5-1.5v-1" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
                </svg>
                {downloadBusy() ? "保存中…" : "下载"}
              </button>
            </Show>
          </div>
        </Show>
      </div>
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

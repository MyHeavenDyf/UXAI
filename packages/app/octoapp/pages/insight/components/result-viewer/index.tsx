import { createMemo, createResource, createSignal, Show, Switch, Match } from "solid-js"
import { Portal } from "solid-js/web"
import type { JSX } from "solid-js"
import { showToast } from "@opencode-ai/ui/toast"
import { tabLocalPath, type ResultTab, type TabViewMode } from "./tab-store"
import { TabBar } from "./tab-bar"
import { ActionBar } from "./action-bar"
import { MindmapRenderer } from "./mindmap-renderer"
import { HtmlRenderer } from "./html-renderer"
import { ImageRenderer } from "./image-renderer"
import { SourceCodeView } from "./source-code-view"
import { IllustrationResultEmpty, fileTypeIconUrl } from "../../icons/illustrations"
import { isMindmapJSON } from "../../utils/mindmap-adapter"
import { fetchResourceText } from "../../utils/resource-link"
import { defaultFilename as defaultLocalFilename, saveDialogName } from "../../utils/local-file"
import { describeResourceError } from "../../utils/local-resource"
import { openFileLocally, revealFileInFolder, NO_APP_HINT } from "../../utils/local-file-ops"
import { MarkdownEditor } from "../markdown-editor"
import { MarkdownPreview } from "../markdown-editor/markdown-preview"
import { langFromPath, canOpenLocally } from "../../utils/write-output"
import { getDesktopApi } from "../../lib/electron-api"
import { tracker } from "@/utils/tracker"
import { useProjectDir } from "@/hooks/use-project-dir"
import { useParams } from "@solidjs/router"
import folderBlueUrl from "../../icons/IconFolderBlue.svg?url"
import { InsightFileManager } from "../file-manager"
import type { InsightFile, InsightFileEntry } from "../../utils/insight-file-api"

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
  /** SPEC-INS-014 §10:tabs/files 页面级切换,决定内容区渲染 tab 列表还是文件管理面板 */
  viewMode: "tabs" | "files"
  onViewModeChange: (mode: "tabs" | "files") => void
  /** 文件管理面板里点击某个文件 → 由 index.tsx 决定怎么开成 tab(复用 tabStore.openTab 去重) */
  onOpenLocalFile: (file: InsightFileEntry) => void
  /** SPEC-INS-014 §10.1:文件管理面板操作回调(对齐 Design)——添加至会话区 / 按路径关 tab / 按路径清附件 / 刷新 */
  onAddToSession?: (file: InsightFile) => void
  onCloseTabsByPath?: (paths: string[]) => void
  onRemoveAttachmentsByPath?: (paths: string[]) => void
  onFilesRefresh?: () => void
  refreshKey?: number
}): JSX.Element {
  const activeTab = createMemo(() => props.tabs.find((t) => t.id === props.activeId) ?? null)
  const projectDir = useProjectDir()
  // 当前 tab 内容容器 ref:供 ActionBar 归档截图时在容器作用域内查 iframe,避免全局 querySelector 取到其他 tab/分屏
  let tabContainer: HTMLDivElement | undefined
  // 正在全屏编辑的 tab id(markdown 编辑器 overlay)。用 id 而非 tab 对象,
  // 这样内容回写(cacheContent 换新对象)后仍指向同一 tab。
  const [editingId, setEditingId] = createSignal<string | null>(null)
  const editingTab = createMemo(() => {
    const id = editingId()
    return id ? props.tabs.find((t) => t.id === id) ?? null : null
  })
  // 磁盘内容版本:编辑器保存后关闭时 +1,驱动 LocalFileTabBody 重新读盘。
  // 磁盘是真相源(§5)——编辑器写的是磁盘,预览就该回去读磁盘,而不是显示一份内存里的回写值。
  const [diskVersion, setDiskVersion] = createSignal(0)

  return (
    <div
      class="flex flex-col flex-1 min-w-0 overflow-hidden"
      style={{ background: "var(--octo-surface-result)", "border-left": "1px solid var(--octo-border-divider)" }}
    >
      <Show when={props.tabs.length > 0 || props.viewMode === "files"} fallback={<ResultViewerEmpty />}>
        <TabBar
          tabs={props.tabs}
          activeId={props.activeId}
          onActivate={props.onActivate}
          onClose={props.onClose}
          onCollapse={props.onCollapse}
          viewMode={props.viewMode}
          onViewModeChange={props.onViewModeChange}
        />
        <Show when={props.viewMode === "files"}>
          <InsightFileManager
            refreshKey={props.refreshKey}
            onOpenFile={props.onOpenLocalFile}
            onAddToSession={props.onAddToSession}
            onCloseTabsByPath={props.onCloseTabsByPath}
            onRemoveAttachmentsByPath={props.onRemoveAttachmentsByPath}
            onFilesRefresh={props.onFilesRefresh}
          />
        </Show>
        <Show when={props.viewMode === "tabs" && activeTab()}>
          {(tab) => (
            <div class="flex flex-col flex-1 min-h-0 overflow-hidden" ref={(el: HTMLDivElement) => { tabContainer = el }}>
              <ActionBar
                tab={tab()}
                viewMode={tab().viewMode ?? "preview"}
                onSetViewMode={(mode) => props.onSetViewMode?.(tab().id, mode)}
                onEdit={() => setEditingId(tab().id)}
                getIframe={() => tabContainer?.querySelector("iframe") ?? null}
              />
              {/* select-text:应用外壳(pages/layoutnet.tsx)整体 `select-none`(Electron 原生手感,
                  避免拖窗/拖分隔线误选),白名单只有 input/textarea/contenteditable。产物预览是**内容**,
                  用户要能划词复制,故在内容容器这一层开口 —— 只覆盖 TabBody,不含 TabBar / ActionBar
                  等 chrome(它们是兄弟节点,保持不可选)。
                  对话区同理由上游 message-part.css 的 text-part / user-message-text 白名单放开。
                  图形类视图(markmap)需要拖拽平移,自行 select-none 关掉,见 mindmap-renderer.tsx。 */}
              <div class="flex-1 overflow-hidden select-text">
                <TabBody
                  tab={tab()}
                  onCacheContent={props.onCacheContent}
                  refreshKey={props.refreshKey}
                  diskVersion={diskVersion()}
                />
              </div>
            </div>
          )}
        </Show>
      </Show>

      {/* 全屏 markdown 编辑器:Portal 到 body,盖住整个 insight 三栏布局。
          关闭后回写 tab.content(供 ActionBar 复制/下载)并 bump diskVersion —— 编辑器写的是磁盘,
          预览重新读一次磁盘,而不是显示内存里的回写值(§5 磁盘是真相源)。见 §2.2 / §2.3。 */}
      <Show when={editingTab()}>
        {(tab) => (
          <Portal>
            <MarkdownEditor
              tab={tab()}
              projectDir={projectDir() || ""}
              onClose={(latest) => {
                props.onCacheContent?.(tab().id, latest)
                setDiskVersion((v) => v + 1)
                setEditingId(null)
              }}
            />
          </Portal>
        )}
      </Show>
    </div>
  )
}

// ── Tab 内容容器:按**身份**分流(SPEC-INS-026 §5「一个身份一份内容」) ──
//
// 已 ready 的产物一律读磁盘,不读远端原件 —— 产物是可编辑的(markdown 编辑器 + 用户直接改
// 磁盘文件),一旦可编辑,远端原件就不再是真相源。要原件走 ActionBar 的「下载原件」。
//
// 分支条件的真值集合(往这条 Switch 里插分支前**先枚举清楚**,别凭「我打算改谁」判断 ——
// 曾有一个新 Match 插在 markdown 分支之前、条件只排除了 file/image,结果静默改写了
// markdown 卡的读法):
//
//   1. image + 有 filePath/uri  → ImageRenderer(二进制,不能走任何文本读法)
//   2. file                     → FileFallback(Office/二进制,压根不读内容)
//   3. 有磁盘路径               → LocalFileTabBody:markdown/html/json/code,IPC 读原字节
//   4. uri 且未缓存             → UriTabBody:非桌面端 / 尚未落盘时的只读预览兜底
//   fallback                    → TabContent:inline 卡,或已 fetch 缓存的 uri 卡
//
// 3 覆盖了原先的 PathTabBody(write 产物)与 UriMarkdownTabBody(uri md 卡)两条路径 ——
// 它们的差别本来只是「怎么拿到那个路径」,拿到之后读法应当一样。
function TabBody(props: {
  tab: ResultTab
  onCacheContent?: (id: string, content: string) => void
  refreshKey?: number
  /** 磁盘内容可能已变(write 覆盖 / 编辑器保存)时 +1,驱动重新读盘 */
  diskVersion?: number
}): JSX.Element {
  const localPath = () => tabLocalPath(props.tab)
  return (
    <Switch fallback={<TabContent tab={props.tab} />}>
      <Match when={props.tab.type === "image" && (props.tab.filePath || props.tab.uri)}>
        <ImageRenderer filePath={props.tab.filePath} uri={props.tab.uri} refreshKey={props.refreshKey} />
      </Match>
      <Match when={props.tab.type === "file"}>
        <TabContent tab={props.tab} />
      </Match>
      <Match when={localPath()}>
        {(path) => (
          <LocalFileTabBody
            tab={props.tab}
            path={path()}
            diskVersion={props.diskVersion}
            refreshKey={props.refreshKey}
            onCacheContent={props.onCacheContent}
          />
        )}
      </Match>
      <Match when={props.tab.source === "uri" && !props.tab.content}>
        <UriTabBody tab={props.tab} onCacheContent={props.onCacheContent} />
      </Match>
    </Switch>
  )
}

// 已 ready 的产物:**统一从磁盘读原字节**(§5)。
//
// 不用 `sdk.client.file.read`:服务端会对内容 `.trim()`(packages/opencode/src/file/index.ts),
// 二进制返回空串。markdown 编辑器以 tab.content 为初始值并写回磁盘,trim 会静默吃掉文件
// 首尾空白 —— 用户改一次就少一个尾部换行,而且看不出是谁干的。
//
// 每次挂载都重读,且 refreshKey / diskVersion 变化时 refetch:write 覆盖同名文件、编辑器保存、
// 用户在 Finder 里直接改,都能反映到预览。
function LocalFileTabBody(props: {
  tab: ResultTab
  path: string
  diskVersion?: number
  refreshKey?: number
  onCacheContent?: (id: string, content: string) => void
}): JSX.Element {
  const [resource, { refetch }] = createResource(
    // source 必须是可按值比较的结构:返回新对象会让 createResource 每次 effect 都重跑,
    // 而 onCacheContent 回写又会换 props.tab 对象 → 死循环。故只放三个原始值。
    () => ({ path: props.path, disk: props.diskVersion ?? 0, key: props.refreshKey ?? 0 }),
    async (src) => {
      const api = getDesktopApi()
      if (typeof api?.readFileBuffer !== "function") {
        throw new Error("缺少 window.api.readFileBuffer,无法读取本地产物")
      }
      console.log("[octo:local] read start", { path: src.path })
      const buf = await api.readFileBuffer(src.path)
      // 读原字节自己解码,不经服务端 —— 尾部换行等空白逐字保留
      const text = buf ? new TextDecoder("utf-8").decode(new Uint8Array(buf)) : ""
      console.log("[octo:local] read ok", { path: src.path, bytes: text.length })
      // 回写 cache 供 ActionBar 复制/下载;显示仍渲染 resource() 以保证是刚读到的那份
      props.onCacheContent?.(props.tab.id, text)
      return text
    },
  )

  return (
    <Show
      when={!resource.error}
      fallback={
        // refetch 期间 error 不清空(Solid resource 语义),不包 loading 态错误页会纹丝不动,
        // 用户分不清「没点上」还是「又失败了」。两个 TabBody 的错误兜底同此。
        <Show when={!resource.loading} fallback={<ResourceLoading />}>
          <PathErrorFallback tab={props.tab} path={props.path} error={resource.error} onRetry={() => void refetch()} />
        </Show>
      }
    >
      <Show when={!resource.loading} fallback={<ResourceLoading />}>
        <TabContent tab={{ ...props.tab, content: resource() ?? "" }} />
      </Show>
    </Show>
  )
}

// URI 模式 + 未缓存 + **无磁盘副本**:fetch 远端只读预览 → 回写 cache → 父层切到 inline 分支。
//
// 这是兜底路径,不是主路径(§5):非桌面端(浏览器 __dev / 测试)没有落盘能力,以及桌面端
// eager 落盘尚未完成(pending)的那段窗口。落盘完成后 bindLocalPath 补上 filePath,
// 父层 Switch 就切到 LocalFileTabBody 读磁盘了 —— 一个身份一份内容。
//
// tab.type 在出卡阶段已由 resolveOutputType 定死(§4.2),此处不做任何二次判断。
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
        <Show when={!resource.loading} fallback={<ResourceLoading />}>
          <ResourceErrorFallback
            tab={props.tab}
            error={resource.error}
            onRetry={() => {
              tracker.interaction({ module: "insight", name: "result-retry", extend: JSON.stringify({ tabType: props.tab.type }) })
              void refetch()
            }}
          />
        </Show>
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

// 实际内容渲染(content 已就位,inline 或缓存后均走这里)
// toggle 类型(html/markdown):viewMode==="source" 走 SourceCodeView(原始源),否则渲染态。
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
      <Match when={props.tab.type === "markdown"}>
        <Show when={!isSource()} fallback={<SourceCodeView content={content()} lang="markdown" />}>
          <MarkdownRenderer content={content()} />
        </Show>
      </Match>
      <Match when={props.tab.type === "json"}>
        {/* json 卡(路径 A application/json / 路径 C .json / 路径 B 嗅探)按**内容**分流:
            内容是思维导图 shape 且处于预览态 → markmap;否则(源码态 / 非 shape)→ 原始 JSON(shiki)。
            - 内容恰为树形(顶层带 children / {mindmaps:[…]} / {nodes:[…]})→ `isMindmapJSON` 真 →
              默认打开即 markmap 预览,并出「预览/代码」切换(可见性见 action-bar.showToggle);
              普通配置 JSON 单显源。
            - SPEC-INS-026 §4.2:思维导图是「json 的一种内容形态」,不是独立类型。此前 business_type
              声明为 mindmap 却内容违约的卡会降级到这里的源视图 —— 现在没有那条路径了,一律看内容。
            判定与渲染共用同一条 isMindmapJSON,杜绝"判中但渲空"漂移。 */}
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
  // 剥掉 [octo:name-rejected] 这类机器标记再展示(§4.1 拒绝类失败的原因文案本身是中文可读的)
  const message = () => describeResourceError(props.error)
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
            onClick={() =>
              navigator.clipboard.writeText(props.tab.uri!).then(
                () => showToast({ description: "已复制到剪贴板", variant: "success", duration: 2000 }),
                (err) => {
                  console.error("[octo:resource] copy-link-failed", { err })
                  showToast({ title: "复制失败", description: "请重试或手动选择文本复制", variant: "error" })
                },
              )
            }
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

// 读盘失败(文件被删 / 路径不存在 / 缺桌面端能力):显示路径 + 重试。
function PathErrorFallback(props: {
  tab: ResultTab
  path?: string
  error: unknown
  onRetry: () => void
}): JSX.Element {
  const message = () => describeResourceError(props.error)
  return (
    <div class="flex flex-col items-center justify-center h-full gap-3 px-8 text-center">
      <div class="text-sm" style={{ color: "var(--octo-text-secondary)" }}>读取本地文件失败</div>
      <div class="text-xs break-all" style={{ color: "var(--octo-text-disabled)" }}>
        {props.path ?? props.tab.filePath}
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
// SOT: ../../lib/electron-api.ts 的 DesktopApi;handoff 同步清单见 octo-agent 文档仓 docs/intranet-handoff.md §4。
type ApiKey = "openPath" | "saveFilePicker" | "downloadResource" | "downloadResourceToTemp" | "showItemInFolder" | "resolveMaterializedPath" | "copyFileTo"
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
  // 选了项目目录且有会话就把 MCP 文件落进 <projectDir>/.octo/<sessionId>/outputs/ 持久保留;否则走 OS 临时目录。
  const projectDir = useProjectDir()
  const params = useParams<{ id?: string }>()

  // 文件类型维度:优先取文件名扩展名,兜底 mimeType,供打点区分用户在不同类型文件上的操作偏好
  function trackFileType(): string {
    const fn = props.tab.fileName ?? ""
    const ext = fn.includes(".") ? fn.split(".").pop()!.toLowerCase() : ""
    return ext || props.tab.mimeType || ""
  }

  // 默认落地文件名:复用共享 util(与 markdown 编辑器同一套规则,见 utils/local-file.ts)。
  // 逐字保留 —— 落盘是否要清洗/拒绝由主进程 landingName 单点决定(SPEC-INS-026 §4.1)。
  const defaultFilename = () => defaultLocalFilename(props.tab)

  // path 源(write 产物):文件已在本地磁盘,直接 openPath(filePath),无需下载。
  const isPath = () => props.tab.source === "path" && !!props.tab.filePath

  async function handleOpenInApp() {
    if (openBusy()) return
    tracker.interaction({ module: "insight", name: "file-open-in-app", extend: JSON.stringify({ fileType: trackFileType() }) })
    if (isPath()) {
      setOpenBusy(true)
      try {
        await openFileLocally(props.tab.filePath!)
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
      namespace: props.tab.uri,
      filename: fname,
      mime: props.tab.mimeType,
      mode: "to-temp",
    })
    try {
      // 幂等键传 uri(资源身份),不传 tab.id —— 见 utils/local-resource.ts 文件头。
      const localPath = await api.downloadResourceToTemp!(props.tab.uri, props.tab.uri, fname, projectDir() || undefined, params.id)
      console.log("[octo:office] download-ok", { localPath })
      console.log("[octo:office] open-path", { localPath })
      // shell.openPath 返回值约定: 空字符串 = 成功,非空 = 错误说明。
      // preload types 声明为 Promise<void>,但实际透传 string;运行时按 string 处理。
      const openResult = (await api.openPath!(localPath)) as unknown as string | undefined
      if (typeof openResult === "string" && openResult.length > 0) {
        console.error("[octo:office] open-failed", { localPath, reason: openResult })
        showToast({ title: "无法打开文件", description: NO_APP_HINT, variant: "error" })
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

  // 「下载」= 优先拷贝已落地的本地副本(走 fs.copyFile,不读进内存再写);本地副本找不到(如被删/移走)
  // 再兜底走 web 拉 S3 直落目标路径。office 卡本就 eager 落到 .octo/<sessionId>/outputs/,常态命中本地拷贝。
  async function handleSaveAs() {
    if (!props.tab.uri || downloadBusy()) return
    tracker.interaction({ module: "insight", name: "file-save-as", extend: JSON.stringify({ fileType: trackFileType() }) })
    const missing = missingDesktopApi(["saveFilePicker", "resolveMaterializedPath", "copyFileTo", "downloadResource"])
    if (missing.length > 0) {
      notifyMissingApi(missing)
      return
    }
    const api = getDesktopApi()!
    setDownloadBusy(true)
    try {
      // 保存位置:有项目目录则落项目内,无则让 OS 弹空白(用户自选)。
      // defaultPath 会被 OS 当路径解析,故这里(且仅这里)过一道 saveDialogName —— 与落盘链路无关。
      const projectBase = projectDir()
      const dialogName = saveDialogName(defaultFilename())
      const defaultPath = projectBase ? `${projectBase}/${dialogName}` : dialogName
      const chosen = await api.saveFilePicker!({ defaultPath })
      if (!chosen) {
        setDownloadBusy(false)
        return
      }
      // 幂等键传 uri(资源身份),与本地打开/文件夹打开共用同一份落地副本。
      const localPath = await api.resolveMaterializedPath!(props.tab.uri, projectBase || undefined, params.id)
      if (localPath) {
        console.log("[octo:office] saveas-copy-local", { localPath, destPath: chosen })
        await api.copyFileTo!(localPath, chosen)
      } else {
        // 本地副本找不到 → 兜底 web 下载直落目标路径
        console.log("[octo:office] saveas-web-fallback", { uri: props.tab.uri, destPath: chosen })
        await api.downloadResource!(props.tab.uri, chosen)
      }
      console.log("[octo:office] saveas-ok", { destPath: chosen, source: localPath ? "local-copy" : "web" })
      showToast({ description: "已下载", variant: "success", duration: 2000 })
    } catch (err) {
      console.error("[octo:office] saveas-failed", { uri: props.tab.uri, err })
      showToast({
        title: "下载失败",
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
      await revealFileInFolder(props.tab.filePath!)
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
    console.log("[octo:office] reveal-start", { uri: props.tab.uri, namespace: props.tab.uri, filename: fname })
    try {
      // 幂等键传 uri(资源身份),不传 tab.id —— 见 utils/local-resource.ts 文件头。
      const localPath = await api.downloadResourceToTemp!(props.tab.uri, props.tab.uri, fname, projectDir() || undefined, params.id)
      console.log("[octo:office] reveal-show", { localPath })
      await revealFileInFolder(localPath)
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
              style={{ height: "32px", padding: "0 16px", "border-radius": "4px", border: "1px solid rgba(243,243,243,1)", background: "rgba(243,243,243,1)", color: "rgba(10,89,247,1)", "font-size": "13px", cursor: revealBusy() ? "not-allowed" : "pointer", opacity: revealBusy() ? 0.5 : 1, display: "flex", "align-items": "center", gap: "6px" }}
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
                style={{ height: "32px", padding: "0 16px", "border-radius": "4px", border: "1px solid rgba(243,243,243,1)", background: "rgba(243,243,243,1)", color: "rgba(10,89,247,1)", "font-size": "13px", cursor: downloadBusy() ? "not-allowed" : "pointer", opacity: downloadBusy() ? 0.5 : 1, display: "flex", "align-items": "center", gap: "6px" }}
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

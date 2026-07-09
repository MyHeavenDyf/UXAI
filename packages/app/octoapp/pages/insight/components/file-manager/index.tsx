// SPEC-INS-014 §10 / §10.1:「文件管理」——viewMode==="files" 时替换 ResultViewer 整个内容区,
// 列当前会话的 insight/<sessionId>/{uploads,outputs}/。§10.1 对齐站内 Design 模块的文件管理:
// 顶部工具栏(刷新/分组切换/类型筛选/上传)+ 表格(多选/表头排序)+ 两段(已上传/已生成)可折叠、
// 各自按类型或修改时间分组。worktree 扁平,无 Design 那套文件夹导航;不抄它的存储层
// (Design 存 .octo/artifacts/make/,insight 走显性 insight/<sessionId>/,见 §2)。
// insight 自包含:不 import make 目录下的组件。

import { createMemo, createSignal, For, Show, Switch, Match, onMount } from "solid-js"
import type { JSX } from "solid-js"
import { Popover as Kobalte } from "@kobalte/core/popover"
import { Spinner } from "@opencode-ai/ui/spinner"
import { Icon } from "@opencode-ai/ui/icon"
import { useParams } from "@solidjs/router"
import { useSDK } from "@/context/sdk"
import { useProjectDir } from "@/hooks/use-project-dir"
import {
  fetchInsightFiles,
  formatFileSize,
  formatTimeAgo,
  kindLabel,
  toInsightFile,
  type InsightFile,
  type InsightFileEntry,
} from "../../utils/insight-file-api"
import {
  createInsightFileStore,
  MODIFIED_SECTION_LABELS,
  type GroupMode,
  type ModifiedSection,
  type SortKey,
} from "../../utils/insight-file-store"
import { openFileLocally, revealFileInFolder, copyFilesToSessionUploads } from "../../utils/local-file-ops"
import { canOpenLocally } from "../../utils/write-output"
import { fileTypeIconUrl } from "../../icons/illustrations"
import emptyPng from "../../icons/empty.png"
import { FileManagerToolbar } from "./toolbar"

export function InsightFileManager(props: { onOpenFile: (file: InsightFileEntry) => void }): JSX.Element {
  const params = useParams<{ id?: string }>()
  // 按 sessionId keyed 重建:切会话时 store(含 localStorage 视图状态 key)整体刷新,不残留上一会话状态。
  return (
    <Show when={params.id} fallback={<NoSessionEmpty />} keyed>
      {(sessionId) => <FileManagerInner sessionId={sessionId} onOpenFile={props.onOpenFile} />}
    </Show>
  )
}

function FileManagerInner(props: { sessionId: string; onOpenFile: (file: InsightFileEntry) => void }): JSX.Element {
  const sdk = useSDK()
  const projectDir = useProjectDir()
  const fileStore = createInsightFileStore(props.sessionId)
  const store = () => fileStore.store
  const [isDragOver, setIsDragOver] = createSignal(false)
  let fileInputRef!: HTMLInputElement

  async function refresh() {
    fileStore.setLoading(true)
    try {
      // 两段各自取;任一失败即视为失败态(try/catch 收口,不 throw 到 ErrorBoundary → 不整页崩溃,
      // 只在面板内显示"加载失败 + 重试",满足 SPEC-INS-014 §8 验证 #10)。
      const [uploads, outputs] = await Promise.all([
        fetchInsightFiles(sdk.url, sdk.directory, props.sessionId, "uploads"),
        fetchInsightFiles(sdk.url, sdk.directory, props.sessionId, "outputs"),
      ])
      fileStore.setUploadedFiles(uploads.map(toInsightFile))
      fileStore.setGeneratedFiles(outputs.map(toInsightFile))
      fileStore.setError(null)
    } catch (err) {
      fileStore.setError(err instanceof Error ? err.message : String(err))
    } finally {
      fileStore.setLoading(false)
    }
  }

  onMount(() => void refresh())

  async function doUpload(files: File[]) {
    if (files.length === 0) return
    const { ok } = await copyFilesToSessionUploads(files, projectDir() || "", props.sessionId)
    if (ok > 0) await refresh()
  }

  function handleHeaderSort(key: SortKey) {
    if (store().sortKey === key) {
      fileStore.setSortDir(store().sortDir === "asc" ? "desc" : "asc")
    } else {
      fileStore.setSortKey(key)
      fileStore.setSortDir(key === "mtime" ? "desc" : "asc")
    }
  }

  const hasAnyFiles = createMemo(() => store().uploadedFiles.length > 0 || store().generatedFiles.length > 0)
  const showInitialSpinner = createMemo(() => store().loading && !hasAnyFiles() && !store().error)

  function handleDrop(e: DragEvent) {
    e.preventDefault()
    setIsDragOver(false)
    const files = e.dataTransfer?.files
    if (files && files.length > 0) void doUpload(Array.from(files))
  }

  return (
    <div
      class="flex flex-col h-full overflow-hidden relative"
      onDragOver={(e) => {
        e.preventDefault()
        if (e.dataTransfer) e.dataTransfer.dropEffect = "copy"
        setIsDragOver(true)
      }}
      onDragLeave={(e) => {
        const t = e.currentTarget as HTMLElement
        const r = t.getBoundingClientRect()
        if (e.clientX < r.left || e.clientX >= r.right || e.clientY < r.top || e.clientY >= r.bottom) setIsDragOver(false)
      }}
      onDrop={handleDrop}
    >
      <input
        type="file"
        multiple
        ref={fileInputRef}
        class="hidden"
        onChange={(e) => {
          const files = e.currentTarget.files
          if (files) void doUpload(Array.from(files))
          e.currentTarget.value = ""
        }}
      />

      <Show when={isDragOver()}>
        <div
          class="absolute inset-0 z-50 flex flex-col items-center justify-center pointer-events-none"
          style={{ background: "rgba(10,89,247,0.06)", border: "2px dashed var(--octo-brand)" }}
        >
          <Icon name="cloud-upload" class="size-8" />
          <span class="text-sm mt-2" style={{ color: "var(--octo-text-primary)" }}>释放以上传到当前会话</span>
        </div>
      </Show>

      <Show when={hasAnyFiles()}>
        <FileManagerToolbar fileStore={fileStore} onRefresh={() => void refresh()} onUpload={() => fileInputRef?.click()} />
      </Show>

      <div class="flex-1 overflow-y-auto">
        <Switch>
          <Match when={store().error}>
            <div class="flex flex-col items-center justify-center h-full gap-2 text-sm" style={{ color: "var(--octo-text-tertiary)" }}>
              <span>加载文件列表失败</span>
              <button
                type="button"
                class="text-xs px-2.5 py-1 rounded-md"
                style={{ background: "var(--octo-surface-selected)", color: "var(--octo-brand)" }}
                onClick={() => void refresh()}
              >
                重试
              </button>
            </div>
          </Match>
          <Match when={showInitialSpinner()}>
            <div class="flex items-center justify-center h-full">
              <Spinner class="size-[20px]" />
            </div>
          </Match>
          <Match when={!hasAnyFiles()}>
            {/* 空态插画 / 文案对齐 Design(empty.png 空箱子 + designFiles.emptyHint)。
                按钮:设计稿为蓝底白字。设计系统 <Button variant="primary"> 的 --button-primary-base
                在 insight 主题下解析成黑底(与设计稿不符),故这里直接用 insight 主蓝 #0a59F7
                (= FileFallback 已上线的主按钮色),尺寸/圆角内网可再按设计稿微调。 */}
            <div class="flex flex-col items-center justify-center h-full text-center px-8">
              <img src={emptyPng} width={150} height={150} alt="" draggable={false} />
              <span class="text-[14px] leading-[22px]" style={{ color: "#666", "margin-bottom": "20px" }}>
                暂无内容，点击上传新增文件吧
              </span>
              {/* 全部写 inline 属性,不用 class(text-white 在此不生效,被元素默认色盖掉,
                  曾渲染成蓝底黑字);图标靠 color 继承 currentColor 变白,再显式兜底一次 */}
              <button
                type="button"
                onClick={() => fileInputRef?.click()}
                style={{
                  display: "flex",
                  "align-items": "center",
                  "justify-content": "center",
                  gap: "8px",
                  background: "#0a59F7",
                  color: "#ffffff",
                  border: "none",
                  "border-radius": "8px",
                  height: "40px",
                  padding: "0 24px",
                  "font-size": "14px",
                  "font-weight": "500",
                  cursor: "pointer",
                }}
              >
                <Icon name="upload" class="size-4" style={{ color: "#ffffff" }} />
                <span style={{ color: "#ffffff" }}>上传文件</span>
              </button>
            </div>
          </Match>
          <Match when={hasAnyFiles()}>
            <FileTable fileStore={fileStore} onHeaderSort={handleHeaderSort} onOpenFile={props.onOpenFile} />
          </Match>
        </Switch>
      </div>
    </div>
  )
}

// ── 表格 ──────────────────────────────────────────────────────────
function FileTable(props: {
  fileStore: ReturnType<typeof createInsightFileStore>
  onHeaderSort: (key: SortKey) => void
  onOpenFile: (file: InsightFileEntry) => void
}): JSX.Element {
  const store = () => props.fileStore.store
  const th = "px-3 py-2 text-left text-xs font-normal select-none"

  return (
    <table class="w-full" style={{ "border-collapse": "separate", "border-spacing": "0", "table-layout": "fixed" }}>
      <thead>
        <tr style={{ background: "var(--octo-surface-selected)" }}>
          <th style={{ width: "44px", padding: "8px 12px" }}>
            <input
              type="checkbox"
              checked={props.fileStore.allSelected()}
              ref={(el) => { el.indeterminate = props.fileStore.someSelected() }}
              onChange={() => props.fileStore.selectAll()}
              style={{ width: "15px", height: "15px", "accent-color": "var(--octo-brand)", cursor: "pointer", "vertical-align": "middle" }}
            />
          </th>
          <th class={th} style={{ width: "48%", color: "var(--octo-text-secondary)" }}>
            <SortLabel label="名称" active={store().sortKey === "name"} dir={store().sortDir} onClick={() => props.onHeaderSort("name")} />
          </th>
          <th class={th} style={{ width: "26%", color: "var(--octo-text-secondary)" }}>
            <SortLabel label="类型" active={store().sortKey === "kind"} dir={store().sortDir} onClick={() => props.onHeaderSort("kind")} />
          </th>
          <th class={th} style={{ width: "26%", color: "var(--octo-text-secondary)" }}>
            <SortLabel label="修改时间" active={store().sortKey === "mtime"} dir={store().sortDir} onClick={() => props.onHeaderSort("mtime")} />
          </th>
          <th style={{ width: "44px" }} />
        </tr>
      </thead>
      <tbody>
        <SectionHeaderRow
          title="已上传"
          count={props.fileStore.uploaded.sortedFiles().length}
          collapsed={store().collapsedUploaded}
          onToggle={() => props.fileStore.toggleUploadedSection()}
        />
        <Show when={!store().collapsedUploaded}>
          <GroupedRows computed={props.fileStore.uploaded} store={props.fileStore} onOpenFile={props.onOpenFile} />
        </Show>

        <SectionHeaderRow
          title="已生成"
          count={props.fileStore.generated.sortedFiles().length}
          collapsed={store().collapsedGenerated}
          onToggle={() => props.fileStore.toggleGeneratedSection()}
        />
        <Show when={!store().collapsedGenerated}>
          <GroupedRows computed={props.fileStore.generated} store={props.fileStore} onOpenFile={props.onOpenFile} />
        </Show>
      </tbody>
    </table>
  )
}

function SortLabel(props: { label: string; active: boolean; dir: "asc" | "desc"; onClick: () => void }): JSX.Element {
  return (
    <button type="button" onClick={props.onClick} class="inline-flex items-center gap-1 transition-colors hover:text-[var(--octo-brand)]">
      <span>{props.label}</span>
      <Show when={props.active}>
        <Icon name={props.dir === "asc" ? "arrow-up" : "arrow-down"} class="size-3" />
      </Show>
    </button>
  )
}

function SectionHeaderRow(props: { title: string; count: number; collapsed: boolean; onToggle: () => void }): JSX.Element {
  return (
    <tr>
      <td colSpan={5} class="px-2 py-1.5" style={{ "border-bottom": "1px solid var(--octo-border-divider)" }}>
        <button type="button" onClick={props.onToggle} class="flex items-center gap-1.5 text-[13px]" style={{ color: "var(--octo-text-primary)" }}>
          <Icon name="chevron-down" class="size-4 transition-transform" style={{ transform: props.collapsed ? "rotate(-90deg)" : "none" }} />
          <span class="font-medium">{props.title}</span>
          <span style={{ color: "var(--octo-text-tertiary)" }}>({props.count})</span>
        </button>
      </td>
    </tr>
  )
}

// 段内按 groupMode 再分组:类型 → 各 kind 小标题;修改时间 → 今天/昨天/… 小标题。
function GroupedRows(props: {
  computed: ReturnType<typeof createInsightFileStore>["uploaded"]
  store: ReturnType<typeof createInsightFileStore>
  onOpenFile: (file: InsightFileEntry) => void
}): JSX.Element {
  const groupMode = (): GroupMode => props.store.store.groupMode
  return (
    <Switch>
      <Match when={groupMode() === "kind"}>
        <For each={props.computed.kindGroupEntries()}>
          {([kind, files]) => (
            <>
              <SubGroupHeaderRow label={kindLabel(kind)} />
              <For each={files}>{(file) => <FileRow file={file} store={props.store} onOpenFile={props.onOpenFile} />}</For>
            </>
          )}
        </For>
      </Match>
      <Match when={groupMode() === "modified"}>
        <For each={props.computed.visibleModifiedSections()}>
          {(section: ModifiedSection) => (
            <>
              <SubGroupHeaderRow label={MODIFIED_SECTION_LABELS[section]} />
              <For each={props.computed.modifiedGroups()[section]}>
                {(file) => <FileRow file={file} store={props.store} onOpenFile={props.onOpenFile} />}
              </For>
            </>
          )}
        </For>
      </Match>
    </Switch>
  )
}

function SubGroupHeaderRow(props: { label: string }): JSX.Element {
  return (
    <tr>
      <td colSpan={5} class="px-4 pt-2.5 pb-1 text-xs" style={{ color: "var(--octo-text-tertiary)" }}>
        {props.label}
      </td>
    </tr>
  )
}

function FileRow(props: {
  file: InsightFile
  store: ReturnType<typeof createInsightFileStore>
  onOpenFile: (file: InsightFileEntry) => void
}): JSX.Element {
  const [menuOpen, setMenuOpen] = createSignal(false)
  const selected = () => props.store.store.selected.has(props.file.path)
  return (
    <tr
      class="cursor-pointer transition-colors"
      style={{ background: selected() ? "var(--octo-surface-selected)" : "transparent" }}
      onMouseEnter={(e) => { if (!selected()) e.currentTarget.style.background = "var(--octo-surface-hover)" }}
      onMouseLeave={(e) => { if (!selected()) e.currentTarget.style.background = "transparent" }}
      onClick={(e) => {
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLButtonElement) return
        props.onOpenFile(props.file)
      }}
    >
      <td style={{ padding: "8px 12px", "vertical-align": "middle", "border-bottom": "1px solid var(--octo-border-divider)" }}>
        <input
          type="checkbox"
          checked={selected()}
          onChange={() => props.store.toggleFileSelection(props.file.path)}
          onClick={(e) => e.stopPropagation()}
          style={{ width: "15px", height: "15px", "accent-color": "var(--octo-brand)", cursor: "pointer", "vertical-align": "middle" }}
        />
      </td>
      <td class="px-3 py-2" style={{ "vertical-align": "middle", "border-bottom": "1px solid var(--octo-border-divider)" }}>
        <div class="flex items-center gap-2.5 min-w-0">
          <img src={fileTypeIconUrl(props.file.name)} alt="" width={32} height={32} class="shrink-0" />
          <div class="flex flex-col min-w-0">
            <span class="truncate text-sm" style={{ color: "var(--octo-text-primary)" }} title={props.file.name}>{props.file.name}</span>
            <span class="text-xs" style={{ color: "var(--octo-text-tertiary)" }}>{formatFileSize(props.file.size)}</span>
          </div>
        </div>
      </td>
      <td class="px-3 py-2 text-[13px]" style={{ color: "var(--octo-text-secondary)", "vertical-align": "middle", "border-bottom": "1px solid var(--octo-border-divider)" }}>
        {kindLabel(props.file.kind)}
      </td>
      <td class="px-3 py-2 text-[13px]" style={{ color: "var(--octo-text-secondary)", "vertical-align": "middle", "border-bottom": "1px solid var(--octo-border-divider)" }}>
        {formatTimeAgo(props.file.mtime)}
      </td>
      <td class="px-2" style={{ "vertical-align": "middle", "border-bottom": "1px solid var(--octo-border-divider)" }}>
        <Kobalte open={menuOpen()} onOpenChange={setMenuOpen} modal={false} placement="bottom-end" gutter={4}>
          <Kobalte.Trigger
            as="button"
            type="button"
            onClick={(e) => e.stopPropagation()}
            class="flex items-center justify-center size-7 rounded-md transition-colors hover:bg-[var(--octo-surface-selected)]"
            style={{ color: "var(--octo-text-tertiary)" }}
          >
            <Icon name="ellipsis" class="size-4" />
          </Kobalte.Trigger>
          <Kobalte.Portal>
            <Kobalte.Content
              class="z-50 rounded-lg p-1.5 min-w-[168px]"
              style={{ background: "var(--octo-surface-raised, #fff)", "box-shadow": "0 4px 16px rgba(0,0,0,0.14)", border: "1px solid var(--octo-border-divider)" }}
            >
              <MenuItem label="在标签页中打开" onClick={() => { props.onOpenFile(props.file); setMenuOpen(false) }} />
              <Show when={canOpenLocally(props.file.name)}>
                <MenuItem label="本地打开" onClick={() => { void openFileLocally(props.file.path); setMenuOpen(false) }} />
              </Show>
              <MenuItem label="打开所在文件夹" onClick={() => { revealFileInFolder(props.file.path); setMenuOpen(false) }} />
            </Kobalte.Content>
          </Kobalte.Portal>
        </Kobalte>
      </td>
    </tr>
  )
}

function MenuItem(props: { label: string; onClick: () => void }): JSX.Element {
  return (
    <button
      type="button"
      onClick={props.onClick}
      class="w-full h-8 px-2.5 rounded-md text-left text-[13px] transition-colors hover:bg-[var(--octo-surface-hover)]"
      style={{ color: "var(--octo-text-primary)" }}
    >
      {props.label}
    </button>
  )
}

function NoSessionEmpty(): JSX.Element {
  return (
    <div class="flex flex-col items-center justify-center h-full text-center px-8">
      <img src={emptyPng} width={150} height={150} alt="" draggable={false} />
      <span class="text-[14px] leading-[22px]" style={{ color: "#666" }}>新建或进入一个会话后，这里会显示会话的文件</span>
    </div>
  )
}

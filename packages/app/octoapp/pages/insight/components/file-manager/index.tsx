// SPEC-INS-014 §10:「文件管理」——viewMode==="files" 时替换 ResultViewer 整个内容区,
// 列当前会话的 insight/<sessionId>/{uploads,outputs}/。worktree 本身扁平,不需要 Make
// design-files-panel 那套文件夹导航,直接两段平铺列表即可。

import { createResource, createMemo, For, Show } from "solid-js"
import type { JSX } from "solid-js"
import { useParams } from "@solidjs/router"
import { useSDK } from "@/context/sdk"
import { fetchInsightFiles, formatFileSize, formatTimeAgo, type InsightFileEntry } from "../../utils/insight-file-api"
import { openFileLocally, revealFileInFolder } from "../../utils/local-file-ops"
import { canOpenLocally } from "../../utils/write-output"
import { fileTypeIconUrl } from "../../icons/illustrations"
import { IconActionOpen, IconActionFolder } from "../../icons"

export function InsightFileManager(props: { onOpenFile: (file: InsightFileEntry) => void }): JSX.Element {
  const sdk = useSDK()
  const params = useParams<{ id?: string }>()

  const [uploads, { refetch: refetchUploads }] = createResource(
    () => (params.id ? { sessionId: params.id, url: sdk.url, dir: sdk.directory } : null),
    (src) => fetchInsightFiles(src.url, src.dir, src.sessionId, "uploads"),
  )
  const [outputs, { refetch: refetchOutputs }] = createResource(
    () => (params.id ? { sessionId: params.id, url: sdk.url, dir: sdk.directory } : null),
    (src) => fetchInsightFiles(src.url, src.dir, src.sessionId, "outputs"),
  )

  // 两个 resource 各自独立取,互不阻塞;任一失败只影响自己那个 section 的展示,不整体崩溃
  // (Solid resource accessor 在 error 态下直接调用会 throw,冒泡到最近 ErrorBoundary——这里
  // 若不挡,会一路冒到 insight 整页崩溃兜底,把"文件管理拉取失败"这种局部问题放大成整页报错)。
  const hasError = createMemo(() => !!uploads.error || !!outputs.error)
  const sortedUploads = createMemo(() => (uploads.error ? [] : [...(uploads() ?? [])]).sort((a, b) => b.mtime - a.mtime))
  const sortedOutputs = createMemo(() => (outputs.error ? [] : [...(outputs() ?? [])]).sort((a, b) => b.mtime - a.mtime))
  const isEmpty = createMemo(() => sortedUploads().length === 0 && sortedOutputs().length === 0)

  return (
    <div class="flex flex-col h-full overflow-hidden">
      <div
        class="flex items-center justify-between px-4 py-2 shrink-0"
        style={{ "border-bottom": "1px solid var(--octo-border-divider)" }}
      >
        <span class="text-sm font-medium" style={{ color: "var(--octo-text-primary)" }}>文件管理</span>
        {/* 上传按钮本期只做视觉,不接交互(SPEC-INS-014 §10 明确排除) */}
        <button
          type="button"
          disabled
          class="text-xs px-2.5 py-1 rounded-md opacity-40 cursor-not-allowed"
          style={{ background: "var(--octo-surface-selected)", color: "var(--octo-text-secondary)" }}
        >
          上传
        </button>
      </div>
      <div class="flex-1 overflow-y-auto">
        <Show
          when={!hasError()}
          fallback={
            <div class="flex flex-col items-center justify-center h-full gap-2 text-sm" style={{ color: "var(--octo-text-tertiary)" }}>
              <span>加载文件列表失败</span>
              <button
                type="button"
                class="text-xs px-2.5 py-1 rounded-md"
                style={{ background: "var(--octo-surface-selected)", color: "var(--octo-brand)" }}
                onClick={() => { refetchUploads(); refetchOutputs() }}
              >
                重试
              </button>
            </div>
          }
        >
          <Show
            when={!isEmpty()}
            fallback={
              <div class="flex items-center justify-center h-full text-sm" style={{ color: "var(--octo-text-tertiary)" }}>
                暂无文件——在对话中上传文件或让 Agent 生成文件后，这里会显示
              </div>
            }
          >
            <FileSection title="已上传" files={sortedUploads()} onOpenFile={props.onOpenFile} />
            <FileSection title="已生成" files={sortedOutputs()} onOpenFile={props.onOpenFile} />
          </Show>
        </Show>
      </div>
    </div>
  )
}

function FileSection(props: {
  title: string
  files: InsightFileEntry[]
  onOpenFile: (file: InsightFileEntry) => void
}): JSX.Element {
  return (
    <Show when={props.files.length > 0}>
      <div class="px-4 pt-3 pb-1 text-xs font-medium" style={{ color: "var(--octo-text-tertiary)" }}>
        {props.title} ({props.files.length})
      </div>
      <For each={props.files}>{(file) => <FileRow file={file} onOpenFile={props.onOpenFile} />}</For>
    </Show>
  )
}

function FileRow(props: { file: InsightFileEntry; onOpenFile: (file: InsightFileEntry) => void }): JSX.Element {
  return (
    <div
      class="flex items-center gap-2.5 px-4 py-2 cursor-pointer group hover:bg-[var(--octo-surface-hover)]"
      onClick={() => props.onOpenFile(props.file)}
    >
      <img src={fileTypeIconUrl(props.file.name)} alt="" class="size-4 shrink-0" />
      <span class="flex-1 truncate text-sm" style={{ color: "var(--octo-text-primary)" }}>{props.file.name}</span>
      <span class="text-xs shrink-0" style={{ color: "var(--octo-text-tertiary)" }}>{formatFileSize(props.file.size)}</span>
      <span class="text-xs shrink-0 w-16 text-right" style={{ color: "var(--octo-text-tertiary)" }}>
        {formatTimeAgo(props.file.mtime)}
      </span>
      <div class="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100">
        <Show when={canOpenLocally(props.file.name)}>
          <button
            type="button"
            title="本地打开"
            class="p-1 rounded hover:bg-[var(--octo-surface-selected)]"
            onClick={(e) => {
              e.stopPropagation()
              void openFileLocally(props.file.path)
            }}
          >
            <IconActionOpen size={14} />
          </button>
        </Show>
        <button
          type="button"
          title="文件夹"
          class="p-1 rounded hover:bg-[var(--octo-surface-selected)]"
          onClick={(e) => {
            e.stopPropagation()
            revealFileInFolder(props.file.path)
          }}
        >
          <IconActionFolder size={14} />
        </button>
      </div>
    </div>
  )
}

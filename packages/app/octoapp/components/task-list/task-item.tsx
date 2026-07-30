import { Show } from "solid-js"
import { TaskStore, type TaskItem } from "@/context/task"
import { getFileIcon } from "@/pages/make/icons/file-type-icons"
import type { ArtifactFileKind } from "@/pages/make/utils/artifact-file-api"

// 类型 → 标签文案
const typeLabel: Record<TaskItem["type"], string> = {
  upload: "上传",
  download: "下载",
  archive: "归档",
}

// 类型 × 状态 → 状态描述文案
const statusTextByType: Record<TaskItem["type"], Record<TaskItem["status"], string>> = {
  upload: { pending: "解析中", in_progress: "上传中", paused: "已暂停", completed: "上传完成", error: "上传失败", cancelled: "已取消" },
  download: { pending: "等待中", in_progress: "下载中", paused: "已暂停", completed: "下载完成", error: "下载失败", cancelled: "已取消" },
  archive: { pending: "打包中", in_progress: "归档中", paused: "已暂停", completed: "归档完成", error: "归档失败", cancelled: "已取消" },
}

// 状态描述字体色(completed/error 走主题变量，暗色主题下仍可读)
const statusTextColor: Record<TaskItem["status"], string> = {
  pending: "#777777",
  in_progress: "#777777",
  paused: "#191919",
  completed: "var(--icon-success-base)",
  error: "var(--icon-critical-base)",
  cancelled: "#777777",
}

// 由文件名后缀推断文件种类，用于匹配文件图标
function inferKind(name: string): ArtifactFileKind {
  const ext = name.split(".").pop()?.toLowerCase() ?? ""
  if (ext === "html" || ext === "htm") return "html"
  if (ext === "svg") return "svg"
  if (["png", "jpg", "jpeg", "gif", "bmp", "webp", "ico"].includes(ext)) return "image"
  if (["mp4", "avi", "mov", "mkv", "webm"].includes(ext)) return "video"
  if (["mp3", "wav", "ogg", "flac", "aac"].includes(ext)) return "audio"
  if (ext === "md" || ext === "mdx") return "markdown"
  if (ext === "txt" || ext === "log") return "text"
  if (ext === "pdf") return "pdf"
  if (["xlsx", "xls", "docx", "doc", "pptx", "ppt"].includes(ext)) return "document"
  if (["zip", "tar", "gz", "rar", "7z", "sql", "bak"].includes(ext)) return "binary"
  if (["ts", "tsx", "js", "jsx", "py", "go", "rs", "c", "cpp", "java", "rb", "sh", "css", "scss", "less", "vue"].includes(ext)) return "code"
  if (ext === "fig") return "binary"
  return "binary"
}

export function TaskItemRow(props: {
  item: TaskItem
  onPause: (item: TaskItem) => void
  onCancel: (item: TaskItem) => void
}) {
  const item = () => props.item
  const progressPercent = () => Math.round(item().progress ?? 0)
  const isCompleted = () => item().status === "completed"
  const isError = () => item().status === "error"
  const isCancelled = () => item().status === "cancelled"
  const isPending = () => item().status === "pending"
  const isInProgress = () => item().status === "in_progress"
  const isPaused = () => item().status === "paused"
  const isTerminal = () => isCompleted() || isError() || isCancelled()
  // 暂停/继续按钮：仅 in_progress / paused 且 canPause 时显示（hover 才出现，见下方 opacity）
  const showPause = () => item().canPause && (isInProgress() || isPaused())
  // 取消按钮：非终态且 canCancel 时显示
  const showCancel = () => item().canCancel && (isPending() || isInProgress() || isPaused())
  // 进度条填充色：进行中蓝、暂停灰（pending 为 0% 不显形）
  const barColor = () => isInProgress() ? "#0A59F7" : "#777777"
  const totalSize = () => item().size > 0 ? TaskStore.formatFileSize(item().size) : ""
  const downloadedSize = () => {
    if (item().size <= 0) return ""
    const downloaded = item().size * (item().progress ?? 0) / 100
    return TaskStore.formatFileSize(downloaded)
  }

  return (
    <div
      class="group hover:bg-[rgba(25,25,25,0.05)]"
      style={{ padding: "8px", "border-radius": "8px" }}
    >
      <div class="flex items-center">
        {/* 左侧文件图标 24×24，右边距 12px */}
        <div style={{ width: "24px", height: "24px", "margin-right": "12px", flex: "0 0 auto" }}>
          {getFileIcon(inferKind(item().name), item().name)({ size: 24 })}
        </div>
        <div class="flex-1 min-w-0 flex flex-col">
          {/* 标题行：文件名 + 类型标签（间距 4px） */}
          <div class="flex items-center gap-1 min-w-0">
            <span class="truncate text-[14px] leading-[20px]" style={{ color: "#191919" }}>
              {item().name}
            </span>
            <span class="shrink-0 flex items-center justify-center text-[10px] leading-none" style={{ width: "36px", height: "18px", "border-radius": "4px", background: "rgba(25,25,25,0.05)", color: "#191919" }}>
              {typeLabel[item().type]}
            </span>
          </div>
          {/* 副行：状态描述 + 已下载/总大小（仅 hasProgress 且非终态显示大小） */}
          <div class="flex items-center gap-1 text-[12px] leading-[16px]" style={{ color: "rgba(0,0,0,0.4)" }}>
            <span style={{ color: statusTextColor[item().status] }}>
              {statusTextByType[item().type][item().status]}
            </span>
            <Show when={totalSize() && item().hasProgress && !isTerminal()}>
              <span>·</span>
              <span>
                <Show when={downloadedSize()}>
                  {downloadedSize()}/
                </Show>
                {totalSize()}
              </span>
            </Show>
          </div>
        </div>
        {/* 右侧操作区：hover 才显示暂停/取消按钮；下方百分比仅 hasProgress 且非终态显示 */}
        <div class="flex flex-col items-end gap-1 shrink-0" classList={{ "self-start": !item().hasProgress }}>
          <div class="flex items-center gap-3 opacity-0 group-hover:opacity-100 transition-opacity">
            <Show when={showPause()}>
              <button
                type="button"
                disabled={item().pauseDisabled}
                class="rounded-full transition-colors"
                classList={{
                  "hover:bg-black/[0.06] cursor-pointer": !item().pauseDisabled,
                  "opacity-40 cursor-not-allowed": item().pauseDisabled,
                }}
                style={{ width: "16px", height: "16px", "background-image": `url(${isPaused() ? "/task/task-play.svg" : "/task/task-pause.svg"})`, "background-size": "contain", "background-repeat": "no-repeat", "background-position": "center" }}
                onClick={() => props.onPause(item())}
              />
            </Show>
            <Show when={showCancel()}>
              <button
                type="button"
                disabled={item().cancelDisabled}
                class="rounded-full transition-colors"
                classList={{
                  "hover:bg-black/[0.06] cursor-pointer": !item().cancelDisabled,
                  "opacity-40 cursor-not-allowed": item().cancelDisabled,
                }}
                style={{ width: "16px", height: "16px", "background-image": "url(/task/task-cancel.svg)", "background-size": "contain", "background-repeat": "no-repeat", "background-position": "center" }}
                onClick={() => props.onCancel(item())}
              />
            </Show>
          </div>
          <Show when={item().hasProgress && !isTerminal()}>
            <span class="text-[12px] leading-[16px]" style={{ color: statusTextColor[item().status] }}>
              {progressPercent()}%
            </span>
          </Show>
        </div>
      </div>
      {/* 进度条：非终态且有进度信息(hasProgress)时显示；轨道用主题弱边框色，填充色见 barColor，外层留 3px 上下间距 */}
      <Show when={!isTerminal() && item().hasProgress}>
        <div style={{ "margin-top": "4px", "padding-top": "3px", "padding-bottom": "3px" }}>
          <div style={{ height: "4px", background: "var(--border-weak-base)", "border-radius": "2px", overflow: "hidden" }}>
            <div style={{ height: "4px", width: `${progressPercent()}%`, background: barColor(), "border-radius": "2px" }} />
          </div>
        </div>
      </Show>
    </div>
  )
}

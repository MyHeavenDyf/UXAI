import { Show } from "solid-js"
import { Icon } from "@opencode-ai/ui/icon"
import { TaskStore, type TaskItem } from "@/context/task"
import { getFileIcon } from "@/pages/make/icons/file-type-icons"
import type { ArtifactFileKind } from "@/pages/make/utils/artifact-file-api"

const statusText: Record<TaskItem["status"], string> = {
  pending: "等待中",
  in_progress: "传输中",
  completed: "已完成",
  error: "失败",
  cancelled: "已取消",
}

const statusColor: Record<TaskItem["status"], string> = {
  pending: "rgba(0,0,0,0.4)",
  in_progress: "#0A59F7",
  completed: "var(--icon-success-base)",
  error: "var(--icon-critical-base)",
  cancelled: "rgba(0,0,0,0.4)",
}

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

export function TaskItemRow(props: { item: TaskItem }) {
  const item = () => props.item
  const progressPercent = () => Math.round(item().progress)
  const isCancelled = () => item().status === "cancelled"
  const isCompleted = () => item().status === "completed"
  const isError = () => item().status === "error"
  const isPending = () => item().status === "pending"
  const isInProgress = () => item().status === "in_progress"
  const showCancel = () => isPending() || isInProgress() || isError()
  const totalSize = () => item().size > 0 ? TaskStore.formatFileSize(item().size) : ""
  const downloadedSize = () => {
    if (item().size <= 0) return ""
    const downloaded = item().size * item().progress / 100
    return TaskStore.formatFileSize(downloaded)
  }

  return (
    <div class="task-item" style={{
      padding: "8px 0",
      opacity: isCancelled() ? 0.5 : 1,
    }}>
      <div class="flex items-center gap-3" style={{ "min-height": "32px" }}>
        {getFileIcon(inferKind(item().name), item().name)({ size: 32 })}
        <div class="flex-1 min-w-0 flex flex-col justify-center">
          <span class="truncate text-[14px] leading-[20px]" style={{ color: "rgba(0,0,0,0.9)" }}>
            {item().name}
          </span>
          <Show when={totalSize()}>
            <span class="text-[12px] leading-[16px]" style={{ color: "rgba(0,0,0,0.4)" }}>
              <Show when={downloadedSize() && !isCompleted()}>
                {downloadedSize()}/
              </Show>
              {totalSize()}
            </span>
          </Show>
        </div>
        <div class="shrink-0 flex flex-col items-end">
          <Show when={showCancel()}>
            <button
              type="button"
              disabled={item().type === "upload" && isPending()}
              class="flex items-center justify-center rounded-full transition-colors"
              classList={{
                "hover:bg-black/[0.06] cursor-pointer": !(item().type === "upload" && isPending()),
                "opacity-40 cursor-not-allowed": item().type === "upload" && isPending(),
              }}
              style={{ width: "20px", height: "20px" }}
              onClick={() => TaskStore.cancel(item())}
            >
              <Icon name="close-small" size="small" style={{ color: "rgba(0,0,0,0.4)" }} />
            </button>
          </Show>
          <span class="text-[12px] leading-[16px]" style={{ color: statusColor[item().status] }}>
            {isCompleted() ? "100%" : `${progressPercent()}%`}
          </span>
        </div>
      </div>
      <div class="mt-2 h-[6px] rounded-full overflow-hidden" style={{ background: "rgba(0,0,0,0.06)" }}>
        <Show when={!isPending()}>
          <div
            class="h-full rounded-full transition-all duration-300"
            style={{
              width: `${progressPercent()}%`,
              background: isError() ? "var(--icon-critical-base)" : isCompleted() ? "var(--icon-success-base)" : "#0A59F7",
            }}
          />
        </Show>
      </div>
    </div>
  )
}

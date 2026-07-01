import { For, Show } from "solid-js"
import type { JSX } from "solid-js"
import type { ArtifactFileKind } from "../utils/artifact-file-api"
import { getFileIcon } from "../icons/file-type-icons"

export type Attachment = {
  id: string
  filename: string
  mime: string
  dataUrl: string
  path?: string
  kind?: ArtifactFileKind
}

/** 单行横向滚动附件栏，放在输入框白卡片内部、文本输入框上方 */
export function AttachmentBar(props: {
  attachments: Attachment[]
  onRemove: (id: string) => void
}): JSX.Element {
  return (
    <Show when={props.attachments.length > 0}>
      <div class="px-4 pt-3">
        <div class="flex items-center gap-2 overflow-x-auto flex-nowrap">
          <For each={props.attachments}>
            {(att) => {
              const kind = att.kind ?? kindFromMime(att.mime)
              const FileIcon = getFileIcon(kind, att.filename)
              return (
                <div
                  class="flex items-center shrink-0"
                  style={{
                    height: "40px",
                    padding: "0 12px",
                    "border-radius": "8px",
                    background: "#f3f3f3",
                    gap: "8px",
                  }}
                >
                  <FileIcon size={24} />
                  <span
                    class="whitespace-nowrap"
                    style={{
                      "font-size": "14px",
                      "line-height": "22px",
                      color: "rgba(0, 0, 0, 0.9)",
                    }}
                  >
                    {att.filename}
                  </span>
                  <button
                    type="button"
                    onClick={() => props.onRemove(att.id)}
                    class="attachment-close-btn flex items-center justify-center shrink-0"
                    style={{
                      width: "16px",
                      height: "16px",
                      cursor: "pointer",
                      background: "transparent",
                      border: "none",
                      padding: "0",
                      color: "rgba(0, 0, 0, 0.6)",
                    }}
                  >
                    <svg viewBox="0 0 16 16" width="16" height="16" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M12.8681 3.81199C12.9557 3.71205 12.9995 3.59963 12.9995 3.4747C12.9995 3.34978 12.9557 3.24152 12.8681 3.14991C12.7763 3.04997 12.6658 3 12.5364 3C12.4071 3 12.2965 3.04997 12.2048 3.14991L7.99951 7.34728L3.79426 3.14991C3.70247 3.04997 3.59192 3 3.46259 3C3.33326 3 3.21854 3.04997 3.11841 3.14991C3.03914 3.24152 2.99951 3.34978 2.99951 3.4747C2.99951 3.59963 3.03914 3.71205 3.11841 3.81199L7.33618 8.00937L3.11841 12.1943C3.03914 12.2942 2.99951 12.4087 2.99951 12.5378C2.99951 12.6669 3.03914 12.7772 3.11841 12.8688C3.21854 12.9479 3.33326 12.9896 3.46259 12.9938C3.59192 12.9979 3.70247 12.9563 3.79426 12.8688L7.99951 8.67146L12.2048 12.8688C12.2965 12.9563 12.4071 13 12.5364 13C12.6658 13 12.7763 12.9563 12.8681 12.8688C12.9557 12.7772 12.9995 12.6669 12.9995 12.5378C12.9995 12.4087 12.9557 12.2942 12.8681 12.1943L8.66284 8.00937L12.8681 3.81199Z" fill="currentColor" fill-opacity="0.6" fill-rule="nonzero" />
                    </svg>
                  </button>
                </div>
              )
            }}
          </For>
        </div>
      </div>
    </Show>
  )
}

function kindFromMime(mime: string): ArtifactFileKind {
  if (mime.startsWith("image/")) return "image"
  if (mime.startsWith("video/")) return "video"
  if (mime.startsWith("audio/")) return "audio"
  if (mime === "application/pdf") return "pdf"
  if (mime === "text/html") return "html"
  if (mime === "image/svg+xml") return "svg"
  if (mime === "text/markdown" || mime === "text/x-markdown") return "markdown"
  if (mime.startsWith("text/")) return "text"
  if (mime.includes("word") || mime.includes("docx")) return "document"
  if (mime.includes("excel") || mime.includes("xlsx") || mime.includes("spreadsheet")) return "document"
  if (mime.includes("powerpoint") || mime.includes("presentation")) return "document"
  return "binary"
}

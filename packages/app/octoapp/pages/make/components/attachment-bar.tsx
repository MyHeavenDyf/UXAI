import { For, Show } from "solid-js"
import type { JSX } from "solid-js"
import type { ArtifactFileKind } from "../utils/artifact-file-api"
import { getFileIcon } from "../icons/file-type-icons"
import { Spinner } from "@opencode-ai/ui/spinner"

export type AttachmentStatus = "uploading" | "done" | "error"
export type AttachmentSource = "external" | "local" | "pending"

export type Attachment = {
  id: string
  filename: string
  mime: string
  size: number
  status: AttachmentStatus
  source: AttachmentSource
  url?: string
  previewUrl?: string
  dataUrl?: string
  path?: string
  kind?: ArtifactFileKind
  error?: string
  retriable?: boolean
}

const SPIN_ANGLES = [0, 45, 90, 135, 180, 225, 270, 315]

function UploadSpinner(): JSX.Element {
  return (
    <svg viewBox="0 0 12 12" width="12" height="12" fill="none" class="octo-att-spin" aria-hidden="true">
      {SPIN_ANGLES.map((deg, i) => {
        const rad = (deg - 90) * Math.PI / 180
        return (
          <line
            x1={6 + 3.1 * Math.cos(rad)}
            y1={6 + 3.1 * Math.sin(rad)}
            x2={6 + 5.0 * Math.cos(rad)}
            y2={6 + 5.0 * Math.sin(rad)}
            stroke="white"
            stroke-width="1.2"
            stroke-linecap="round"
            opacity={1 - i * 0.1}
          />
        )
      })}
    </svg>
  )
}

function ExclamationCircleIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 10 10" width="10" height="10" fill="none" aria-hidden="true" style={{ "flex-shrink": "0" }}>
      <circle cx="5" cy="5" r="4.45" stroke="rgb(224,33,40)" stroke-width="0.65" />
      <path d="M5 2.7v3.1" stroke="rgb(224,33,40)" stroke-width="0.9" stroke-linecap="round" />
      <circle cx="5" cy="7.15" r="0.55" fill="rgb(224,33,40)" />
    </svg>
  )
}

function XMarkIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="none" aria-hidden="true">
      <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" stroke="rgba(0,0,0,0.6)" stroke-width="1.4" stroke-linecap="round" />
    </svg>
  )
}

function AttachmentChip(props: {
  att: Attachment
  onRemove: (id: string) => void
  onRetry?: (id: string) => void
}): JSX.Element {
  const isUploading = () => props.att.status === "uploading"
  const isError = () => props.att.status === "error"
  const isImage = () => props.att.mime.startsWith("image/") || props.att.kind === "image" || props.att.kind === "svg"
  const kind = () => props.att.kind ?? kindFromMime(props.att.mime)

  return (
    <div
      class="flex items-center shrink-0"
      style={{
        height: isError() ? "56px" : "40px",
        padding: "0 12px",
        "border-radius": "8px",
        background: "#f3f3f3",
        gap: "8px",
        position: "relative",
      }}
    >
      <div style={{ position: "relative", width: "24px", height: "24px", "flex-shrink": "0" }}>
        <Show when={props.att.previewUrl && isImage()}>
          <img
            src={props.att.previewUrl}
            width={24}
            height={24}
            alt=""
            aria-hidden="true"
            style={{
              display: "block",
              width: "24px",
              height: "24px",
              "object-fit": "cover",
              "border-radius": "4px",
            }}
          />
        </Show>
        <Show when={!props.att.previewUrl || !isImage()}>
          {getFileIcon(kind(), props.att.filename)({ size: 24 })}
        </Show>
        <Show when={isUploading()}>
          <div
            style={{
              position: "absolute",
              inset: "0",
              background: "rgba(0,0,0,0.4)",
              "border-radius": "4px",
              display: "flex",
              "align-items": "center",
              "justify-content": "center",
            }}
          >
            <UploadSpinner />
          </div>
        </Show>
      </div>

      <div style={{ flex: "1", "min-width": "0", display: "flex", "flex-direction": "column", gap: "2px", "padding-right": "24px" }}>
        <span
          title={props.att.filename}
          class="whitespace-nowrap"
          style={{
            "font-size": "14px",
            "line-height": "22px",
            color: "rgba(0, 0, 0, 0.9)",
            overflow: "hidden",
            "text-overflow": "ellipsis",
          }}
        >
          {props.att.filename}
        </span>
        <Show when={isError()}>
          <div style={{ display: "flex", "align-items": "center", gap: "4px", height: "18px" }}>
            <ExclamationCircleIcon />
            <span
              title={props.att.error ?? "上传失败"}
              style={{
                "font-size": "11px",
                color: "rgb(224,33,40)",
                "white-space": "nowrap",
                overflow: "hidden",
                "text-overflow": "ellipsis",
                flex: "1",
                "min-width": "0",
              }}
            >
              {props.att.error ?? "上传失败"}
            </span>
            <Show when={props.att.retriable && props.onRetry}>
              <button
                type="button"
                onClick={() => props.onRetry?.(props.att.id)}
                style={{
                  "font-size": "11px",
                  color: "rgb(10,89,247)",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  padding: "0",
                  "flex-shrink": "0",
                  "text-decoration": "underline",
                }}
              >
                重试
              </button>
            </Show>
          </div>
        </Show>
      </div>

      <button
        type="button"
        onClick={() => props.onRemove(props.att.id)}
        class="attachment-close-btn flex items-center justify-center shrink-0"
        style={{
          width: "16px",
          height: "16px",
          cursor: "pointer",
          background: "transparent",
          border: "none",
          padding: "0",
          color: "rgba(0, 0, 0, 0.6)",
          position: "absolute",
          right: "12px",
          top: isError() ? "20px" : "12px",
        }}
        title="移除"
      >
        <XMarkIcon />
      </button>
    </div>
  )
}

export function AttachmentBar(props: {
  attachments: Attachment[]
  onRemove: (id: string) => void
  onRetry?: (id: string) => void
}): JSX.Element {
  return (
    <Show when={props.attachments.length > 0}>
      <div class="px-4 pt-3">
        <div class="flex items-center gap-2 overflow-x-auto flex-nowrap">
          <For each={props.attachments}>
            {(att) => (
              <AttachmentChip
                att={att}
                onRemove={props.onRemove}
                onRetry={props.onRetry}
              />
            )}
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
/**
 * 3D 预览页 —— 精简工具栏 + SceneCanvas(替代 pattern 的 iframe+postMessage 方案)。
 * 接口对齐 pattern/modules/preview,供页面 index.tsx 使用:
 *   直接传 doc(SceneDocument),SceneCanvas 响应式重建,无需 sendToPreview postMessage。
 */
import { For, Show, createSignal, type JSX } from "solid-js"
import { SceneCanvas, type SceneCanvasAPI } from "./SceneCanvas"
import type { SceneDocument } from "../../utils/scene-protocol"
import type { VersionEntry } from "../../utils/persist"

export type PreviewPageAPI = {
  refresh: () => void
}

export function PreviewPage(props: {
  api?: PreviewPageAPI
  /** 完整场景文档,变化时 SceneCanvas 自动重建 */
  doc: SceneDocument | null
  onDownload?: () => void
  versions?: VersionEntry[]
  currentVersionId?: string | null
  onSelectVersion?: (id: string) => void
  /** 点选物体回调(对应 pattern 的 onModifyElement/onPickerSubmit,3D 简化为单回调) */
  onPickObject?: (id: string | null) => void
}): JSX.Element {
  let containerRef: HTMLDivElement | undefined
  let canvasApi: SceneCanvasAPI | undefined
  const [versionOpen, setVersionOpen] = createSignal(false)

  if (props.api) props.api.refresh = () => canvasApi?.refresh()

  const toolBtn = (label: string, onClick: () => void): JSX.Element => (
    <button
      type="button"
      onClick={onClick}
      class="px-2 py-1 rounded text-[12px] leading-[18px]"
      style={{ color: "rgba(255,255,255,0.85)", background: "transparent", cursor: "pointer", border: "none" }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.1)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      {label}
    </button>
  )

  return (
    <div ref={containerRef} class="flex flex-col h-full overflow-hidden" style={{ background: "#0d1117" }}>
      <div
        class="flex items-center justify-between shrink-0 relative"
        style={{ padding: "6px 10px", background: "#1a1a22", "border-bottom": "1px solid #2a2a35" }}
      >
        <div class="flex items-center gap-1">
          {toolBtn("刷新", () => canvasApi?.refresh())}
          {toolBtn("重置视角", () => canvasApi?.resetView())}
        </div>
        <div class="flex items-center gap-1">
          <Show when={props.versions && props.versions.length > 0}>
            <div class="relative">
              <button
                type="button"
                onClick={() => setVersionOpen((v) => !v)}
                class="px-2 py-1 rounded text-[12px] leading-[18px]"
                style={{ color: "rgba(255,255,255,0.85)", background: "transparent", cursor: "pointer", border: "none" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.1)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                历史版本
              </button>
              <Show when={versionOpen()}>
                <div
                  class="absolute right-0 top-full mt-1 rounded-md overflow-hidden z-50"
                  style={{ background: "#2a2a35", "min-width": "180px", "max-height": "260px", "overflow-y": "auto" }}
                  onMouseLeave={() => setVersionOpen(false)}
                >
                  <For each={props.versions}>
                    {(v) => (
                      <button
                        type="button"
                        onClick={() => { setVersionOpen(false); props.onSelectVersion?.(v.id) }}
                        class="block w-full text-left px-3 py-2 text-[12px] leading-[18px]"
                        style={{
                          color: v.id === props.currentVersionId ? "#5b9bff" : "rgba(255,255,255,0.85)",
                          background: "transparent",
                          cursor: "pointer",
                          border: "none",
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.08)")}
                        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                      >
                        {v.summary}
                        {v.id === props.currentVersionId ? "（当前）" : ""}
                      </button>
                    )}
                  </For>
                </div>
              </Show>
            </div>
          </Show>
          <Show when={props.onDownload}>{toolBtn("下载", () => props.onDownload?.())}</Show>
          {toolBtn("全屏", () => containerRef?.requestFullscreen?.())}
        </div>
      </div>

      <div class="flex-1 min-h-0">
        <SceneCanvas doc={props.doc} onPickObject={props.onPickObject} ref={(api) => { canvasApi = api }} />
      </div>
    </div>
  )
}

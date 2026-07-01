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
  /** 点「实时预览」:写 live-3d.json 并新开独立预览窗口 */
  onLivePreview?: () => void
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

  const btnResetHover = (e: MouseEvent) => (e.currentTarget as HTMLElement).style.background = "transparent"
  const btn = (label: string, onClick: () => void, icon?: JSX.Element): JSX.Element => (
    <button
      type="button"
      onClick={onClick}
      style={{ display: "inline-flex", "align-items": "center", gap: "4px", padding: "3px 8px", "border-radius": "4px",
        color: "rgba(0,0,0,0.6)", background: "transparent", cursor: "pointer", border: "none",
        "font-size": "12px", "line-height": "18px" }}
      onMouseEnter={(e) => (e.currentTarget as HTMLElement).style.background = "rgba(0,0,0,0.06)"}
      onMouseLeave={btnResetHover}
    >
      <span>{label}</span>
      {icon}
    </button>
  )
  const iconBtn = (title: string, onClick: () => void, svg: JSX.Element): JSX.Element => (
    <button type="button" title={title} onClick={onClick}
      style={{ display: "inline-flex", "align-items": "center", "justify-content": "center", width: "28px", height: "28px",
        "border-radius": "4px", color: "rgba(0,0,0,0.55)", background: "transparent", cursor: "pointer", border: "none" }}
      onMouseEnter={(e) => (e.currentTarget as HTMLElement).style.background = "rgba(0,0,0,0.06)"}
      onMouseLeave={btnResetHover}
    >
      {svg}
    </button>
  )
  const divider = (): JSX.Element => <div style={{ width: "1px", height: "14px", background: "#ddd", margin: "0 4px", "flex-shrink": "0" }} />
  const chevron = (): JSX.Element => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="10" height="10" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  )

  return (
    <div ref={containerRef} class="flex flex-col h-full overflow-hidden" style={{ background: "#ffffff" }}>
      <div
        class="flex items-center justify-between shrink-0 relative"
        style={{ padding: "4px 10px", background: "#f5f5f5", "border-bottom": "1px solid #e0e0e0" }}
      >
        {/* 左侧:刷新 + 重置视角 + 分隔线 + 历史版本 */}
        <div style={{ display: "flex", "align-items": "center", gap: "2px" }}>
          {iconBtn("刷新", () => canvasApi?.refresh(),
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="14" height="14" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/>
            </svg>
          )}
          {iconBtn("重置视角", () => canvasApi?.resetView(),
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="14" height="14" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="3"/><path d="M12 2v4m0 12v4M2 12h4m12 0h4"/>
            </svg>
          )}
        </div>

        {/* 右侧:下载 + 实时预览 + 历史版本 + 全屏 */}
        <div style={{ display: "flex", "align-items": "center", gap: "2px" }}>
          <Show when={props.onDownload}>
            {btn("下载", () => props.onDownload?.(),
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="12" height="12" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>
              </svg>
            )}
          </Show>
          <Show when={props.onLivePreview}>
            {btn("实时预览", () => props.onLivePreview?.(),
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="12" height="12" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M18 10l-6-6-6 6M12 4v16"/>
              </svg>
            )}
          </Show>
          <Show when={props.versions && props.versions.length > 0}>
            <div class="relative">
              {btn("历史版本", () => setVersionOpen((v) => !v), chevron())}
              <Show when={versionOpen()}>
                <div
                  class="absolute right-0 top-full mt-1 rounded-md overflow-hidden z-50"
                  style={{ background: "#ffffff", "min-width": "180px", "max-height": "260px", "overflow-y": "auto", "box-shadow": "0 4px 12px rgba(0,0,0,0.1)", border: "1px solid #e0e0e0" }}
                  onMouseLeave={() => setVersionOpen(false)}
                >
                  <For each={props.versions}>
                    {(v) => (
                      <button
                        type="button"
                        onClick={() => { setVersionOpen(false); props.onSelectVersion?.(v.id) }}
                        class="block w-full text-left px-3 py-2 text-[12px] leading-[18px]"
                        style={{
                          color: v.id === props.currentVersionId ? "#2979ff" : "rgba(0,0,0,0.75)",
                          background: "transparent", cursor: "pointer", border: "none",
                        }}
                        onMouseEnter={(e) => (e.currentTarget as HTMLElement).style.background = "rgba(0,0,0,0.06)"}
                        onMouseLeave={(e) => (e.currentTarget as HTMLElement).style.background = "transparent"}
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
          {iconBtn("全屏", () => containerRef?.requestFullscreen?.(),
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="14" height="14" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="13 2 22 2 22 11" /><polyline points="11 22 2 22 2 13" /><line x1="22" y1="2" x2="13" y2="11" /><line x1="2" y1="22" x2="11" y2="13" />
            </svg>
          )}
        </div>
      </div>

      <div class="flex-1 min-h-0">
        <SceneCanvas doc={props.doc} onPickObject={props.onPickObject} ref={(api) => { canvasApi = api }} />
      </div>
    </div>
  )
}

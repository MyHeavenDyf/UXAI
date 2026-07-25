/**
 * 3D 预览页：iframe 嵌入 3d-templete embed.vue，走 SCENE_* 通信。
 *
 * 工具栏（TitleBar3D，参考 pattern titlebar-wrapper，UI 一致）：
 *   刷新 / 预览(另开窗口) / 设备切换(桌面/平板/手机) /
 *   复位 / 编辑 / 历史 / 主题(预留) / 分享 / 下载
 *
 * 编辑态浮层（仅在编辑模式时显示）：
 *   部件/整体粒度切换 + 聚焦选中物 + 属性编辑弹窗
 */
import { createEffect, createSignal, on, onCleanup, Show } from "solid-js"
import type { SceneConfig, SceneConfigObject3D, ScenePatch } from "../../utils/scene-config"
import { showToast } from "@opencode-ai/ui/toast"
import { PropertyEditor3DPopup } from "./property-editor-popup"
import { TitleBar3D } from "./title-bar"
import type { VersionEntry } from "../../utils/version-history"

export type PreviewPageAPI = {
  sendToPreview: (data: SceneConfig | null) => void
  /** 增量补丁（SCENE_PATCH），供外部主动调用；内部编辑器也用同一通路 */
  sendPatch?: (patch: ScenePatch) => void
  /** 开关编辑态拾取（SCENE_PICK_MODE） */
  sendPickMode?: (enabled: boolean) => void
  /** 聚焦物体（SCENE_FLY_TO） */
  sendFlyTo?: (targetId: string) => void
  /** 复位相机到初始视角（SCENE_RESET_CAMERA） */
  sendResetCamera?: () => void
  /** 切主题（SCENE_THEME） */
  sendTheme?: (mode: "light" | "dark") => void
}

export function PreviewPage3D(props: {
  api?: PreviewPageAPI
  pendingData?: SceneConfig | null
  previewSrc: string
  sessionId?: string
  onReady?: () => void
  /** 编辑器产生增量补丁时回调父组件（用于回写 authoritative state + 持久化，避免编辑丢失） */
  onPatch?: (patch: ScenePatch) => void
  /** 以下 TitleBar 回调由 pages/3d/index.tsx 传入 */
  versions?: VersionEntry[]
  currentVersionId?: string | null
  onSelectVersion?: (versionId: string) => void
  onPreview?: () => void
  onCanvasEditing?: () => void
  archiving?: boolean
  onArchiveToggle?: () => void
  onShare?: () => void
  onDownload?: () => void
}) {
  let iframeRef: HTMLIFrameElement | undefined

  // ── 编辑态 / 拾取 / 本地物体表 ──
  const [editMode, setEditMode] = createSignal(false)
  /** 选中粒度：'part'(部件，默认) | 'whole'(整体，如整棵树/整张桌) */
  const [pickGranularity, setPickGranularity] = createSignal<"part" | "whole">("part")
  const [pickedObj, setPickedObj] = createSignal<SceneConfigObject3D | null>(null)
  /** id → SceneConfigObject3D：从 pendingData 同步，patch 时本地更新，保证连续编辑基于最新 def */
  const [objectsById, setObjectsById] = createSignal<Map<string, SceneConfigObject3D>>(new Map())

  function post(msg: Record<string, unknown>): void {
    iframeRef?.contentWindow?.postMessage(msg, "*")
  }
  function sendToPreview(data: SceneConfig | null): void {
    if (!iframeRef?.contentWindow) {
      console.log("[3d] sendToPreview skipped: no iframe")
      return
    }
    console.log("[3d] sendToPreview posting SCENE_UPDATE")
    post({ type: "SCENE_UPDATE", payload: data })
  }
  function sendPatch(patch: ScenePatch): void {
    post({ type: "SCENE_PATCH", payload: patch })
    applyPatchToLocal(patch)
    props.onPatch?.(patch)
  }
  function sendPickMode(enabled: boolean): void {
    post({ type: "SCENE_PICK_MODE", enabled })
  }
  function sendPickGranularity(mode: "part" | "whole"): void {
    post({ type: "SCENE_PICK_GRANULARITY", granularity: mode })
  }
  function sendFlyTo(targetId: string): void {
    post({ type: "SCENE_FLY_TO", targetId })
  }
  function sendResetCamera(): void {
    post({ type: "SCENE_RESET_CAMERA" })
  }
  function sendTheme(mode: "light" | "dark"): void {
    post({ type: "SCENE_THEME", mode })
  }

  /** 本地同步补丁，避免连续编辑基于过期 def */
  function applyPatchToLocal(patch: ScenePatch): void {
    setObjectsById((prev) => {
      const m = new Map(prev)
      for (const o of patch.objects?.upsert ?? []) {
        if (o.id) m.set(o.id, o)
      }
      for (const id of patch.objects?.remove ?? []) m.delete(id)
      return m
    })
  }

  // 注入 api（父组件通过 props.api 调用）
  if (props.api) {
    props.api.sendToPreview = sendToPreview
    props.api.sendPatch = sendPatch
    props.api.sendPickMode = sendPickMode
    props.api.sendFlyTo = sendFlyTo
    props.api.sendResetCamera = sendResetCamera
    props.api.sendTheme = sendTheme
  }

  // pendingData 变化（新生成/切会话/恢复）→ 重建本地物体表 + 关弹窗
  createEffect(
    on(
      () => props.pendingData,
      (data) => {
        const m = new Map<string, SceneConfigObject3D>()
        if (data?.objects) {
          for (const o of data.objects) if (o.id) m.set(o.id, o)
        }
        setObjectsById(m)
        setPickedObj(null)
      },
      { defer: false },
    ),
  )

  function toggleEditMode(): void {
    const next = !editMode()
    setEditMode(next)
    sendPickMode(next)
    // picker 每次渲染新建、默认 'part'，进入编辑态时需重申当前粒度
    if (next) sendPickGranularity(pickGranularity())
    if (!next) setPickedObj(null)
  }

  function switchGranularity(mode: "part" | "whole"): void {
    if (pickGranularity() === mode) return
    setPickGranularity(mode)
    if (editMode()) sendPickGranularity(mode)
  }

  function handlePick(info: { id?: string }): void {
    const id = info.id
    if (!id) {
      setPickedObj(null)
      return
    }
    const obj = objectsById().get(id)
    if (obj) {
      setPickedObj(obj)
    } else {
      // 拾取到的是 group/component 子节点，当前 objectsById 无顶层 def：给一个最小可编辑 def（仅 Transform）
      console.log("[3d] SCENE_PICK 物体不在 objectsById，构造最小 def:", id)
      setPickedObj({ id, type: "group", parentId: null })
    }
  }

  // 收 iframe 消息
  const handleIframeMessage = (e: MessageEvent) => {
    const type = e.data?.type
    if (type === "SCENE_READY") {
      console.log("[3d] SCENE_READY received, re-sending pendingData")
      props.onReady?.()
      const pending = props.pendingData ?? null
      console.log("[3d] re-sending: pendingData is", pending ? `NON-NULL (objects=${(pending as any)?.objects?.length})` : "NULL")
      if (pending) {
        console.log("[3d] FULL SCENE PAYLOAD:", JSON.parse(JSON.stringify(pending)))
        post({ type: "SCENE_UPDATE", payload: pending })
        console.log("[3d] postMessage SCENE_UPDATE sent to iframe")
      }
    } else if (type === "SCENE_PICK") {
      console.log("[3d] SCENE_PICK:", e.data?.id)
      handlePick({ id: e.data?.id })
    } else if (type === "SCENE_ERROR") {
      console.error("[3d] SCENE_ERROR:", e.data?.message)
      showToast({ title: "场景渲染失败", description: e.data?.message ?? "未知错误" })
    }
  }

  window.addEventListener("message", handleIframeMessage)
  onCleanup(() => {
    window.removeEventListener("message", handleIframeMessage)
  })

  // ── 刷新：重置 iframe src 重载 embed ──
  function handleRefresh(): void {
    if (iframeRef) {
      iframeRef.src = props.previewSrc
    }
  }

  return (
    <div class="flex flex-col h-full w-full overflow-hidden bg-[var(--octo-surface-page,#1a1a2e)]">
      {/* 工具栏 */}
      <TitleBar3D
        onRefresh={handleRefresh}
        onPreview={() => props.onPreview?.()}
        onReset={() => sendResetCamera()}
        onToggleEditing={() => toggleEditMode()}
        onCanvasEditing={() => props.onCanvasEditing?.()}
        archiving={props.archiving}
        onArchiveToggle={() => props.onArchiveToggle?.()}
        versions={props.versions}
        currentVersionId={props.currentVersionId}
        onSelectVersion={(vid) => props.onSelectVersion?.(vid)}
        onThemeChange={(mode) => sendTheme(mode)}
        onShare={() => props.onShare?.()}
        onDownload={() => props.onDownload?.()}
        editing={editMode()}
      />

      {/* iframe 区域（flex-1 占剩余高度，iframe 铺满） */}
      <div class="relative flex-1 overflow-hidden" style={{ background: "var(--octo-surface-page,#1a1a2e)" }}>
        <iframe
          ref={(el) => {
            iframeRef = el
          }}
          src={props.previewSrc}
          onLoad={() => {
            console.log("[3d] iframe loaded")
            const pending = props.pendingData ?? null
            if (pending) post({ type: "SCENE_UPDATE", payload: pending })
          }}
          style={{ width: "100%", height: "100%", border: "none" }}
        />

        {/* 编辑态浮层：粒度切换 + 聚焦（右上角，仅编辑模式）。
            用 token 浅色块 + 深字 + 描边/阴影，确保在深色/浅色 3D 场景背景上都可读（参考项目 TitleBar 按钮风格）。 */}
        <Show when={editMode()}>
          <div class="absolute top-2 right-2 flex items-center gap-1.5 z-10" style={{ "pointer-events": "auto" }}>
            <Show when={pickedObj()}>
              <button
                class="rounded-md text-[12px] leading-none"
                style={{
                  height: "26px",
                  padding: "0 10px",
                  background: "var(--octo-surface, #ffffff)",
                  color: "var(--octo-text-primary, #1f2937)",
                  border: "1px solid var(--octo-border, #e5e7eb)",
                  "box-shadow": "0 1px 3px rgba(0,0,0,0.15)",
                }}
                onClick={() => pickedObj() && sendFlyTo(pickedObj()!.id)}
                title="聚焦到选中物体"
              >
                聚焦
              </button>
            </Show>
            <div
              class="flex items-center rounded-md overflow-hidden"
              style={{
                background: "var(--octo-surface, #ffffff)",
                border: "1px solid var(--octo-border, #e5e7eb)",
                "box-shadow": "0 1px 3px rgba(0,0,0,0.15)",
              }}
            >
              <button
                class="px-2 h-[26px] text-[11px] leading-none transition-colors"
                style={{
                  background: pickGranularity() === "part" ? "var(--octo-brand, #3d99ff)" : "transparent",
                  color: pickGranularity() === "part" ? "#fff" : "var(--octo-text-primary, #1f2937)",
                }}
                onClick={() => switchGranularity("part")}
                title="选中单个部件（树干/树冠）"
              >
                部件
              </button>
              <button
                class="px-2 h-[26px] text-[11px] leading-none transition-colors"
                style={{
                  background: pickGranularity() === "whole" ? "var(--octo-brand, #3d99ff)" : "transparent",
                  color: pickGranularity() === "whole" ? "#fff" : "var(--octo-text-primary, #1f2937)",
                }}
                onClick={() => switchGranularity("whole")}
                title="选中一个整体（整棵树/整张桌），整体变换"
              >
                整体
              </button>
            </div>
          </div>
        </Show>

        {/* 属性编辑弹窗 */}
        <Show when={pickedObj()} keyed>
          {(obj) => (
            <PropertyEditor3DPopup
              obj={obj}
              onPatch={(patch) => sendPatch(patch)}
              onClose={() => setPickedObj(null)}
            />
          )}
        </Show>

        <Show when={!props.pendingData}>
          <div class="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-white/40">
            <div class="text-base">3D 预览</div>
            <div class="mt-2 text-xs">场景生成中...</div>
          </div>
        </Show>

        <Show when={editMode()}>
          <div class="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 rounded bg-black/50 text-white/70 text-[11px] px-3 py-1">
            编辑模式：点击物体编辑属性，拖拽旋转视角 · 右上「部件/整体」切换选中粒度
          </div>
        </Show>
      </div>
    </div>
  )
}

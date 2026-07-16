/**
 * 3D 预览页：iframe 嵌入 3d-templete embed.vue，走 SCENE_* 通信。
 *
 * 阶段3 新增交互闭环：
 *   - 右上角"编辑"按钮 → sendPickMode(true) 开 iframe 侧 ScenePicker
 *   - iframe 拾取物体 → SCENE_PICK {id} → 从本地 objectsById 取 SceneConfigObject3D → 弹属性编辑器
 *   - 属性编辑器改字段 → sendPatch(SCENE_PATCH) → iframe 增量 upsert（不重建、不闪烁）
 *
 * 3D 不需要 pattern 的 canvas-view/property-editor/device-switch/drag-reorder（2D+DOM 专属），
 * 轨道交互在 iframe 内（OrbitControls）。
 *
 * 自包含：editMode/objectsById/pickedObj 全在本组件内管理，pages/3d/index.tsx 无需改动。
 */
import { createEffect, createSignal, on, onCleanup, Show } from "solid-js"
import type { SceneConfig, SceneConfigObject3D, ScenePatch } from "../../utils/scene-config"
import { showToast } from "@opencode-ai/ui/toast"
import { PropertyEditor3DPopup } from "./property-editor-popup"

export type PreviewPageAPI = {
  sendToPreview: (data: SceneConfig | null) => void
  /** 增量补丁（SCENE_PATCH），供外部主动调用；内部编辑器也用同一通路 */
  sendPatch?: (patch: ScenePatch) => void
  /** 开关编辑态拾取（SCENE_PICK_MODE） */
  sendPickMode?: (enabled: boolean) => void
  /** 聚焦物体（SCENE_FLY_TO） */
  sendFlyTo?: (targetId: string) => void
}

export function PreviewPage3D(props: {
  api?: PreviewPageAPI
  pendingData?: SceneConfig | null
  previewSrc: string
  sessionId?: string
  onReady?: () => void
}) {
  let iframeRef: HTMLIFrameElement | undefined

  // ── 编辑态 / 拾取 / 本地物体表 ──
  const [editMode, setEditMode] = createSignal(false)
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
  }
  function sendPickMode(enabled: boolean): void {
    post({ type: "SCENE_PICK_MODE", enabled })
  }
  function sendFlyTo(targetId: string): void {
    post({ type: "SCENE_FLY_TO", targetId })
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
    if (!next) setPickedObj(null)
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

  return (
    <div class="relative h-full w-full overflow-hidden bg-[#1a1a2e]">
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

      {/* 顶部工具条：编辑/拾取切换 + 聚焦选中物（对齐 Pattern .preview-action-btn 玻璃白按钮） */}
      <div class="absolute top-2 right-2 flex items-center gap-1.5 z-10" style={{ "pointer-events": "auto" }}>
        <Show when={pickedObj()}>
          <button
            class="preview-action-btn"
            style={{ width: "auto", padding: "0 10px", "font-size": "12px" }}
            onClick={() => pickedObj() && sendFlyTo(pickedObj()!.id)}
            title="聚焦到选中物体"
          >
            聚焦
          </button>
        </Show>
        <button
          class="preview-action-btn"
          style={{
            width: "auto",
            padding: "0 12px",
            "font-size": "12px",
            background: editMode() ? "var(--octo-brand)" : undefined,
            color: editMode() ? "#fff" : undefined,
            "border-color": editMode() ? "var(--octo-brand)" : undefined,
          }}
          onClick={() => toggleEditMode()}
          title={editMode() ? "退出编辑（恢复轨道操作）" : "进入编辑（点击物体编辑属性）"}
        >
          {editMode() ? "✓ 编辑中" : "编辑"}
        </button>
      </div>

      {/* 属性编辑弹窗（按 pickedObj.id keyed 切换物体时 remount） */}
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
          编辑模式：点击物体编辑属性，拖拽旋转视角
        </div>
      </Show>
    </div>
  )
}

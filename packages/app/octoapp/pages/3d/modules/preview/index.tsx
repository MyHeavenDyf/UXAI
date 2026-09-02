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
import type { SceneConfig, SceneConfigMaterial, SceneConfigObject3D, ScenePatch, EditDeltaEntry } from "../../utils/scene-config"
import type { ConsoleEntry } from "../../utils/scene-gate"
import { PropertyEditor3DPopup } from "./property-editor-popup"
import { TitleBar3D } from "./title-bar"
import type { VersionEntry } from "../../utils/version-history"
import { commitEdits } from "../../workflow/commit-edits"
import type { CodeFile } from "../../utils/parse-code-files"

export type PreviewPageAPI = {
  sendToPreview: (data: SceneConfig | null) => void
  /** 开关编辑态拾取（SCENE_PICK_MODE） */
  sendPickMode?: (enabled: boolean) => void
  /** 聚焦物体（SCENE_FLY_TO） */
  sendFlyTo?: (targetId: string) => void
  /** 复位相机到初始视角（SCENE_RESET_CAMERA） */
  sendResetCamera?: () => void
  /** 切主题（SCENE_THEME） */
  sendTheme?: (mode: "light" | "dark") => void
  /** 场景级增量更新（SCENE_PATCH_ENV，M-3 ①）：mutate 灯/相机/背景·雾，不 reload 不 dispose */
  sendPatchEnv?: (env: { camera?: unknown; lights?: unknown; scene?: unknown }) => void
}

export function PreviewPage3D(props: {
  api?: PreviewPageAPI
  pendingData?: SceneConfig | null
  previewSrc: string
  sessionId?: string
  /** 场景历史目录（提交落盘时读 codeDir + mergedSceneConfig） */
  sceneDir?: string
  /** 提交落盘物化入口（父 onCodeVersionReady：appendSceneVersion + switchVersion + wsNonce++） */
  onCodeVersionReady?: (
    files: CodeFile[],
    summary: string,
    sceneData: Record<string, unknown> | null,
  ) => Promise<void>
  /** 轻量物化入口（父 materializePatch：archive+overlay，不调 switchVersion，避开 240s startDev 卡顿）。
   *  提交优先用此；未传则回落 onCodeVersionReady（冷启动 / 旧版本）。 */
  onMaterializePatch?: (
    files: CodeFile[],
    summary: string,
    sceneData: Record<string, unknown> | null,
  ) => Promise<void>
  onReady?: () => void
  /** iframe 运行时错误（SCENE_CONSOLE_ERROR / SCENE_ERROR）回调父组件，供 9a 门控 buffer 收集 + 持久化（不走消失 toast） */
  onConsoleError?: (entry: ConsoleEntry) => void
  /** 以下 TitleBar 回调由 pages/3d/index.tsx 传入 */
  versions?: VersionEntry[]
  currentVersionId?: string | null
  onSelectVersion?: (versionId: string) => void
  onPreview?: () => void
  onShare?: () => void
  onDownload?: () => void
}) {
  let iframeRef: HTMLIFrameElement | undefined

  // ── 编辑态 / 拾取 / 本地物体表 ──
  const [editMode, setEditMode] = createSignal(false)
  /** 选中粒度：'part'(部件，默认) | 'whole'(整体，如整棵树/整张桌) */
  const [pickGranularity, setPickGranularity] = createSignal<"part" | "whole">("part")
  const [pickedObj, setPickedObj] = createSignal<SceneConfigObject3D | null>(null)
  /** id → SceneConfigObject3D：从 pendingData 同步，供 handlePick 查顶层节点 def（codegen 路径无 objects 字段则空） */
  const [objectsById, setObjectsById] = createSignal<Map<string, SceneConfigObject3D>>(new Map())
  /** 编辑态改动累加器：__id → 材质/transform（rotation 存弧度；提交时 patch 进 handler override Map 落盘；切版本/退出编辑态清空） */
  const [editDelta, setEditDelta] = createSignal<Map<string, EditDeltaEntry>>(new Map())
  /** 提交中（阻塞重复点击 + 按钮显「提交中…」） */
  const [committing, setCommitting] = createSignal(false)
  /** 提交结果横幅（自动消失） */
  const [commitBanner, setCommitBanner] = createSignal<{ text: string; kind: "ok" | "warn" | "err" } | null>(null)
  let bannerTimer: number | undefined

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
  function sendEditObject(
    id: string,
    material: SceneConfigMaterial | undefined,
    transform: { position?: number[]; rotation?: number[]; scale?: number[] } | undefined,
  ): void {
    post({ type: "SCENE_EDIT_OBJECT", id, material, transform })
  }
  /**
   * 属性弹窗编辑统一走 SCENE_EDIT_OBJECT 直改运行时 Object3D（即时生效）+ 累积进 editDelta
   * （提交时 patch 进 handler override Map 落盘、重生成后持久）。
   * rotation 单位：popup 传度 → 此处转弧度（Three 原生，override.ts/editObject 直接 set 弧度）。
   */
  function applyEdit(patch: ScenePatch): void {
    const work = patch.objects?.upsert?.[0]
    const id = work?.id
    if (!id) return
    const material = work?.material
    // popup 传度 → 弧度（Three 原生；不转则度当弧度，旋转运行时直改与落盘皆错）
    const DEG2RAD = Math.PI / 180
    const degRot = work?.rotation
    const radRot = degRot
      ? [degRot[0] * DEG2RAD, degRot[1] * DEG2RAD, degRot[2] * DEG2RAD]
      : undefined
    const tf = work ? { position: work.position, rotation: radRot, scale: work.scale } : undefined
    sendEditObject(id, material, tf)
    // 材质 + transform 字段级 merge 累加（防 material/transform 互覆盖丢失）
    setEditDelta((m) => {
      const next = new Map(m)
      const prev = next.get(id) ?? {}
      next.set(id, {
        material: material ? { ...prev.material, ...material } : prev.material,
        transform: tf
          ? {
              ...prev.transform,
              ...(tf.position ? { position: tf.position } : {}),
              ...(tf.rotation ? { rotation: tf.rotation } : {}),
              ...(tf.scale ? { scale: tf.scale } : {}),
            }
          : prev.transform,
      })
      return next
    })
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
  /** 场景级增量（M-3 ①）：post SCENE_PATCH_ENV → iframe onPatchEnv → handle.updateEnvironment 运行时 mutate（不重建物体树） */
  function sendPatchEnv(env: { camera?: unknown; lights?: unknown; scene?: unknown }): void {
    post({ type: "SCENE_PATCH_ENV", camera: env.camera, lights: env.lights, scene: env.scene })
  }

  // 注入 api（父组件通过 props.api 调用）
  if (props.api) {
    props.api.sendToPreview = sendToPreview
    props.api.sendPickMode = sendPickMode
    props.api.sendFlyTo = sendFlyTo
    props.api.sendResetCamera = sendResetCamera
    props.api.sendTheme = sendTheme
    props.api.sendPatchEnv = sendPatchEnv
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
        setEditDelta(new Map())
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
    if (!next) {
      setPickedObj(null)
      setEditDelta(new Map())
    }
  }

  function switchGranularity(mode: "part" | "whole"): void {
    if (pickGranularity() === mode) return
    setPickGranularity(mode)
    if (editMode()) sendPickGranularity(mode)
  }

  /**
   * 提交：把 editDelta 里的 per-instance 材质改动 patch 进 handler override Map 落盘
   * （commitEdits 读 codeDir + 反查 __id→type + patch + 重组 codeFiles → onCodeVersionReady
   * 物化重生成）。合契约 handler 才能落盘；不合契约的 __id 跳过并回报。
   */
  async function handleCommit(): Promise<void> {
    if (committing()) return
    if (editDelta().size === 0 || !props.sceneDir || !props.sessionId || !props.onCodeVersionReady) {
      setCommitBanner({ text: "无可提交改动或缺少落盘上下文（sceneDir/sessionId/onCodeVersionReady）", kind: "warn" })
      window.clearTimeout(bannerTimer)
      bannerTimer = window.setTimeout(() => setCommitBanner(null), 5000)
      return
    }
    setCommitting(true)
    try {
      const res = await commitEdits({
        sceneDir: props.sceneDir,
        sid: props.sessionId,
        delta: editDelta(),
        // 优先轻量物化（overlay 不重启 dev，避开 240s startDev 卡顿）；未传回落全量 switchVersion
        onCodeVersionReady: props.onMaterializePatch ?? props.onCodeVersionReady,
      })
      if (res.ok) {
        setEditDelta(new Map())
        setPickedObj(null)
        toggleEditMode() // 退出编辑态（iframe 已重载，picker 重建后需重进编辑态）
        setCommitBanner({
          text:
            res.skipped.length > 0
              ? `已落盘 ${res.committedCount} 项（${res.skipped.length} 项跳过：${res.skipped[0]?.reason ?? ""}）`
              : `已落盘 ${res.committedCount} 项`,
          kind: res.skipped.length > 0 ? "warn" : "ok",
        })
      } else {
        setCommitBanner({ text: res.error ?? "提交失败", kind: "err" })
      }
    } catch (e) {
      setCommitBanner({ text: `提交异常：${e instanceof Error ? e.message : String(e)}`, kind: "err" })
    } finally {
      setCommitting(false)
      window.clearTimeout(bannerTimer)
      bannerTimer = window.setTimeout(() => setCommitBanner(null), 5000)
    }
  }

  function handlePick(info: {
    id?: string
    isMesh?: boolean
    material?: SceneConfigMaterial
    transform?: { position?: number[]; rotation?: number[]; scale?: number[] }
  }): void {
    const id = info.id
    if (!id) {
      setPickedObj(null)
      return
    }
    // picker 运行时弧度 → 度（popup 期望度；transform.ts 创建时度→弧度，转回一致，初始值也正确）
    const RAD2DEG = 180 / Math.PI
    const tf = info.transform
      ? {
          position: info.transform.position,
          rotation: info.transform.rotation?.map((r) => r * RAD2DEG),
          scale: info.transform.scale,
        }
      : undefined
    const tfFields = tf ? { position: tf.position, rotation: tf.rotation, scale: tf.scale } : {}
    const obj = objectsById().get(id)
    if (obj) {
      // 合并 picker 运行时 transform 覆盖静态 def（否则编辑后重选显陈旧初始值）
      setPickedObj({ ...obj, ...tfFields })
    } else if (info.isMesh && info.material) {
      // 拾取到子 mesh（auto/handler 盖 __id 但不在 live-data 顶层）：带材质快照建 mesh def，
      // 属性弹窗显材质编辑器；编辑走 SCENE_EDIT_OBJECT 直改运行时 Object3D（即时生效、不落盘）。
      // material.type 由 snapshotMaterial 归一（standard/basic/.../points/undefined），勿强制覆盖。
      setPickedObj({ id, type: "mesh", parentId: null, material: { ...info.material }, ...tfFields })
    } else {
      // group/component 子节点无顶层 def：最小可编辑 def（含 picker transform）
      console.log("[3d] SCENE_PICK 物体不在 objectsById，构造最小 def:", id)
      setPickedObj({ id, type: "group", parentId: null, ...tfFields })
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
      console.log("[3d] SCENE_PICK:", e.data?.id, e.data?.isMesh ? "(mesh)" : "")
      handlePick({ id: e.data?.id, isMesh: e.data?.isMesh, material: e.data?.material, transform: e.data?.transform })
    } else if (type === "SCENE_CONSOLE_ERROR") {
      // 9a 门控：iframe 转发的运行时 console.error / window error / unhandledrejection
      const entry: ConsoleEntry = {
        level: e.data?.level === "warn" ? "warn" : "error",
        message: e.data?.message ?? "未知运行时错误",
        stack: e.data?.stack,
      }
      console.error("[3d] SCENE_CONSOLE_ERROR:", entry.level, entry.message)
      props.onConsoleError?.(entry)
    } else if (type === "SCENE_ERROR") {
      // 场景构建 fatal（createScene3D 抛错）：不再走消失 toast，改路由到 9a 持久化通道
      console.error("[3d] SCENE_ERROR:", e.data?.message)
      props.onConsoleError?.({ level: "error", message: e.data?.message ?? "未知错误", fatal: true })
    }
  }

  window.addEventListener("message", handleIframeMessage)
  onCleanup(() => {
    window.removeEventListener("message", handleIframeMessage)
    window.clearTimeout(bannerTimer)
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
            <button
              class="rounded-md text-[12px] leading-none flex items-center gap-1"
              style={{
                height: "26px",
                padding: "0 10px",
                background: editDelta().size > 0 ? "var(--octo-brand, #3d99ff)" : "var(--octo-surface, #ffffff)",
                color: editDelta().size > 0 ? "#fff" : "var(--octo-text-primary, #1f2937)",
                border: "1px solid var(--octo-border, #e5e7eb)",
                "box-shadow": "0 1px 3px rgba(0,0,0,0.15)",
                opacity: committing() ? "0.6" : "1",
              }}
              onClick={() => handleCommit()}
              disabled={committing() || editDelta().size === 0}
              title="把编辑态改动落盘进 handler override Map（重生成后持久）"
            >
              {committing() ? "提交中…" : "提交"}
              <Show when={editDelta().size > 0}>
                <span class="ml-0.5 rounded-full bg-white/25 px-1 text-[10px]">{editDelta().size}</span>
              </Show>
            </button>
          </div>
        </Show>

        {/* 提交结果横幅 */}
        <Show when={commitBanner()}>
          {(b) => (
            <div
              class="absolute top-2 left-1/2 -translate-x-1/2 rounded-md text-[12px] px-3 py-1 z-10"
              style={{
                background:
                  b().kind === "ok" ? "rgba(34,197,94,0.92)" : b().kind === "warn" ? "rgba(234,179,8,0.92)" : "rgba(239,68,68,0.92)",
                color: "#fff",
                "pointer-events": "none",
              }}
            >
              {b().text}
            </div>
          )}
        </Show>

        {/* 属性编辑弹窗 */}
        <Show when={pickedObj()} keyed>
          {(obj) => (
            <PropertyEditor3DPopup
              obj={obj}
              onPatch={(patch) => applyEdit(patch)}
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

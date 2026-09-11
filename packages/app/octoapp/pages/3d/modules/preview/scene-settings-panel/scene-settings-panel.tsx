/**
 * 场景设置面板（10.5 + Phase L/S：scene/camera/lights/renderer/controls 五块 UI 化）。
 *
 * 后端走 M-3 ① 已通的链路：
 *   - 实时预览：onLiveChange → sendPatchEnv → SCENE_PATCH_ENV → iframe updateEnvironment
 *     运行时 mutate（不 reload/不 dispose/不丢编辑态）
 *   - 提交落盘：onCommit → materializeEnvPatch（appendSceneVersion + 落盘 live-data + 版本菜单）
 *
 * lights 按 index 定位（__id=light-${i}）；增删由 updateEnvironment 的 existing/seen diff 自动处理。
 * Phase L/S：灯光六型（ambient/hemisphere/directional/point/spot/rectarea）+ 阴影 bias/normalBias/radius，
 * renderer 运行时可变子集（toneMapping/shadowMapType/exposure/outputColorSpace/autoClear），
 * controls 手感（阻尼/距离/极角/开关/autoRotate）。
 *
 * UI 复用 property-editor-popup 的 .property-editor-popup 容器 + ui-primitives 控件，风格一致。
 */
import { createEffect, createMemo, createSignal, Index, Show, type Accessor, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import type { SceneConfig, SceneConfigLight } from "../../../utils/scene-config"
import { NumberField, Vec3Row, Section, SliderRow, ColorRow, clone } from "../ui-primitives"
import "../../../../pattern/assets/style/preview/PropertyEditorPopup.css"
import "../../../assets/style/preview/titleBar.css"
import "../../../assets/style/preview/sceneSettingsPanel.css"

/** 面板工作的场景环境切片（对齐 sendPatchEnv payload + EnvUpdate 形状） */
export interface SceneEnvSlice {
  camera?: SceneConfig["camera"]
  lights?: SceneConfigLight[]
  scene?: SceneConfig["scene"]
  renderer?: SceneConfig["renderer"]
  controls?: SceneConfig["controls"]
}

export interface SceneSettingsPanelProps {
  /** 当前 env（从 pendingData 派生）；切会话/切版本时外部重置 → 面板同步 */
  env: Accessor<SceneEnvSlice | null>
  /** 实时预览：每次字段改 → sendPatchEnv 运行时 mutate */
  onLiveChange: (env: SceneEnvSlice) => void
  /** 提交落盘：把当前 workEnv 传出 → materializeEnvPatch */
  onCommit: (env: SceneEnvSlice) => Promise<void>
  onClose: () => void
}

const DEFAULT_LIGHT: SceneConfigLight = { type: "ambient", intensity: 0.5 }

export function SceneSettingsPanel(props: SceneSettingsPanelProps): JSX.Element {
  const [work, setWork] = createSignal<SceneEnvSlice | null>(props.env() ? clone(props.env()!) : null)
  const [committing, setCommitting] = createSignal(false)
  const [banner, setBanner] = createSignal<{ text: string; kind: "ok" | "err" } | null>(null)
  let bannerTimer: number | undefined
  /** 拖拽偏移（对齐 pattern popup-header 可拖动） */
  const [dragOffset, setDragOffset] = createStore({ x: 0, y: 0 })

  function startDrag(e: MouseEvent): void {
    e.preventDefault()
    const sx = e.clientX, sy = e.clientY
    const ox = dragOffset.x, oy = dragOffset.y
    const onMove = (me: MouseEvent): void => {
      setDragOffset({ x: ox + (me.clientX - sx), y: oy + (me.clientY - sy) })
    }
    const onUp = (): void => {
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("mouseup", onUp)
    }
    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseup", onUp)
  }

  // 外部 env 变化（切会话/切版本）→ 重置本地 workEnv
  createEffect(() => {
    const e = props.env()
    setWork(e ? clone(e) : null)
    setBanner(null)
  })

  const cam = createMemo(() => work()?.camera ?? null)
  const lights = createMemo(() => work()?.lights ?? [])
  const scene = createMemo(() => work()?.scene ?? null)
  const renderer = createMemo(() => work()?.renderer ?? null)
  const controls = createMemo(() => work()?.controls ?? null)

  /** 更新 workEnv 的某切片并 emit 实时预览 */
  function mutate(fn: (w: SceneEnvSlice) => void): void {
    const cur = work() ?? {}
    const next = clone(cur)
    fn(next)
    setWork(next)
    props.onLiveChange(next)
  }

  // ── scene ──
  function setSceneField(field: keyof NonNullable<SceneConfig["scene"]>, value: unknown): void {
    mutate((w) => {
      if (!w.scene) {
        w.scene = { background: "#1a1a2e", environment: { preset: "studio", intensity: 0.8 } }
      }
      ;(w.scene as Record<string, unknown>)[field] = value
    })
  }
  function setFogField(field: "color" | "near" | "far", value: unknown): void {
    mutate((w) => {
      if (!w.scene) w.scene = { background: "#1a1a2e", environment: { preset: "studio", intensity: 0.8 } }
      if (!w.scene.fog) w.scene.fog = { type: "linear", color: "#cccccc", near: 10, far: 60 }
      ;(w.scene.fog as Record<string, unknown>)[field] = value
    })
  }
  function toggleFog(on: boolean): void {
    mutate((w) => {
      if (!w.scene) w.scene = { background: "#1a1a2e", environment: { preset: "studio", intensity: 0.8 } }
      if (on) {
        w.scene.fog = { type: "linear", color: "#cccccc", near: 10, far: 60 }
      } else {
        w.scene.fog = undefined
      }
    })
  }

  // ── camera ──
  function setCamField(field: "type", value: "perspective" | "orthographic"): void
  function setCamField(field: "position" | "lookAt", value: number[]): void
  function setCamField(field: "type" | "position" | "lookAt", value: unknown): void {
    mutate((w) => {
      if (!w.camera) {
        w.camera = {
          type: "perspective",
          position: [15, 12, 15],
          lookAt: [0, 0, 0],
          perspective: { fov: 50, near: 0.1, far: 1000 },
        }
      }
      ;(w.camera as Record<string, unknown>)[field] = value
    })
  }
  function setFov(v: number): void {
    mutate((w) => {
      if (!w.camera) return
      if (!w.camera.perspective) w.camera.perspective = { fov: 50, near: 0.1, far: 1000 }
      w.camera.perspective.fov = v
    })
  }
  function camVec(field: "position" | "lookAt", i: number): number {
    const c = cam()
    if (!c) return 0
    const arr = c[field]
    return arr?.[i] ?? 0
  }
  function setCamVec(field: "position" | "lookAt", i: number, v: number): void {
    const cur = cam()?.[field] ?? [0, 0, 0]
    const arr = [cur[0] ?? 0, cur[1] ?? 0, cur[2] ?? 0]
    arr[i] = v
    setCamField(field, arr)
  }

  // ── lights ──
  function setLightType(idx: number, type: SceneConfigLight["type"]): void {
    mutate((w) => {
      if (!w.lights || idx >= w.lights.length) return
      const light = w.lights[idx] as unknown as Record<string, unknown>
      light.type = type
      // 非 directional/spot 无阴影：切走时清 castShadow + shadow，避免 live-data 残留 + 引擎警告
      if (type !== "directional" && type !== "spot") {
        light.castShadow = false
        delete light.shadow
      }
    })
  }
  function setLightField(idx: number, field: keyof SceneConfigLight, value: unknown): void {
    mutate((w) => {
      if (!w.lights || idx >= w.lights.length) return
      ;(w.lights[idx] as unknown as Record<string, unknown>)[field] = value
    })
  }
  function setLightVec(idx: number, field: "position" | "target", i: number, v: number): void {
    mutate((w) => {
      if (!w.lights || idx >= w.lights.length) return
      const cur = (w.lights[idx][field] as number[] | undefined) ?? [0, 0, 0]
      const arr = [cur[0] ?? 0, cur[1] ?? 0, cur[2] ?? 0]
      arr[i] = v
      ;(w.lights[idx] as unknown as Record<string, unknown>)[field] = arr
    })
  }
  /** 阴影配置字段（directional/spot 共用）：mapSize/bias/normalBias/radius */
  function setShadowField(
    idx: number,
    field: "mapSize" | "bias" | "normalBias" | "radius",
    value: unknown,
  ): void {
    mutate((w) => {
      if (!w.lights || idx >= w.lights.length) return
      const light = w.lights[idx]
      if (!light.shadow) light.shadow = {}
      ;(light.shadow as unknown as Record<string, unknown>)[field] = value
    })
  }
  /** spot angle：UI 用度数，data 存弧度（THREE 原生弧度；angleUnit 只管物体 rotation 不涉及灯角） */
  const RAD2DEG = 180 / Math.PI
  function spotAngleDeg(idx: number): number {
    const l = lights()[idx]
    return (l?.angle ?? Math.PI / 6) * RAD2DEG
  }
  function setSpotAngleDeg(idx: number, deg: number): void {
    mutate((w) => {
      if (!w.lights || idx >= w.lights.length) return
      w.lights[idx].angle = deg / RAD2DEG
    })
  }
  function addLight(): void {
    mutate((w) => {
      if (!w.lights) w.lights = []
      w.lights.push({ ...DEFAULT_LIGHT })
    })
  }
  function removeLight(idx: number): void {
    mutate((w) => {
      if (!w.lights || idx >= w.lights.length) return
      w.lights.splice(idx, 1)
    })
  }

  // ── renderer / controls ──
  function setRendererField(field: keyof NonNullable<SceneConfig["renderer"]>, value: unknown): void {
    mutate((w) => {
      if (!w.renderer) w.renderer = {}
      ;(w.renderer as Record<string, unknown>)[field] = value
    })
  }
  function setControlsField(field: keyof NonNullable<SceneConfig["controls"]>, value: unknown): void {
    mutate((w) => {
      if (!w.controls) w.controls = {}
      ;(w.controls as Record<string, unknown>)[field] = value
    })
  }

  async function handleCommit(): Promise<void> {
    if (committing()) return
    const w = work()
    if (!w) return
    setCommitting(true)
    try {
      await props.onCommit(w)
      setBanner({ text: "已落盘", kind: "ok" })
    } catch (e) {
      setBanner({ text: `提交失败：${e instanceof Error ? e.message : String(e)}`, kind: "err" })
    } finally {
      setCommitting(false)
      window.clearTimeout(bannerTimer)
      bannerTimer = window.setTimeout(() => setBanner(null), 4000)
    }
  }

  return (
    <div
      class="property-editor-popup scene-settings-panel"
      style={{
        position: "absolute",
        top: "50px",
        right: "5px",
        width: "260px",
        "max-height": "calc(100% - 64px)",
        transform: `translate(${dragOffset.x}px, ${dragOffset.y}px)`,
      }}
    >
      <div class="popup-header" onMouseDown={startDrag}>
        <span class="text-sm font-semibold text-slate-700">场景设置</span>
        <span class="text-xs text-slate-400 ml-2">scene / camera / lights / renderer / controls</span>
        <button
          type="button"
          onClick={() => props.onClose()}
          class="ml-auto flex items-center justify-center w-5 h-5 rounded-sm text-slate-400 hover:text-slate-600 hover:bg-slate-100 shrink-0"
          title="关闭"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
            <line x1="2" y1="2" x2="10" y2="10" />
            <line x1="10" y1="2" x2="2" y2="10" />
          </svg>
        </button>
      </div>

      <div class="popup-body px-4 pb-2 flex flex-col gap-2">
        {/* ── 场景 Scene ── */}
        <Section title="场景 Scene">
          <ColorRow
            label="背景"
            value={scene()?.background}
            onChange={(v) => setSceneField("background", v)}
          />
          {/* 雾开关 */}
          <div class="flex items-center gap-2">
            <label class="flex items-center gap-1 text-[11px] text-slate-600 cursor-pointer">
              <input
                type="checkbox"
                checked={!!scene()?.fog}
                onChange={(e) => toggleFog(e.currentTarget.checked)}
                class="accent-[#3D99FF]"
              />
              雾
            </label>
            <Show when={scene()?.fog}>
              <div class="flex-1 flex items-center gap-2">
                <NumberField
                  value={scene()?.fog?.near ?? 10}
                  step={1}
                  min={0}
                  placeholder="near"
                  onChange={(v) => setFogField("near", v)}
                />
                <NumberField
                  value={scene()?.fog?.far ?? 60}
                  step={1}
                  min={0}
                  placeholder="far"
                  onChange={(v) => setFogField("far", v)}
                />
              </div>
            </Show>
          </div>
          <Show when={scene()?.fog}>
            <ColorRow
              label="雾色"
              value={scene()?.fog?.color}
              onChange={(v) => setFogField("color", v)}
            />
          </Show>
          {/* 环境光强度 */}
          <SliderRow
            label="环境"
            value={scene()?.environment?.intensity ?? 0.8}
            min={0}
            max={3}
            step={0.05}
            onChange={(v) =>
              setSceneField("environment", {
                preset: scene()?.environment?.preset ?? "studio",
                intensity: v,
              })
            }
          />
        </Section>

        {/* ── 相机 Camera ── */}
        <Show when={cam()}>
          <Section title="相机 Camera">
            <div class="flex items-center gap-2">
              <span class="text-[11px] text-slate-500 w-10 shrink-0">类型</span>
              <select
                value={cam()!.type}
                onChange={(e) => setCamField("type", e.currentTarget.value as "perspective" | "orthographic")}
                class="property-input flex-1 min-w-0 h-6"
              >
                <option value="perspective">透视</option>
                <option value="orthographic">正交</option>
              </select>
            </div>
            <Show when={cam()!.type === "perspective"}>
              <SliderRow
                label="FOV"
                value={cam()!.perspective?.fov ?? 50}
                min={10}
                max={120}
                step={1}
                onChange={(v) => setFov(v)}
              />
            </Show>
            <Vec3Row
              label="位置"
              values={[camVec("position", 0), camVec("position", 1), camVec("position", 2)]}
              step={0.5}
              onChange={(i, v) => setCamVec("position", i, v)}
            />
            <Vec3Row
              label="注视"
              values={[camVec("lookAt", 0), camVec("lookAt", 1), camVec("lookAt", 2)]}
              step={0.5}
              onChange={(i, v) => setCamVec("lookAt", i, v)}
            />
          </Section>
        </Show>

        {/* ── 灯光 Lights ── */}
        <Section title="灯光 Lights">
          <Show when={lights().length === 0}>
            <div class="text-[11px] text-slate-400">无灯光</div>
          </Show>
          {/* 用 <Index>（按 index 追踪）而非 <For>（按引用追踪）：mutate 时 setWork(clone) 会换引用，
              <For> 把所有行判为「换对象」re-render → 原生 color picker DOM 重建 → 拖动调色立刻收起。
              <Index> 按槽位复用 DOM，color picker 拖动时不重建，可连续调色。 */}
          <Index each={lights()}>
            {(light, idx) => (
              <div class="border border-slate-200 rounded p-1.5 flex flex-col gap-1.5 bg-white/50">
                <div class="flex items-center gap-2">
                  <select
                    value={light().type}
                    onChange={(e) =>
                      setLightType(idx, e.currentTarget.value as SceneConfigLight["type"])
                    }
                    class="property-input flex-1 min-w-0 h-6"
                  >
                    <option value="ambient">ambient 环境光</option>
                    <option value="hemisphere">hemisphere 半球光</option>
                    <option value="directional">directional 平行光</option>
                    <option value="point">point 点光源</option>
                    <option value="spot">spot 聚光灯</option>
                    <option value="rectarea">rectarea 面光</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => removeLight(idx)}
                    class="text-slate-400 hover:text-red-500 text-[12px] px-1 shrink-0"
                    title="删除此灯"
                  >
                    ✕
                  </button>
                </div>
                <SliderRow
                  label="强度"
                  value={light().intensity ?? 1}
                  min={0}
                  max={5}
                  step={0.05}
                  onChange={(v) => setLightField(idx, "intensity", v)}
                />
                <Show when={light().type !== "hemisphere"}>
                  <ColorRow
                    label="颜色"
                    value={light().color}
                    onChange={(v) => setLightField(idx, "color", v)}
                  />
                </Show>
                <Show when={light().type === "hemisphere"}>
                  <ColorRow
                    label="天色"
                    value={light().skyColor ?? light().color}
                    onChange={(v) => setLightField(idx, "skyColor", v)}
                  />
                  <ColorRow
                    label="地色"
                    value={light().groundColor}
                    onChange={(v) => setLightField(idx, "groundColor", v)}
                  />
                </Show>
                {/* directional/point/spot/rectarea 都有位置 */}
                <Show when={light().type === "directional" || light().type === "point" || light().type === "spot" || light().type === "rectarea"}>
                  <Vec3Row
                    label="位置"
                    values={[
                      (light().position ?? [0, 0, 0])[0],
                      (light().position ?? [0, 0, 0])[1],
                      (light().position ?? [0, 0, 0])[2],
                    ]}
                    step={0.5}
                    onChange={(i, v) => setLightVec(idx, "position", i, v)}
                  />
                </Show>
                {/* directional/spot/rectarea 支持 target（rectarea 用 lookAt 定向） */}
                <Show when={light().type === "directional" || light().type === "spot" || light().type === "rectarea"}>
                  <Vec3Row
                    label="目标"
                    values={[
                      (light().target ?? [0, 0, 0])[0],
                      (light().target ?? [0, 0, 0])[1],
                      (light().target ?? [0, 0, 0])[2],
                    ]}
                    step={0.5}
                    onChange={(i, v) => setLightVec(idx, "target", i, v)}
                  />
                </Show>
                {/* point：物理衰减距离/系数 */}
                <Show when={light().type === "point"}>
                  <SliderRow
                    label="距离"
                    value={light().distance ?? 0}
                    min={0}
                    max={50}
                    step={0.5}
                    onChange={(v) => setLightField(idx, "distance", v)}
                  />
                  <SliderRow
                    label="衰减"
                    value={light().decay ?? 2}
                    min={0}
                    max={5}
                    step={0.1}
                    onChange={(v) => setLightField(idx, "decay", v)}
                  />
                </Show>
                {/* spot：光锥半角(度数)/半影软边/衰减 */}
                <Show when={light().type === "spot"}>
                  <SliderRow
                    label="角度°"
                    value={spotAngleDeg(idx)}
                    min={1}
                    max={90}
                    step={1}
                    onChange={(v) => setSpotAngleDeg(idx, v)}
                  />
                  <SliderRow
                    label="半影"
                    value={light().penumbra ?? 0}
                    min={0}
                    max={1}
                    step={0.05}
                    onChange={(v) => setLightField(idx, "penumbra", v)}
                  />
                  <SliderRow
                    label="距离"
                    value={light().distance ?? 0}
                    min={0}
                    max={50}
                    step={0.5}
                    onChange={(v) => setLightField(idx, "distance", v)}
                  />
                  <SliderRow
                    label="衰减"
                    value={light().decay ?? 2}
                    min={0}
                    max={5}
                    step={0.1}
                    onChange={(v) => setLightField(idx, "decay", v)}
                  />
                </Show>
                {/* rectarea：发光面尺寸 */}
                <Show when={light().type === "rectarea"}>
                  <SliderRow
                    label="宽度"
                    value={light().width ?? 4}
                    min={0.5}
                    max={20}
                    step={0.5}
                    onChange={(v) => setLightField(idx, "width", v)}
                  />
                  <SliderRow
                    label="高度"
                    value={light().height ?? 4}
                    min={0.5}
                    max={20}
                    step={0.5}
                    onChange={(v) => setLightField(idx, "height", v)}
                  />
                </Show>
                {/* directional/spot 阴影 */}
                <Show when={light().type === "directional" || light().type === "spot"}>
                  <label class="flex items-center gap-1 text-[11px] text-slate-600 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={!!light().castShadow}
                      onChange={(e) => setLightField(idx, "castShadow", e.currentTarget.checked)}
                      class="accent-[#3D99FF]"
                    />
                    阴影
                  </label>
                  <Show when={light().castShadow}>
                    <SliderRow
                      label="贴图"
                      value={light().shadow?.mapSize ?? 1024}
                      min={256}
                      max={4096}
                      step={256}
                      onChange={(v) => setShadowField(idx, "mapSize", v)}
                    />
                    <NumberField
                      value={light().shadow?.bias ?? -0.0005}
                      step={0.0001}
                      placeholder="bias"
                      onChange={(v) => setShadowField(idx, "bias", v)}
                    />
                    <NumberField
                      value={light().shadow?.normalBias ?? 0}
                      step={0.01}
                      placeholder="normalBias"
                      onChange={(v) => setShadowField(idx, "normalBias", v)}
                    />
                    <NumberField
                      value={light().shadow?.radius ?? 1}
                      step={0.1}
                      min={0}
                      placeholder="radius"
                      onChange={(v) => setShadowField(idx, "radius", v)}
                    />
                  </Show>
                </Show>
              </div>
            )}
          </Index>
          <button
            type="button"
            onClick={() => addLight()}
            class="text-[11px] text-[#3D99FF] hover:underline self-start"
          >
            + 添加灯光
          </button>
        </Section>

        {/* ── 渲染器 Renderer ── */}
        <Section title="渲染器 Renderer">
          <div class="flex items-center gap-2">
            <span class="text-[11px] text-slate-500 w-10 shrink-0">色调映射</span>
            <select
              value={renderer()?.toneMapping ?? "ACESFilmicToneMapping"}
              onChange={(e) => setRendererField("toneMapping", e.currentTarget.value)}
              class="property-input flex-1 min-w-0 h-6"
            >
              <option value="NoToneMapping">No 无</option>
              <option value="LinearToneMapping">Linear</option>
              <option value="ReinhardToneMapping">Reinhard</option>
              <option value="CineonToneMapping">Cineon</option>
              <option value="ACESFilmicToneMapping">ACES Filmic</option>
              <option value="AgXToneMapping">AgX</option>
              <option value="NeutralToneMapping">Neutral</option>
            </select>
          </div>
          <SliderRow
            label="曝光"
            value={renderer()?.toneMappingExposure ?? 1}
            min={0}
            max={3}
            step={0.05}
            onChange={(v) => setRendererField("toneMappingExposure", v)}
          />
          <div class="flex items-center gap-2">
            <span class="text-[11px] text-slate-500 w-10 shrink-0">阴影算法</span>
            <select
              value={renderer()?.shadowMapType ?? "PCFShadowMap"}
              onChange={(e) => setRendererField("shadowMapType", e.currentTarget.value)}
              class="property-input flex-1 min-w-0 h-6"
            >
              <option value="BasicShadowMap">Basic</option>
              <option value="PCFShadowMap">PCF</option>
              <option value="PCFSoftShadowMap">PCF Soft</option>
              <option value="VSMShadowMap">VSM</option>
            </select>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-[11px] text-slate-500 w-10 shrink-0">色彩空间</span>
            <select
              value={renderer()?.outputColorSpace ?? "srgb"}
              onChange={(e) => setRendererField("outputColorSpace", e.currentTarget.value)}
              class="property-input flex-1 min-w-0 h-6"
            >
              <option value="srgb">sRGB</option>
              <option value="linear">Linear</option>
            </select>
          </div>
          <label class="flex items-center gap-1 text-[11px] text-slate-600 cursor-pointer">
            <input
              type="checkbox"
              checked={renderer()?.autoClear ?? true}
              onChange={(e) => setRendererField("autoClear", e.currentTarget.checked)}
              class="accent-[#3D99FF]"
            />
            自动清屏 autoClear
          </label>
        </Section>

        {/* ── 轨道控制 Controls ── */}
        <Section title="轨道控制 Controls">
          <label class="flex items-center gap-1 text-[11px] text-slate-600 cursor-pointer">
            <input
              type="checkbox"
              checked={controls()?.enableDamping ?? true}
              onChange={(e) => setControlsField("enableDamping", e.currentTarget.checked)}
              class="accent-[#3D99FF]"
            />
            阻尼 enableDamping
          </label>
          <Show when={controls()?.enableDamping}>
            <SliderRow
              label="阻尼系数"
              value={controls()?.dampingFactor ?? 0.05}
              min={0}
              max={0.5}
              step={0.01}
              onChange={(v) => setControlsField("dampingFactor", v)}
            />
          </Show>
          <SliderRow
            label="最近距离"
            value={controls()?.minDistance ?? 0}
            min={0}
            max={30}
            step={0.5}
            onChange={(v) => setControlsField("minDistance", v)}
          />
          <SliderRow
            label="最远距离"
            value={controls()?.maxDistance ?? 500}
            min={0}
            max={1000}
            step={10}
            onChange={(v) => setControlsField("maxDistance", v)}
          />
          <SliderRow
            label="极角上限"
            value={controls()?.maxPolarAngle ?? Math.PI}
            min={0}
            max={Math.PI}
            step={0.05}
            onChange={(v) => setControlsField("maxPolarAngle", v)}
          />
          <div class="flex items-center gap-3">
            <label class="flex items-center gap-1 text-[11px] text-slate-600 cursor-pointer">
              <input
                type="checkbox"
                checked={controls()?.enableRotate ?? true}
                onChange={(e) => setControlsField("enableRotate", e.currentTarget.checked)}
                class="accent-[#3D99FF]"
              />
              旋转
            </label>
            <label class="flex items-center gap-1 text-[11px] text-slate-600 cursor-pointer">
              <input
                type="checkbox"
                checked={controls()?.enableZoom ?? true}
                onChange={(e) => setControlsField("enableZoom", e.currentTarget.checked)}
                class="accent-[#3D99FF]"
              />
              缩放
            </label>
            <label class="flex items-center gap-1 text-[11px] text-slate-600 cursor-pointer">
              <input
                type="checkbox"
                checked={controls()?.enablePan ?? true}
                onChange={(e) => setControlsField("enablePan", e.currentTarget.checked)}
                class="accent-[#3D99FF]"
              />
              平移
            </label>
          </div>
          <label class="flex items-center gap-1 text-[11px] text-slate-600 cursor-pointer">
            <input
              type="checkbox"
              checked={controls()?.autoRotate ?? false}
              onChange={(e) => setControlsField("autoRotate", e.currentTarget.checked)}
              class="accent-[#3D99FF]"
            />
            自动旋转 autoRotate
          </label>
          <Show when={controls()?.autoRotate}>
            <SliderRow
              label="旋转速度"
              value={controls()?.autoRotateSpeed ?? 2}
              min={0}
              max={10}
              step={0.1}
              onChange={(v) => setControlsField("autoRotateSpeed", v)}
            />
          </Show>
        </Section>

        {/* 提交按钮 */}
        <div class="border-t border-[#e5e7eb] -mx-4 px-4 pt-2 flex flex-col gap-1.5">
          <Show when={banner()}>
            {(b) => (
              <div
                class="text-[11px] px-2 py-1 rounded"
                style={{
                  background: b().kind === "ok" ? "rgba(34,197,94,0.15)" : "rgba(239,68,68,0.15)",
                  color: b().kind === "ok" ? "#16a34a" : "#dc2626",
                }}
              >
                {b().text}
              </div>
            )}
          </Show>
          <button
            type="button"
            classList={{ "edit-btn": true, "primary": !committing(), "subtle": committing() }}
            onClick={() => handleCommit()}
            disabled={committing()}
          >
            {committing() ? "提交中…" : "提交"}
          </button>
          <div class="text-[10px] text-slate-400 text-center">实时改动已生效，提交后落盘并加入版本历史</div>
        </div>
      </div>
    </div>
  )
}

/**
 * 3D 属性编辑弹窗（阶段3）
 *
 * 点选物体后弹出，编辑该物体的 Transform / 材质 / 几何参数，
 * 每次改动即时 onPatch({objects:{upsert:[workDef]}}) → applyEdit → SCENE_EDIT_OBJECT 直改运行时 Object3D（即时生效，不重建）。
 *
 * UI 风格 100% 对齐 Pattern 的 property-editor-popup（复用其 PropertyEditorPopup.css 的
 * .property-editor-popup / .popup-header / .popup-body 类，浅色主题）。
 * 数值输入保留浮点能力（Pattern 的 DragInput 是 parseInt 整数、专为 2D px，3D 变换需要浮点），
 * 故用本地 NumberField 但视觉对齐 DragInput（同色/边框/聚焦环）。
 *
 * 父组件以 keyed <Show> 挂载（按 obj.id 切换 remount）。
 */
import { createEffect, createSignal, For, Show, type JSX } from "solid-js"
import type { SceneConfigObject3D, SceneConfigMaterial, ScenePatch } from "../../../utils/scene-config"
import "../../../../pattern/assets/style/preview/PropertyEditorPopup.css"

export interface PropertyEditor3DPopupProps {
  obj: SceneConfigObject3D
  onPatch: (patch: ScenePatch) => void
  onClose: () => void
}

/** 各几何体类型可编辑的参数（对齐 3d-templete createLiveGeometry 支持集） */
const GEO_PARAMS: Record<string, { name: string; step?: number; min?: number; int?: boolean }[]> = {
  box: [{ name: "width", step: 0.1, min: 0.01 }, { name: "height", step: 0.1, min: 0.01 }, { name: "depth", step: 0.1, min: 0.01 }],
  plane: [{ name: "width", step: 0.1, min: 0.01 }, { name: "height", step: 0.1, min: 0.01 }],
  sphere: [{ name: "radius", step: 0.1, min: 0.01 }, { name: "widthSegments", step: 1, int: true, min: 3 }, { name: "heightSegments", step: 1, int: true, min: 2 }],
  cylinder: [{ name: "radiusTop", step: 0.1, min: 0 }, { name: "radiusBottom", step: 0.1, min: 0 }, { name: "height", step: 0.1, min: 0.01 }, { name: "radialSegments", step: 1, int: true, min: 3 }],
  cone: [{ name: "radius", step: 0.1, min: 0.01 }, { name: "height", step: 0.1, min: 0.01 }, { name: "radialSegments", step: 1, int: true, min: 3 }],
  torus: [{ name: "innerRadius", step: 0.1, min: 0 }, { name: "outerRadius", step: 0.1, min: 0.01 }],
  circle: [{ name: "radius", step: 0.1, min: 0.01 }, { name: "segments", step: 1, int: true, min: 3 }],
  ring: [{ name: "innerRadius", step: 0.1, min: 0 }, { name: "outerRadius", step: 0.1, min: 0.01 }],
}

/** 材质属性定义：按归一 type 分组的可编辑属性（驱动弹窗动态渲染） */
type PropKind = "color" | "slider" | "number" | "bool" | "select"
interface PropDef {
  key: string
  label: string
  kind: PropKind
  min?: number
  max?: number
  step?: number
  int?: boolean
  options?: { v: number; t: string }[]
}

/** 所有材质通用（THREE.Material 基类属性） */
const COMMON_PROPS: PropDef[] = [
  { key: "transparent", label: "透明", kind: "bool" },
  { key: "opacity", label: "不透明", kind: "slider", min: 0, max: 1, step: 0.02 },
  {
    key: "side",
    label: "面",
    kind: "select",
    options: [{ v: 0, t: "前面" }, { v: 1, t: "后面" }, { v: 2, t: "双面" }],
  },
  { key: "depthTest", label: "深度测试", kind: "bool" },
  { key: "depthWrite", label: "深度写入", kind: "bool" },
  {
    key: "blending",
    label: "混合",
    kind: "select",
    options: [{ v: 0, t: "正常" }, { v: 1, t: "相减" }, { v: 2, t: "相加" }, { v: 4, t: "相乘" }],
  },
  { key: "fog", label: "雾", kind: "bool" },
  { key: "toneMapped", label: "色调映射", kind: "bool" },
]

/** standard/physical 共用的基础属性 */
const STANDARD_PROPS: PropDef[] = [
  { key: "color", label: "颜色", kind: "color" },
  { key: "emissive", label: "自发光", kind: "color" },
  { key: "emissiveIntensity", label: "发光强", kind: "slider", min: 0, max: 5, step: 0.05 },
  { key: "roughness", label: "粗糙", kind: "slider", min: 0, max: 1, step: 0.02 },
  { key: "metalness", label: "金属", kind: "slider", min: 0, max: 1, step: 0.02 },
  { key: "wireframe", label: "线框", kind: "bool" },
  { key: "flatShading", label: "平面着色", kind: "bool" },
]

/** 按归一 type 的专属属性（key 须与 snapshotMaterial 归一结果一致） */
const MATERIAL_PROPS: Record<string, PropDef[]> = {
  basic: [
    { key: "color", label: "颜色", kind: "color" },
    { key: "wireframe", label: "线框", kind: "bool" },
  ],
  lambert: [
    { key: "color", label: "颜色", kind: "color" },
    { key: "emissive", label: "自发光", kind: "color" },
    { key: "emissiveIntensity", label: "发光强", kind: "slider", min: 0, max: 5, step: 0.05 },
    { key: "wireframe", label: "线框", kind: "bool" },
    { key: "flatShading", label: "平面着色", kind: "bool" },
  ],
  phong: [
    { key: "color", label: "颜色", kind: "color" },
    { key: "emissive", label: "自发光", kind: "color" },
    { key: "emissiveIntensity", label: "发光强", kind: "slider", min: 0, max: 5, step: 0.05 },
    { key: "specular", label: "高光色", kind: "color" },
    { key: "shininess", label: "高光强", kind: "number", min: 0, step: 1 },
    { key: "wireframe", label: "线框", kind: "bool" },
    { key: "flatShading", label: "平面着色", kind: "bool" },
  ],
  standard: STANDARD_PROPS,
  physical: [
    ...STANDARD_PROPS,
    { key: "transmission", label: "透射", kind: "slider", min: 0, max: 1, step: 0.02 },
    { key: "ior", label: "折射率", kind: "number", min: 1, max: 2.333, step: 0.01 },
    { key: "thickness", label: "厚度", kind: "number", min: 0, step: 0.1 },
    { key: "clearcoat", label: "清漆", kind: "slider", min: 0, max: 1, step: 0.02 },
    { key: "clearcoatRoughness", label: "清漆粗糙", kind: "slider", min: 0, max: 1, step: 0.02 },
    { key: "sheen", label: "绒感", kind: "slider", min: 0, max: 1, step: 0.02 },
    { key: "sheenColor", label: "绒感色", kind: "color" },
    { key: "sheenRoughness", label: "绒感粗糙", kind: "slider", min: 0, max: 1, step: 0.02 },
    { key: "iridescence", label: "虹彩", kind: "slider", min: 0, max: 1, step: 0.02 },
    { key: "iridescenceIOR", label: "虹彩折射", kind: "number", min: 1, max: 2.333, step: 0.01 },
    { key: "anisotropy", label: "各向异性", kind: "slider", min: 0, max: 1, step: 0.02 },
    { key: "anisotropyRotation", label: "各向旋转", kind: "slider", min: 0, max: 6.28, step: 0.05 },
  ],
  toon: [
    { key: "color", label: "颜色", kind: "color" },
    { key: "emissive", label: "自发光", kind: "color" },
    { key: "emissiveIntensity", label: "发光强", kind: "slider", min: 0, max: 5, step: 0.05 },
    { key: "wireframe", label: "线框", kind: "bool" },
  ],
  points: [
    { key: "color", label: "颜色", kind: "color" },
    { key: "size", label: "大小", kind: "number", min: 0, step: 0.1 },
    { key: "sizeAttenuation", label: "距离衰减", kind: "bool" },
  ],
}

function clone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T
}

function formatNum(n: number): string {
  if (!isFinite(n)) return "0"
  return String(Math.round(n * 1000) / 1000)
}

/**
 * 数值输入：拖动调整 + 直接输入（浮点）。
 * 视觉对齐 Pattern 的 DragInput：bg #F4F4F5、slate 文字、#3D99FF 聚焦环。
 */
function NumberField(props: {
  value: number
  onChange: (v: number) => void
  step?: number
  min?: number
  max?: number
  int?: boolean
  placeholder?: string
}): JSX.Element {
  const step = () => props.step ?? 0.1
  const [text, setText] = createSignal(formatNum(props.value))
  createEffect(() => setText(formatNum(props.value)))

  const clamp = (v: number): number => {
    let val = props.int ? Math.round(v) : v
    if (props.min != null) val = Math.max(props.min, val)
    if (props.max != null) val = Math.min(props.max, val)
    return val
  }
  const commit = (raw: string): void => {
    const v = parseFloat(raw)
    if (!isNaN(v)) props.onChange(clamp(v))
  }
  const startDrag = (e: MouseEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startVal = props.value
    const overlay = document.createElement("div")
    overlay.style.cssText = "position:fixed;inset:0;z-index:99999;cursor:ew-resize"
    document.body.appendChild(overlay)
    const onMove = (me: MouseEvent): void => {
      const d = (me.clientX - startX) * step()
      props.onChange(clamp(startVal + d))
    }
    const onUp = (): void => {
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("mouseup", onUp)
      overlay.remove()
    }
    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseup", onUp)
  }

  return (
    <div class="flex items-center rounded-sm border border-slate-200 focus-within:border-[#3D99FF] focus-within:ring-1 focus-within:ring-[#3D99FF] h-6 bg-[#F4F4F5] min-w-0 flex-1">
      <span
        onMouseDown={startDrag}
        class="select-none cursor-ew-resize text-slate-400 text-[10px] font-medium px-1.5 h-full flex items-center shrink-0"
        title="拖动调整"
      >
        ⇆
      </span>
      <input
        type="text"
        inputmode="decimal"
        placeholder={props.placeholder}
        value={text()}
        onInput={(e) => {
          setText(e.currentTarget.value)
          commit(e.currentTarget.value)
        }}
        onBlur={() => setText(formatNum(props.value))}
        class="placeholder:text-slate-300 flex-1 min-w-0 bg-transparent outline-none text-[11px] text-slate-700 pr-1 h-full border-0 shadow-none"
      />
    </div>
  )
}

/** 三元组行（位置/旋转/缩放）。label + X/Y/Z 三个 NumberField。 */
function Vec3Row(props: {
  label: string
  values: number[]
  step?: number
  onChange: (i: number, v: number) => void
}): JSX.Element {
  return (
    <div class="flex items-center gap-2">
      <span class="text-[11px] text-slate-500 w-10 shrink-0">{props.label}</span>
      <div class="grid grid-cols-3 gap-1 flex-1 min-w-0">
        <For each={props.values}>
          {(val, i) => <NumberField value={val} step={props.step} onChange={(v) => props.onChange(i(), v)} />}
        </For>
      </div>
    </div>
  )
}

function Section(props: { title: string; children: JSX.Element }): JSX.Element {
  return (
    <div class="border-t border-[#e5e7eb] py-2 -mx-4 px-4 first:border-t-0 first:pt-0">
      <div class="text-[12px] font-semibold text-slate-500 mb-1.5">{props.title}</div>
      <div class="flex flex-col gap-1.5">{props.children}</div>
    </div>
  )
}

export function PropertyEditor3DPopup(props: PropertyEditor3DPopupProps): JSX.Element {
  const [workDef, setWorkDef] = createSignal<SceneConfigObject3D>(clone(props.obj))

  /** 深拷贝当前 workDef → 应用变更 → set + emit patch */
  function mutate(fn: (d: SceneConfigObject3D) => void): void {
    const next = clone(workDef())
    fn(next)
    setWorkDef(next)
    props.onPatch({ objects: { upsert: [next] } })
  }

  /** 读三元组，scale 缺省 [1,1,1]，position/rotation 缺省 [0,0,0] */
  function vec(field: "position" | "rotation" | "scale", i: number): number {
    const def = field === "scale" ? 1 : 0
    const cur = workDef()[field] as number[] | undefined
    return cur?.[i] ?? def
  }
  /** 写三元组：沿用 vec 的缺省（scale→1，其余→0），避免编辑一轴时其余被置 0 */
  function setVec(field: "position" | "rotation" | "scale", i: number, v: number): void {
    mutate((d) => {
      const def = field === "scale" ? 1 : 0
      const cur = d[field] as number[] | undefined
      const arr = [cur?.[0] ?? def, cur?.[1] ?? def, cur?.[2] ?? def]
      arr[i] = v
      ;(d as unknown as Record<string, number[]>)[field] = arr
    })
  }

  function setMat(field: string, value: unknown): void {
    mutate((d) => {
      if (!d.material) d.material = { type: "standard" }
      d.material = { ...d.material, [field]: value }
    })
  }

  function setTransparent(on: boolean): void {
    mutate((d) => {
      if (!d.material) d.material = { type: "standard" }
      d.material = { ...d.material, transparent: on, opacity: on ? d.material.opacity ?? 0.7 : d.material.opacity }
    })
  }

  function setGeoParam(name: string, value: number | string): void {
    mutate((d) => {
      if (!d.geometry) return
      d.geometry = { ...d.geometry, params: { ...(d.geometry.params ?? {}), [name]: value } }
    })
  }

  const d = workDef
  const geoType = () => d().geometry?.type ?? ""
  const geoParamDefs = () => GEO_PARAMS[geoType()] ?? []
  const isMesh = () => d().type === "mesh"
  /** 材质归一 type（snapshotMaterial 归一；顶层 def 为配置别名，同 key 空间）。空串=未知 */
  const matType = () => d().material?.type ?? ""
  /** COMMON 基类属性 + 该类型专属属性（未知 type 仅 COMMON） */
  const matProps = () => [...COMMON_PROPS, ...(MATERIAL_PROPS[matType()] ?? [])]

  return (
    <div
      class="property-editor-popup"
      style={{ position: "absolute", top: "50px", right: "5px", width: "240px", "max-height": "calc(100% - 64px)" }}
    >
      {/* 头部（对齐 Pattern：类型 + id + 关闭） */}
      <div class="popup-header">
        <span class="text-sm font-semibold text-slate-700">{d().type}</span>
        <span class="text-xs text-slate-400 ml-2 truncate">{d().id}</span>
        <button
          type="button"
          onClick={() => props.onClose()}
          id="popup-header-close-btn"
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
        {/* Transform（所有类型可编辑） */}
        <Section title="变换 Transform">
          <Vec3Row label="位置" values={[vec("position", 0), vec("position", 1), vec("position", 2)]} step={0.2} onChange={(i, v) => setVec("position", i, v)} />
          <Vec3Row label="旋转°" values={[vec("rotation", 0), vec("rotation", 1), vec("rotation", 2)]} step={5} onChange={(i, v) => setVec("rotation", i, v)} />
          <Vec3Row label="缩放" values={[vec("scale", 0), vec("scale", 1), vec("scale", 2)]} step={0.1} onChange={(i, v) => setVec("scale", i, v)} />
        </Section>

        {/* 材质（仅 mesh 且有 material；按归一 type 动态显属性） */}
        <Show when={isMesh() && d().material}>
          <Section title="材质 Material">
            <For each={matProps()}>
              {(p) => {
                const val = () => d().material![p.key]
                if (p.kind === "color") {
                  return (
                    <div class="flex items-center gap-2">
                      <span class="text-[11px] text-slate-500 w-10 shrink-0">{p.label}</span>
                      <input
                        type="color"
                        value={normalizeHex(val() as string | undefined)}
                        onInput={(e) => setMat(p.key, e.currentTarget.value)}
                        class="h-6 w-8 rounded border border-slate-200 bg-transparent cursor-pointer shrink-0"
                      />
                      <input
                        type="text"
                        value={(val() as string | undefined) ?? "#ffffff"}
                        onInput={(e) => setMat(p.key, e.currentTarget.value)}
                        class="property-input flex-1 min-w-0 h-6"
                      />
                    </div>
                  )
                }
                if (p.kind === "slider") {
                  const row = (
                    <SliderRow
                      label={p.label}
                      value={(val() as number | undefined) ?? (p.key === "opacity" ? 1 : 0)}
                      min={p.min ?? 0}
                      max={p.max ?? 1}
                      step={p.step ?? 0.02}
                      onChange={(v) => setMat(p.key, v)}
                    />
                  )
                  // opacity 仅在 transparent 开启时显（three 需 transparent=true 才认 opacity<1）
                  if (p.key === "opacity") {
                    return <Show when={!!d().material!.transparent}>{row}</Show>
                  }
                  return row
                }
                if (p.kind === "number") {
                  return (
                    <div class="flex items-center gap-2">
                      <span class="text-[11px] text-slate-500 w-10 shrink-0">{p.label}</span>
                      <div class="flex-1 min-w-0">
                        <NumberField
                          value={(val() as number | undefined) ?? 0}
                          step={p.step}
                          min={p.min}
                          max={p.max}
                          int={p.int}
                          onChange={(v) => setMat(p.key, v)}
                        />
                      </div>
                    </div>
                  )
                }
                if (p.kind === "bool") {
                  // transparent 特判：联动 opacity（开时给 0.7 默认）
                  if (p.key === "transparent") {
                    return (
                      <div class="flex items-center gap-2">
                        <label class="flex items-center gap-1 text-[11px] text-slate-600 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={!!val()}
                            onChange={(e) => setTransparent(e.currentTarget.checked)}
                            class="accent-[#3D99FF]"
                          />
                          {p.label}
                        </label>
                      </div>
                    )
                  }
                  return (
                    <div class="flex items-center gap-2">
                      <label class="flex items-center gap-1 text-[11px] text-slate-600 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={!!val()}
                          onChange={(e) => setMat(p.key, e.currentTarget.checked)}
                          class="accent-[#3D99FF]"
                        />
                        {p.label}
                      </label>
                    </div>
                  )
                }
                // select（side/blending 等）
                return (
                  <div class="flex items-center gap-2">
                    <span class="text-[11px] text-slate-500 w-10 shrink-0">{p.label}</span>
                    <select
                      value={String(val() ?? 0)}
                      onChange={(e) => setMat(p.key, Number(e.currentTarget.value))}
                      class="property-input flex-1 min-w-0 h-6"
                    >
                      <For each={p.options ?? []}>
                        {(o) => <option value={String(o.v)}>{o.t}</option>}
                      </For>
                    </select>
                  </div>
                )
              }}
            </For>
            <Show when={!MATERIAL_PROPS[matType()]}>
              <div class="text-[11px] text-slate-400">该材质类型（{matType() || "未知"}）不支持细项属性编辑</div>
            </Show>
          </Section>
        </Show>

        {/* 几何参数（仅 mesh 且有 geometry） */}
        <Show when={isMesh() && d().geometry && geoParamDefs().length > 0}>
          <Section title={`几何 · ${geoType()}`}>
            <For each={geoParamDefs()}>
              {(p) => (
                <div class="flex items-center gap-2">
                  <span class="text-[11px] text-slate-500 w-16 shrink-0">{p.name}</span>
                  <div class="flex-1 min-w-0">
                    <NumberField
                      value={Number((d().geometry!.params as Record<string, number | string>)?.[p.name] ?? 0)}
                      step={p.step}
                      min={p.min}
                      int={p.int}
                      onChange={(v) => setGeoParam(p.name, v)}
                    />
                  </div>
                </div>
              )}
            </For>
          </Section>
        </Show>

        <Show when={isMesh() && d().geometry && geoParamDefs().length === 0}>
          <div class="text-[11px] text-slate-400 border-t border-[#e5e7eb] -mx-4 px-4 py-2">
            该几何类型（{geoType()}）暂无可编辑参数
          </div>
        </Show>
      </div>
    </div>
  )
}

/** 滑块行（材质粗糙/金属/不透明度） */
function SliderRow(props: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
}): JSX.Element {
  return (
    <div class="flex items-center gap-2">
      <span class="text-[11px] text-slate-500 w-10 shrink-0">{props.label}</span>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onInput={(e) => props.onChange(parseFloat(e.currentTarget.value))}
        class="flex-1 accent-[#3D99FF] h-1"
      />
      <span class="text-[10px] text-slate-400 w-8 text-right tabular-nums">{formatNum(props.value)}</span>
    </div>
  )
}

/** color 输入要求 #rrggbb 7 位；补全 3 位简写/非法值 */
function normalizeHex(c: string | undefined): string {
  if (!c) return "#ffffff"
  const s = c.trim()
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s
  if (/^#[0-9a-fA-F]{3}$/.test(s)) {
    return "#" + s.slice(1).split("").map((ch) => ch + ch).join("")
  }
  return "#ffffff"
}

/**
 * 3D 预览 UI 公共控件（property-editor-popup 与 scene-settings-panel 共用）。
 *
 * 视觉对齐 Pattern 的 DragInput：bg #F4F4F5、slate 文字、#3D99FF 聚焦环；
 * ColorRow 复用 pattern 的富功能 ColorPicker（HSB/RGB/alpha + token 色板）。
 * 从 property-editor-popup.tsx 抽出，避免重复。
 */
import { createEffect, createSignal, For, type JSX } from "solid-js"
import { ColorPicker } from "@/pages/pattern/modules/preview/property-editor-popup/color-picker"
import { HUI_COLOR_TOKENS } from "@/pages/pattern/modules/preview/property-editor-popup/hui-color-tokens"
import { DragIcon } from "@/pages/pattern/modules/preview/property-editor-popup/icons"

/** 深拷贝（JSON 往返）。workDef / workEnv 编辑态拷贝用。 */
export function clone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T
}

/** 数值显示：保留 3 位小数（去尾零），NaN/Infinity 回退 "0"。 */
export function formatNum(n: number): string {
  if (!isFinite(n)) return "0"
  return String(Math.round(n * 1000) / 1000)
}

/**
 * 数值输入：拖动调整 + 直接输入（浮点）。
 * 视觉对齐 Pattern 的 DragInput：bg #F4F4F5、slate 文字、#3D99FF 聚焦环。
 */
export function NumberField(props: {
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
    <div class="flex items-center rounded-sm focus-within:border-[#3D99FF] focus-within:ring-1 focus-within:ring-[#3D99FF] h-6 bg-[#F4F4F5] min-w-0 flex-1">
      <span
        onMouseDown={startDrag}
        class="select-none cursor-ew-resize text-slate-400 px-1.5 h-full flex items-center shrink-0"
        title="拖动调整"
      >
        <DragIcon />
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
export function Vec3Row(props: {
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

/** 带标题的分区块容器（顶部分隔线 + 标题 + 子内容列）。 */
export function Section(props: { title: string; children: JSX.Element }): JSX.Element {
  return (
    <div class="border-t border-[#e5e7eb] py-2 -mx-4 px-4 first:border-t-0 first:pt-0">
      <div class="text-[12px] font-semibold text-slate-500 mb-1.5">{props.title}</div>
      <div class="flex flex-col gap-1.5">{props.children}</div>
    </div>
  )
}

/** 滑块行（label + range + 数值显示）。 */
export function SliderRow(props: {
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

/** color 输入要求 #rrggbb 7 位；补全 3 位简写/非法值。 */
export function normalizeHex(c: string | undefined): string {
  if (!c) return "#ffffff"
  const s = c.trim()
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s
  if (/^#[0-9a-fA-F]{3}$/.test(s)) {
    return "#" + s.slice(1).split("").map((ch) => ch + ch).join("")
  }
  return "#ffffff"
}

/**
 * 颜色行：label + pattern 富功能 ColorPicker（HSB/RGB/alpha 滑块 + token 色板，Portal 弹层）。
 * 对齐 pattern property-editor-popup 的颜色选择交互。
 * label 由 ColorRow 自己渲染（ColorPicker 内部仅在「背景色/文字色」时显 label，3D 标签不同，避开）。
 */
export function ColorRow(props: {
  label: string
  value: string | undefined
  onChange: (v: string) => void
}): JSX.Element {
  return (
    <div class="flex items-center gap-2">
      <span class="text-[11px] text-slate-500 w-10 shrink-0">{props.label}</span>
      <div class="flex-1 min-w-0">
        <ColorPicker
          value={normalizeHex(props.value)}
          onChange={props.onChange}
          label={props.label}
          tokens={HUI_COLOR_TOKENS}
        />
      </div>
    </div>
  )
}

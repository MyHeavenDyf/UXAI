import { createSignal, createEffect } from "solid-js"
import { DragIcon } from "./icons"
import type { JSX } from "solid-js"

export function DragInput(props: {
  value: () => number
  setValue: (v: number) => void
  setFound: (v: boolean) => void
  found: () => boolean
  placeholder: string
  direction?: 'vertical' | 'horizontal'
  min?: number
  max?: number
  icon?: string | JSX.Element
  suffixIcon?: string | JSX.Element
  hasBorder?: boolean
  bg?: string
  class?: string
  flex1?: boolean
  suffix?: string
  display?: string
}) {
  const icon = props.icon ?? DragIcon()
  const isV = props.direction === 'vertical'
  const mn = props.min ?? 0
  const border = props.hasBorder ? 'border border-slate-200' : ''
  const bg = props.bg ?? 'bg-[#F4F4F5]'
  const flex = props.flex1 !== false ? 'flex-1' : ''
  // 分离显示文本与提交值：让用户能输入 "-" / "-5" 等中间态而不被受控 input 用旧
  // signal 立即覆盖（旧实现 parseInt("-")=NaN→0 会把 "-" 钳成 0 并触发 autoSave）。
  // 外部 value 变化（拖拽 / 父组件 setValue）时同步 text，但 input 正在 focus 时跳过，
  // 避免打断用户输入；失焦时把 text 重置为当前 value，丢弃无效输入。
  const computeDisplay = () => props.display ?? (props.found() ? String(props.value()) + (props.suffix ?? '') : '')
  const [text, setText] = createSignal(computeDisplay())
  let inputEl: HTMLInputElement | undefined
  createEffect(() => {
    const next = computeDisplay()
    if (inputEl && document.activeElement === inputEl) return
    setText(next)
  })
  // 键盘提交：失焦或回车时才把文本解析成数字并 setValue，避免每个字符触发 autoSave
  // 全量重渲染 iframe。解析失败时把 text 重置为当前 value，丢弃无效输入。
  const commit = () => {
    const parsed = parseInt(text())
    if (!isNaN(parsed)) {
      const v = Math.max(mn, props.max != null ? Math.min(props.max, parsed) : parsed)
      props.setValue(v)
      props.setFound(true)
    }
    setText(computeDisplay())
  }
  return (
    <div class={`flex items-center rounded-sm ${border} focus-within:border-[#3D99FF] focus-within:ring-1 focus-within:ring-[#3D99FF] h-6 shadow-none ${bg} ${flex} min-w-0 ${props.class ?? ''}`}>
      <span onMouseDown={(e) => {
        e.preventDefault()
        e.stopPropagation()
        const sc = isV ? e.clientY : e.clientX
        const sv = props.value()
        const overlay = document.createElement('div')
        overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;cursor:' + (isV ? 'ns-resize' : 'ew-resize')
        document.body.appendChild(overlay)
        const onMove = (me: MouseEvent) => {
          const cursor = isV ? me.clientY : me.clientX
          const d = Math.round(((isV ? sc - cursor : cursor - sc)) / 2)
          const v = Math.max(mn, sv + d)
          props.setValue(props.max != null ? Math.min(props.max, v) : v)
          props.setFound(true)
        }
        const onUp = () => {
          window.removeEventListener('mousemove', onMove)
          window.removeEventListener('mouseup', onUp)
          overlay.remove()
        }
        window.addEventListener('mousemove', onMove)
        window.addEventListener('mouseup', onUp)
      }} class={`select-none ${isV ? 'cursor-ns-resize' : 'cursor-ew-resize'} text-slate-400 text-[10px] font-medium px-1.5 h-full flex items-center`}>{icon}</span>
      <input ref={(el) => { inputEl = el }} type="text" inputmode="numeric" placeholder={props.placeholder}
        value={text()}
        onInput={(e) => {
          // 只更新本地文本，不立即 setValue，避免每个字符触发 autoSave 全量重渲染 iframe。
          // 真正提交在 onBlur / Enter 时（见 commit）。
          setText(e.currentTarget.value)
        }}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
        class="placeholder:text-muted-foreground flex-1 min-w-0 bg-transparent outline-none text-[11px] pr-1 h-full border-0 shadow-none" />
      {props.suffixIcon && <span class="text-slate-400 text-[10px] font-medium px-1.5 h-full flex items-center shrink-0 select-none">{props.suffixIcon}</span>}
    </div>
  )
}

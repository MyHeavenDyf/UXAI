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
      <input type="text" inputmode="numeric" placeholder={props.placeholder}
        value={props.display ?? (props.found() ? String(props.value()) + (props.suffix ?? '') : '')}
        onInput={(e) => { const v = Math.max(mn, parseInt(e.currentTarget.value) || 0); props.setValue(props.max != null ? Math.min(props.max, v) : v); props.setFound(true) }}
        class="placeholder:text-muted-foreground flex-1 min-w-0 bg-transparent outline-none text-[11px] pr-1 h-full border-0 shadow-none" />
    </div>
  )
}

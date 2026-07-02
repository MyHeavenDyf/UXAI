import { createEffect, createSignal, onCleanup, Show, For } from "solid-js"
import { Portal } from "solid-js/web"

export function CustomSelect(props: {
  value: string
  options: { label: string; value: string }[]
  onChange: (value: string) => void
  class?: string
}) {
  const [open, setOpen] = createSignal(false)
  const [pos, setPos] = createSignal({ x: 0, y: 0, w: 0 })
  let btnRef!: HTMLButtonElement
  let listRef!: HTMLDivElement
  createEffect(() => {
    if (!open()) return
    const handler = (e: MouseEvent) => {
      if (listRef && !listRef.contains(e.target as Node) && !btnRef.contains(e.target as Node)) setOpen(false)
    }
    const onScroll = () => setOpen(false)
    if (btnRef) {
      const r = btnRef.getBoundingClientRect()
      setPos({ x: r.left, y: r.bottom + 4, w: r.width })
    }
    document.addEventListener('mousedown', handler)
    window.addEventListener('scroll', onScroll, true)
    onCleanup(() => {
      document.removeEventListener('mousedown', handler)
      window.removeEventListener('scroll', onScroll, true)
    })
  })
  const cls = () => props.class || ''
  return (
    <div class={`relative flex-1 ${cls()}`}>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen(!open())}
        class="flex items-center rounded-sm bg-[#F4F4F5] h-6 text-[11px] px-2 outline-none w-full border border-transparent hover:border-[#c9c9c9] focus:border-[#0067d1] focus:shadow-[0_0_0_1px_#8abef3] text-left"
      >
        <span class="flex-1 truncate">{props.options.find(o => o.value === props.value)?.label || props.value}</span>
        <svg class="w-3 h-3 ml-1 shrink-0 text-slate-400" viewBox="0 0 8 5" fill="none"><path d="M1 1L4 4L7 1" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" /></svg>
      </button>
      <Show when={open()}>
        <Portal mount={document.body}>
          <div ref={listRef} class="fixed z-[2147483646] py-1 rounded-lg border border-[#e5e7eb]"
            style={{ left: pos().x + 'px', top: pos().y + 'px', 'min-width': pos().w + 'px', background: '#fff', 'box-shadow': '0 10px 15px -3px rgba(0,0,0,0.08), 0 4px 6px -2px rgba(0,0,0,0.04)' }}
            onClick={() => setOpen(false)}>
            <For each={props.options}>
              {(opt) => (
                <div
                  onClick={() => props.onChange(opt.value)}
                  class="px-[10px] py-[6px] text-[10px] text-slate-700 bg-white hover:bg-[#f3f4f6] cursor-pointer whitespace-nowrap"
                  classList={{ 'bg-[#E6F2FD] text-primary font-medium': opt.value === props.value }}
                >
                  {opt.label}
                </div>
              )}
            </For>
          </div>
        </Portal>
      </Show>
    </div>
  )
}

import { createEffect, createSignal, createMemo, Show, For, onCleanup } from "solid-js"
import { Portal } from "solid-js/web"

export type { ColorToken } from "./hui-color-tokens"
import type { ColorToken } from "./hui-color-tokens"
import { HUI_COLOR_TOKENS, TEXT_COLOR_TOKENS, BG_COLOR_TOKENS } from "./hui-color-tokens"
export { HUI_COLOR_TOKENS, TEXT_COLOR_TOKENS, BG_COLOR_TOKENS }

function hsbToRgb(h: number, s: number, b: number) {
  const c = (b / 100) * (s / 100)
  const x = c * (1 - Math.abs((h / 60) % 2 - 1))
  const m = b / 100 - c
  const [r, g, bl] = h < 60 ? [c, x, 0]
    : h < 120 ? [x, c, 0]
      : h < 180 ? [0, c, x]
        : h < 240 ? [0, x, c]
          : h < 300 ? [x, 0, c]
            : [c, 0, x]
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((bl + m) * 255),
  }
}

function hslToRgb(h: number, s: number, l: number) {
  const c = (1 - Math.abs(2 * (l / 100) - 1)) * (s / 100)
  const x = c * (1 - Math.abs((h / 60) % 2 - 1))
  const m = l / 100 - c / 2
  const [r, g, b] = h < 60 ? [c, x, 0]
    : h < 120 ? [x, c, 0]
      : h < 180 ? [0, c, x]
        : h < 240 ? [0, x, c]
          : h < 300 ? [x, 0, c]
            : [c, 0, x]
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  }
}

function rgbToHex(rgb: { r: number; g: number; b: number }) {
  return `#${rgb.r.toString(16).padStart(2, '0')}${rgb.g.toString(16).padStart(2, '0')}${rgb.b.toString(16).padStart(2, '0')}`
}

function hexWithAlpha(hex: string, a: number): string {
  if (a >= 100) return hex
  return hex + Math.round(a * 2.55).toString(16).padStart(2, '0')
}

function hexToRgb(hex: string) {
  const match = hex.match(/^#?([a-fA-F0-9]{6})([a-fA-F0-9]{2})?$/)
  if (!match) return null
  return {
    r: parseInt(match[1].slice(0, 2), 16),
    g: parseInt(match[1].slice(2, 4), 16),
    b: parseInt(match[1].slice(4, 6), 16),
    a: match[2] ? Math.round((parseInt(match[2], 16) / 255) * 100) : 100,
  }
}

function rgbToHsb(rgb: { r: number; g: number; b: number }) {
  const r = rgb.r / 255, g = rgb.g / 255, b = rgb.b / 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const d = max - min
  const h = d === 0 ? 0
    : max === r ? 60 * (((g - b) / d) % 6)
      : max === g ? 60 * ((b - r) / d + 2)
        : 60 * ((r - g) / d + 4)
  return {
    h: Math.round(h < 0 ? h + 360 : h),
    s: max === 0 ? 0 : Math.round((d / max) * 100),
    b: Math.round(max * 100),
  }
}

export function ColorPicker(props: {
  value: string
  onChange: (hex: string) => void
  onTokenChange?: (tokenName: string | null) => void
  label: string
  tokens: ColorToken[]
  placeholder?: string
}) {
  let buttonRef: HTMLButtonElement | undefined
  let popupRef: HTMLDivElement | undefined
  let dragFrame: number | undefined

  const [open, setOpen] = createSignal(false)
  const [popupPos, setPopupPos] = createSignal({ x: 0, y: 0 })
  const [tab, setTab] = createSignal<'custom' | 'token'>('token')
  const [hue, setHue] = createSignal(0)
  const [saturation, setSaturation] = createSignal(100)
  const [brightness, setBrightness] = createSignal(100)
  const [alpha, setAlpha] = createSignal(100)
  const [mode, setMode] = createSignal<'RGB' | 'HSL' | 'HSB'>('RGB')
  const [modeOpen, setModeOpen] = createSignal(false)
  const [lastTokenName, setLastTokenName] = createSignal('')
  const [tooltipData, setTooltipData] = createSignal<{ name: string; color: string; opacity: string; x: number; y: number } | null>(null)

  function showTooltip(token: ColorToken, e: MouseEvent) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setTooltipData({ name: token.displayName || token.name, color: token.color, opacity: token.opacity, x: rect.left - 10, y: rect.top + rect.height / 2 })
  }

  const placeholder = () => props.placeholder ?? '继承'

  const displayLabel = createMemo(() => {
    if (!props.value) return placeholder()
    if (lastTokenName()) {
      for (const t of props.tokens) {
        if (t.name !== lastTokenName()) continue
        const tokenAlpha = parseFloat(t.opacity) || 100
        if (hexWithAlpha(t.color, tokenAlpha).toLowerCase() === props.value.toLowerCase()) return t.displayName || t.name
      }
    }
    for (const t of props.tokens) {
      const tokenAlpha = parseFloat(t.opacity) || 100
      if (hexWithAlpha(t.color, tokenAlpha).toLowerCase() === props.value.toLowerCase()) return t.displayName || t.name
    }
    return props.value
  })

  function syncFromHex(hex = props.value) {
    const rgb = hexToRgb(hex)
    if (!rgb) return
    const hsb = rgbToHsb(rgb)
    setHue(hsb.h)
    setSaturation(hsb.s)
    setBrightness(hsb.b)
    setAlpha(rgb.a)
  }

  function setColorFromHsb(h = hue(), s = saturation(), b = brightness()) {
    setLastTokenName('')
    props.onTokenChange?.(null)
    props.onChange(hexWithAlpha(rgbToHex(hsbToRgb(h, s, b)), alpha()))
  }

  function setAreaFromPointer(el: HTMLElement, e: PointerEvent) {
    if (dragFrame) cancelAnimationFrame(dragFrame)
    dragFrame = requestAnimationFrame(() => {
      const rect = el.getBoundingClientRect()
      const s = Math.max(0, Math.min(100, Math.round(((e.clientX - rect.left) / rect.width) * 100)))
      const b = Math.max(0, Math.min(100, Math.round((1 - (e.clientY - rect.top) / rect.height) * 100)))
      setSaturation(s)
      setBrightness(b)
      setColorFromHsb(hue(), s, b)
    })
  }

  function startAreaDrag(e: PointerEvent & { currentTarget: HTMLElement }) {
    e.preventDefault()
    const el = e.currentTarget
    setAreaFromPointer(el, e)
    const onMove = (ev: PointerEvent) => setAreaFromPointer(el, ev)
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  function setHueFromPointer(el: HTMLElement, e: PointerEvent) {
    const rect = el.getBoundingClientRect()
    const h = Math.max(0, Math.min(360, Math.round(((e.clientX - rect.left) / rect.width) * 360)))
    setHue(h)
    setColorFromHsb(h)
  }

  function startHueDrag(e: PointerEvent & { currentTarget: HTMLElement }) {
    e.preventDefault()
    const el = e.currentTarget
    setHueFromPointer(el, e)
    const onMove = (ev: PointerEvent) => setHueFromPointer(el, ev)
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  function setAlphaFromPointer(el: HTMLElement, e: PointerEvent) {
    const rect = el.getBoundingClientRect()
    const a = Math.max(0, Math.min(100, Math.round(((e.clientX - rect.left) / rect.width) * 100)))
    setAlpha(a)
    props.onChange(hexWithAlpha(rgbToHex(rgb()), a))
  }

  function startAlphaDrag(e: PointerEvent & { currentTarget: HTMLElement }) {
    e.preventDefault()
    const el = e.currentTarget
    setAlphaFromPointer(el, e)
    const onMove = (ev: PointerEvent) => setAlphaFromPointer(el, ev)
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  function setCustomHex(value: string) {
    const hex = value.startsWith('#') ? value : `#${value}`
    if (/^#[a-fA-F0-9]{6}$/.test(hex)) {
      props.onChange(hexWithAlpha(hex.toLowerCase(), alpha()))
      syncFromHex(hex)
    } else if (/^#[a-fA-F0-9]{8}$/.test(hex)) {
      props.onChange(hex.toLowerCase())
      syncFromHex(hex)
    }
  }

  async function pickFromScreen() {
    const eyeDropper = (window as unknown as { EyeDropper?: new () => { open: () => Promise<{ sRGBHex: string }> } }).EyeDropper
    if (!eyeDropper) return
    const hex = (await new eyeDropper().open()).sRGBHex
    props.onChange(hex)
    syncFromHex(hex)
  }

  const rgb = createMemo(() => hsbToRgb(hue(), saturation(), brightness()))
  const hsl = createMemo(() => {
    const { r, g, b } = rgb()
    const max = Math.max(r, g, b) / 255, min = Math.min(r, g, b) / 255
    const l = (max + min) / 2
    const d = max - min
    const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1))
    return { h: hue(), s: Math.round(s * 100), l: Math.round(l * 100) }
  })

  function channelValues() {
    if (mode() === 'HSL') return [hsl().h, hsl().s, hsl().l, alpha()]
    if (mode() === 'HSB') return [hue(), saturation(), brightness(), alpha()]
    return [rgb().r, rgb().g, rgb().b, alpha()]
  }

  function channelLabels() {
    if (mode() === 'HSL') return ['H', 'S', 'L', 'A']
    if (mode() === 'HSB') return ['H', 'S', 'B', 'A']
    return ['R', 'G', 'B', 'A']
  }

  function setChannel(index: number, value: number) {
    const v = Math.max(0, value || 0)
    if (index === 3) {
      const a = Math.min(100, v)
      setAlpha(a)
      props.onChange(hexWithAlpha(rgbToHex(rgb()), a))
      return
    }
    if (mode() === 'HSB') {
      const h = index === 0 ? Math.min(360, v) : hue()
      const s = index === 1 ? Math.min(100, v) : saturation()
      const b = index === 2 ? Math.min(100, v) : brightness()
      setHue(h); setSaturation(s); setBrightness(b); setColorFromHsb(h, s, b)
      return
    }
    if (mode() === 'RGB') {
      const { r, g, b } = rgb()
      const next = {
        r: index === 0 ? Math.min(255, v) : r,
        g: index === 1 ? Math.min(255, v) : g,
        b: index === 2 ? Math.min(255, v) : b,
      }
      const hex = hexWithAlpha(rgbToHex(next), alpha())
      props.onChange(hex)
      syncFromHex(hex)
      return
    }
    if (mode() === 'HSL') {
      const hs = hsl()
      const h = index === 0 ? Math.min(360, v) : hs.h
      const s = index === 1 ? Math.min(100, v) : hs.s
      const l = index === 2 ? Math.min(100, v) : hs.l
      const hex = hexWithAlpha(rgbToHex(hslToRgb(h, s, l)), alpha())
      props.onChange(hex)
      syncFromHex(hex)
    }
  }

  function updatePos() {
    if (!buttonRef) return
    const rect = buttonRef.getBoundingClientRect()
    const panelW = 260
    const panelH = 330
    setPopupPos({
      x: Math.max(4, rect.left - panelW - 6),
      y: Math.max(4, Math.min(rect.top - 72, window.innerHeight - panelH - 4)),
    })
  }

  function toggle() {
    if (!open() && buttonRef) {
      updatePos()
    }
    setOpen(!open())
  }

  function onPopupMouseDown(e: MouseEvent) {
    const target = e.target as Node
    if (popupRef?.contains(target)) return
    if (buttonRef?.contains(target)) return
    setOpen(false)
    setModeOpen(false)
  }

  const unsubOpen = (() => {
    let cleanup: () => void
    createEffect(() => {
      if (open()) {
        window.addEventListener('mousedown', onPopupMouseDown)
        cleanup = () => window.removeEventListener('mousedown', onPopupMouseDown)
        return
      }
      window.removeEventListener('mousedown', onPopupMouseDown)
    })
    onCleanup(() => window.removeEventListener('mousedown', onPopupMouseDown))
  })()

  const unsubMode = (() => {
    createEffect(() => {
      if (modeOpen()) {
        const h = () => setModeOpen(false)
        window.addEventListener('mousedown', h)
        onCleanup(() => window.removeEventListener('mousedown', h))
      }
    })
  })()

  onCleanup(() => { if (dragFrame) cancelAnimationFrame(dragFrame) })

  return (
    <div class="relative flex items-center gap-2">
      <Show when={props.label == "背景色"}>
        <label class="text-[12px] font-semibold text-slate-500 w-14 shrink-0">{props.label}</label>
      </Show>
      <Show when={props.label == "文字色"}>
        <label class="text-[10px] text-slate-400 w-8 shrink-0">{props.label}</label>
      </Show>
      <button
        ref={(el) => { buttonRef = el }}
        type="button"
        onClick={(e) => { e.stopPropagation(); toggle() }}
        class="flex items-center gap-4 h-6 rounded-sm bg-[#F4F4F5] text-[10px] text-slate-600 hover:bg-[#E4E4E7] w-full py-2 px-2"
      >
        <span class="w-4 h-4 rounded-[2px] shrink-0" style={{ background: props.value || '#ffffff' }} />
        <span class="truncate">{displayLabel()}</span>
      </button>
      <Show when={open()}>
        <Portal>
          <div
            ref={(el) => { popupRef = el }}
            class="fixed z-[302] w-[260px] rounded-md bg-white py-1 shadow-[0_8px_24px_rgba(0,0,0,0.18)]"
            style={{ left: popupPos().x + 'px', top: popupPos().y + 'px', background: '#ffffff' }}
          >
            <div class="flex items-center gap-1 border-b border-[#e5e7eb] px-2 pb-1">
              <button
                type="button"
                onClick={() => { setLastTokenName(''); props.onTokenChange?.(null); syncFromHex(); setTab('custom'); updatePos() }}
                class={tab() === 'custom' ? 'h-6 rounded-sm px-2 text-[11px] text-[#19191a]' : 'h-6 rounded-sm px-2 text-[11px] text-[#8b8c8f] hover:bg-[#F4F4F5]'}
              >
                自定义
              </button>
              <button
                type="button"
                onClick={() => { setTab('token'); updatePos() }}
                class={tab() === 'token' ? 'h-6 rounded-sm px-2 text-[11px] text-[#19191a]' : 'h-6 rounded-sm px-2 text-[11px] text-[#8b8c8f] hover:bg-[#F4F4F5]'}
              >
                token色
              </button>
            </div>
            <Show
              when={tab() === 'token'}
              fallback={
                <div class="px-2 pb-2 pt-1">
                  <div
                    class="relative h-[224px] w-[238px] touch-none overflow-hidden cursor-crosshair"
                    style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${hue()}, 100%, 50%))` }}
                    onPointerDown={startAreaDrag}
                  >
                    <span class="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white"
                      style={{ left: saturation() + '%', top: (100 - brightness()) + '%', 'box-shadow': '0 0 0 2px #fff, inset 0 0 0 1px #0000001a, 0 0 0 3px #0003', outline: 'none' }} />
                  </div>

                  <div class="mt-2 grid grid-cols-[40px_1fr] gap-2">
                    <button type="button" onClick={pickFromScreen}
                      class="flex h-10 w-10 items-center justify-center rounded text-slate-500 hover:bg-[#E4E4E7]">
                      <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="M17.4144 10.3426C17.0239 9.95205 16.3907 9.95205 16.0002 10.3426C15.6097 10.7331 15.6097 11.3663 16.0002 11.7568L16.7073 12.4639L10.3432 18.828C9.698 19.4732 9.58579 20.4496 10.0066 21.21L9.3959 21.8206C9.17744 22.0391 9.17744 22.3933 9.39589 22.6117C9.61434 22.8302 9.96851 22.8302 10.187 22.6117L10.8 21.9987C11.5589 22.4128 12.5293 22.2987 13.1716 21.6564L19.5357 15.2923L20.2428 15.9994C20.6334 16.39 21.2665 16.39 21.6571 15.9994C22.0476 15.6089 22.0476 14.9757 21.6571 14.5852L20.9857 13.9138L23.657 11.2424C24.4381 10.4614 24.4381 9.19507 23.657 8.41402C22.876 7.63297 21.6097 7.63297 20.8286 8.41402L19.8886 9.35408C19.7632 9.43269 19.6447 9.52653 19.5356 9.6356L18.1215 11.0497L17.4144 10.3426ZM17.4144 13.171L18.8286 14.5852L12.4645 20.9493C12.1444 21.2694 11.659 21.3283 11.279 21.1209L11.0229 20.9812L10.8815 20.7258C10.6709 20.3451 10.7287 19.8567 11.0503 19.5351L17.4144 13.171Z" fill="currentColor"></path></svg>
                    </button>
                    <div class="flex flex-col gap-2 min-w-0">
                      <div
                        class="relative h-3.5 w-full touch-none rounded-full bg-[linear-gradient(90deg,red,#ff0,lime,cyan,blue,magenta,red)] cursor-pointer"
                        onPointerDown={startHueDrag}
                      >
                        <span class="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white"
                          style={{ left: `calc(5px + (100% - 10px) * ${hue() / 360})`, 'box-shadow': '0 0 0 2px #fff, inset 0 0 0 1px #0000001a, 0 0 0 3px #0003', outline: 'none' }} />
                      </div>
                      <div
                        class="relative h-3.5 w-full touch-none rounded-full bg-[linear-gradient(45deg,#ddd_25%,transparent_25%),linear-gradient(-45deg,#ddd_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#ddd_75%),linear-gradient(-45deg,transparent_75%,#ddd_75%)] bg-[length:8px_8px] bg-[position:0_0,0_4px,4px_-4px,-4px_0] cursor-pointer"
                        onPointerDown={startAlphaDrag}
                      >
                        <span class="absolute inset-0 rounded-full" style={{ background: `linear-gradient(90deg, transparent, ${props.value || '#000000'})` }} />
                        <span class="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white"
                          style={{ left: `calc(5px + (100% - 10px) * ${alpha() / 100})`, 'box-shadow': '0 0 0 2px #fff, inset 0 0 0 1px #0000001a, 0 0 0 3px #0003', outline: 'none' }} />
                      </div>
                    </div>
                  </div>

                  <div class="mt-2 flex items-center gap-2">
                    <div class="flex h-7 flex-1 items-center bg-[#F4F4F5] px-2 rounded-[4px] focus-within:shadow-[0_0_0_1px_#336fff]">
                      <span class="mr-1 text-[12px] text-slate-400">#</span>
                      <input value={(props.value || '#000000').replace('#', '').toUpperCase()} onInput={(e) => setCustomHex(e.currentTarget.value)}
                        class="rounded-l-[4px] min-w-0 flex-1 bg-transparent font-mono text-[12px] text-slate-600 outline-none" />
                      <input value={alpha()} onInput={(e) => { const a = Math.max(0, Math.min(100, Number(e.currentTarget.value) || 0)); setAlpha(a); props.onChange(hexWithAlpha(rgbToHex(rgb()), a)) }}
                        class="rounded-r-[4px] w-8 bg-transparent text-right text-[12px] text-slate-500 outline-none" />
                      <span class="text-[12px] text-slate-400">%</span>
                    </div>
                  </div>

                  <div class="mt-2">
                    <div class="flex rounded-[4px] bg-white focus-within:shadow-[0_0_0_1px_#336fff]">
                      <div class="grid flex-1 grid-cols-4 gap-0">
                        <For each={channelValues()}>
                          {(value, index) => (
                            <input value={value} onInput={(e) => setChannel(index(), Number(e.currentTarget.value))}
                              class={index() === 0 ? 'h-7 rounded-l-[4px] bg-[#F4F4F5] px-1 text-center text-[12px] text-slate-600 outline-none' : 'h-7 border-l border-[#ffffff] bg-[#F4F4F5] px-1 text-center text-[12px] text-slate-600 outline-none'} />
                          )}
                        </For>
                      </div>
                      <div class="relative">
                        <button type="button" onClick={(e) => { e.stopPropagation(); setModeOpen(!modeOpen()) }}
                          class="flex h-7 w-7 items-center justify-center rounded-r-[4px] border-l border-[#ffffff] bg-[#F4F4F5] text-slate-500 hover:bg-[#E4E4E7]">
                          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#747476" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-chevron-down-icon lucide-chevron-down">
                            <path d="m6 9 6 6 6-6" />
                          </svg>
                        </button>
                        <Show when={modeOpen()}>
                          <div class="absolute right-0 top-full z-[303] mt-1 w-[88px] rounded-[8px] border border-[#e5e7eb] bg-white p-0.5 text-left text-[12px] text-[#3f3f41] shadow-[0_8px_24px_rgba(0,0,0,0.14)]"
                            style={{ background: '#ffffff' }}
                            onMouseDown={(e) => e.stopPropagation()}>
                            <For each={['RGB', 'HSL', 'HSB'] as const}>
                              {(m) => (
                                <button type="button"
                                  onClick={(e) => { e.stopPropagation(); syncFromHex(); setMode(m); setModeOpen(false) }}
                                  class="flex h-7 w-full items-center rounded-[4px] px-2 text-[#19191a] hover:bg-[#f3f3f4]">
                                  <span class="w-4 shrink-0 text-[#3f3f41]">{mode() === m ? '✓' : ''}</span>
                                  <span>{m}</span>
                                </button>
                              )}
                            </For>
                          </div>
                        </Show>
                      </div>
                    </div>
                    <div class="mt-1 flex text-center text-[10px] text-slate-400">
                      <div class="grid flex-1 grid-cols-4">
                        <For each={channelLabels()}>
                          {(label) => <span>{label}</span>}
                        </For>
                      </div>
                      <span class="w-7 text-transparent">-</span>
                    </div>
                  </div>
                </div>
              }
            >
              <div class="max-h-[367.5px] overflow-y-auto">
              <For each={props.tokens}>
                {(token) => (
                  <Show when={token.isGroupTitle} fallback={
                    <button
                      type="button"
                      onClick={() => { const tokenAlpha = parseFloat(token.opacity) || 100; const hex = hexWithAlpha(token.color, tokenAlpha); props.onChange(hex); syncFromHex(hex); setLastTokenName(token.name); props.onTokenChange?.(token.name); setOpen(false) }}
                      onMouseEnter={(e) => showTooltip(token, e)}
                      onMouseLeave={() => setTooltipData(null)}
                      class="flex w-full items-center gap-2 px-2 py-1.5 text-left text-[11px] text-slate-600 hover:bg-[#F4F4F5]"
                    >
                      <span class="h-3.5 w-3.5 shrink-0 rounded-full border border-[#12112a12]" style={{ background: token.color, opacity: token.opacity }} />
                      <span class="truncate">{token.displayName || token.name}</span>
                    </button>
                  }>
                    <div class="px-2 py-1 text-[10px] font-medium text-slate-400">{token.name}</div>
                  </Show>
                )}
              </For>
              </div>
            </Show>
            <Show when={tooltipData()}>
              <Portal>
                <div
                  class="fixed z-[303] pointer-events-none whitespace-nowrap rounded-sm bg-[#1a1b1e] px-3 py-1 text-[12px] shadow-[0_4px_12px_rgba(0,0,0,0.24)]"
                  style={{
                    left: (tooltipData()!.x) + 'px',
                    top: (tooltipData()!.y) + 'px',
                    transform: 'translate(-100%, -50%)',
                  }}
                >
                  <span class="block text-[#fbfbfc]">{tooltipData()!.name}</span>
                  <span class="block text-[#797a7b]">{tooltipData()!.color} {tooltipData()!.opacity}</span>
                  <span class="absolute right-[-6px] top-1/2 h-0 w-0 -translate-y-1/2 border-y-[6px] border-l-[6px] border-y-transparent border-l-[#1a1b1e]" />
                </div>
              </Portal>
            </Show>
          </div>
        </Portal>
      </Show>
    </div>
  )
}

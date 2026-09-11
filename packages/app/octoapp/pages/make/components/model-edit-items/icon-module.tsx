import { For, Show, createSignal, createEffect, onCleanup, onMount, type JSX } from 'solid-js'
import { Portal } from 'solid-js/web'
import { createStore } from 'solid-js/store'
import type { IconConfig, IconState, IconConfig as IC } from './types'
import type { ModelEditElement } from './types'
import { LUCIDE_ICONS } from './icon-data/lucide-icons'
import { createIconPlusStore } from './icon-data/icon-plus-fetch'
import { iconColors, iconCssColor } from './icon-data/icon-colors'
import { IconCategorySelect } from './icon-data/icon-category-select'
import { CustomSelect } from './icon-data/custom-select'
import { getDesktopApi } from '../../lib/electron-api'
import { useSDK } from '@/context/sdk'
import { useParams } from '@solidjs/router'
import { sendTextToAgent } from '../../utils/agent-events'

const PANEL_W = 380
const PANEL_H = 634
const ACCENT = '#3D99FF'

const FALLBACK_TABS = [
  { label: '基础图标', value: '基础图标' },
  { label: '质感图标', value: '质感图标' },
  { label: '2.5D图标', value: '2.5D图标' },
  { label: '天气', value: '天气' },
  { label: '拓扑图标', value: '拓扑图标' },
  { label: '智慧图标', value: '智慧图标' },
  { label: '自定义', value: '自定义' },
] as const

const CATEGORY_MATCHERS: Record<string, RegExp> = {
  direction: /^(arrow|chevron|trending|move|maximize|minimize|expand|compass)/,
  action: /^(plus|minus|check|x$|x-|pencil|trash|copy|download|upload|search|settings|funnel|refresh|rotate|wrench|hammer|share|printer|send|sliders|toggle|pointer|mouse|hand|focus|scan|power|plug|loader)/,
  media: /^(image|video|music|play|pause|camera|film|mic|file|folder|archive|inbox|paperclip|aperture|qr|barcode)/,
  comm: /^(mail|phone|message|bell|megaphone|at-sign|rss|wifi|bluetooth|shield|lock|key|bug|terminal|code|braces|git|globe|map-pin)/,
}

const DEFAULT_SHAPE_OPTIONS = [
  { key: '线性', label: '线性', value: 'outline' },
  { key: '线性双色', label: '线性双色', value: 'two-tone' },
  { key: '方底托', label: '方底托', value: 'square' },
  { key: '圆底托', label: '圆底托', value: 'circle' },
]

const DEFAULT_SIZES = ['12', '14', '16', '20', '24', '32', '36', '40']

const shapeKeyToStyle = (value: string) => DEFAULT_SHAPE_OPTIONS.find(o => o.value === value)?.key ?? value

const normalizeInitialColor = (v: string | undefined, colors: Record<string, any>) => {
  if (!v) return iconCssColor('default')
  if (colors[v]) return colors[v].color.split(',')[0].trim()
  const lower = v.toLowerCase()
  if (colors[lower]) return colors[lower].color.split(',')[0].trim()
  if (/^#[0-9a-f]{3,8}$/i.test(v)) return v
  return iconCssColor('default')
}

const iconClassName = (name: string) =>
  name.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('')

const blobToDataURL = (b: Blob | File) => new Promise<string>(resolve => {
  const reader = new FileReader()
  reader.onload = () => resolve(reader.result as string)
  reader.readAsDataURL(b)
})

type CustomIcon = { src: string; path?: string }
const ICON_FILE_RE = /^icon_.+\.(svg|png|jpe?g)$/i

const mimeFromName = (name: string) => {
  const ext = name.split('.').pop()?.toLowerCase()
  if (ext === 'svg') return 'image/svg+xml'
  if (ext === 'png') return 'image/png'
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg'
  return 'application/octet-stream'
}

function customIconsDir(root: string | undefined, sessionId: string | undefined, htmlFilePath: string | undefined): string | null {
  if (htmlFilePath) return `${htmlFilePath.replace(/[\\/][^\\/]+$/, '')}/uploads`
  if (root && sessionId) return `${root}/.octo/${sessionId}/assets`
  return null
}

async function saveSessionIconFile(root: string | undefined, sessionId: string | undefined, htmlFilePath: string | undefined, name: string, buf: ArrayBuffer): Promise<CustomIcon | null> {
  const api = getDesktopApi()
  const dir = customIconsDir(root, sessionId, htmlFilePath)
  if (!dir || !api?.writeFileBuffer) return null
  const safe = name.replace(/[\\/:*?"<>|]/g, '_').replace(/^\.+/, '')
  const filename = `icon_${safe}`
  const path = `${dir}/${filename}`
  try {
    await api.writeFileBuffer(path, buf)
  } catch (e) {
    console.log('[icon-module] write failed', path, e)
    return null
  }
  return { src: await blobToDataURL(new Blob([buf], { type: mimeFromName(name) })), path }
}

async function listSessionIconFiles(root: string | undefined, sessionId: string | undefined, htmlFilePath: string | undefined): Promise<CustomIcon[]> {
  const api = getDesktopApi()
  const dir = customIconsDir(root, sessionId, htmlFilePath)
  if (!dir || !api?.listDirectory || !api.readFileBuffer) return []
  const out: CustomIcon[] = []
  for (const e of await api.listDirectory(dir)) {
    const filename = e.path.split(/[\\/]/).pop() ?? ''
    if (e.type !== 'file' || !ICON_FILE_RE.test(filename)) continue
    const buf = await api.readFileBuffer(`${dir}/${filename}`)
    if (!buf) continue
    out.push({ src: await blobToDataURL(new Blob([buf], { type: mimeFromName(filename) })), path: `${dir}/${filename}` })
  }
  return out
}

const customIconName = (srcOrPath: string) =>
  decodeURIComponent(srcOrPath.split(/[\\/]/).pop() ?? '').replace(/^icon_/, '').replace(/\.[^.]*$/, '')

async function deleteSessionIconFile(icon: CustomIcon): Promise<void> {
  if (icon.path) await getDesktopApi()?.deleteFile?.(icon.path)
}

function buildStandaloneSvg(svgInner: string, shape: string, color: string, size: number): string {
  const sz = Number(size)
  if (shape === 'two-tone') {
    const m = Math.round(sz * 0.72)
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${sz}" height="${sz}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${svgInner}<g fill="${ACCENT}" fill-opacity="0.85" stroke="none" transform="scale(${m / sz})" style="transform-origin:center">${svgInner}</g></svg>`
  }
  if (shape === 'circle' || shape === 'square') {
    const m = Math.round(sz * 0.72)
    const r = shape === 'circle' ? '50%' : `${Math.round(sz / 6)}px`
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${sz}" height="${sz}" viewBox="0 0 24 24"><rect width="24" height="24" rx="${shape === 'circle' ? '12' : '4'}" fill="${color}" fill-opacity="0.12"/><g fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" transform="scale(${m / sz})" style="transform-origin:center">${svgInner}</g></svg>`
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${sz}" height="${sz}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${svgInner}</svg>`
}

function GridIcon(svg: string, s: string = 'outline', c: string = '#191919', size: number = 24) {
  const m = Math.round(size * 0.72)
  const strokeEl = (w: number, style?: string) => (
    <svg width={w} height={w} viewBox="0 0 24 24" fill="none" stroke={c} stroke-width="2"
      stroke-linecap="round" stroke-linejoin="round" innerHTML={svg} style={style} />
  )
  const fillEl = (w: number, fill: string, fillOpacity: number | undefined, style?: string) => (
    <svg width={w} height={w} viewBox="0 0 24 24" fill={fill} fill-opacity={fillOpacity} stroke="none" innerHTML={svg} style={style} />
  )
  if (s === 'two-tone') {
    return (
      <span class="relative inline-flex" style={{ width: `${size}px`, height: `${size}px` }}>
        {strokeEl(size, 'position:absolute;inset:0;margin:auto')}
        {fillEl(m, ACCENT, 0.85, 'position:absolute;inset:0;margin:auto')}
      </span>
    )
  }
  if (s === 'circle' || s === 'square') {
    return (
      <span class="inline-flex items-center justify-center"
        style={{
          width: `${size}px`, height: `${size}px`,
          'border-radius': s === 'circle' ? '50%' : `${Math.round(size / 6)}px`,
          background: `color-mix(in srgb, ${c} 12%, transparent)`,
        }}>
        {strokeEl(m)}
      </span>
    )
  }
  return strokeEl(size)
}

function IconFieldPreview(props: { name?: string; src?: string; url?: string; color?: string }) {
  const [failed, setFailed] = createSignal(false)
  createEffect(() => { props.url; props.src; setFailed(false) })
  const imgSrc = props.src ?? props.url
  return (
    <Show when={imgSrc && !failed()} fallback={
      (() => {
        const d = LUCIDE_ICONS.find(i => i.name === props.name)
        return d
          ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" innerHTML={d.svg} class="shrink-0" style={{ stroke: props.color ?? '#191919' }} />
          : <span class="text-[10px] text-slate-400">无</span>
      })()
    }>
      <img src={imgSrc} alt="" loading="lazy" decoding="async" class="h-4 w-4 shrink-0 object-contain" onError={() => setFailed(true)} />
    </Show>
  )
}

function EmptyState(props: { text: string }) {
  return <div class="flex h-full items-center justify-center py-8 text-[12px] text-slate-400">{props.text}</div>
}

function IconPickerPopup(props: {
  anchor: HTMLElement | undefined
  iconConfig: IconConfig
  current: string
  currentId?: string
  currentCustom?: boolean
  initialSize?: string
  initialStyle?: string
  initialColor?: string
  htmlFilePath?: string
  onConfirm: (current: IconState) => void
  onClose: () => void
}): JSX.Element {
  const sdk = useSDK()
  const routeParams = useParams<{ id?: string }>()
  const sessionId = () => routeParams.id
  const colors = props.iconConfig.data?.colors ?? iconColors
  const shapeOptions = props.iconConfig.data?.styles ?? DEFAULT_SHAPE_OPTIONS
  const sizeOptions = (props.iconConfig.data?.sizes ?? DEFAULT_SIZES).map(s => ({ label: `${s}px`, value: s }))

  const [state, setState] = createStore({
    source: props.currentCustom ? 'custom' as const : 'official' as const,
    tabsCan: { left: false, right: false },
    category: 'all' as number | 'all',
    categoryName: '全部分类',
    shapeKey: props.initialStyle ?? 'outline',
    iconColorKey: Object.keys(colors).find(k => colors[k].color.split(',')[0].trim() === normalizeInitialColor(props.initialColor, colors)) ?? 'default',
    customIcons: [] as CustomIcon[],
    selected: props.current,
    selectedId: props.currentId ?? '',
    tip: null as { name: string; x: number; y: number } | null,
    uploadTip: null as { x: number; y: number; cx: number } | null,
    pos: { x: 0, y: 0 },
  })

  const onlineUrl = props.iconConfig.onlineServiceUrl
  const iconStore = createIconPlusStore(props.current ?? '')
  onMount(() => {
    if (props.initialSize && /^\d+$/.test(props.initialSize)) iconStore.setSize(props.initialSize)
    iconStore.setShape(shapeKeyToStyle(state.shapeKey))
    iconStore.setColor(normalizeInitialColor(props.initialColor, colors))
    if (state.source === 'custom') iconStore.setKeyword('')
    void iconStore.init()
  })
  onCleanup(() => iconStore.dispose())

  const tabs = () => iconStore.state.tabs.length ? iconStore.state.tabs : FALLBACK_TABS
  let popupRef: HTMLDivElement | undefined
  let fileRef: HTMLInputElement | undefined
  let tabsRef: HTMLDivElement | undefined

  const updateTabsScroll = () => {
    if (!tabsRef) return
    setState('tabsCan', { left: tabsRef.scrollLeft > 1, right: tabsRef.scrollLeft + tabsRef.clientWidth < tabsRef.scrollWidth - 1 })
  }
  const scrollTabs = (dir: 1 | -1) => tabsRef?.scrollBy({ left: dir * 160, behavior: 'smooth' })
  createEffect(() => { tabs(); requestAnimationFrame(updateTabsScroll) })

  function updatePos() {
    if (!props.anchor) return
    const rect = props.anchor.getBoundingClientRect()
    setState('pos', { x: Math.max(4, rect.left - PANEL_W - 20), y: Math.max(4, Math.min(rect.top - 8, window.innerHeight - PANEL_H - 4)) })
  }
  updatePos()

  const onOutside = (e: MouseEvent) => {
    const t = e.target as Node
    if (popupRef?.contains(t)) return
    if (props.anchor?.contains(t)) return
    if ((t as HTMLElement).closest?.('[data-custom-select-list]')) return
    props.onClose()
  }
  window.addEventListener('mousedown', onOutside)
  onCleanup(() => window.removeEventListener('mousedown', onOutside))

  const filtered = () => {
    const kw = iconStore.state.keyword.trim().toLowerCase()
    const matcher = state.category === 'all' ? null : CATEGORY_MATCHERS[String(state.category)]
    return LUCIDE_ICONS.filter(i => { if (matcher && !matcher.test(i.name)) return false; if (kw && !i.name.includes(kw)) return false; return true })
  }

  const ApiIcon = (props: { url: string }) => {
    const svg = () => iconStore.state.svgCache[props.url] ?? ''
    const px = () => `${iconStore.state.iconSize}px`
    return (
      <Show when={svg()} fallback={<span class="text-[10px] text-slate-400">…</span>}>
        <div class="api-icon flex items-center justify-center" style={{ width: px(), height: px() }} innerHTML={svg()} />
      </Show>
    )
  }

  const showTip = (el: HTMLElement, name: string) => {
    if (!popupRef) return
    const r = el.getBoundingClientRect()
    const pr = popupRef.getBoundingClientRect()
    setState('tip', { name, x: r.left - pr.left + r.width / 2, y: r.top - pr.top + r.height })
  }

  const onFiles = async (e: Event) => {
    const input = e.currentTarget as HTMLInputElement
    const files = Array.from(input.files ?? []).filter(f => /\.(svg|png|jpe?g)$/i.test(f.name))
    input.value = ''
    if (!files.length) return
    const added: CustomIcon[] = []
    for (const f of files) {
      const buf = await f.arrayBuffer()
      added.push(await saveSessionIconFile(sdk.directory, sessionId(), props.htmlFilePath, f.name, buf) ?? { src: await blobToDataURL(f) })
    }
    const newNames = new Set(added.flatMap(a => { const fn = a.path?.split(/[\\/]/).pop(); return fn ? [fn] : [] }))
    setState('customIcons', prev => { const kept = newNames.size ? prev.filter(p => { const fn = p.path?.split(/[\\/]/).pop(); return !fn || !newNames.has(fn) }) : prev; return [...kept, ...added] })
  }

  onMount(() => {
    void listSessionIconFiles(sdk.directory, sessionId(), props.htmlFilePath).then(icons => {
      if (!icons.length) return
      const diskNames = new Set(icons.flatMap(i => { const fn = i.path?.split(/[\\/]/).pop(); return fn ? [fn] : [] }))
      setState('customIcons', prev => [...prev.filter(p => { const fn = p.path?.split(/[\\/]/).pop(); return !fn || !diskNames.has(fn) }), ...icons])
    })
  })

  createEffect(() => {
    if (state.source !== 'custom' || !props.current || !state.customIcons.length) return
    if (state.selectedId.startsWith('custom:')) return
    const currentStem = props.current.replace(/\.[^.]*$/, '')
    const hit = state.customIcons.find(ic => { const display = customIconName(ic.path ?? ic.src); return display === props.current || display === currentStem })
    if (!hit) return
    setState('selectedId', `custom:${hit.src}`)
    setState('selected', props.current)
  })

  const deleteCustomIcon = (i: number) => {
    const icon = state.customIcons[i]
    if (icon.path) void deleteSessionIconFile(icon)
    setState('customIcons', prev => prev.filter((_, idx) => idx !== i))
    setState('tip', null)
  }

  const handleConfirm = () => {
    if (state.selected) {
      const custom = state.selectedId.startsWith('custom:') ? state.customIcons.find(c => `custom:${c.src}` === state.selectedId) : undefined
      const apiUrl = custom ? undefined : iconStore.state.icons.find(i => String(i.icon_id) === state.selectedId)?.url
      const lucideIcon = custom ? undefined : LUCIDE_ICONS.find(i => i.name === state.selected)
      const result: IconState = {
        name: custom ? customIconName(custom.path ?? custom.src) : state.selected,
        id: custom ? undefined : state.selectedId || undefined,
        url: apiUrl,
        src: custom?.path ? `uploads/${custom.path.split(/[\\/]/).pop()}` : undefined,
        isCustom: !!custom,
        size: iconStore.state.iconSize,
        style: state.shapeKey,
        color: iconStore.state.iconColor,
        svgContent: apiUrl ? (iconStore.state.svgCache[apiUrl] ?? undefined) : (lucideIcon ? buildStandaloneSvg(lucideIcon.svg, state.shapeKey, iconStore.state.iconColor, Number(iconStore.state.iconSize)) : undefined),
      }
      props.onConfirm(result)
    }
    props.onClose()
  }

  return (
    <Portal>
      <style>{`
        .icon-picker-scroll::-webkit-scrollbar { width: 6px }
        .icon-picker-scroll::-webkit-scrollbar-track { background: transparent }
        .icon-picker-scroll::-webkit-scrollbar-thumb { background: #D9DDE2; border-radius: 3px }
        .icon-picker-scroll::-webkit-scrollbar-thumb:hover { background: #C4C9CF }
        .icon-picker-scroll { scrollbar-width: thin; scrollbar-color: #D9DDE2 transparent }
        .icon-tabs::-webkit-scrollbar { display: none }
        .icon-tabs { scrollbar-width: none; -ms-overflow-style: none }
        .icon-tabs :focus, .icon-tabs :focus-visible { outline: none }
        .api-icon > svg { width: 100%; height: 100% }
      `}</style>
      <div ref={popupRef} class="fixed z-[302] flex flex-col rounded-md py-4"
        style={{ left: state.pos.x + 'px', top: state.pos.y + 'px', width: `${PANEL_W}px`, "height": `${PANEL_H}px`, background: "#fff", border: "1px solid #e2e8f0", "box-shadow": "0 8px 24px rgba(0,0,0,0.18)" }}>
        <div class="flex shrink-0 items-center justify-between">
          <span class="ml-4 text-[13px] font-semibold text-slate-700">图标</span>
          <button type="button" onClick={() => props.onClose()} class="text-slate-400 hover:text-slate-600 flex items-center justify-center w-5 h-5 mr-4">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><line x1="2" y1="2" x2="10" y2="10" /><line x1="10" y1="2" x2="2" y2="10" /></svg>
          </button>
        </div>

        <div class="mt-4 flex shrink-0 items-center gap-2 px-4">
          <div class="w-[109px] shrink-0">
            <IconCategorySelect value={state.category} label={state.categoryName} tree={iconStore.state.groups}
              onChange={(id, name) => { setState('category', id); setState('categoryName', name); iconStore.setGroupId(id === 'all' ? null : id) }} />
          </div>
          <input value={iconStore.state.keyword} onInput={(e) => iconStore.setKeyword(e.currentTarget.value)}
            type="search" placeholder="请搜索..."
            class="h-9 w-[231px] shrink-0 rounded-[36px] bg-[#F2F3F5] pl-[38px] pr-3 text-[12px] text-[#333333] outline-none placeholder:text-[#777777]"
            style={{ "background-image": `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%23555555' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><circle cx='11' cy='11' r='8'/><path d='m21 21-4.3-4.3'/></svg>")`, "background-repeat": "no-repeat", "background-position": "12px center" }} />
        </div>

        <div class="mt-4 flex shrink-0 items-center gap-8 px-4">
          <button type="button" onClick={() => setState('source', 'official')} class="relative pb-[4px] text-[12px] leading-5" style={{ color: state.source === 'official' ? '#0A59F7' : '#777777' }}>官方<Show when={state.source === 'official'}><span class="absolute bottom-0 left-0 right-0 h-[2px] rounded-full" style={{ background: '#0A59F7' }} /></Show></button>
          <button type="button" onClick={() => { setState('source', 'custom'); iconStore.setKeyword('') }} class="relative pb-[4px] text-[12px] leading-5" style={{ color: state.source === 'custom' ? '#0A59F7' : '#777777' }}>自定义<Show when={state.source === 'custom'}><span class="absolute bottom-0 left-0 right-0 h-[2px] rounded-full" style={{ background: '#0A59F7' }} /></Show></button>
        </div>

        <Show when={state.source === 'official'}>
          <div class="relative mt-4 shrink-0 px-4">
            <Show when={state.tabsCan.left}>
              <div class="pointer-events-none absolute left-0 top-1/2 z-10 flex h-[28px] w-[90px] -translate-y-1/2 items-center justify-start pl-[18px]" style={{ background: 'linear-gradient(to right, #FFFFFF 18px, rgba(255,255,255,0))' }}>
                <button type="button" onClick={() => scrollTabs(-1)} class="pointer-events-auto flex cursor-pointer items-center justify-center outline-none"><svg class="h-3 w-3" viewBox="0 0 8 8" fill="none"><path d="M5.5 1L2.5 4L5.5 7" stroke="#777777" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" /></svg></button>
              </div>
            </Show>
            <div ref={tabsRef} class="icon-tabs flex items-center gap-0 overflow-x-auto" onScroll={updateTabsScroll}>
              <For each={tabs().filter(t => t.value !== '自定义')}>
                {(t) => (<button type="button" onClick={() => iconStore.setTab(t.value)} class="shrink-0 px-3 py-1 text-center text-[12px] leading-5 rounded-[28px] whitespace-nowrap" classList={{ 'bg-[#0A59F7]/10 text-[#0A59F7]': iconStore.state.activeTab === t.value, 'text-[#777777]': iconStore.state.activeTab !== t.value }}>{t.label}</button>)}
              </For>
            </div>
            <Show when={state.tabsCan.right}>
              <div class="pointer-events-none absolute right-0 top-1/2 z-10 flex h-[28px] w-[90px] -translate-y-1/2 items-center justify-end pr-[18px]" style={{ background: 'linear-gradient(to left, #FFFFFF 18px, rgba(255,255,255,0))' }}>
                <button type="button" onClick={() => scrollTabs(1)} class="pointer-events-auto flex cursor-pointer items-center justify-center outline-none"><svg class="h-3 w-3" viewBox="0 0 8 8" fill="none"><path d="M2.5 1L5.5 4L2.5 7" stroke="#777777" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" /></svg></button>
              </div>
            </Show>
          </div>
        </Show>

        <div class="icon-picker-scroll mt-4 min-h-0 flex-1 overflow-y-auto px-4" onScroll={() => setState('tip', null)}>
          <Show when={state.source === 'custom'} fallback={
            <Show when={iconStore.state.online} fallback={
              <Show when={iconStore.state.activeTab === '基础图标'} fallback={<EmptyState text="暂无内容" />}>
                <div class="grid grid-cols-5 gap-2">
                  <For each={filtered()}>
                    {(icon) => (
                      <button type="button" onMouseEnter={(e) => showTip(e.currentTarget, icon.name)} onMouseLeave={() => setState('tip', null)}
                        onClick={() => { setState('selectedId', icon.name); setState('selected', icon.name) }}
                        class="flex h-[60px] w-full items-center justify-center rounded-xl bg-[#F2F3F5]" classList={{ 'ring-1 ring-inset ring-[#0A59F7]': (state.selectedId || state.selected) === icon.name }}>
                        {(state.selectedId || state.selected) === icon.name ? GridIcon(icon.svg, state.shapeKey, iconStore.state.iconColor, Number(iconStore.state.iconSize)) : GridIcon(icon.svg, 'outline', '#191919', Number(iconStore.state.iconSize))}
                      </button>
                    )}
                  </For>
                </div>
                <Show when={filtered().length === 0}><div class="py-8 text-center text-[12px] text-slate-400">未找到匹配的图标</div></Show>
              </Show>
            }>
              <Show when={iconStore.state.icons.length > 0} fallback={<EmptyState text={iconStore.state.searching ? '搜索中…' : '未找到匹配的图标'} />}>
                <div class="grid grid-cols-5 gap-2">
                  <For each={iconStore.state.icons}>
                    {(icon) => (
                      <button type="button" onMouseEnter={(e) => showTip(e.currentTarget, icon.name)} onMouseLeave={() => setState('tip', null)}
                        onClick={() => { setState('selectedId', String(icon.icon_id)); setState('selected', icon.name) }}
                        class="flex h-[60px] w-full items-center justify-center rounded-xl bg-[#F2F3F5]" classList={{ 'ring-1 ring-inset ring-[#0A59F7]': !!state.selectedId && String(icon.icon_id) === state.selectedId }}>
                        <ApiIcon url={icon.url} />
                      </button>
                    )}
                  </For>
                </div>
              </Show>
            </Show>
          }>
            <div class="flex h-full min-h-[240px] flex-col">
              <div class="flex shrink-0 items-center justify-between">
                <span class="text-[13px] font-semibold text-slate-700">自定义图标</span>
                <button type="button" onClick={() => fileRef?.click()} class="flex cursor-pointer items-center gap-1 text-[12px] text-[#0A59F7]">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>上传图标
                </button>
              </div>
              <div class="mt-4 min-h-0 flex-1">
                <Show when={state.customIcons.length > 0} fallback={<EmptyState text="暂无内容，点击上传图标吧～" />}>
                  <div class="grid grid-cols-5 gap-2">
                    <For each={state.customIcons}>
                      {(icon, i) => (
                        <div class="group relative flex h-[60px] w-full cursor-pointer items-center justify-center rounded-xl bg-[#F2F3F5]" classList={{ 'ring-1 ring-inset ring-[#0A59F7]': `custom:${icon.src}` === state.selectedId }}
                          onMouseEnter={(e) => showTip(e.currentTarget, customIconName(icon.path ?? icon.src))} onMouseLeave={() => setState('tip', null)}
                          onClick={() => { setState('selectedId', `custom:${icon.src}`); setState('selected', customIconName(icon.path ?? icon.src)) }}>
                          <img src={icon.src} class="max-h-full max-w-full object-contain" />
                          <button type="button" title="删除" onClick={(e) => { e.stopPropagation(); deleteCustomIcon(i()) }} class="absolute right-[6px] top-[6px] z-10 hidden cursor-pointer group-hover:block"><span class="text-slate-400 hover:text-red-500 text-[14px]">✕</span></button>
                        </div>
                      )}
                    </For>
                  </div>
                </Show>
              </div>
              <input ref={fileRef} type="file" accept={props.iconConfig.data?.acceptedFileTypes ?? ".svg,.png,.jpg,.jpeg"} multiple class="hidden" onChange={onFiles} />
            </div>
          </Show>
        </div>

        <div class="mt-4 shrink-0 px-4">
          <div class="flex items-center gap-2">
            <div class="w-[110px] shrink-0"><CustomSelect value={state.shapeKey} options={shapeOptions} onChange={v => { setState('shapeKey', v); iconStore.setShape(shapeKeyToStyle(v)) }} class="[&>button]:h-9 [&>button]:rounded-[36px] [&>button]:text-[12px]" /></div>
            <div class="w-[110px] shrink-0"><CustomSelect value={iconStore.state.iconSize} options={sizeOptions} onChange={v => iconStore.setSize(v)} class="[&>button]:h-9 [&>button]:rounded-[36px] [&>button]:text-[12px]" /></div>
            <div class="w-[110px] shrink-0">
              <button type="button" class="flex h-9 w-full items-center gap-1 rounded-[36px] border border-transparent bg-[#F2F3F5] px-2 text-left text-[12px] text-[#333333] outline-none">
                <span class="h-[18px] w-[18px] shrink-0 rounded-full" style={{ background: iconCssColor(state.iconColorKey) }} />
                <span class="flex-1 truncate" style={{ color: '#191919' }}>{colors[state.iconColorKey]?.label ?? state.iconColorKey}</span>
                <svg class="ml-1 h-3 w-3 shrink-0 text-slate-400" viewBox="0 0 8 5" fill="none"><path d="M1 1L4 4L7 1" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" /></svg>
              </button>
            </div>
          </div>
          <div class="mt-4 flex items-center justify-end gap-2">
            <button type="button" onClick={() => props.onClose()} class="h-7 shrink-0 rounded-[28px] bg-[#F2F3F5] px-[22px] text-[12px] hover:bg-[#E8E9EC]" style={{ color: '#191919' }}>取消</button>
            <button type="button" onClick={handleConfirm} class="h-7 shrink-0 rounded-[28px] bg-[#0A59F7] px-[22px] text-[12px] hover:bg-[#3B76F9]" style={{ color: '#fff' }}>确认</button>
          </div>
        </div>

        <Show when={state.tip}>
          <span class="pointer-events-none absolute z-20 h-[8px] w-[8px] -translate-x-1/2 rotate-45" style={{ left: state.tip!.x + 'px', top: state.tip!.y + 'px', background: '#595959' }} />
          <div class="pointer-events-none absolute z-20 -translate-x-1/2 rounded-md px-2 py-1.5 shadow-lg" style={{ left: state.tip!.x + 'px', top: state.tip!.y + 4 + 'px', background: '#595959', color: '#fff' }}>
            <div class="whitespace-nowrap text-[11px]" style={{ color: '#fff', "text-align": 'center' }}>{state.tip!.name}</div>
            <div class="whitespace-nowrap text-[10px]" style={{ color: '#fff', opacity: 0.9, "text-align": 'center' }}>{iconClassName(state.tip!.name)}</div>
          </div>
        </Show>
      </div>
    </Portal>
  )
}

export function IconModule(props: {
  iconConfig: IconConfig
  dom: ModelEditElement | null
  filePath: string
  disabled: boolean
  onSubmitStart: () => void
  postMessageToIframe?: (data: unknown) => void
  writeFileBuffer?: (path: string, buffer: ArrayBuffer) => Promise<void>
  sessionDir?: string
  getIframeSnapshot?: () => Promise<string>
  cleanBridgeContent?: (html: string) => string
  wrapHtmlContent?: (html: string) => string
  onContentChange?: (content: string) => Promise<void>
  onRefreshNeeded?: () => void
}): JSX.Element {
  const [popupOpen, setPopupOpen] = createSignal(false)
  const [iconValue, setIconValue] = createSignal<IconState>({})
  let anchorRef: HTMLButtonElement | undefined

  createEffect(() => {
    if (props.dom && props.iconConfig.getInitialState) {
      setIconValue(props.iconConfig.getInitialState(props.dom))
    }
  })

  const handleConfirm = async (current: IconState) => {
    const prev = iconValue()
    setIconValue(current)
    const prompt = await props.iconConfig.onConfirm({
      prev, current,
      dom: props.dom!,
      filePath: props.filePath,
      postMessageToIframe: props.postMessageToIframe ?? (() => {}),
      writeFileBuffer: props.writeFileBuffer,
      sessionDir: props.sessionDir,
      getIframeSnapshot: props.getIframeSnapshot,
      cleanBridgeContent: props.cleanBridgeContent,
      wrapHtmlContent: props.wrapHtmlContent,
      onContentChange: props.onContentChange,
      onRefreshNeeded: props.onRefreshNeeded,
    })
    if (prompt) {
      props.onSubmitStart()
      await sendTextToAgent(prompt, { source: 'icon-confirm' })
    }
    setPopupOpen(false)
  }

  return (
    <>
      <div class="model-edit-group-title">图标</div>
      <button ref={anchorRef} type="button" disabled={props.disabled}
        onClick={() => setPopupOpen(true)}
        class="cc-row" style={{ width: '100%', height: '36px', border: '1px solid rgba(0,0,0,0.1)', 'border-radius': '8px', background: '#FFF', padding: '8px 12px', 'box-sizing': 'border-box', cursor: props.disabled ? 'wait' : 'pointer' }}>
        <IconFieldPreview name={iconValue().name} src={iconValue().src} url={iconValue().url} color={iconValue().color} />
        <span class="flex-1 truncate text-[12px] text-slate-600">{iconValue().name || '选择图标'}</span>
        <svg class="h-3 w-3 shrink-0 text-slate-400" viewBox="0 0 8 5" fill="none"><path d="M1 1L4 4L7 1" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" /></svg>
      </button>
      <Show when={popupOpen()}>
        <IconPickerPopup
          anchor={anchorRef}
          iconConfig={props.iconConfig}
          current={iconValue().name ?? ''}
          currentId={iconValue().id}
          currentCustom={iconValue().isCustom}
          initialSize={iconValue().size}
          initialStyle={iconValue().style}
          initialColor={iconValue().color}
          htmlFilePath={props.filePath}
          onConfirm={handleConfirm}
          onClose={() => setPopupOpen(false)}
        />
      </Show>
    </>
  )
}

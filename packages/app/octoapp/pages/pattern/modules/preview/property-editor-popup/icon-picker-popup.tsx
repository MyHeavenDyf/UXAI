import { For, Show, createSignal, createEffect, onCleanup, onMount, type JSX } from "solid-js"
import { Portal } from "solid-js/web"
import { createStore } from "solid-js/store"
import { LUCIDE_ICONS } from "./lucide-icons"
import { CustomSelect } from "./custom-select"
import { createIconPlusStore } from "./icon-plus-fetch"
import { iconColors, iconCssColor } from "./icon-colors"
import { IconCategorySelect } from "./icon-category-select"
import noDataEmptySvg from "../../../assets/images/noDataEmpty.svg?url"
import deleteSvg from "../../../assets/images/delete.svg?url"
import { getDesktopApi } from "../../../utils/desktop-api"
import { useSDK } from "@/context/sdk"
import { useParams } from "@solidjs/router"

const blobToDataURL = (b: Blob | File) => new Promise<string>(resolve => {
  const reader = new FileReader()
  reader.onload = () => resolve(reader.result as string)
  reader.readAsDataURL(b)
})

/** 会话自定义图标目录：优先预览产物同级的 uploads（<htmlFilePath 目录>/uploads，与 pickAndUploadImage 落盘规则一致），
 *  无 htmlFilePath 时回退 <工作区>/.octo/<sessionId>/assets/。文件名 icon_ 前缀与其它资源区分。 */
type CustomIcon = { src: string; path?: string }

const ICON_FILE_RE = /^icon_.+\.(svg|png|jpe?g)$/i

function customIconsDir(root: string | undefined, sessionId: string | undefined, htmlFilePath: string | undefined): string | null {
  if (htmlFilePath) return `${htmlFilePath.replace(/[\\/][^\\/]+$/, "")}/uploads`
  if (root && sessionId) return `${root}/.octo/${sessionId}/assets`
  return null
}

/** 上传单个图标：写入目标目录（icon_ 原文件名，同文件重传覆盖）；src 用 dataURL（不依赖服务目录，刷新仍有效）。失败返回 null（调用方回退 dataURL） */
async function saveSessionIconFile(root: string | undefined, sessionId: string | undefined, htmlFilePath: string | undefined, name: string, buf: ArrayBuffer): Promise<CustomIcon | null> {
  const api = getDesktopApi()
  const dir = customIconsDir(root, sessionId, htmlFilePath)
  if (!dir || !api?.writeFileBuffer) return null
  const safe = name.replace(/[\\/:*?"<>|]/g, "_").replace(/^\.+/, "")
  const filename = `icon_${safe}`
  const path = `${dir}/${filename}`
  try {
    await api.writeFileBuffer(path, buf)
  } catch (e) {
    console.log('[icon-picker] 写入失败', path, e)
    return null
  }
  return { src: await blobToDataURL(new Blob([buf])), path }
}

/** 读回目标目录中的自定义图标（仅 icon_ 前缀文件） */
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
    out.push({ src: await blobToDataURL(new Blob([buf])), path: `${dir}/${filename}` })
  }
  return out
}

/** 自定义图标展示名：用户原始文件名（去 icon_ 前缀与扩展名） */
const customIconName = (srcOrPath: string) =>
  decodeURIComponent(srcOrPath.split(/[\\/]/).pop() ?? '').replace(/^icon_/, '').replace(/\.[^.]*$/, '')

/** 删除会话 assets 目录中的图标文件 */
async function deleteSessionIconFile(icon: CustomIcon): Promise<void> {
  if (icon.path) await getDesktopApi()?.deleteFile?.(icon.path)
}

const PANEL_W = 380
const PANEL_H = 634
const ACCENT = "#3D99FF"

/** 图标来源 tab 兜底：offline 或 tags 未返回前用这份渲染，tags 返回后由 store.tabs 覆盖 */
const FALLBACK_TABS = [
  { label: '基础图标', value: '基础图标' },
  { label: '质感图标', value: '质感图标' },
  { label: '2.5D图标', value: '2.5D图标' },
  { label: '天气', value: '天气' },
  { label: '拓扑图标', value: '拓扑图标' },
  { label: '智慧图标', value: '智慧图标' },
  { label: '自定义', value: '自定义' },
] as const

/** 分类筛选（按图标名前缀归类） */
const CATEGORY_MATCHERS: Record<string, RegExp> = {
  direction: /^(arrow|chevron|trending|move|maximize|minimize|expand|compass)/,
  action: /^(plus|minus|check|x$|x-|pencil|trash|copy|download|upload|search|settings|funnel|refresh|rotate|wrench|hammer|share|printer|send|sliders|toggle|pointer|mouse|hand|focus|scan|power|plug|loader)/,
  media: /^(image|video|music|play|pause|camera|film|mic|file|folder|archive|inbox|paperclip|aperture|qr|barcode)/,
  comm: /^(mail|phone|message|bell|megaphone|at-sign|rss|wifi|bluetooth|shield|lock|key|bug|terminal|code|braces|git|globe|map-pin)/,
}

/** 底部形状筛选：value 与旧组件 Icon.shape 枚举一致（CustomSelect 选中/回传用）；
 *  key 为传给 store 的 style 入参（即后端 getIcon 所需的中文标签，与 label 一致） */
const SHAPE_OPTIONS = [
  { key: '线性', label: '线性', value: 'outline' },
  { key: '线性双色', label: '线性双色', value: 'two-tone' },
  { key: '方底托', label: '方底托', value: 'square' },
  { key: '圆底托', label: '圆底托', value: 'circle' },
]

/** 按枚举 value 反查 store 所需的 style 中文标签（key） */
const shapeKeyToStyle = (value: string) => SHAPE_OPTIONS.find(o => o.value === value)?.key ?? value

const SIZE_OPTIONS = ['12', '14', '16', '20', '24', '32', '36', '40'].map(s => ({ label: `${s}px`, value: s }))

/** 带入颜色归一化：兼容旧枚举 token（default/info/…）、大写形态、hex */
const normalizeInitialColor = (v?: string) => {
  if (!v) return iconCssColor('default')
  if (iconColors[v]) return iconCssColor(v)
  const lower = v.toLowerCase()
  if (iconColors[lower]) return iconCssColor(lower)
  if (/^#[0-9a-f]{3,8}$/i.test(v)) return v
  return iconCssColor('default')
}

const iconClassName = (name: string) =>
  'Icon' + name.split(/[-_]/).map(p => p.charAt(0).toUpperCase() + p.slice(1)).join('')

/** 空内容占位 */
function EmptyState(props: { text: string }) {
  return (
    <div class="flex h-full min-h-[240px] w-full flex-col items-center justify-center py-6">
      <img src={noDataEmptySvg} width="100" height="100" alt="" />
      <div class="mt-3 text-center text-[12px] text-[#777777]">{props.text}</div>
    </div>
  )
}

/** 图标颜色筛选：色板圆点(18px) + 名称，选项取自 icon-colors.ts 的 iconColors 语义色 */
function IconColorSelect(props: { value: string; onChange: (key: string) => void }) {
  const [open, setOpen] = createSignal(false)
  const [pos, setPos] = createSignal({ x: 0, y: 0, w: 0 })
  let btnRef!: HTMLButtonElement
  let listRef!: HTMLDivElement
  createEffect(() => {
    if (!open()) return
    const handler = (e: MouseEvent) => {
      if (listRef && !listRef.contains(e.target as Node) && !btnRef.contains(e.target as Node)) setOpen(false)
    }
    const onScroll = (e: Event) => {
      const t = e.target as Node
      if (listRef && (t === listRef || listRef.contains(t))) return
      setOpen(false)
    }
    if (btnRef) {
      const r = btnRef.getBoundingClientRect()
      setPos({ x: r.left, y: r.bottom + 4, w: r.width })
      requestAnimationFrame(() => {
        if (!listRef) return
        const lr = listRef.getBoundingClientRect()
        if (!lr.height) return
        const fitsDown = r.bottom + 4 + lr.height <= window.innerHeight
        const ay = fitsDown ? r.bottom + 4 : Math.max(4, r.top - 4 - lr.height)
        setPos({ x: r.left, y: ay, w: r.width })
      })
    }
    document.addEventListener('mousedown', handler)
    window.addEventListener('scroll', onScroll, true)
    onCleanup(() => {
      document.removeEventListener('mousedown', handler)
      window.removeEventListener('scroll', onScroll, true)
    })
  })
  const swatch = (k: string) => iconCssColor(k)
  return (
    <div class="relative flex-1">
      <button ref={btnRef} type="button" onClick={() => setOpen(!open())}
        class="flex h-9 w-full items-center gap-1 rounded-[36px] border border-transparent bg-[#F2F3F5] px-2 text-left text-[12px] text-[#333333] outline-none">
        <span class="h-[18px] w-[18px] shrink-0 rounded-full" style={{ background: swatch(props.value) }} />
        <span class="flex-1 truncate" style={{ color: '#191919' }}>{iconColors[props.value]?.label ?? props.value}</span>
        <svg class="ml-1 h-3 w-3 shrink-0 text-slate-400" viewBox="0 0 8 5" fill="none"><path d="M1 1L4 4L7 1" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" /></svg>
      </button>
      <Show when={open()}>
        <Portal mount={document.body}>
          <div ref={listRef} data-custom-select-list class="icon-picker-scroll fixed z-[2147483646] max-h-[260px] overflow-y-auto rounded-lg border border-[#e5e7eb] py-1"
            style={{ left: pos().x + 'px', top: pos().y + 'px', 'min-width': pos().w + 'px', background: '#fff', 'box-shadow': '0 10px 15px -3px rgba(0,0,0,0.08), 0 4px 6px -2px rgba(0,0,0,0.04)' }}
            onClick={() => setOpen(false)}>
            <For each={Object.keys(iconColors)}>
              {(k) => (
                <div onClick={() => props.onChange(k)}
                  class="flex cursor-pointer items-center gap-1 whitespace-nowrap bg-white px-[10px] py-[6px] text-[11px] text-slate-700 hover:bg-[#f3f4f6]"
                  classList={{ 'bg-[#E6F2FD] font-medium text-primary': k === props.value }}>
                  <span class="h-[18px] w-[18px] shrink-0 rounded-full" style={{ background: swatch(k) }} />
                  <span style={{ color: '#191919' }}>{iconColors[k].label}</span>
                </div>
              )}
            </For>
          </div>
        </Portal>
      </Show>
    </div>
  )
}

/** 图标选择弹窗：筛选/搜索 + 来源 tab + 图标网格（60px，一行五个）+ 底部线性/尺寸/颜色筛选与确认取消按钮 */
export function IconPickerPopup(props: {
  current: string
  /** 触发按钮元素：弹窗锚定在其左侧，点外部（含锚点）关闭 */
  anchor: HTMLElement | undefined
  onPick: (pick: { name: string; id?: string; url?: string; src?: string; isCustom?: boolean; size: string; style: string; color: string }) => void
  onClose: () => void
  /** 点击确认按钮（事件预留） */
  onConfirm?: () => void
  /** 打开弹窗时带入的上次选择：尺寸（如 "24"）、形状（旧枚举值如 outline）、颜色（hex 或语义 token） */
  initialSize?: string
  initialStyle?: string
  initialColor?: string
  /** 当前图标的唯一 id（icon-plus 的 icon_id；offline 无 id 时以 name 充当），回显按 id 匹配 */
  currentId?: string
  /** 会话 id：自定义图标持久化定位用 */
  sessionId?: string
  /** 预览产物 html 路径：自定义图标存到其同级 uploads 目录（与图片上传落盘规则一致） */
  htmlFilePath?: string
}): JSX.Element {
  const [state, setState] = createStore({
    /** 当前为自定义图标（currentId 带 custom: 前缀）时默认打开自定义 tab */
    source: props.currentId?.startsWith('custom:') ? 'custom' as const : 'official' as const,
    tabsCan: { left: false, right: false },
    category: 'all' as number | 'all',
    categoryName: '全部分类',
    shapeKey: props.initialStyle ?? 'outline',
    iconColorKey: Object.keys(iconColors).find(k => iconColors[k].color.split(',')[0].trim() === normalizeInitialColor(props.initialColor)) ?? 'default',
    customIcons: [] as CustomIcon[],
    selected: props.current,
    selectedId: props.currentId ?? '',
    tip: null as { name: string; x: number; y: number } | null,
    uploadTip: null as { x: number; y: number; cx: number } | null,
    pos: { x: 0, y: 0 },
  })
  /** icon-plus 服务：打开弹窗即拉 getConfig（联通再取 tags），用 tags 重建 tab 列表（末尾固定"自定义"）；不联通回退 lucide */
  const iconStore = createIconPlusStore(props.current ?? "")
  onMount(() => {
    if (props.initialSize && /^\d+$/.test(props.initialSize)) iconStore.setSize(props.initialSize)
    iconStore.setShape(shapeKeyToStyle(state.shapeKey))
    iconStore.setColor(normalizeInitialColor(props.initialColor))
    // 仅自定义图标场景清空搜索；普通图标保留正常搜索
    if (state.source === 'custom') iconStore.setKeyword('')
    void iconStore.init()
  })
  onCleanup(() => iconStore.dispose())
  /** tabs：接口返回前用兜底，返回后用 store 数据 */
  const tabs = () => iconStore.state.tabs.length ? iconStore.state.tabs : FALLBACK_TABS
  let popupRef: HTMLDivElement | undefined
  let fileRef: HTMLInputElement | undefined
  let tabsRef: HTMLDivElement | undefined

  /** 二级 tab 滚动条隐藏 + 左右箭头控制 */
  const updateTabsScroll = () => {
    if (!tabsRef) return
    setState('tabsCan', {
      left: tabsRef.scrollLeft > 1,
      right: tabsRef.scrollLeft + tabsRef.clientWidth < tabsRef.scrollWidth - 1,
    })
  }
  const scrollTabs = (dir: 1 | -1) => tabsRef?.scrollBy({ left: dir * 160, behavior: 'smooth' })
  createEffect(() => {
    tabs()
    requestAnimationFrame(updateTabsScroll)
  })

  function updatePos() {
    if (!props.anchor) return
    const rect = props.anchor.getBoundingClientRect()
    setState('pos', {
      x: Math.max(4, rect.left - PANEL_W - 20),
      y: Math.max(4, Math.min(rect.top - 8, window.innerHeight - PANEL_H - 4)),
    })
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

  /** offline 兜底：本地 lucide 过滤（关键词读 store、分类读本地 state） */
  const filtered = () => {
    const kw = iconStore.state.keyword.trim().toLowerCase()
    const matcher = state.category === 'all' ? null : CATEGORY_MATCHERS[String(state.category)]
    return LUCIDE_ICONS.filter(i => {
      if (matcher && !matcher.test(i.name)) return false
      if (kw && !i.name.includes(kw)) return false
      return true
    })
  }

  /** 渲染后端返回的整段 svg 文本（online 时网格用）；尺寸联动底部筛选，作用于全部图标 */
  const ApiIcon = (props: { url: string }) => {
    const svg = () => iconStore.state.svgCache[props.url] ?? ''
    const px = () => `${iconStore.state.iconSize}px`
    return (
      <Show when={svg()} fallback={<span class="text-[10px] text-slate-400">…</span>}>
        <div class="api-icon flex items-center justify-center" style={{ width: px(), height: px() }} innerHTML={svg()} />
      </Show>
    )
  }

  /** 网格图标预览（容器 60px 高，居中展示）；shape/color/size 仅作用于当前选中的图标 */
  const GridIcon = (svg: string, s: string = 'outline', c: string = '#191919', size: number = 24) => {
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

  /** hover 图标：在图标下方弹气泡（图标名称 + 图标类名），坐标相对弹窗 */
  const showTip = (el: HTMLElement, name: string) => {
    if (!popupRef) return
    const r = el.getBoundingClientRect()
    const pr = popupRef.getBoundingClientRect()
    setState('tip', {
      name,
      x: r.left - pr.left + r.width / 2,
      y: r.top - pr.top + r.height,
    })
  }

  /** 自定义图标：上传写入 <工作区>/.octo/<sessionId>/assets/，重开弹窗可读回；无 desktop API 时回退 dataURL（仅本次会话） */
  const sdk = useSDK()
  /** 会话 id：优先 prop 传入，缺失时直接取路由参数（避免多层传参链路缺位） */
  const routeParams = useParams<{ id?: string }>()
  const sessionId = () => props.sessionId ?? routeParams.id
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
    setState('customIcons', [...state.customIcons, ...added])
  }

  /** 打开弹窗时读回会话已上传的自定义图标 */
  onMount(() => {
    void listSessionIconFiles(sdk.directory, sessionId(), props.htmlFilePath).then(icons => {
      if (icons.length) setState('customIcons', [...state.customIcons, ...icons])
    })
  })

  /** 删除已上传的自定义图标：会话文件一并删除；dataURL（web 回退）仅移出列表 */
  const deleteCustomIcon = (i: number) => {
    const icon = state.customIcons[i]
    if (icon.path) void deleteSessionIconFile(icon)
    setState('customIcons', prev => prev.filter((_, idx) => idx !== i))
    setState('tip', null)
  }

  const handleConfirm = () => {
    if (state.selected) {
      const custom = state.selectedId.startsWith('custom:') ? state.customIcons.find(c => `custom:${c.src}` === state.selectedId) : undefined
      props.onPick({
        /** 自定义图标：name 即原始文件名；src 为渲染端消费的相对路径 uploads/<文件名>（普通图标不带，接收方清除） */
        name: custom ? customIconName(custom.path ?? custom.src) : state.selected,
        id: state.selectedId || undefined,
        url: custom?.src ?? iconStore.state.icons.find(i => String(i.icon_id) === state.selectedId)?.url,
        src: custom?.path ? `uploads/${custom.path.split(/[\\/]/).pop()}` : undefined,
        isCustom: !!custom,
        size: iconStore.state.iconSize,
        style: state.shapeKey,
        color: iconStore.state.iconColor,
      })
    }
    props.onConfirm?.()
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
        style={{
          left: state.pos.x + 'px',
          top: state.pos.y + 'px',
          width: `${PANEL_W}px`,
          "height": `${PANEL_H}px`,
          background: "#fff",
          border: "1px solid #e2e8f0",
          "box-shadow": "0 8px 24px rgba(0,0,0,0.18)",
        }}>
        {/* 标题 */}
        <div class="flex shrink-0 items-center justify-between">
          <span class="ml-4 text-[13px] font-semibold text-slate-700">图标</span>
          <button type="button" onClick={() => props.onClose()}
            class="text-slate-400 hover:text-slate-600 flex items-center justify-center w-5 h-5 mr-4">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
              <line x1="2" y1="2" x2="10" y2="10" /><line x1="10" y1="2" x2="2" y2="10" />
            </svg>
          </button>
        </div>

        {/* 筛选框(109) + 搜索框(231)：高36 背景#F2F3F5 */}
        <div class="mt-4 flex shrink-0 items-center gap-2 px-4">
          <div class="w-[109px] shrink-0">
            <IconCategorySelect value={state.category} label={state.categoryName}
              tree={iconStore.state.groups}
              onChange={(id, name) => {
                setState('category', id)
                setState('categoryName', name)
                iconStore.setGroupId(id === 'all' ? null : id)
              }} />
          </div>
          <input value={iconStore.state.keyword} onInput={(e) => iconStore.setKeyword(e.currentTarget.value)}
            type="search" placeholder="请搜索..."
            class="h-9 w-[231px] shrink-0 rounded-[36px] bg-[#F2F3F5] pl-[38px] pr-3 text-[12px] text-[#333333] outline-none placeholder:text-[#777777]"
            style={{
              "background-image": `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%23555555' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><circle cx='11' cy='11' r='8'/><path d='m21 21-4.3-4.3'/></svg>")`,
              "background-repeat": "no-repeat",
              "background-position": "12px center",
            }} />
        </div>

        {/* 一级 tab：官方 / 自定义；选中 #0A59F7 + 下划线（距文字底部 4px），未选中 #777777 */}
        <div class="mt-4 flex shrink-0 items-center gap-8 px-4">
          <button type="button" onClick={() => setState('source', 'official')}
            class="relative pb-[4px] text-[12px] leading-5"
            style={{ color: state.source === 'official' ? '#0A59F7' : '#777777' }}>
            官方
            <Show when={state.source === 'official'}>
              <span class="absolute bottom-0 left-0 right-0 h-[2px] rounded-full" style={{ background: '#0A59F7' }} />
            </Show>
          </button>
          <button type="button" onClick={() => { setState('source', 'custom'); iconStore.setKeyword('') }}
            class="relative pb-[4px] text-[12px] leading-5"
            style={{ color: state.source === 'custom' ? '#0A59F7' : '#777777' }}>
            自定义
            <Show when={state.source === 'custom'}>
              <span class="absolute bottom-0 left-0 right-0 h-[2px] rounded-full" style={{ background: '#0A59F7' }} />
            </Show>
          </button>
        </div>

        {/* 二级 tab（仅官方）：现有来源 tab 去掉"自定义"；不出现滚动条，超宽时左右箭头点击滚动 */}
        <Show when={state.source === 'official'}>
          <div class="relative mt-4 shrink-0 px-4">
            <Show when={state.tabsCan.left}>
              <div class="pointer-events-none absolute left-0 top-1/2 z-10 flex h-[28px] w-[90px] -translate-y-1/2 items-center justify-start pl-[18px]"
                style={{ background: 'linear-gradient(to right, #FFFFFF 18px, rgba(255,255,255,0))' }}>
                <button type="button" onClick={() => scrollTabs(-1)}
                  class="pointer-events-auto flex cursor-pointer items-center justify-center outline-none">
                  <svg class="h-3 w-3" viewBox="0 0 8 8" fill="none"><path d="M5.5 1L2.5 4L5.5 7" stroke="#777777" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" /></svg>
                </button>
              </div>
            </Show>
            <div ref={tabsRef} class="icon-tabs flex items-center gap-0 overflow-x-auto" onScroll={updateTabsScroll}>
              <For each={tabs().filter(t => t.value !== '自定义')}>
                {(t) => (
                  <button type="button" onClick={() => iconStore.setTab(t.value)}
                    class="shrink-0 px-3 py-1 text-center text-[12px] leading-5 rounded-[28px] whitespace-nowrap"
                    classList={{
                      'bg-[#0A59F7]/10 text-[#0A59F7]': iconStore.state.activeTab === t.value,
                      'text-[#777777]': iconStore.state.activeTab !== t.value,
                    }}>
                    {t.label}
                  </button>
                )}
              </For>
            </div>
            <Show when={state.tabsCan.right}>
              <div class="pointer-events-none absolute right-0 top-1/2 z-10 flex h-[28px] w-[90px] -translate-y-1/2 items-center justify-end pr-[18px]"
                style={{ background: 'linear-gradient(to left, #FFFFFF 18px, rgba(255,255,255,0))' }}>
                <button type="button" onClick={() => scrollTabs(1)}
                  class="pointer-events-auto flex cursor-pointer items-center justify-center outline-none">
                  <svg class="h-3 w-3" viewBox="0 0 8 8" fill="none"><path d="M2.5 1L5.5 4L2.5 7" stroke="#777777" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" /></svg>
                </button>
              </div>
            </Show>
          </div>
        </Show>

        {/* 主内容：随 tab 切换；可滚动，底部筛选与按钮始终固定在弹窗底部 */}
        <div class="icon-picker-scroll mt-4 min-h-0 flex-1 overflow-y-auto px-4" onScroll={() => setState('tip', null)}>
          <Show when={state.source === 'custom'} fallback={
            <Show when={iconStore.state.online} fallback={
              /* offline 兜底：仅 '基础图标' tab 显示 lucide 网格，其余"暂无内容" */
              <Show when={iconStore.state.activeTab === '基础图标'} fallback={<EmptyState text="暂无内容" />}>
                <div class="grid grid-cols-5 gap-2">
                  <For each={filtered()}>
                    {(icon) => (
                      <button type="button"
                        onMouseEnter={(e) => showTip(e.currentTarget, icon.name)}
                        onMouseLeave={() => setState('tip', null)}
                        onClick={() => { setState('selectedId', icon.name); setState('selected', icon.name) }}
                        class="flex h-[60px] w-full items-center justify-center rounded-xl bg-[#F2F3F5]"
                        classList={{ 'ring-1 ring-inset ring-[#0A59F7]': (state.selectedId || state.selected) === icon.name }}>
                        {(state.selectedId || state.selected) === icon.name
                          ? GridIcon(icon.svg, state.shapeKey, iconStore.state.iconColor, Number(iconStore.state.iconSize))
                          : GridIcon(icon.svg, 'outline', '#191919', Number(iconStore.state.iconSize))}
                      </button>
                    )}
                  </For>
                </div>
                <Show when={filtered().length === 0}>
                  <div class="py-8 text-center text-[12px] text-slate-400">未找到匹配的图标</div>
                </Show>
              </Show>
            }>
              {/* online：icon-plus 网格 */}
              <Show when={iconStore.state.icons.length > 0} fallback={
                <EmptyState text={iconStore.state.searching ? '搜索中…' : '未找到匹配的图标'} />
              }>
                <div class="grid grid-cols-5 gap-2">
                  <For each={iconStore.state.icons}>
                    {(icon) => (
                      <button type="button"
                        onMouseEnter={(e) => showTip(e.currentTarget, icon.name)}
                        onMouseLeave={() => setState('tip', null)}
                        onClick={() => { setState('selectedId', String(icon.icon_id)); setState('selected', icon.name) }}
                        class="flex h-[60px] w-full items-center justify-center rounded-xl bg-[#F2F3F5]"
                        classList={{ 'ring-1 ring-inset ring-[#0A59F7]': !!state.selectedId && String(icon.icon_id) === state.selectedId }}>
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
                <div class="relative">
                  <button type="button"
                    onMouseEnter={(e) => {
                      const r = e.currentTarget.getBoundingClientRect()
                      setState('uploadTip', { x: r.left, y: r.top - 6, cx: r.left + r.width / 2 })
                    }}
                    onMouseLeave={() => setState('uploadTip', null)}
                    onClick={() => fileRef?.click()}
                    class="flex cursor-pointer items-center gap-1 text-[12px] text-[#0A59F7]">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="17 8 12 3 7 8" />
                      <line x1="12" y1="3" x2="12" y2="15" />
                    </svg>
                    上传图标
                  </button>
                </div>
              </div>
              <div class="mt-4 min-h-0 flex-1">
                <Show when={state.customIcons.length > 0}
                  fallback={<EmptyState text="暂无内容，点击上传图标吧～" />}>
                  <div class="grid grid-cols-5 gap-2">
                    <For each={state.customIcons}>
                      {(icon, i) => (
                        <div class="group relative flex h-[60px] w-full cursor-pointer items-center justify-center rounded-xl bg-[#F2F3F5]"
                          classList={{ 'ring-1 ring-inset ring-[#0A59F7]': `custom:${icon.src}` === state.selectedId }}
                          onMouseEnter={(e) => showTip(e.currentTarget, customIconName(icon.path ?? icon.src))}
                          onMouseLeave={() => setState('tip', null)}
                          onClick={() => { setState('selectedId', `custom:${icon.src}`); setState('selected', customIconName(icon.path ?? icon.src)) }}>
                          <img src={icon.src} class="max-h-full max-w-full object-contain" />
                          <button type="button" title="删除"
                            onClick={(e) => { e.stopPropagation(); deleteCustomIcon(i()) }}
                            class="absolute right-[6px] top-[6px] z-10 hidden cursor-pointer group-hover:block">
                            <img src={deleteSvg} width="16" height="16" alt="" />
                          </button>
                        </div>
                      )}
                    </For>
                  </div>
                </Show>
              </div>
              <input ref={fileRef} type="file" accept=".svg,.png,.jpg,.jpeg" multiple class="hidden" onChange={onFiles} />
            </div>
          </Show>
        </div>

        {/* 底部：第一组三个筛选项（线性/尺寸/颜色），往下16px 是取消/确认按钮 */}
        <div class="mt-4 shrink-0 px-4">
          <div class="flex items-center gap-2">
            <div class="w-[110px] shrink-0">
              <CustomSelect value={state.shapeKey} options={SHAPE_OPTIONS}
                onChange={v => { setState('shapeKey', v); iconStore.setShape(shapeKeyToStyle(v)) }}
                class="[&>button]:h-9 [&>button]:rounded-[36px] [&>button]:text-[12px]" />
            </div>
            <div class="w-[110px] shrink-0">
              <CustomSelect value={iconStore.state.iconSize} options={SIZE_OPTIONS} onChange={v => iconStore.setSize(v)}
                class="[&>button]:h-9 [&>button]:rounded-[36px] [&>button]:text-[12px]" />
            </div>
            <div class="w-[110px] shrink-0">
              <IconColorSelect value={state.iconColorKey}
                onChange={v => { setState('iconColorKey', v); iconStore.setColor(iconCssColor(v)) }} />
            </div>
          </div>
          <div class="mt-4 flex items-center justify-end gap-2">
            <button type="button" onClick={() => props.onClose()}
              class="h-7 shrink-0 rounded-[28px] bg-[#F2F3F5] px-[22px] text-[12px] hover:bg-[#E8E9EC]"
              style={{ color: '#191919' }}>取消</button>
            <button type="button" onClick={handleConfirm}
              class="h-7 shrink-0 rounded-[28px] bg-[#0A59F7] px-[22px] text-[12px] hover:bg-[#3B76F9]"
              style={{ color: '#fff' }}>确认</button>
          </div>
        </div>

        {/* 图标 hover 气泡：两行（图标名称 / 图标类名），出现在图标下方；箭头对准图标真实中心 */}
        <Show when={state.tip}>
          <span class="pointer-events-none absolute z-20 h-[8px] w-[8px] -translate-x-1/2 rotate-45"
            style={{ left: state.tip!.x + 'px', top: state.tip!.y + 'px', background: '#595959' }} />
          <div class="pointer-events-none absolute z-20 -translate-x-1/2 rounded-md px-2 py-1.5 shadow-lg"
            style={{ left: state.tip!.x + 'px', top: state.tip!.y + 4 + 'px', background: '#595959', color: '#fff' }}>
            <div class="whitespace-nowrap text-[11px]" style={{ color: '#fff', "text-align": 'center' }}>{state.tip!.name}</div>
            <div class="whitespace-nowrap text-[10px]" style={{ color: '#fff', opacity: 0.9, "text-align": 'center' }}>{iconClassName(state.tip!.name)}</div>
          </div>
        </Show>
        {/* 上传图标 hover 气泡：与图标气泡同款样式，展示在按钮上方，箭头指向按钮中心 */}
        <Show when={state.uploadTip}>
          <span class="pointer-events-none fixed z-[303] h-[8px] w-[8px] -translate-x-1/2 rotate-45"
            style={{ left: state.uploadTip!.cx + 'px', top: state.uploadTip!.y - 4 + 'px', background: '#595959' }} />
          <div class="pointer-events-none fixed z-[303] max-w-[280px] -translate-y-full rounded-md px-2 py-1.5 shadow-lg"
            style={{ left: state.uploadTip!.x + 'px', top: state.uploadTip!.y + 'px', background: '#595959', color: '#fff' }}>
            <div class="whitespace-nowrap text-[11px]" style={{ color: '#fff' }}>支持SVG、PNG、JPG等格式文件，</div>
            <div class="whitespace-nowrap text-[10px]" style={{ color: '#fff', opacity: 0.9 }}>支持单张与批量上传</div>
          </div>
        </Show>
      </div>
    </Portal>
  )
}

/**
 * icon-plus 图标服务逻辑层
 *
 * 接口流程（见 D:\60096960\icon-plus.md）：
 *   1. getConfig   取尺寸/风格/颜色等配置（兼作 online 探测）
 *   2. tags        取标签列表（用于弹窗 TABS）
 *   3. getIconInfo 按关键词搜索图标（topK=25、source_id=6、type=icon、tags；支持逗号分隔批量）
 *   4. getIcon     按图标 url 批量取 svg 文本（size/style/color/fileType/url）
 *
 * 基址复用 lib-resource-service 域名，请求风格对齐 pattern-resource.ts（原生 fetch，{success,data} 信封）。
 * size/style 由弹窗直传 API 值；color 经 mapColorToId 解析为 config.colors 的 id（后端要 id）。
 */
import { createStore, produce } from "solid-js/store"

// ============ 常量 ============

const ICON_PLUS_BASE = "https://octo.hdesign.huawei.com"
export const SOURCE_ID = 6
export const ICON_TYPE = "icon"
export const TOP_K = 25

/** 搜索框为空时的预设关键词（25 个真实 lucide 图标名，逗号分隔批量搜索，topK=1 各取 1 个 = 25 个图标） */
const PRESET_KEYWORDS = [
  "file-text", "folder", "image", "search", "settings",
  "user", "users", "house", "mail", "bell",
  "calendar", "clock", "phone", "heart", "star",
  "check", "plus", "menu", "trash-2", "download",
  "upload", "pencil", "lock", "eye", "shopping-cart",
].join(",")

// ============ 类型 ============

/** getConfig 中 colors 数组项：颜色按 style 分组，API 的 color 入参取 id */
export type IconColorOption = {
  id: string
  key: string
  value: string
  domain?: string
  type?: string
  style?: string
}

/** getConfig 返回（弹窗 size/style 直传 API 值；color 需经 mapColorToId 解析为 config id） */
export type IconPlusConfig = {
  colors?: IconColorOption[]
  [key: string]: unknown
}

/** getIconInfo 返回的单个图标信息 */
export type IconInfo = {
  icon_id: string
  name: string
  chineseName?: string
  englishName?: string
  description?: string[]
  category?: string
  group?: string
  tags?: string[]
  url: string
  score?: number
}

/** getIconInfo 外层按 keyword 分组 */
export type IconInfoGroup = { keyword: string; icons: IconInfo[] }

/** getIcon 返回的单个图标内容 */
export type IconContent = { url: string; name: string; data: string }

/** 统一返回信封 */
export type Result<T> = { success: true; data: T } | { success: false; error: string }

/** getIconInfo 请求参数 */
export type IconSearchParams = {
  keyword: string
  topK?: number
  source_id?: number
  type?: string
  tags: string
}

/** getIcon 请求参数 */
export type IconContentParams = {
  size: string
  style: string
  color: string
  fileType?: string
  urls: string[]
}

export type TabItem = { label: string; value: string }

// ============ 底层 fetch ============

function buildQuery(params: Record<string, unknown>): string {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue
    sp.append(k, String(v))
  }
  const s = sp.toString()
  return s ? `?${s}` : ""
}

async function getRequest<T>(url: string): Promise<Result<T>> {
  try {
    const res = await fetch(url, {
      headers: { "Content-Type": "application/json"},
    })
    if (!res.ok) return { success: false, error: `HTTP ${res.status}` }
    const data = (await res.json()) as T
    return { success: true, data }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** 1. 获取图标配置 */
export function fetchIconConfig(): Promise<Result<IconPlusConfig>> {
  return getRequest<IconPlusConfig>(`${ICON_PLUS_BASE}/assetRepository/iconPlus/getConfig`)
}

/** 2. 获取标签列表 */
export async function fetchIconTags(
  sourceId: number = SOURCE_ID,
  type: string = ICON_TYPE,
): Promise<Result<string[]>> {
  const r = await getRequest<{ items: string[] }>(
    `${ICON_PLUS_BASE}/lib-resource-service/api/resources/tags${buildQuery({ source_id: sourceId, type })}`,
  )
  if (!r.success) return r
  return { success: true, data: r.data?.items ?? [] }
}

/** 3. 根据关键词搜索图标信息，拍平成 一维 IconInfo[] */
export async function fetchIconInfo(params: IconSearchParams): Promise<Result<IconInfo[]>> {
  const q = buildQuery({
    keyword: params.keyword,
    topK: params.topK ?? TOP_K,
    source_id: params.source_id ?? SOURCE_ID,
    type: params.type ?? ICON_TYPE,
    tags: params.tags,
  })
  const r = await getRequest<IconInfoGroup[]>(
    `${ICON_PLUS_BASE}/assetRepository/iconPlus/getIconInfo${q}`,
  )
  if (!r.success) return r
  const icons = (r.data ?? []).flatMap(g => g?.icons ?? [])
  return { success: true, data: icons }
}

/** 4. 根据 url 批量获取图标内容，按输入 url 索引回填（批量返回假定顺序与输入一致，联调校准） */
export async function fetchIconContent(params: IconContentParams): Promise<Result<Record<string, string>>> {
  const urls = params.urls
  if (!urls.length) return { success: true, data: {} }
  const q = buildQuery({
    size: params.size,
    style: params.style,
    color: params.color,
    fileType: params.fileType ?? "svg",
    url: urls.join(","),
  })
  const r = await getRequest<IconContent | IconContent[]>(
    `${ICON_PLUS_BASE}/assetRepository/iconPlus/getIcon${q}`,
  )
  if (!r.success) return r
  const list = Array.isArray(r.data) ? r.data : [r.data]
  const map: Record<string, string> = {}
  list.forEach((item, i) => {
    if (!item) return
    const key = urls[i] ?? item.url ?? ""
    if (key) map[key] = item.data ?? ""
  })
  return { success: true, data: map }
}

// ============ 映射函数 ============

/** iconColor → config.colors 的 id；按当前 style 过滤，命中 value 任一色，否则取该 style 首个 id
 *  注：弹窗色板为 icon-colors.ts 的语义色 hex，通常不命中 config 的 hex，故实际回退到该 style 首个 id（仍为有效 id） */
export function mapColorToId(
  iconColor: string,
  config: IconPlusConfig | null | undefined,
  shapeLabel?: string,
): string | undefined {
  const colors = config?.colors
  if (!colors?.length) return undefined
  const lc = (iconColor ?? "").toLowerCase()
  const pool = shapeLabel ? colors.filter(c => c.style === shapeLabel) : colors
  const list = pool.length ? pool : colors
  const found = list.find(c => (c.value ?? "").toLowerCase().split(",").includes(lc))
  return found?.id ?? list[0]?.id
}

/** tags 数组 → tab 列表，末尾固定追加"自定义"（先剔除已存在的"自定义"） */
export function buildTabsFromTags(items: string[]): TabItem[] {
  const tabs = items
    .filter(t => t && t !== "自定义")
    .map(t => ({ label: t, value: t }))
  tabs.push({ label: "自定义", value: "自定义" })
  return tabs
}

// ============ Solid 响应式封装 ============

export type IconPlusStore = ReturnType<typeof createIconPlusStore>

export function createIconPlusStore() {
  const [state, setState] = createStore({
    config: null as IconPlusConfig | null,
    tags: [] as string[],
    tabs: [] as TabItem[],
    /** getConfig 是否联通：false 时弹窗回退 lucide，store 内所有请求方法跳过 */
    online: false,
    status: "idle" as "idle" | "loading" | "ready" | "error",
    keyword: "",
    activeTab: "基础图标",
    shape: "线性",
    iconSize: "24",
    iconColor: "#191919",
    icons: [] as IconInfo[],
    svgCache: {} as Record<string, string>,
    searching: false,
    error: null as string | null,
  })

  let debounceTimer: ReturnType<typeof setTimeout> | null = null

  /** 弹窗 onMount 调用：先试 getConfig，联通才取 tags；不联通则 online=false 回退 lucide */
  async function init() {
    setState("status", "loading")
    const cfg = await fetchIconConfig()
    if (!cfg.success) {
      setState("online", false)
      setState("status", "ready")
      return
    }
    setState("online", true)
    setState("config", cfg.data)
    const tags = await fetchIconTags()
    if (tags.success) {
      setState("tags", tags.data)
      setState("tabs", buildTabsFromTags(tags.data))
      if (!state.activeTab || state.activeTab === "自定义") {
        const first = state.tabs.find(t => t.value !== "自定义")
        setState("activeTab", first?.value ?? "自定义")
      }
    }
    setState("status", "ready")
    // 预载 25 个图标（关键词为空走预设）
    void search()
  }

  /** 构造 getIcon 所需的 size/style/color：size/style 直传；color 经 mapColorToId 解析为 config id（后端要 id） */
  function buildIconContentParams(): Pick<IconContentParams, "size" | "style" | "color"> {
    return {
      size: state.iconSize,
      style: state.shape,
      color: mapColorToId(state.iconColor, state.config, state.shape) ?? "",
    }
  }

  /** getIconInfo + getIcon 搜索（tab/keyword 变更触发）；offline / 自定义 不发请求；空关键词走预设 25 个 */
  async function search() {
    if (!state.online || state.activeTab === "自定义") {
      setState("icons", [])
      return
    }
    const typed = state.keyword.trim()
    const keyword = typed || PRESET_KEYWORDS
    const topK = typed ? TOP_K : 1 // 预设 25 个关键词各取 1 个 = 25 个；单个关键词取 25 个
    setState("searching", true)
    setState("error", null)
    const res = await fetchIconInfo({ keyword, tags: state.activeTab, topK })
    if (!res.success) {
      setState("icons", [])
      setState("searching", false)
      setState("error", res.error)
      return
    }
    setState("icons", res.data)
    setState("searching", false)
    // 紧接着批量取 svg（第 4 步 getIcon）
    void loadVisibleSvgs(res.data.map(i => i.url))
  }

  function scheduleSearch(immediate = false) {
    if (debounceTimer) {
      clearTimeout(debounceTimer)
      debounceTimer = null
    }
    if (immediate) {
      void search()
      return
    }
    debounceTimer = setTimeout(() => {
      debounceTimer = null
      void search()
    }, 300)
  }

  /** shape/size/color 变更：offline 或无图标时只存值；否则清缓存并按新参数重新批量取 svg（仅 getIcon） */
  async function refreshSvgs() {
    if (!state.online || !state.icons.length) return
    setState("svgCache", {})
    await loadVisibleSvgs(state.icons.map(i => i.url))
  }

  /** 批量预取当前可视图标的 svg */
  async function loadVisibleSvgs(urls: string[]) {
    if (!urls.length) return
    const res = await fetchIconContent({ ...buildIconContentParams(), urls })
    if (!res.success) return
    setState(
      "svgCache",
      produce((prev: Record<string, string>) => {
        for (const [k, v] of Object.entries(res.data)) prev[k] = v
      }),
    )
  }

  /** 懒加载单个图标 svg，命中缓存直接返回 */
  async function getSvg(url: string): Promise<string | null> {
    if (state.svgCache[url]) return state.svgCache[url]
    const res = await fetchIconContent({ ...buildIconContentParams(), urls: [url] })
    if (!res.success) return null
    const data = res.data[url] ?? ""
    setState("svgCache", produce((prev: Record<string, string>) => {
      prev[url] = data
    }))
    return data
  }

  function setKeyword(v: string) {
    setState("keyword", v)
    scheduleSearch()
  }
  function setTab(v: string) {
    setState("activeTab", v)
    scheduleSearch(true)
  }
  function setShape(v: string) {
    setState("shape", v)
    void refreshSvgs()
  }
  function setSize(v: string) {
    setState("iconSize", v)
    void refreshSvgs()
  }
  function setColor(v: string) {
    setState("iconColor", v)
    void refreshSvgs()
  }

  function dispose() {
    if (debounceTimer) {
      clearTimeout(debounceTimer)
      debounceTimer = null
    }
  }

  return {
    state,
    init,
    search,
    getSvg,
    loadVisibleSvgs,
    refreshSvgs,
    setKeyword,
    setTab,
    setShape,
    setSize,
    setColor,
    dispose,
  }
}

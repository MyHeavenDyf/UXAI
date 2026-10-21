import { createEffect, createMemo, createSignal, For, on, onCleanup, Show, type JSX } from "solid-js"
import { Portal } from "solid-js/web"
import { createStore, produce } from "solid-js/store"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import { showToast } from "@opencode-ai/ui/toast"
import { Spinner } from "@opencode-ai/ui/spinner"
import { StudioMediaThumbnail } from "./studio-media-thumbnail"
import { batchSaveStudioMedia, prepareStudioMediaDownload, saveStudioMediaDownload } from "./studio-shared"
import { useLanguage } from "@/context/language"
import { groupMediaByDate } from "./studio-file-manager"
import {
  deleteHistoryMedia,
  fetchExcludedMediaIds,
  fetchHistoryMedia,
  fetchHistoryRevision,
  type HistoryMedia,
  type StudioHistoryRevision,
} from "./studio-history-store"
import emptyPng from "../insight/icons/empty.png"
import squareAndPencilPng from "@/pages/_shell/icons/square_and_pencil.png"
import { StudioHistoryDeleteDialog } from "./studio-history-delete-dialog"
import { FloatingNotice, type FloatingNoticeType } from "@/components/floating-notice"
import { StudioDownloadIcon } from "./studio-download-icon"
import { tracker } from "@/utils/tracker"
import { StudioDetails, StudioEmptyState } from "./studio-conversation"
import { StudioVideoPlayer } from "./studio-video-player"
import { getImageOrientation, isVideoMedia } from "./studio-shared"
import { resolveStudioThumbnailUrl } from "./studio-media"
import { useServer } from "@/context/server"
import type { StudioGenerationResult, StudioImage } from "./types"

type GlobalSDK = ReturnType<typeof import("@/context/global-sdk").useGlobalSDK>
type HistoryTab = "all" | "image" | "video"

const DOWNLOAD_CONCURRENCY = 3
const DOWNLOAD_TIMEOUT_MS = 60_000
const HISTORY_PAGE_SIZE = 48
// 距底部不足该像素即触发下一页。用滚动位置判断而不是 IntersectionObserver：
// IO 只在相交状态变化时回调，若加载后哨兵仍落在 rootMargin 内就不会再次触发，
// 表现为必须手动上滑再下滑才会继续加载。
const LOAD_MORE_THRESHOLD_PX = 400

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  task: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (true) {
        const index = cursor++
        if (index >= items.length) return
        results[index] = await task(items[index])
      }
    }),
  )
  return results
}

// Original media may be a provider URL that can expire or be blocked by CORS.
// Fall back to the server-materialized thumbnail, then a placeholder, so the
// detail/fullscreen preview never goes blank.
function HistoryPreviewImage(props: {
  src: string
  fallbackSrc?: string
  class?: string
  onClick?: (event: MouseEvent) => void
}): JSX.Element {
  const [src, setSrc] = createSignal(props.src)
  const [failed, setFailed] = createSignal(false)
  return (
    <Show
      when={!failed()}
      fallback={<span class={`studio-media-thumbnail-placeholder ${props.class ?? ""}`} aria-label="媒体预览不可用" />}
    >
      <img
        src={src()}
        class={props.class}
        alt=""
        onClick={props.onClick}
        onError={() => {
          const fallback = props.fallbackSrc
          if (fallback && src() !== fallback) {
            setSrc(fallback)
            return
          }
          setFailed(true)
        }}
      />
    </Show>
  )
}

const HISTORY_TABS: {
  key: HistoryTab
  label: "studio.history.tab.all" | "studio.history.tab.image" | "studio.history.tab.video"
}[] = [
  { key: "all", label: "studio.history.tab.all" },
  { key: "image", label: "studio.history.tab.image" },
  { key: "video", label: "studio.history.tab.video" },
]

const RESOLUTION_OPTIONS = ["480P", "720P", "1080P", "4K"]
// 图片/视频各自不支持的比例：视频没有 2:3/3:2，图片没有 21:9。
// 选项仍然展示（不做禁用），只是在构造查询时把不适用于目标类型的比例排除掉。
const VIDEO_HIDDEN_RATIOS = new Set(["2:3", "3:2"])
const IMAGE_HIDDEN_RATIOS = new Set(["21:9"])
const RATIO_OPTIONS: { label: string }[] = [
  { label: "21:9" },
  { label: "16:9" },
  { label: "4:3" },
  { label: "3:2" },
  { label: "1:1" },
  { label: "2:3" },
  { label: "3:4" },
  { label: "9:16" },
]

// 模块级缓存：组件在 <Show> 内随切换挂载/卸载，缓存必须跨挂载保留才能避免重复请求。
// 每个「目录+筛选+排序」各自记录已加载媒体与其对应的 revision（用 revision 而非单一
// 目录级指纹比对，避免其它筛选刷新指纹后误判当前筛选的旧缓存仍新鲜）。
type HistoryPageCache = {
  directory: string
  items: HistoryMedia[]
  nextCursor?: string
  revision: string
  excludedIds: Set<string>
}
const historyPageCache = new Map<string, HistoryPageCache>()

// 本地删除后清空该目录所有筛选缓存：服务端 revision 需要提交后才变化，
// 清缓存可避免在提交完成前命中并展示已删除的旧数据。
function invalidateHistoryCache(directory: string) {
  for (const [key, entry] of historyPageCache) {
    if (entry.directory === directory) historyPageCache.delete(key)
  }
}

type HistoryGalleryState = {
  activeTab: HistoryTab
  loading: boolean
  loadingMore: boolean
  loadMoreFailed: boolean
  loadError: boolean
  showFilter: boolean
  showSort: boolean
  batchMode: boolean
  showDeleteDialog: boolean
  sortOrder: "desc" | "asc"
  // 列表实际渲染用的排序方向：只在服务端返回对应排序的数据后才切换。
  // 直接跟随 sortOrder 会让已加载的分页立刻被就地重排，在新数据到达前闪现错误顺序。
  appliedSort: "desc" | "asc"
  resolutionFilter: ReadonlySet<string>
  ratioFilter: ReadonlySet<string>
  media: HistoryMedia[]
  nextCursor: string | undefined
  excludedIds: Set<string>
  downloading: boolean
  notice: { type: FloatingNoticeType; message: string } | null
}

export function StudioHistoryGallery(props: {
  directory: string
  globalSDK: GlobalSDK
  // 每次「我的资产」被点击时递增：即使已停留在资产页也能重新查询最新数据。
  refreshKey?: number
  onOpenSession: (sessionID: string) => void
  fullscreenMount?: () => HTMLElement
}): JSX.Element {
  const language = useLanguage()
  const server = useServer()
  const [state, setState] = createStore<HistoryGalleryState>({
    activeTab: "all",
    loading: true,
    loadingMore: false,
    loadMoreFailed: false,
    loadError: false,
    showFilter: false,
    showSort: false,
    batchMode: false,
    showDeleteDialog: false,
    sortOrder: "desc",
    appliedSort: "desc",
    resolutionFilter: new Set(),
    ratioFilter: new Set(),
    media: [],
    nextCursor: undefined,
    excludedIds: new Set(),
    downloading: false,
    notice: null,
  })
  const [selectedItems, setSelectedItems] = createStore<Record<string, boolean>>({})
  const [detailItem, setDetailItem] = createSignal<HistoryMedia | undefined>()
  const [detailResult, setDetailResult] = createSignal<(StudioGenerationResult & { sessionID: string }) | undefined>()
  const [showDetailPanel, setShowDetailPanel] = createSignal(true)
  const [fullscreenItem, setFullscreenItem] = createSignal<HistoryMedia | undefined>()
  let noticeTimer: ReturnType<typeof setTimeout> | undefined
  let requestSeq = 0
  // 详情请求序号：快速连续切换条目时丢弃旧响应，避免慢请求覆盖新条目的数据。
  let detailSeq = 0
  let seenIds = new Set<string>()
  let viewportEl: HTMLDivElement | undefined

  onCleanup(() => clearTimeout(noticeTimer))

  createEffect(on(detailItem, (item) => {
    const seq = ++detailSeq
    setDetailResult(undefined)
    if (!item) return
    const client = props.globalSDK.createClient({ directory: props.directory })
    client.studio.generations.get({ generationID: item.generationID, directory: props.directory })
      .then((res) => {
        if (seq === detailSeq) setDetailResult(res.data as StudioGenerationResult & { sessionID: string })
      })
      .catch((error) => console.error("[studio.history] failed to fetch generation result", { generationID: item.generationID, error }))
  }))

  function showNotice(type: FloatingNoticeType, message: string) {
    clearTimeout(noticeTimer)
    setState("notice", { type, message })
    noticeTimer = setTimeout(() => setState("notice", null), 3000)
  }

  // Server-materialized thumbnail URL, used as a preview fallback when the
  // provider URL cannot load (expired / CORS / offline).
  function previewFallback(item: HistoryMedia): string | undefined {
    if (!item.thumbnailUrl) return undefined
    return resolveStudioThumbnailUrl({
      value: item.thumbnailUrl,
      sdkUrl: server.current?.http.url ?? "",
      directory: props.directory,
    })
  }

  async function downloadDetailMedia() {
    const item = detailItem()
    if (!item || state.downloading) return
    setState("downloading", true)
    try {
      const source = item.url
      const fallbackMime = item.kind === "video" ? "video/mp4" : "image/png"
      const prepared = await prepareStudioMediaDownload({ source, fallbackMime })
      tracker.interaction({
        module: "studio",
        name: "history-download",
        extend: JSON.stringify({ name: prepared.label, url: source }),
      })
      const result = await saveStudioMediaDownload({ source, ...prepared })
      if (result.saved) showNotice("success", language.t("studio.download.success"))
      else if (result.fallback) showNotice("error", language.t("studio.download.fallback"))
    } catch (error) {
      console.error("[studio.history] detail download failed", error)
      showNotice("error", language.t("common.requestFailed"))
    } finally {
      setState("downloading", false)
    }
  }

  // 筛选时真正生效的比例：分辨率为视频专属，一旦选中结果只可能是视频，
  // 此时图片专属比例（2:3/3:2）不作为筛选条件；图片 tab 下同理排除 21:9。
  // 全选当前上下文适用的全部比例等价于不筛选：比例无法判定（NULL）的行只在无比例条件时可见。
  function effectiveRatios() {
    const hidden = state.resolutionFilter.size > 0 || state.activeTab === "video"
      ? VIDEO_HIDDEN_RATIOS
      : state.activeTab === "image"
        ? IMAGE_HIDDEN_RATIOS
        : undefined
    const applicable = RATIO_OPTIONS.filter((option) => !hidden?.has(option.label))
    const selected = applicable.filter((option) => state.ratioFilter.has(option.label)).map((option) => option.label)
    return selected.length === applicable.length ? [] : selected
  }

  // 目录 / tab / 筛选 / 排序 / 手动刷新任一变化即重置到第一页。
  // 不做后台事件驱动的实时刷新：组件在 <Show> 内随切换挂载/卸载，
  // 每次进入"我的资产"时重置副作用触发 loadFirstPage 拉取最新数据；
  // refreshKey 让已停留在资产页时的重复点击也能重新查询。
  const resetKey = createMemo(() =>
    JSON.stringify({
      directory: props.directory,
      refreshKey: props.refreshKey ?? 0,
      tab: state.activeTab,
      sort: state.sortOrder,
      resolution: [...state.resolutionFilter].sort(),
      ratio: effectiveRatios().slice().sort(),
    }),
  )

  function historyParams(cursor?: string) {
    const tab = state.activeTab
    const ratios = effectiveRatios()
    return {
      // 勾了分辨率（即使 4 档全选）结果就只可能是视频；全选档位等价于不筛分辨率，
      // 让无法识别档位的老视频也能命中。
      kind: tab === "all" ? (state.resolutionFilter.size > 0 ? "video" : undefined) : tab,
      resolutions: state.resolutionFilter.size > 0 && !RESOLUTION_OPTIONS.every((option) => state.resolutionFilter.has(option))
        ? [...state.resolutionFilter]
        : undefined,
      ratios: ratios.length > 0 ? ratios : undefined,
      sort: state.sortOrder,
      cursor,
      limit: HISTORY_PAGE_SIZE,
    }
  }

  // 缓存键稳定化：筛选集合排序后再序列化，避免同集合因插入顺序不同而缓存不命中。
  function filterCacheKey(params: ReturnType<typeof historyParams>) {
    return JSON.stringify({
      directory: props.directory,
      kind: params.kind,
      resolutions: params.resolutions ? [...params.resolutions].sort() : undefined,
      ratios: params.ratios ? [...params.ratios].sort() : undefined,
      sort: params.sort,
    })
  }

  async function loadFirstPage() {
    const directory = props.directory
    if (!directory) return
    const seq = ++requestSeq
    setState({ loading: true, loadingMore: false, loadMoreFailed: false, loadError: false })
    const client = props.globalSDK.createClient({ directory })
    const params = historyParams()
    const cacheKey = filterCacheKey(params)
    try {
      // 有缓存时先取轻量指纹：与该筛选缓存记录的 revision 一致才复用，避免跑完整列表查询。
      const cachedPage = historyPageCache.get(cacheKey)
      let revision: StudioHistoryRevision | undefined
      if (cachedPage) {
        revision = await fetchHistoryRevision(client).catch(() => undefined)
        if (seq !== requestSeq) return
        if (revision && revision.revision === cachedPage.revision) {
          setState({
            excludedIds: cachedPage.excludedIds,
            media: cachedPage.items,
            nextCursor: cachedPage.nextCursor,
            appliedSort: params.sort,
            loading: false,
          })
          seenIds = new Set(cachedPage.items.map((item) => item.id))
          return
        }
      }
      const [excluded, page] = await Promise.all([
        fetchExcludedMediaIds(client),
        fetchHistoryMedia(client, params),
      ])
      if (seq !== requestSeq) return
      // 首次加载没有缓存时补取一次指纹，供下次点击比对；有缓存时复用上面已取的值。
      if (!cachedPage) revision = await fetchHistoryRevision(client).catch(() => undefined)
      if (seq !== requestSeq) return
      historyPageCache.set(cacheKey, {
        directory,
        items: page.items,
        nextCursor: page.nextCursor,
        // 指纹取不到时存空串，使缓存永不命中（宁可多查一次也不展示未校验的数据）。
        revision: revision?.revision ?? "",
        excludedIds: excluded,
      })
      setState({
        excludedIds: excluded,
        media: page.items,
        nextCursor: page.nextCursor,
        appliedSort: params.sort,
        loading: false,
      })
      seenIds = new Set(page.items.map((item) => item.id))
    } catch (error) {
      if (seq !== requestSeq) return
      console.error("[studio.history] failed to load history media", error)
      setState({ loadError: true, loading: false })
    }
  }

  async function loadMore() {
    const cursor = state.nextCursor
    const directory = props.directory
    if (!cursor || !directory || state.loading || state.loadingMore) return
    const seq = requestSeq
    setState({ loadingMore: true, loadMoreFailed: false })
    const cacheKey = filterCacheKey(historyParams())
    try {
      const page = await fetchHistoryMedia(props.globalSDK.createClient({ directory }), historyParams(cursor))
      if (seq !== requestSeq) return
      const fresh = page.items.filter((item) => !seenIds.has(item.id))
      for (const item of fresh) seenIds.add(item.id)
      setState("media", (prev) => {
        const next = fresh.length > 0 ? [...prev, ...fresh] : prev
        const cached = historyPageCache.get(cacheKey)
        historyPageCache.set(cacheKey, {
          directory,
          items: next,
          nextCursor: page.nextCursor,
          revision: cached?.revision ?? "",
          excludedIds: cached?.excludedIds ?? state.excludedIds,
        })
        return next
      })
      setState("nextCursor", page.nextCursor)
    } catch (error) {
      if (seq !== requestSeq) return
      console.error("[studio.history] failed to load more history media", error)
      // 失败后停止自动续拉，暴露重试入口恢复分页。
      setState("loadMoreFailed", true)
    } finally {
      if (seq === requestSeq) setState("loadingMore", false)
    }
  }

  createEffect(on(resetKey, () => {
    // 刷新（含「我的资产」重复点击）时回到列表，让重新查询的结果可见。
    setDetailItem(undefined)
    const timer = setTimeout(() => void loadFirstPage(), 300)
    onCleanup(() => clearTimeout(timer))
  }))

  // 触发下一页加载：已到（或不足一屏时自带）底部阈值即拉取。
  // loadMoreFailed 时不自动重试，交由重试按钮恢复，避免失败后无限循环。
  function maybeLoadMore() {
    const viewport = viewportEl
    // 详情打开后列表视图已卸载，viewportEl 指向游离节点：跳过检查，避免误触发一次多余请求。
    if (!viewport?.isConnected) return
    if (state.loading || state.loadingMore || state.loadMoreFailed || !state.nextCursor) return
    if (viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= LOAD_MORE_THRESHOLD_PX) {
      void loadMore()
    }
  }

  // 内容增删、加载完成或视图尺寸变化后补一次检查：内容不足一屏时自动续拉，直到填满或没有更多。
  createEffect(on(() => [state.loading, state.media.length, state.nextCursor], () => {
    if (state.loading) return
    requestAnimationFrame(() => maybeLoadMore())
  }, { defer: true }))

  // viewport 在详情 <Show> 的 fallback 内，进出详情会卸载重建：
  // 在 ref 回调里重新挂观察器，避免 ResizeObserver 一直观察已卸载的旧节点、resize 不再触发加载。
  let viewportObserver: ResizeObserver | undefined
  const observeViewport = (el: HTMLDivElement) => {
    viewportEl = el
    viewportObserver?.disconnect()
    viewportObserver = new ResizeObserver(() => maybeLoadMore())
    viewportObserver.observe(el)
  }
  onCleanup(() => viewportObserver?.disconnect())

  const toggleFilterValue = (key: "resolutionFilter" | "ratioFilter", value: string) => {
    tracker.interaction({ module: "studio", name: "history-filter", extend: JSON.stringify({ filter: key, value }) })
    setState(key, (prev) => {
      const next = new Set(prev)
      if (next.has(value)) next.delete(value)
      else next.add(value)
      return next
    })
  }

  const allMedia = createMemo(() => {
    const excluded = state.excludedIds
    return state.media.filter((item) => !excluded.has(item.id))
  })

  const visibleRatioOptions = createMemo(() => {
    if (state.activeTab === "image") return RATIO_OPTIONS.filter((option) => !IMAGE_HIDDEN_RATIOS.has(option.label))
    if (state.activeTab === "video") return RATIO_OPTIONS.filter((option) => !VIDEO_HIDDEN_RATIOS.has(option.label))
    return RATIO_OPTIONS
  })

  const hasSelection = createMemo(() => Object.values(selectedItems).some(Boolean))

  async function downloadSelectedMedia() {
    if (state.downloading) return
    const items = allMedia().filter((item) => selectedItems[item.id])
    if (items.length === 0) return
    setState("downloading", true)
    try {
      // 限制并发 + 单项超时，避免一次性把所有媒体的字节读进内存、或单个请求挂起拖垮整批。
      const prepared = await mapWithConcurrency(items, DOWNLOAD_CONCURRENCY, async (item) => {
        const source = item.url
        const fallbackMime = item.kind === "video" ? "video/mp4" : "image/png"
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS)
        try {
          return { source, ...(await prepareStudioMediaDownload({ source, fallbackMime, signal: controller.signal })) }
        } finally {
          clearTimeout(timer)
        }
      })
      // 逐个落盘：桌面端与单个下载同款「保存文件」弹框，只弹一次；字节缺失的项在保存阶段回退为直链下载。
      const { saved, fallback, cancelled } = await batchSaveStudioMedia({ entries: prepared })
      if (cancelled) return
      tracker.interaction({
        module: "studio",
        name: "history-batch-download",
        extend: JSON.stringify({ count: items.length, saved, fallback }),
      })
      if (saved === items.length) {
        showNotice("success", language.t("studio.download.success"))
        return
      }
      if (saved > 0) {
        showNotice("error", language.t("studio.download.partial"))
        return
      }
      // 一个都没确认落盘：部分回退为浏览器直链下载（结果不可确认），其余全部失败。
      if (fallback > 0) showNotice("error", language.t("studio.download.fallback"))
      else showNotice("error", language.t("common.requestFailed"))
    } catch (error) {
      console.error("[studio.history] batch download failed", error)
      showNotice("error", language.t("common.requestFailed"))
    } finally {
      setState("downloading", false)
    }
  }

  // 分页与筛选/排序都在服务端完成，这里只负责按时间分组渲染，排序方向一次到位。
  const groups = createMemo(() => groupMediaByDate(allMedia(), state.appliedSort))

  const emptyText = createMemo(() => {
    if (state.loadError) return language.t("common.requestFailed")
    const tab = state.activeTab
    if (tab === "image") return language.t("studio.history.empty.image")
    if (tab === "video") return language.t("studio.history.empty.video")
    return language.t("studio.history.empty.file")
  })

  return (
    <div class="studio-file-manager studio-history-gallery">
      <Show when={state.notice}>
        {(item) => (
          <div class="studio-history-notice">
            <FloatingNotice type={item().type} message={item().message} />
          </div>
        )}
      </Show>
      <Show when={detailItem()} fallback={
        <>
      <div class="studio-file-manager-header">
        <div class="studio-history-header-left">
          <div class="studio-file-manager-tabs">
            <For each={HISTORY_TABS}>
              {(tab) => (
                <button
                  type="button"
                  class="studio-file-manager-tab"
                  classList={{ active: state.activeTab === tab.key }}
                  onClick={() => {
                    if (state.activeTab === tab.key) return
                    tracker.interaction({ module: "studio", name: "history-tab-switch", extend: JSON.stringify({ tab: tab.key }) })
                    // 切换 tab 清空上一次的筛选：分辨率与比例的可见范围随 tab 变化，保留会造成不可见条件。
                    setState({ activeTab: tab.key, resolutionFilter: new Set(), ratioFilter: new Set() })
                  }}
                >
                  {language.t(tab.label)}
                </button>
              )}
            </For>
          </div>
          <span class="studio-history-header-divider" />
          <DropdownMenu gutter={4} placement="bottom" open={state.showFilter} onOpenChange={(open) => setState("showFilter", open)}>
            <DropdownMenu.Trigger
              class="studio-history-filter-trigger"
              classList={{ "studio-history-filter-trigger--open": state.showFilter }}
            >
              <span>{language.t("studio.history.filter")}</span>
              <svg
                width="10"
                height="6"
                viewBox="0 0 10 6"
                fill="none"
                style={{
                  "margin-left": "4px",
                  transform: state.showFilter ? "rotate(180deg)" : "rotate(0deg)",
                  transition: "transform 0.15s ease",
                }}
              >
                <path d="M1 1L5 5L9 1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content class="studio-history-filter-menu studio-history-filter-menu--scrollable">
                <Show when={state.activeTab !== "image"}>
                  <DropdownMenu.Group>
                    <DropdownMenu.GroupLabel>{language.t("studio.history.filter.resolution")}</DropdownMenu.GroupLabel>
                    <For each={RESOLUTION_OPTIONS}>
                      {(option) => (
                        <DropdownMenu.CheckboxItem
                          checked={state.resolutionFilter.has(option)}
                          onChange={() => toggleFilterValue("resolutionFilter", option)}
                          closeOnSelect={false}
                        >
                          <DropdownMenu.ItemLabel>{option}</DropdownMenu.ItemLabel>
                          <DropdownMenu.ItemIndicator>
                            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                              <path d="M2.5 7.5L5.5 10.5L11.5 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
                            </svg>
                          </DropdownMenu.ItemIndicator>
                        </DropdownMenu.CheckboxItem>
                      )}
                    </For>
                  </DropdownMenu.Group>
                </Show>
                <DropdownMenu.Group>
                  <DropdownMenu.GroupLabel>{language.t("studio.history.filter.ratio")}</DropdownMenu.GroupLabel>
                  <For each={visibleRatioOptions()}>
                    {(option) => (
                      <DropdownMenu.CheckboxItem
                        checked={state.ratioFilter.has(option.label)}
                        onChange={() => toggleFilterValue("ratioFilter", option.label)}
                        closeOnSelect={false}
                      >
                        <DropdownMenu.ItemLabel>{option.label}</DropdownMenu.ItemLabel>
                        <DropdownMenu.ItemIndicator>
                          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                            <path d="M2.5 7.5L5.5 10.5L11.5 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
                          </svg>
                        </DropdownMenu.ItemIndicator>
                      </DropdownMenu.CheckboxItem>
                    )}
                  </For>
                </DropdownMenu.Group>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu>
          <DropdownMenu gutter={4} placement="bottom" open={state.showSort} onOpenChange={(open) => setState("showSort", open)}>
            <DropdownMenu.Trigger
              class="studio-history-filter-trigger"
              classList={{ "studio-history-filter-trigger--open": state.showSort }}
            >
              <span>{language.t("studio.history.sort")}</span>
              <svg
                width="10"
                height="6"
                viewBox="0 0 10 6"
                fill="none"
                style={{
                  "margin-left": "4px",
                  transform: state.showSort ? "rotate(180deg)" : "rotate(0deg)",
                  transition: "transform 0.15s ease",
                }}
              >
                <path d="M1 1L5 5L9 1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content class="studio-history-filter-menu">
                <DropdownMenu.Group>
                  <DropdownMenu.GroupLabel>{language.t("studio.history.sort.time")}</DropdownMenu.GroupLabel>
                  <DropdownMenu.RadioGroup value={state.sortOrder} onChange={(value) => { tracker.interaction({ module: "studio", name: "history-sort", extend: JSON.stringify({ sort: value }) }); setState("sortOrder", value as "desc" | "asc") }}>
                    <DropdownMenu.RadioItem value="desc">
                      <DropdownMenu.ItemLabel>{language.t("studio.history.sort.desc")}</DropdownMenu.ItemLabel>
                      <DropdownMenu.ItemIndicator>
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                          <path d="M2.5 7.5L5.5 10.5L11.5 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
                        </svg>
                      </DropdownMenu.ItemIndicator>
                    </DropdownMenu.RadioItem>
                    <DropdownMenu.RadioItem value="asc">
                      <DropdownMenu.ItemLabel>{language.t("studio.history.sort.asc")}</DropdownMenu.ItemLabel>
                      <DropdownMenu.ItemIndicator>
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                          <path d="M2.5 7.5L5.5 10.5L11.5 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
                        </svg>
                      </DropdownMenu.ItemIndicator>
                    </DropdownMenu.RadioItem>
                  </DropdownMenu.RadioGroup>
                </DropdownMenu.Group>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu>
        </div>
        <Show
          when={!state.batchMode}
          fallback={
            <div class="studio-history-batch-actions">
              <button type="button" class="studio-history-batch-trigger" disabled={!hasSelection()} onClick={() => { if (!hasSelection()) return; tracker.interaction({ module: "studio", name: "history-batch-delete-trigger" }); setState("showDeleteDialog", true) }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style={{ "flex-shrink": "0" }} aria-hidden="true">
                  <path d="M3 6h18" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                  <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  <line x1="10" y1="11" x2="10" y2="17" />
                  <line x1="14" y1="11" x2="14" y2="17" />
                </svg>
                <span>{language.t("common.delete")}</span>
              </button>
              <button
                type="button"
                class="studio-history-batch-trigger"
                disabled={!hasSelection() || state.downloading}
                onClick={() => void downloadSelectedMedia()}
              >
                <StudioDownloadIcon style={{ "flex-shrink": "0" }} />
                <span>{language.t("studio.history.batch.download")}</span>
              </button>
              <span class="studio-history-batch-divider" />
              <button type="button" class="studio-history-batch-cancel" onClick={() => { tracker.interaction({ module: "studio", name: "history-batch-cancel" }); setSelectedItems(produce((draft) => { for (const key in draft) delete draft[key] })); setState("batchMode", false) }}>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ "flex-shrink": "0" }}>
                  <path d="M3 3L11 11M11 3L3 11" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" />
                </svg>
                <span>{language.t("studio.history.batch.cancel")}</span>
              </button>
            </div>
          }
        >
          <button
            type="button"
            class="studio-history-batch-trigger"
            classList={{ active: state.batchMode }}
            onClick={() => {
              const wasBatch = state.batchMode
              tracker.interaction({ module: "studio", name: "history-batch-toggle", extend: JSON.stringify({ active: !wasBatch }) })
              setState("batchMode", (v) => !v)
              if (wasBatch) setSelectedItems(produce((draft) => { for (const key in draft) delete draft[key] }))
            }}
          >
            <img src={squareAndPencilPng} style={{ width: "14px", height: "14px", "flex-shrink": "0" }} alt="" draggable={false} />
            <span>{language.t("studio.history.batch.manage")}</span>
          </button>
        </Show>
      </div>
      <ScrollView class="studio-file-manager-body" viewportRef={observeViewport} onScroll={() => maybeLoadMore()}>
        <Show
          when={!state.loading || allMedia().length > 0}
          fallback={
            <div class="studio-file-manager-loading">
              <StudioEmptyState label={language.t("studio.history.loading")} />
            </div>
          }
        >
          <Show
            when={groups().length > 0}
            fallback={
              <div class="studio-file-manager-empty">
                <img src={emptyPng} style={{ width: "150px", height: "150px", "margin-bottom": "12px" }} alt="" draggable={false} />
                <span class="studio-file-manager-empty-text">{emptyText()}</span>
                <Show when={state.loadError}>
                  <button
                    type="button"
                    class="studio-history-retry"
                    onClick={() => { tracker.interaction({ module: "studio", name: "history-retry-load" }); void loadFirstPage() }}
                  >
                    {language.t("studio.history.retry")}
                  </button>
                </Show>
              </div>
            }
          >
            <div class="studio-file-manager-content">
              <For each={groups()}>
                {(group) => (
                  <div class="studio-file-manager-date-group">
                    <div class="studio-file-manager-date-title">{group.dateLabel}</div>
                    <div class="studio-file-manager-media-grid">
                      <For each={group.items}>
                        {(item) => (
                          <div
                            class="studio-file-manager-media-item"
                            onClick={() => {
                              if (state.batchMode) setSelectedItems(item.id, (v) => !v)
                              else { tracker.interaction({ module: "studio", name: "history-detail-open", extend: JSON.stringify({ kind: item.kind }) }); setDetailItem(item) }
                            }}
                          >
                            <Show when={state.batchMode}>
                              <div
                                class="studio-history-batch-checkbox"
                                classList={{ checked: !!selectedItems[item.id] }}
                              />
                            </Show>
                            <StudioMediaThumbnail
                              image={{
                                id: item.id,
                                kind: item.kind,
                                url: item.url,
                                remoteUrl: item.url,
                                // DB 里存的是相对路径 `.octo/<sid>/thumbnails/...`,
                                // 不经 /artifact/serve 直接当 <img src> 会被浏览器解析成
                                // `http://host/.octo/...` 而 404；这里解析为 serve URL,
                                // 同时保留 thumbnail 形态供 isStudioThumbnailUrl 判别。
                                thumbnailUrl: item.thumbnailUrl
                                  ? resolveStudioThumbnailUrl({
                                      value: item.thumbnailUrl,
                                      sdkUrl: server.current?.http.url ?? "",
                                      directory: props.directory,
                                    })
                                  : undefined,
                                thumbnailStatus: item.thumbnailStatus,
                              }}
                              duration={item.duration}
                              durationBadge="file-manager"
                              generationID={item.generationID}
                              mediaIndex={item.mediaIndex}
                              class="studio-file-manager-media-image"
                            />
                          </div>
                        )}
                      </For>
                    </div>
                  </div>
                )}
              </For>
              <Show when={state.loadingMore}>
                <div class="studio-file-manager-loading">
                  <Spinner class="size-4" />
                </div>
              </Show>
              <Show when={state.loadMoreFailed}>
                <button
                  type="button"
                  class="studio-history-retry"
                  onClick={() => { tracker.interaction({ module: "studio", name: "history-retry-load-more" }); void loadMore() }}
                >
                  {language.t("studio.history.retry")}
                </button>
              </Show>
            </div>
          </Show>
        </Show>
      </ScrollView>
        </>
      }>
        <div class="studio-history-detail">
          <div class="studio-file-manager-back-bar">
            <button
              type="button"
              class="studio-file-manager-back-btn"
              onClick={() => { tracker.interaction({ module: "studio", name: "history-detail-back" }); setDetailItem(undefined) }}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" style={{ "flex-shrink": "0" }}>
                <path d="M10 3L5 8L10 13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
              <span>{language.t("studio.history.back")}</span>
            </button>
          </div>
          <div class="studio-history-detail-divider" />
          <div class="studio-history-detail-body">
            <div class="studio-history-detail-stage">
              <div class="studio-canvas-image-wrapper">
                <Show when={detailItem()}>{(item) => {
                  const image = (): StudioImage => ({ id: item().id, kind: item().kind, url: item().url, remoteUrl: item().url })
                  return (
                    <Show
                      when={isVideoMedia(image())}
                      fallback={<HistoryPreviewImage src={item().url} fallbackSrc={previewFallback(item())} class={`studio-canvas-image ${getImageOrientation(image())}`} onClick={() => { tracker.interaction({ module: "studio", name: "history-fullscreen-open" }); setFullscreenItem(item()) }} />}
                    >
                      <StudioVideoPlayer src={item().url} poster={previewFallback(item())} mount={props.fullscreenMount ?? (() => document.body)} />
                    </Show>
                  )
                }}</Show>
              </div>
              <div class="studio-canvas-floating-actions">
                <button
                  type="button"
                  disabled={state.downloading}
                  onClick={() => void downloadDetailMedia()}
                  class="studio-canvas-download-action disabled:opacity-45 disabled:cursor-not-allowed"
                >
                  <StudioDownloadIcon />
                  <span>{language.t("studio.action.download")}</span>
                </button>
              </div>
            </div>
            <div class="studio-details-wrapper" classList={{ expanded: showDetailPanel() }}>
              <button
                class="studio-details-toggle"
                onClick={() => { tracker.interaction({ module: "studio", name: "history-detail-panel-toggle", extend: JSON.stringify({ expanded: !showDetailPanel() }) }); setShowDetailPanel((v) => !v) }}
                aria-label={showDetailPanel() ? language.t("studio.history.detail.collapse") : language.t("studio.history.detail.expand")}
              />
              <Show when={showDetailPanel() && detailResult()} fallback={
                <Show when={showDetailPanel() && !detailResult()}>
                  <aside class="studio-history-detail-panel">
                    <div class="studio-file-manager-loading">
                      <Spinner class="size-4" />
                    </div>
                  </aside>
                </Show>
              }>
                {(result) => {
                  const image = createMemo<StudioImage | undefined>(() => {
                    const item = detailItem()
                    if (!item || !result().images) return undefined
                    return result().images.find((img) => img.id === item.id) ?? result().images[0]
                  })
                  return (
                    <aside class="studio-history-detail-panel">
                      <StudioDetails
                        result={result()}
                        image={image()}
                        selectedImageId={detailItem()?.id}
                        imageLabel=""
                        regenerateDisabled={true}
                        showVideoGeneration={false}
                        hideCover={true}
                        onSelectImage={() => {}}
                        onRegenerate={() => {}}
                        onGenerateVideo={() => {}}
                        onUpscale={() => {}}
                        onCutout={() => {}}
                        onInpaint={() => {}}
                        onOutpaint={() => {}}
                      />
                    </aside>
                  )
                }}
              </Show>
            </div>
          </div>
        </div>
      </Show>
      <Show when={state.showDeleteDialog}>
        <StudioHistoryDeleteDialog
          onCancel={() => { tracker.interaction({ module: "studio", name: "history-delete-cancel" }); setState("showDeleteDialog", false) }}
          onConfirm={() => {
            tracker.interaction({ module: "studio", name: "history-delete-confirm" })
            // 只删除当前可见列表（excludedIds 过滤后）中被选中的条目：
            // 切换 tab/筛选后 selectedItems 可能仍保留已不可见条目的勾选，不能随之删除。
            const visible = new Set(allMedia().map((item) => item.id))
            const ids = Object.keys(selectedItems).filter((key) => selectedItems[key] && visible.has(key))
            setState("showDeleteDialog", false)
            setSelectedItems(produce((draft) => { for (const key in draft) delete draft[key] }))
            setState("batchMode", false)
            if (ids.length === 0) return
            // 真删除：只移除历史记录条目，不影响会话生成的数据与文件。
            const idSet = new Set(ids)
            const removed = state.media.filter((item) => idSet.has(item.id))
            setState("media", (prev) => prev.filter((item) => !idSet.has(item.id)))
            // 删除后立即清缓存，避免服务端 revision 尚未提交时命中并展示已删除项。
            invalidateHistoryCache(props.directory)
            const client = props.globalSDK.createClient({ directory: props.directory })
            void deleteHistoryMedia(client, ids).catch(() => {
              invalidateHistoryCache(props.directory)
              setState("media", (prev) => {
                const existing = new Set(prev.map((item) => item.id))
                return [...removed.filter((item) => !existing.has(item.id)), ...prev]
              })
              showToast({ title: language.t("common.requestFailed") })
            })
          }}
        />
      </Show>
      <Show when={fullscreenItem()}>
        {(item) => (
          <Portal mount={props.fullscreenMount?.() || document.body}>
            <div class="studio-fullscreen-overlay" onClick={() => { tracker.interaction({ module: "studio", name: "history-fullscreen-close" }); setFullscreenItem(undefined) }}>
              <button type="button" class="studio-fullscreen-close" onClick={(e) => { e.stopPropagation(); tracker.interaction({ module: "studio", name: "history-fullscreen-close" }); setFullscreenItem(undefined) }} aria-label={language.t("studio.history.closeFullscreen")}>
                <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
                  <path d="M18 6L6 18M6 6l12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
                </svg>
              </button>
              <HistoryPreviewImage src={item().url} fallbackSrc={previewFallback(item())} class="studio-fullscreen-image" />
            </div>
          </Portal>
        )}
      </Show>
    </div>
  )
}

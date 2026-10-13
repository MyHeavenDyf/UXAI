import { createEffect, createMemo, For, on, onCleanup, onMount, Show, type JSX } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import { showToast } from "@opencode-ai/ui/toast"
import { Spinner } from "@opencode-ai/ui/spinner"
import { StudioMediaThumbnail } from "./studio-media-thumbnail"
import { batchSaveStudioMedia, prepareStudioMediaDownload, recordValue } from "./studio-shared"
import { useLanguage } from "@/context/language"
import { groupMediaByDate } from "./studio-file-manager"
import {
  deleteHistoryMedia,
  fetchExcludedMediaIds,
  fetchHistoryMedia,
  type HistoryMedia,
} from "./studio-history-store"
import emptyPng from "../insight/icons/empty.png"
import squareAndPencilPng from "@/pages/_shell/icons/square_and_pencil.png"
import trashPng from "@/pages/_shell/icons/trash.png"
import { StudioHistoryDeleteDialog } from "./studio-history-delete-dialog"
import { FloatingNotice, type FloatingNoticeType } from "@/components/floating-notice"
import { StudioDownloadIcon } from "./studio-download-icon"
import { tracker } from "@/utils/tracker"

type GlobalSDK = ReturnType<typeof import("@/context/global-sdk").useGlobalSDK>
type HistoryTab = "all" | "image" | "video"

const DOWNLOAD_CONCURRENCY = 3
const DOWNLOAD_TIMEOUT_MS = 60_000
const HISTORY_PAGE_SIZE = 48
const LOAD_MORE_MARGIN = "400px"

function sameIdSet(a: Set<string>, b: Set<string>) {
  if (a.size !== b.size) return false
  for (const value of a) if (!b.has(value)) return false
  return true
}

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

const HISTORY_TABS: {
  key: HistoryTab
  label: "studio.history.tab.all" | "studio.history.tab.image" | "studio.history.tab.video"
}[] = [
  { key: "all", label: "studio.history.tab.all" },
  { key: "image", label: "studio.history.tab.image" },
  { key: "video", label: "studio.history.tab.video" },
]

const RESOLUTION_OPTIONS = ["480P", "720P", "1080P", "4K"]
const RATIO_OPTIONS: { label: string; value: number }[] = [
  { label: "21:9", value: 21 / 9 },
  { label: "16:9", value: 16 / 9 },
  { label: "3:2", value: 3 / 2 },
  { label: "4:3", value: 4 / 3 },
  { label: "1:1", value: 1 },
]

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
  resolutionFilter: ReadonlySet<string>
  ratioFilter: ReadonlySet<string>
  media: HistoryMedia[]
  nextCursor: string | undefined
  excludedIds: Set<string>
  reloadVersion: number
  downloading: boolean
  notice: { type: FloatingNoticeType; message: string } | null
}

export function StudioHistoryGallery(props: {
  directory: string
  globalSDK: GlobalSDK
  onOpenSession: (sessionID: string) => void
}): JSX.Element {
  const language = useLanguage()
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
    resolutionFilter: new Set(),
    ratioFilter: new Set(),
    media: [],
    nextCursor: undefined,
    excludedIds: new Set(),
    reloadVersion: 0,
    downloading: false,
    notice: null,
  })
  const [selectedItems, setSelectedItems] = createStore<Record<string, boolean>>({})
  let noticeTimer: ReturnType<typeof setTimeout> | undefined
  let requestSeq = 0
  let seenIds = new Set<string>()
  let viewportEl: HTMLDivElement | undefined
  let sentinelEl: HTMLDivElement | undefined
  let sentinelObserver: IntersectionObserver | undefined

  onCleanup(() => clearTimeout(noticeTimer))

  function showNotice(type: FloatingNoticeType, message: string) {
    clearTimeout(noticeTimer)
    setState("notice", { type, message })
    noticeTimer = setTimeout(() => setState("notice", null), 3000)
  }

  // 目录 / tab / 筛选 / 排序任一变化才重置到第一页。
  // 后台生成导致的 session 更新不在这里重置 —— 那由事件驱动的
  // refreshFirstPage 处理，可保留滚动位置与已加载分页。
  const resetKey = createMemo(() =>
    JSON.stringify({
      directory: props.directory,
      tab: state.activeTab,
      sort: state.sortOrder,
      resolution: [...state.resolutionFilter].sort(),
      ratio: [...state.ratioFilter].sort(),
    }),
  )

  function historyParams(cursor?: string) {
    const tab = state.activeTab
    return {
      kind: tab === "all" ? undefined : tab,
      resolutions: state.resolutionFilter.size > 0 ? [...state.resolutionFilter] : undefined,
      ratios: state.ratioFilter.size > 0 ? [...state.ratioFilter] : undefined,
      sort: state.sortOrder,
      cursor,
      limit: HISTORY_PAGE_SIZE,
    }
  }

  async function loadFirstPage() {
    const directory = props.directory
    if (!directory) return
    const seq = ++requestSeq
    setState({ loading: true, loadingMore: false, loadMoreFailed: false, loadError: false })
    const client = props.globalSDK.createClient({ directory })
    try {
      const [excluded, page] = await Promise.all([
        fetchExcludedMediaIds(client),
        fetchHistoryMedia(client, historyParams()),
      ])
      if (seq !== requestSeq) return
      setState({
        excludedIds: excluded,
        media: page.items,
        nextCursor: page.nextCursor,
        loading: false,
      })
      seenIds = new Set(page.items.map((item) => item.id))
    } catch (error) {
      if (seq !== requestSeq) return
      console.error("[studio.history] failed to load history media", error)
      setState({ loadError: true, loading: false })
    }
  }

  // 新生成结果只重拉第一页并合并到顶部，保留滚动位置与已加载分页。
  async function refreshFirstPage() {
    const directory = props.directory
    if (!directory || state.loading) return
    const seq = requestSeq
    const client = props.globalSDK.createClient({ directory })
    try {
      const [excluded, page] = await Promise.all([
        fetchExcludedMediaIds(client),
        fetchHistoryMedia(client, historyParams()),
      ])
      if (seq !== requestSeq) return
      // 只在排除集真的变化时写 Store，否则每个后台事件都会替换 Set 引用，
      // 触发 allMedia/groups 重算并让整块网格重渲染（表现为频繁闪动）。
      if (!sameIdSet(excluded, state.excludedIds)) setState("excludedIds", excluded)
      const fresh = page.items.filter((item) => !seenIds.has(item.id))
      if (fresh.length === 0) return
      for (const item of fresh) seenIds.add(item.id)
      setState("media", (prev) => [...fresh, ...prev])
    } catch (error) {
      console.error("[studio.history] failed to refresh history media", error)
    }
  }

  async function loadMore() {
    const cursor = state.nextCursor
    const directory = props.directory
    if (!cursor || !directory || state.loading || state.loadingMore) return
    const seq = requestSeq
    setState({ loadingMore: true, loadMoreFailed: false })
    try {
      const page = await fetchHistoryMedia(props.globalSDK.createClient({ directory }), historyParams(cursor))
      if (seq !== requestSeq) return
      const fresh = page.items.filter((item) => !seenIds.has(item.id))
      for (const item of fresh) seenIds.add(item.id)
      if (fresh.length > 0) setState("media", (prev) => [...prev, ...fresh])
      setState("nextCursor", page.nextCursor)
    } catch (error) {
      if (seq !== requestSeq) return
      console.error("[studio.history] failed to load more history media", error)
      // IntersectionObserver 不会因状态不变而再次触发，失败后暴露重试入口恢复分页。
      setState("loadMoreFailed", true)
    } finally {
      if (seq === requestSeq) setState("loadingMore", false)
    }
  }

  createEffect(on(resetKey, () => {
    const timer = setTimeout(() => void loadFirstPage(), 300)
    onCleanup(() => clearTimeout(timer))
  }))

  createEffect(on(() => state.reloadVersion, () => {
    const timer = setTimeout(() => void refreshFirstPage(), 400)
    onCleanup(() => clearTimeout(timer))
  }, { defer: true }))

  onMount(() => {
    sentinelObserver = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void loadMore()
      },
      { root: viewportEl ?? null, rootMargin: LOAD_MORE_MARGIN },
    )
    if (sentinelEl) sentinelObserver.observe(sentinelEl)
    onCleanup(() => sentinelObserver?.disconnect())
  })

  // 会话内生成结果落盘后，服务端会推送带 studio 元数据的 tool part 更新。
  // 监听该事件即可让历史记录按会话结果自动刷新（含新会话首个结果）。
  createEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const unsub = props.globalSDK.event.listen((event) => {
      const payload = event.details
      if (payload.type !== "message.part.updated") return
      const part = payload.properties.part
      if (part.type !== "tool") return
      const metadata = part.state.status === "pending" ? undefined : part.state.metadata
      const status = recordValue(recordValue(metadata, "studio"), "status")
      if (status !== "succeeded" && status !== "failed" && status !== "create_failed") return
      clearTimeout(timer)
      timer = setTimeout(() => setState("reloadVersion", (value) => value + 1), 400)
    })
    onCleanup(() => {
      clearTimeout(timer)
      unsub()
    })
  })

  const toggleFilterValue = (key: "resolutionFilter" | "ratioFilter", value: string) => {
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
  const groups = createMemo(() => groupMediaByDate(allMedia(), state.sortOrder))

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
      <div class="studio-file-manager-header">
        <div class="studio-history-header-left">
          <div class="studio-file-manager-tabs">
            <For each={HISTORY_TABS}>
              {(tab) => (
                <button
                  type="button"
                  class="studio-file-manager-tab"
                  classList={{ active: state.activeTab === tab.key }}
                  onClick={() => setState("activeTab", tab.key)}
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
              <DropdownMenu.Content class="studio-history-filter-menu">
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
                <DropdownMenu.Group>
                  <DropdownMenu.GroupLabel>{language.t("studio.history.filter.ratio")}</DropdownMenu.GroupLabel>
                  <For each={RATIO_OPTIONS}>
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
                  <DropdownMenu.RadioGroup value={state.sortOrder} onChange={(value) => setState("sortOrder", value as "desc" | "asc")}>
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
          when={!(state.batchMode && hasSelection())}
          fallback={
            <div class="studio-history-batch-actions">
              <button type="button" class="studio-history-batch-trigger" onClick={() => setState("showDeleteDialog", true)}>
                <img src={trashPng} style={{ width: "14px", height: "14px", "flex-shrink": "0" }} alt="" draggable={false} />
                <span>{language.t("common.delete")}</span>
              </button>
              <button
                type="button"
                class="studio-history-batch-trigger"
                disabled={state.downloading}
                onClick={() => void downloadSelectedMedia()}
              >
                <StudioDownloadIcon style={{ "flex-shrink": "0" }} />
                <span>{language.t("studio.history.batch.download")}</span>
              </button>
              <span class="studio-history-batch-divider" />
              <button type="button" class="studio-history-batch-cancel" onClick={() => { setSelectedItems(produce((draft) => { for (const key in draft) delete draft[key] })); setState("batchMode", false) }}>
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
              setState("batchMode", (v) => !v)
              if (wasBatch) setSelectedItems(produce((draft) => { for (const key in draft) delete draft[key] }))
            }}
          >
            <img src={squareAndPencilPng} style={{ width: "14px", height: "14px", "flex-shrink": "0" }} alt="" draggable={false} />
            <span>{language.t("studio.history.batch.manage")}</span>
          </button>
        </Show>
      </div>
      <ScrollView class="studio-file-manager-body" viewportRef={(el) => (viewportEl = el)}>
        <Show
          when={!state.loading || allMedia().length > 0}
          fallback={
            <div class="studio-file-manager-loading">
              <Spinner class="size-4" />
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
                    onClick={() => void loadFirstPage()}
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
                              else props.onOpenSession(item.sessionID)
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
                                thumbnailUrl: item.thumbnailUrl,
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
                  onClick={() => void loadMore()}
                >
                  {language.t("studio.history.retry")}
                </button>
              </Show>
              <Show when={state.nextCursor}>
                <div
                  ref={(el) => {
                    // 分页结束/重置时 sentinel 会被卸载替换，卸绑旧的避免 observer 持有游离元素。
                    if (sentinelEl && sentinelEl !== el) sentinelObserver?.unobserve(sentinelEl)
                    sentinelEl = el
                    sentinelObserver?.observe(el)
                  }}
                  style={{ height: "1px" }}
                  aria-hidden="true"
                />
              </Show>
            </div>
          </Show>
        </Show>
      </ScrollView>
      <Show when={state.showDeleteDialog}>
        <StudioHistoryDeleteDialog
          onCancel={() => setState("showDeleteDialog", false)}
          onConfirm={() => {
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
            const client = props.globalSDK.createClient({ directory: props.directory })
            void deleteHistoryMedia(client, ids).catch(() => {
              setState("media", (prev) => {
                const existing = new Set(prev.map((item) => item.id))
                return [...removed.filter((item) => !existing.has(item.id)), ...prev]
              })
              showToast({ title: language.t("common.requestFailed") })
            })
          }}
        />
      </Show>
    </div>
  )
}

import { createEffect, createMemo, createSignal, For, Show, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import { tracker } from "@/utils/tracker"
import { useLanguage } from "@/context/language"
import type { StudioTurnData } from "./turns"
import emptyPng from "../insight/icons/empty.png"
import { StudioMediaThumbnail } from "./studio-media-thumbnail"
import type { StudioImage } from "./types"

type FileFilterTab = "all" | "image" | "video"

const FILE_FILTER_TABS: {
  key: FileFilterTab
  label: "studio.history.tab.all" | "studio.history.tab.image" | "studio.history.tab.video"
}[] = [
  { key: "all", label: "studio.history.tab.all" },
  { key: "image", label: "studio.history.tab.image" },
  { key: "video", label: "studio.history.tab.video" },
]

const RESOLUTION_OPTIONS = ["480P", "720P", "1080P", "4K"]
// 图片/视频各自不支持的比例：视频没有 2:3/3:2，图片没有 21:9。
// 选项仍然展示（不做禁用），只是在筛选时把不适用于目标类型的比例排除掉。
const VIDEO_HIDDEN_RATIOS = new Set(["2:3", "3:2"])
const IMAGE_HIDDEN_RATIOS = new Set(["21:9"])
const RATIO_OPTIONS: { label: string; value: number }[] = [
  { label: "21:9", value: 21 / 9 },
  { label: "16:9", value: 16 / 9 },
  { label: "4:3", value: 4 / 3 },
  { label: "3:2", value: 3 / 2 },
  { label: "1:1", value: 1 },
  { label: "2:3", value: 2 / 3 },
  { label: "3:4", value: 3 / 4 },
  { label: "9:16", value: 9 / 16 },
]
const RATIO_LABELS = new Set(RATIO_OPTIONS.map((option) => option.label))
// 与「我的资产」服务端 mediaRatio 相同的容差：比例值差 ≤0.02 视为命中该档。
const RATIO_TOLERANCE = 0.02

// 旧版筛选状态持久化键前缀：已不再写入，保留导出供 studio-page 离开页面时清理遗留数据。
export const STUDIO_FILTER_STATE_KEY_PREFIX = "octo:studio:file-manager:filter-state:v2:"

// 编辑类能力的结果可能缺像素尺寸，需探测真实图片宽高兜底比例判定。
const EDIT_CAPABILITIES = new Set(["image.upscale", "image.cutout", "image.inpaint", "image.outpaint"])

const dimensionCache = new Map<string, { w: number; h: number }>()

function probeImageDimensions(url: string, onReady: () => void) {
  if (dimensionCache.has(url)) return
  const el = new Image()
  el.onload = () => {
    const w = el.naturalWidth
    const h = el.naturalHeight
    if (w && h) {
      dimensionCache.set(url, { w, h })
      onReady()
    }
  }
  el.onerror = () => {}
  el.src = url
}

// 比例判定与「我的资产」服务端 mediaRatio 一致：aspectRatio 命中已知档位直接采用；
// 否则用像素宽高就近匹配（±0.02 容差）；无法归档时为「自定义」，无任何尺寸信息时
// 返回 undefined（比例筛选生效时不可见）。
function getMediaRatio(item: FileManagerMedia): string | undefined {
  if (item.aspectRatio && RATIO_LABELS.has(item.aspectRatio)) return item.aspectRatio
  const real = dimensionCache.get(item.url)
  const w = real?.w ?? item.width ?? 0
  const h = real?.h ?? item.height ?? 0
  if (!w || !h) return undefined
  const ratio = w / h
  const closest = RATIO_OPTIONS.reduce((best, option) =>
    Math.abs(ratio - option.value) < Math.abs(ratio - best.value) ? option : best,
  )
  if (Math.abs(ratio - closest.value) <= RATIO_TOLERANCE) return closest.label
  return "自定义"
}

// 视频分辨率档位：与「我的资产」服务端一致（4k→4K，其余→480P/720P/1080P）。
function videoResolutionLabel(mode?: string): string | undefined {
  if (mode === "4k") return "4K"
  if (mode === "480" || mode === "720" || mode === "1080") return `${mode}P`
  return undefined
}

export type FileManagerMedia = {
  id: string
  turnID: string
  generationID: string
  mediaIndex: number
  url: string
  thumbnailUrl?: string
  thumbnailStatus?: StudioImage["thumbnailStatus"]
  kind: "image" | "video"
  width?: number
  height?: number
  aspectRatio?: string
  resolution?: string
  capability?: string
  duration?: string
  createdAt: number
  sessionID?: string
}

export type DateGroup<T extends FileManagerMedia = FileManagerMedia> = {
  dateLabel: string
  timestamp: number
  items: T[]
}

function formatDateLabel(timestamp: number): string {
  const d = new Date(timestamp)
  return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`
}

export function extractMediaFromTurns(turns: StudioTurnData[]): FileManagerMedia[] {
  const media: FileManagerMedia[] = []

  for (const turn of turns) {
    const images = turn.result?.images
    if (!images || images.length === 0) continue

    for (const [mediaIndex, image] of images.entries()) {
      const url = image.remoteUrl ?? image.url
      if (!url) continue

      const kind = image.kind === "video" ? "video" : "image"
      media.push({
        id: image.id,
        turnID: turn.id,
        generationID: turn.result!.id,
        mediaIndex,
        url,
        thumbnailUrl: image.thumbnailUrl,
        thumbnailStatus: image.thumbnailStatus,
        kind,
        width: image.width ?? turn.result?.width,
        height: image.height ?? turn.result?.height,
        // 保留 result 级别的 aspectRatio（如智能重绘探测到的源图比例），
        // getMediaRatio 中 aspectRatio 优先于像素尺寸判断，避免被 API
        // 返回的默认输出尺寸（可能非 1:1）误判为竖版。
        aspectRatio: turn.result?.aspectRatio,
        resolution: kind === "video" ? videoResolutionLabel(turn.result?.videoQualityMode) : undefined,
        capability: turn.result?.capability ?? turn.editCapability,
        duration: turn.result?.duration,
        createdAt: turn.createdAt,
      })
    }
  }

  return media
}

export function groupMediaByDate<T extends FileManagerMedia>(
  media: T[],
  order: "asc" | "desc" = "desc",
): DateGroup<T>[] {
  const groups = new Map<string, DateGroup<T>>()

  for (const item of media) {
    const d = new Date(item.createdAt)
    const dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
    const existing = groups.get(dateKey)
    if (existing) {
      existing.items.push(item)
    } else {
      groups.set(dateKey, {
        dateLabel: formatDateLabel(item.createdAt),
        timestamp: item.createdAt,
        items: [item],
      })
    }
  }

  const direction = order === "asc" ? 1 : -1
  return Array.from(groups.values())
    .sort((a, b) => direction * (a.timestamp - b.timestamp))
    .map((group) => ({
      ...group,
      items: group.items.sort((a, b) => direction * (a.createdAt - b.createdAt)),
    }))
}

type FileManagerState = {
  activeTab: FileFilterTab
  showFilter: boolean
  resolutionFilter: ReadonlySet<string>
  ratioFilter: ReadonlySet<string>
}

export function StudioFileManager(props: {
  hideFilter?: boolean
  turns?: StudioTurnData[]
  canGenerateVideo?: boolean
  onSelectMedia?: (item: FileManagerMedia) => void
}): JSX.Element {
  const language = useLanguage()
  const [state, setState] = createStore<FileManagerState>({
    activeTab: "all",
    showFilter: false,
    resolutionFilter: new Set<string>(),
    ratioFilter: new Set<string>(),
  })

  // Extract media directly from turns prop (same reactive signal as center column)
  const mediaByDate = createMemo(() => {
    const t = props.turns
    if (!t || t.length === 0) return []
    const allMedia = extractMediaFromTurns(t)
    if (allMedia.length === 0) return []
    return groupMediaByDate(allMedia)
  })

  const [dimsTick, setDimsTick] = createSignal(0)

  createEffect(() => {
    const groups = mediaByDate()
    for (const group of groups) {
      for (const item of group.items) {
        if (item.kind === "image" && EDIT_CAPABILITIES.has(item.capability ?? "")) {
          probeImageDimensions(item.url, () => setDimsTick((tick) => tick + 1))
        }
      }
    }
  })

  const globalEmpty = createMemo(() => mediaByDate().length === 0)

  // 筛选时真正生效的比例：分辨率为视频专属，一旦选中结果只可能是视频，
  // 此时图片专属比例（2:3/3:2）不作为筛选条件；图片 tab 下同理排除 21:9。
  // 全选当前上下文适用的全部比例等价于不筛选：比例无法判定的项只在无比例条件时可见。
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

  // Filter media groups by all active filters
  const filteredGroups = createMemo(() => {
    dimsTick()
    const groups = mediaByDate()
    const resolutionSelected = state.resolutionFilter
    const ratioSelected = effectiveRatios()
    // 勾了分辨率（即使 4 档全选）结果就只可能是视频；全选档位等价于不筛分辨率，
    // 让无法识别档位的老视频也能命中。
    const allResolutionsSelected = RESOLUTION_OPTIONS.every((option) => resolutionSelected.has(option))

    return groups
      .map((group) => ({
        ...group,
        items: group.items.filter((item) => {
          // Tab filter: all / image / video
          if (props.canGenerateVideo) {
            const filter = state.activeTab
            if (filter === "image" && item.kind !== "image") return false
            if (filter === "video" && item.kind !== "video") return false
          }
          // 分辨率为视频专属：选中任一档位即只保留视频，未全选时还要命中具体档位
          if (resolutionSelected.size > 0) {
            if (item.kind !== "video") return false
            if (!allResolutionsSelected && (!item.resolution || !resolutionSelected.has(item.resolution))) return false
          }
          // 比例无法判定（无 aspectRatio 也无尺寸）的项只在无比例条件时可见；
          // 「自定义」档不命中任何具体比例选项。
          if (ratioSelected.length > 0) {
            const label = getMediaRatio(item)
            if (!label || !ratioSelected.includes(label)) return false
          }
          return true
        }),
      }))
      .filter((group) => group.items.length > 0)
  })

  const tabEmpty = createMemo(() => filteredGroups().length === 0)

  const visibleRatioOptions = createMemo(() => {
    if (state.activeTab === "image") return RATIO_OPTIONS.filter((option) => !IMAGE_HIDDEN_RATIOS.has(option.label))
    if (state.activeTab === "video") return RATIO_OPTIONS.filter((option) => !VIDEO_HIDDEN_RATIOS.has(option.label))
    return RATIO_OPTIONS
  })

  // 已选筛选值的展示文案：分辨率在前、比例在后，用「、」连成一行，筛选按钮据此切换为「已筛选：…」。
  const activeFilterLabels = createMemo(() => [
    ...RESOLUTION_OPTIONS.filter((option) => state.resolutionFilter.has(option)),
    ...visibleRatioOptions().filter((option) => state.ratioFilter.has(option.label)).map((option) => option.label),
  ])

  const toggleFilterValue = (key: "resolutionFilter" | "ratioFilter", value: string) => {
    tracker.interaction({ module: "studio", name: "file-manager-filter", extend: JSON.stringify({ filter: key, value }) })
    setState(key, (prev) => {
      const next = new Set(prev)
      if (next.has(value)) next.delete(value)
      else next.add(value)
      return next
    })
  }

  function clearFilters(event: MouseEvent) {
    event.stopPropagation()
    tracker.interaction({ module: "studio", name: "file-manager-filter-clear" })
    setState({ resolutionFilter: new Set<string>(), ratioFilter: new Set<string>() })
  }

  // 切换 tab：清空上一次的筛选，因为分辨率与比例的可见范围随 tab 变化，保留会造成不可见条件。
  function selectTab(tab: FileFilterTab) {
    if (state.activeTab === tab) return
    tracker.interaction({ module: "studio", name: "file-manager-tab", extend: JSON.stringify({ tab }) })
    setState({ activeTab: tab, resolutionFilter: new Set<string>(), ratioFilter: new Set<string>() })
  }

  const emptyText = createMemo(() => {
    const tab = state.activeTab
    if (tab === "image") return language.t("studio.history.empty.image")
    if (tab === "video") return language.t("studio.history.empty.video")
    return language.t("studio.history.empty.file")
  })

  createEffect(() => {
    if (props.hideFilter && state.showFilter) setState("showFilter", false)
  })

  return (
    <div class="studio-file-manager">
      <div class="studio-file-manager-header">
        <Show when={props.canGenerateVideo && !globalEmpty()} fallback={<span />}>
          <div class="studio-file-manager-tabs">
            <For each={FILE_FILTER_TABS}>
              {(tab) => (
                <button
                  type="button"
                  class="studio-file-manager-tab"
                  classList={{ active: state.activeTab === tab.key }}
                  onClick={() => selectTab(tab.key)}
                >
                  {language.t(tab.label)}
                </button>
              )}
            </For>
          </div>
        </Show>
        <Show when={!globalEmpty()}>
          <DropdownMenu gutter={4} placement="bottom" open={state.showFilter} onOpenChange={(open) => setState("showFilter", open)}>
            <DropdownMenu.Trigger
              class="studio-history-filter-trigger"
              classList={{
                "studio-history-filter-trigger--open": state.showFilter,
                "studio-history-filter-trigger--filtered": activeFilterLabels().length > 0,
              }}
            >
              <Show
                when={activeFilterLabels().length > 0}
                fallback={<span>{language.t("studio.history.filter")}</span>}
              >
                <span class="studio-history-filter-active">
                  <span class="studio-history-filter-active-prefix">{language.t("studio.history.filter.active")}</span>{activeFilterLabels().join("、")}
                </span>
                <span
                  class="studio-history-filter-clear"
                  role="button"
                  aria-label={language.t("studio.history.filter.clear")}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={clearFilters}
                />
              </Show>
              <Show when={activeFilterLabels().length === 0}>
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
              </Show>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content class="studio-history-filter-menu studio-history-filter-menu--scrollable">
                <Show when={state.activeTab !== "image" && props.canGenerateVideo}>
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
        </Show>
      </div>
      <ScrollView class="studio-file-manager-body">
        <Show when={!tabEmpty()} fallback={
          <div class="studio-file-manager-empty">
            <img src={emptyPng} style={{ width: "150px", height: "150px", "margin-bottom": "12px" }} alt="" draggable={false} />
            <span class="studio-file-manager-empty-text">{emptyText()}</span>
          </div>
        }>
          <div class="studio-file-manager-content">
            <For each={filteredGroups()}>
              {(group) => (
                <div class="studio-file-manager-date-group">
                  <div class="studio-file-manager-date-title">{group.dateLabel}</div>
                  <div class="studio-file-manager-media-grid">
                    <For each={group.items}>
                      {(item) => (
                        <div
                          class="studio-file-manager-media-item"
                          onClick={() => {
                            tracker.interaction({ module: "studio", name: "file-manager-media-select", extend: JSON.stringify({ id: item.id, kind: item.kind }) })
                            props.onSelectMedia?.(item)
                          }}
                        >
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
          </div>
        </Show>
      </ScrollView>
    </div>
  )
}

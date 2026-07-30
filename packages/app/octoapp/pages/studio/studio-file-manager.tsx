import { batch, createEffect, createMemo, createSignal, For, onCleanup, Show, type JSX } from "solid-js"
import { Portal } from "solid-js/web"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import type { StudioTurnData } from "./turns"
import emptyPng from "../insight/icons/empty.png"

type FileFilterTab = "all" | "image" | "video"

const FILE_FILTER_TABS: { key: FileFilterTab; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "image", label: "图片" },
  { key: "video", label: "视频" },
]

const SOURCE_OPTIONS = ["图片生成", "视频生成", "变清晰", "抠图", "智能重绘", "扩图"]
const RATIO_OPTIONS = ["横版", "竖版", "正方形"]
const SIZE_OPTIONS = [
  { label: "1K", desc: "(长边<2000)" },
  { label: "2K", desc: "(2000≤长边<4000)" },
  { label: "4K", desc: "(长边≥4000)" },
]

export const STUDIO_FILTER_STATE_KEY_PREFIX = "octo:studio:file-manager:filter-state:v2:"

type PersistedFilterSnapshot = { source: string[]; ratio: string[]; size: string[] }

function readFilterState(sessionID: string): { activeTab: FileFilterTab; tabs: Record<string, PersistedFilterSnapshot> } | null {
  try {
    const raw = localStorage.getItem(STUDIO_FILTER_STATE_KEY_PREFIX + sessionID)
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null
    const obj = parsed as Record<string, unknown>
    if (typeof obj.activeTab !== "string" || !obj.tabs || typeof obj.tabs !== "object") return null
    return { activeTab: obj.activeTab as FileFilterTab, tabs: obj.tabs as Record<string, PersistedFilterSnapshot> }
  } catch {
    return null
  }
}

function writeFilterState(sessionID: string, state: { activeTab: FileFilterTab; tabs: Record<string, PersistedFilterSnapshot> }) {
  try {
    localStorage.setItem(STUDIO_FILTER_STATE_KEY_PREFIX + sessionID, JSON.stringify(state))
  } catch { /* noop */ }
}

const SOURCE_TO_CAPABILITY: Record<string, string> = {
  "图片生成": "image.generate",
  "视频生成": "video.generate",
  "变清晰": "image.upscale",
  "抠图": "image.cutout",
  "智能重绘": "image.inpaint",
  "扩图": "image.outpaint",
}

function getRatioCategory(item: FileManagerMedia): string | null {
  // 自定义尺寸直接用实际宽高判断，避免 aspectRatio 仍是默认值导致误判
  if (item.isCustom) {
    const w = item.width
    const h = item.height
    if (w && h) {
      const maxDim = Math.max(w, h)
      if (Math.abs(w - h) / maxDim <= 0.01) return "正方形"
      if (w > h) return "横版"
      if (h > w) return "竖版"
    }
    return null
  }
  // 非自定义优先用 aspectRatio 字段，避免编辑后的微小像素偏差导致误判
  const ratio = item.aspectRatio
  if (ratio) {
    if (ratio === "1:1") return "正方形"
    if (["16:9", "3:2", "4:3"].includes(ratio)) return "横版"
    if (["2:3", "3:4", "9:16"].includes(ratio)) return "竖版"
  }
  const w = item.width
  const h = item.height
  if (w && h) {
    const maxDim = Math.max(w, h)
    if (Math.abs(w - h) / maxDim <= 0.01) return "正方形"
    if (w > h) return "横版"
    if (h > w) return "竖版"
  }
  return null
}

function getSizeCategory(item: FileManagerMedia): string | null {
  const w = item.width
  const h = item.height
  if (w && h) {
    const longSide = Math.max(w, h)
    if (longSide < 2000) return "1K"
    if (longSide < 4000) return "2K"
    return "4K"
  }
  // 无直接尺寸时，用比例反推估算长边
  if (item.aspectRatio && item.kind === "image") {
    const estimated = estimateLongSideFromRatio(item.aspectRatio)
    if (estimated) {
      if (estimated < 2000) return "1K"
      if (estimated < 4000) return "2K"
      return "4K"
    }
  }
  return null
}

function estimateLongSideFromRatio(aspectRatio: string): number | null {
  const parts = aspectRatio.split(":").map(Number)
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null
  const [w, h] = parts
  // 以短边 1024 为基准估算长边
  const ratio = Math.max(w, h) / Math.min(w, h)
  return Math.round(1024 * ratio)
}

type FileManagerMedia = {
  id: string
  turnID: string
  url: string
  thumbnailUrl: string
  kind: "image" | "video"
  width?: number
  height?: number
  aspectRatio?: string
  isCustom?: boolean
  capability?: string
  duration?: string
  createdAt: number
}

type DateGroup = {
  dateLabel: string
  timestamp: number
  items: FileManagerMedia[]
}

function createCheckboxState(labels: string[]) {
  const [state, setState] = createSignal<Set<string>>(new Set<string>())
  const toggle = (label: string) => {
    setState((prev) => {
      const next = new Set(prev)
      if (next.has(label)) next.delete(label)
      else next.add(label)
      return next
    })
  }
  const reset = () => setState(new Set<string>())
  return { state, toggle, reset }
}

function formatDateLabel(timestamp: number): string {
  const d = new Date(timestamp)
  return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`
}

function extractMediaFromTurns(turns: StudioTurnData[]): FileManagerMedia[] {
  const media: FileManagerMedia[] = []

  for (const turn of turns) {
    const images = turn.result?.images
    if (!images || images.length === 0) continue

    for (const image of images) {
      const url = image.url
      if (!url) continue

      // For edit results (inpaint/outpaint/cutout/upscale), the result-level
      // aspectRatio may not reflect the actual output image dimensions. Prefer
      // image-level width/height for ratio detection by marking as isCustom.
      const isEditResult = turn.result?.capability
        ? ["image.upscale", "image.cutout", "image.inpaint", "image.outpaint"].includes(turn.result.capability)
        : false
      const itemWidth = image.width ?? turn.result?.width
      const itemHeight = image.height ?? turn.result?.height
      const hasExplicitDimensions = itemWidth && itemHeight && isEditResult

      media.push({
        id: image.id,
        turnID: turn.id,
        url,
        thumbnailUrl: image.thumbnailUrl ?? url,
        kind: image.kind === "video" ? "video" : "image",
        width: itemWidth,
        height: itemHeight,
        // 保留 result 级别的 aspectRatio（如智能重绘探测到的源图比例），
        // getRatioCategory 中 aspectRatio 优先于像素尺寸判断，避免被 API
        // 返回的默认输出尺寸（可能非 1:1）误判为竖版。
        aspectRatio: turn.result?.aspectRatio,
        isCustom: hasExplicitDimensions || turn.result?.isCustom,
        capability: turn.result?.capability ?? turn.editCapability,
        duration: turn.result?.duration,
        createdAt: turn.createdAt,
      })
    }
  }

  return media
}

function groupMediaByDate(media: FileManagerMedia[]): DateGroup[] {
  const groups = new Map<string, DateGroup>()

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

  return Array.from(groups.values())
    .sort((a, b) => b.timestamp - a.timestamp)
    .map((group) => ({
      ...group,
      items: group.items.sort((a, b) => b.createdAt - a.createdAt),
    }))
}

export function StudioFileManager(props: {
  onClose?: () => void
  studioCenterWidth?: number
  showStudioCenter?: boolean
  hideFilter?: boolean
  turns?: StudioTurnData[]
  canGenerateVideo?: boolean
  onSelectMedia?: (item: FileManagerMedia) => void
  sessionID?: string
}): JSX.Element {
  const [activeFilter, setActiveFilter] = createSignal<FileFilterTab>("all")
  const [showFilter, setShowFilter] = createSignal(false)
  const [overlayStyle, setOverlayStyle] = createSignal<JSX.CSSProperties>({})
  let containerRef!: HTMLDivElement

  const sourceFilter = createCheckboxState(SOURCE_OPTIONS)
  const ratioFilter = createCheckboxState(RATIO_OPTIONS)
  const sizeFilter = createCheckboxState(SIZE_OPTIONS.map((s) => s.label))

  // Confirmed filter state — only updated when user clicks "确定"
  const [confirmedSource, setConfirmedSource] = createSignal<Set<string>>(new Set<string>())
  const [confirmedRatio, setConfirmedRatio] = createSignal<Set<string>>(new Set<string>())
  const [confirmedSize, setConfirmedSize] = createSignal<Set<string>>(new Set<string>())

  // 每个 tab 保留独立的筛选记录（同一 session 内有效，且持久化到 localStorage）
  type SavedFilterSnapshot = { source: Set<string>; ratio: Set<string>; size: Set<string> }
  const savedTabFilters = new Map<FileFilterTab, SavedFilterSnapshot>()
  let lastSessionID: string | undefined

  // 初始化：从 localStorage 恢复当前 session 的筛选状态
  {
    const sid = props.sessionID
    if (sid) {
      lastSessionID = sid
      const saved = readFilterState(sid)
      if (saved) {
        setActiveFilter(saved.activeTab)
        for (const [tabKey, snap] of Object.entries(saved.tabs)) {
          savedTabFilters.set(tabKey as FileFilterTab, {
            source: new Set<string>(snap.source),
            ratio: new Set<string>(snap.ratio),
            size: new Set<string>(snap.size),
          })
        }
        const active = savedTabFilters.get(saved.activeTab)
        if (active) {
          batch(() => {
            setConfirmedSource(new Set(active.source))
            setConfirmedRatio(new Set(active.ratio))
            setConfirmedSize(new Set(active.size))
            for (const v of active.source) sourceFilter.toggle(v)
            for (const v of active.ratio) ratioFilter.toggle(v)
            for (const v of active.size) sizeFilter.toggle(v)
          })
        }
      }
    }
  }

  function persistCurrentState() {
    const sid = props.sessionID
    if (!sid) return
    const tabs: Record<string, PersistedFilterSnapshot> = {}
    for (const [tabKey, snap] of savedTabFilters) {
      tabs[tabKey] = {
        source: Array.from(snap.source),
        ratio: Array.from(snap.ratio),
        size: Array.from(snap.size),
      }
    }
    writeFilterState(sid, { activeTab: activeFilter(), tabs })
  }

  createEffect(() => {
    const sid = props.sessionID
    if (sid !== lastSessionID) {
      // 清理旧 session 的持久化筛选记录
      if (lastSessionID) {
        try { localStorage.removeItem(STUDIO_FILTER_STATE_KEY_PREFIX + lastSessionID) } catch { /* noop */ }
      }
      lastSessionID = sid
      // 切换 session → 清空所有 tab 的筛选记录（新 session 从头开始）
      savedTabFilters.clear()
      setActiveFilter("all")
      batch(() => {
        sourceFilter.reset()
        ratioFilter.reset()
        sizeFilter.reset()
        setConfirmedSource(new Set<string>())
        setConfirmedRatio(new Set<string>())
        setConfirmedSize(new Set<string>())
      })
    }
  })

  function saveCurrentTabFilters() {
    savedTabFilters.set(activeFilter(), {
      source: new Set<string>(confirmedSource()),
      ratio: new Set<string>(confirmedRatio()),
      size: new Set<string>(confirmedSize()),
    })
  }

  function loadTabFilters(tab: FileFilterTab) {
    const saved = savedTabFilters.get(tab)
    const source = saved?.source ?? new Set<string>()
    const ratio = saved?.ratio ?? new Set<string>()
    const size = saved?.size ?? new Set<string>()
    batch(() => {
      setConfirmedSource(source)
      setConfirmedRatio(ratio)
      setConfirmedSize(size)
      sourceFilter.reset()
      ratioFilter.reset()
      sizeFilter.reset()
      for (const v of source) sourceFilter.toggle(v)
      for (const v of ratio) ratioFilter.toggle(v)
      for (const v of size) sizeFilter.toggle(v)
    })
  }

  function switchTab(tab: FileFilterTab) {
    if (tab === activeFilter()) return
    saveCurrentTabFilters()
    setActiveFilter(tab)
    loadTabFilters(tab)
    persistCurrentState()
  }

  function syncLiveFromConfirmed() {
    batch(() => {
      sourceFilter.reset()
      ratioFilter.reset()
      sizeFilter.reset()
      for (const v of confirmedSource()) sourceFilter.toggle(v)
      for (const v of confirmedRatio()) ratioFilter.toggle(v)
      for (const v of confirmedSize()) sizeFilter.toggle(v)
    })
  }

  function applyAndCloseFilter() {
    const source = new Set<string>(sourceFilter.state())
    const ratio = new Set<string>(ratioFilter.state())
    const size = new Set<string>(sizeFilter.state())
    batch(() => {
      setConfirmedSource(source)
      setConfirmedRatio(ratio)
      setConfirmedSize(size)
    })
    savedTabFilters.set(activeFilter(), { source, ratio, size })
    persistCurrentState()
    setShowFilter(false)
  }

  function handleConfirm() {
    applyAndCloseFilter()
  }

  // Extract media directly from turns prop (same reactive signal as center column)
  const mediaByDate = createMemo(() => {
    const t = props.turns
    if (!t || t.length === 0) return []
    const allMedia = extractMediaFromTurns(t)
    if (allMedia.length === 0) return []
    return groupMediaByDate(allMedia)
  })

  const globalEmpty = createMemo(() => mediaByDate().length === 0)

  // Filter media groups by all active filters
  const filteredGroups = createMemo(() => {
    const groups = mediaByDate()

    const sourceSelected = confirmedSource()
    const ratioSelected = confirmedRatio()
    const sizeSelected = confirmedSize()
    const hasSourceFilter = sourceSelected.size > 0
    const hasRatioFilter = ratioSelected.size > 0
    const hasSizeFilter = sizeSelected.size > 0

    return groups
      .map((group) => ({
        ...group,
        items: group.items.filter((item) => {
          // Tab filter: all / image / video
          if (props.canGenerateVideo) {
            const filter = activeFilter()
            if (filter === "image" && item.kind !== "image") return false
            if (filter === "video" && item.kind !== "video") return false
          }
          // Source filter
          if (hasSourceFilter) {
            const cap = item.capability ?? ""
            // 直接匹配中文标签，或通过 SOURCE_TO_CAPABILITY 反查
            const matched = sourceSelected.has(cap) ||
              SOURCE_OPTIONS.some((opt) => SOURCE_TO_CAPABILITY[opt] === cap && sourceSelected.has(opt))
            if (!matched) return false
          }
          // Ratio filter
          if (hasRatioFilter) {
            const cat = getRatioCategory(item)
            if (!cat || !ratioSelected.has(cat)) return false
          }
          // Size filter（仅对图片生效，视频直接放行）
          if (hasSizeFilter && item.kind === "image") {
            const cat = getSizeCategory(item)
            if (!cat || !sizeSelected.has(cat)) return false
          }
          return true
        }),
      }))
      .filter((group) => group.items.length > 0)
  })

  const tabEmpty = createMemo(() => filteredGroups().length === 0)

  const emptyText = createMemo(() => {
    if (globalEmpty()) return "暂无相关文件"
    const filter = activeFilter()
    if (filter === "image") return "暂无相关图片"
    if (filter === "video") return "暂无相关视频"
    return "暂无相关文件"
  })

  function handleReset() {
    batch(() => {
      sourceFilter.reset()
      ratioFilter.reset()
      sizeFilter.reset()
    })
  }

  function updateOverlayStyle() {
    if (!containerRef || !showFilter()) return
    const rect = containerRef.getBoundingClientRect()
    if (props.showStudioCenter) {
      const centerWidth = props.studioCenterWidth ?? 468
      setOverlayStyle({
        position: "fixed",
        top: `${rect.top}px`,
        left: `${rect.left - centerWidth}px`,
        width: `${rect.width + centerWidth}px`,
        height: `${rect.height}px`,
      })
    } else {
      setOverlayStyle({
        position: "fixed",
        top: `${rect.top}px`,
        left: `${rect.left}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
      })
    }
  }

  createEffect(() => {
    if (props.hideFilter && showFilter()) setShowFilter(false)
  })

  createEffect(() => {
    if (!showFilter() || !containerRef) return
    updateOverlayStyle()
    const ro = new ResizeObserver(() => updateOverlayStyle())
    ro.observe(containerRef)
    window.addEventListener("resize", updateOverlayStyle)
    onCleanup(() => {
      ro.disconnect()
      window.removeEventListener("resize", updateOverlayStyle)
    })
  })

  return (
    <div
      ref={containerRef}
      class="studio-file-manager"
    >
      <div class="studio-file-manager-header">
        <Show when={props.canGenerateVideo && !globalEmpty()} fallback={<span />}>
          <div class="studio-file-manager-tabs">
            <For each={FILE_FILTER_TABS}>
              {(tab) => (
                <button
                  type="button"
                  class="studio-file-manager-tab"
                  classList={{ active: activeFilter() === tab.key }}
                  onClick={() => switchTab(tab.key)}
                >
                  {tab.label}
                </button>
              )}
            </For>
          </div>
        </Show>
        <Show when={!globalEmpty()}>
          <div
            class="studio-file-manager-filter"
            classList={{ active: showFilter() }}
            onClick={() => {
              if (!showFilter()) syncLiveFromConfirmed()
              setShowFilter((v) => !v)
            }}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" style={{ "margin-right": "4px", "flex-shrink": "0" }}>
              <path d="M3.5 2.5H12.5A1 1 0 0 1 13.5 3.5L9.5 7V10L7 13.5A1 1 0 0 1 6.5 12.5V7L2.5 3.5A1 1 0 0 1 3.5 2.5Z" stroke="currentColor" stroke-width="1" fill="none" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
            <span class="studio-file-manager-filter-text">筛选</span>
          </div>
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
                          onClick={() => props.onSelectMedia?.(item)}
                        >
                          <Show when={item.kind === "video"} fallback={
                            <img
                              src={item.thumbnailUrl}
                              alt=""
                              class="studio-file-manager-media-image"
                              loading="lazy"
                              onError={(e) => {
                                const el = e.currentTarget as HTMLImageElement
                                el.style.display = "none"
                              }}
                            />
                          }>
                            <div class="studio-file-manager-media-video-wrapper">
                              <video
                                src={item.url}
                                muted
                                playsinline
                                preload="metadata"
                                class="studio-file-manager-media-image"
                                onError={(e) => {
                                  const el = e.currentTarget as HTMLVideoElement
                                  el.style.display = "none"
                                }}
                              />
                              <span class="studio-file-manager-media-video-badge">
                                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                                  <rect x="0.5" y="2.5" width="9" height="9" rx="1.5" stroke="white" stroke-width="1" fill="none" />
                                  <path d="M13 4.5L13 9.5Q13 10.5 12.5 10.4L10 8.5L10 5.5L12.5 3.6Q13 3.5 13 4.5Z" stroke="white" stroke-width="1" fill="none" stroke-linejoin="round" />
                                </svg>
                                <Show when={item.duration}>
                                  <span class="studio-file-manager-media-video-badge-text">{item.duration}s</span>
                                </Show>
                              </span>
                            </div>
                          </Show>
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
      <Show when={showFilter()}>
        <Portal>
          <div class="studio-filter-overlay" style={overlayStyle()} onClick={applyAndCloseFilter}>
            <div class="studio-filter-dialog" onClick={(e) => e.stopPropagation()}>
              <div class="studio-filter-dialog-header">
                <span class="studio-filter-dialog-title">筛选</span>
                <button type="button" class="studio-filter-dialog-close" onClick={applyAndCloseFilter}>
                  <svg width="12.14" height="12.14" viewBox="0 0 12.14 12.14" fill="none">
                    <path d="M1 1L11.14 11.14" stroke="currentColor" stroke-width="1" stroke-linecap="round" />
                    <path d="M11.14 1L1 11.14" stroke="currentColor" stroke-width="1" stroke-linecap="round" />
                  </svg>
                </button>
              </div>
              <div class="studio-filter-dialog-body">
                <Show when={activeFilter() !== "video"}>
                  <div class="studio-filter-section">
                    <div class="studio-filter-section-title">来源</div>
                    <div class="studio-filter-section-options">
                      <For each={SOURCE_OPTIONS}>
                        {(label) => {
                          const isVideoSource = label === "视频生成"
                          const shouldHide =
                            (!props.canGenerateVideo && isVideoSource) ||
                            (activeFilter() === "image" && isVideoSource)
                          if (shouldHide) return null
                          return (
                          <label class="studio-filter-checkbox">
                            <input type="checkbox" checked={sourceFilter.state().has(label)} onChange={() => sourceFilter.toggle(label)} />
                            <span class="studio-filter-checkbox-label">{label}</span>
                          </label>
                          )
                        }}
                      </For>
                    </div>
                  </div>
                </Show>
                <div class="studio-filter-section">
                  <div class="studio-filter-section-title">比例</div>
                  <div class="studio-filter-section-options">
                    <For each={RATIO_OPTIONS}>
                      {(label) => (
                        <label class="studio-filter-checkbox">
                          <input type="checkbox" checked={ratioFilter.state().has(label)} onChange={() => ratioFilter.toggle(label)} />
                          <span class="studio-filter-checkbox-label">{label}</span>
                        </label>
                      )}
                    </For>
                  </div>
                </div>
                <Show when={activeFilter() !== "video"}>
                  <div class="studio-filter-section">
                    <div class="studio-filter-section-title">尺寸</div>
                    <div class="studio-filter-section-options">
                      <For each={SIZE_OPTIONS}>
                        {(item) => (
                        <label class="studio-filter-checkbox">
                          <input type="checkbox" checked={sizeFilter.state().has(item.label)} onChange={() => sizeFilter.toggle(item.label)} />
                          <span class="studio-filter-checkbox-label">{item.label}</span>
                          <span class="studio-filter-checkbox-desc">{item.desc}</span>
                        </label>
                        )}
                      </For>
                    </div>
                  </div>
                </Show>
              </div>
              <div class="studio-filter-dialog-footer">
                <button type="button" class="studio-filter-btn studio-filter-btn-reset" onClick={handleReset}>重置</button>
                <button type="button" class="studio-filter-btn studio-filter-btn-confirm" onClick={handleConfirm}>确定</button>
              </div>
            </div>
          </div>
        </Portal>
      </Show>
    </div>
  )
}

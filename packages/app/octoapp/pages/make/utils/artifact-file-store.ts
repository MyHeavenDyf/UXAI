import { createStore, reconcile } from "solid-js/store"
import { createMemo, createSignal, createEffect, on } from "solid-js"
import type { ArtifactFile, ArtifactFileKind } from "./artifact-file-api"
import { kindSortPriority } from "./artifact-file-api"

export type GroupMode = "kind" | "modified"
export type ModifiedSection = "today" | "yesterday" | "previous7Days" | "previous30Days" | "older"
export type SortKey = "name" | "kind" | "mtime"
export type SortDir = "asc" | "desc"
export { type ArtifactFile, type ArtifactFileKind, kindSortPriority }

const VIEW_STATE_KEY_PREFIX = "octo:make:design-files:view-state:v1:"
const DEFAULT_SORT_KEY: SortKey = "mtime"
const DEFAULT_SORT_DIR: SortDir = "desc"
const DEFAULT_PAGE_SIZE: number | "all" = 30
const PAGE_SIZE_OPTIONS = [15, 30, 45, 60, "all"] as const

interface PersistedViewState {
  sortKey?: SortKey
  sortDir?: SortDir
  pageSize?: number | "all"
  kindFilter?: ArtifactFileKind[]
  groupMode?: GroupMode
}

function readViewState(sessionId: string): PersistedViewState {
  try {
    const raw = localStorage.getItem(VIEW_STATE_KEY_PREFIX + sessionId)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {}
    return parsed as PersistedViewState
  } catch {
    return {}
  }
}

function writeViewState(sessionId: string, state: PersistedViewState): void {
  try {
    localStorage.setItem(VIEW_STATE_KEY_PREFIX + sessionId, JSON.stringify(state))
  } catch {}
}

function dateDaysBefore(date: Date, days: number): Date {
  const result = new Date(date)
  result.setDate(result.getDate() - days)
  return result
}

function modifiedSectionThresholds(now: number) {
  const startOfToday = new Date(now)
  startOfToday.setHours(0, 0, 0, 0)
  return {
    todayStart: startOfToday.getTime(),
    yesterdayStart: dateDaysBefore(startOfToday, 1).getTime(),
    previous7DaysStart: dateDaysBefore(startOfToday, 7).getTime(),
    previous30DaysStart: dateDaysBefore(startOfToday, 30).getTime(),
  }
}

export function modifiedSectionFor(mtime: number, thresholds: ReturnType<typeof modifiedSectionThresholds>): ModifiedSection {
  if (mtime >= thresholds.todayStart) return "today"
  if (mtime >= thresholds.yesterdayStart) return "yesterday"
  if (mtime >= thresholds.previous7DaysStart) return "previous7Days"
  if (mtime >= thresholds.previous30DaysStart) return "previous30Days"
  return "older"
}

const MODIFIED_SECTION_ORDER: ModifiedSection[] = ["today", "yesterday", "previous7Days", "previous30Days", "older"]

export const MODIFIED_SECTION_LABELS: Record<ModifiedSection, string> = {
  today: "Today",
  yesterday: "Yesterday",
  previous7Days: "Previous 7 Days",
  previous30Days: "Previous 30 Days",
  older: "Older",
}

export type ArtifactFileStore = {
  files: ArtifactFile[]
  loading: boolean
  error: string | null
  selected: Set<string>
  sortKey: SortKey
  sortDir: SortDir
  pageSize: number | "all"
  page: number
  groupMode: GroupMode
  kindFilter: Set<ArtifactFileKind>
  collapsedSections: Set<string>
  previewFile: ArtifactFile | null
  viewMode: "tabs" | "files"
}

export function createArtifactFileStore(sessionId: string) {
  const savedViewState = readViewState(sessionId)

  const [store, setStore] = createStore<ArtifactFileStore>({
    files: [],
    loading: false,
    error: null,
    selected: new Set(),
    sortKey: savedViewState.sortKey ?? DEFAULT_SORT_KEY,
    sortDir: savedViewState.sortDir ?? DEFAULT_SORT_DIR,
    pageSize: savedViewState.pageSize ?? DEFAULT_PAGE_SIZE,
    page: 0,
    groupMode: savedViewState.groupMode ?? "kind",
    kindFilter: new Set(savedViewState.kindFilter ?? []),
    collapsedSections: new Set(),
    previewFile: null,
    viewMode: "tabs",
  })

  const [dayBoundary, setDayBoundary] = createSignal(Date.now())

  createEffect(() => {
    const now = Date.now()
    const startOfTomorrow = new Date(now)
    startOfTomorrow.setHours(24, 0, 0, 0)
    const timer = setTimeout(() => setDayBoundary(Date.now()), Math.max(1, startOfTomorrow.getTime() - now))
    return () => clearTimeout(timer)
  })

  const kindCounts = createMemo(() => {
    const counts = new Map<ArtifactFileKind, number>()
    for (const file of store.files) {
      counts.set(file.kind, (counts.get(file.kind) ?? 0) + 1)
    }
    return counts
  })

  const availableKinds = createMemo(() =>
    Array.from(kindCounts().keys()).sort((a, b) => kindSortPriority(a) - kindSortPriority(b)),
  )

  const filteredFiles = createMemo(() => {
    if (store.kindFilter.size === 0) return store.files
    return store.files.filter((f) => store.kindFilter.has(f.kind))
  })

  const sortedFiles = createMemo(() => {
    return [...filteredFiles()].sort((a, b) => {
      let cmp: number
      if (store.sortKey === "name") cmp = a.name.localeCompare(b.name)
      else if (store.sortKey === "kind") cmp = kindSortPriority(a.kind) - kindSortPriority(b.kind)
      else cmp = a.mtime - b.mtime
      return store.sortDir === "asc" ? cmp : -cmp
    })
  })

  const effectivePageSize = createMemo(() =>
    store.pageSize === "all" ? Math.max(1, sortedFiles().length) : store.pageSize,
  )

  const totalPages = createMemo(() =>
    Math.max(1, Math.ceil(sortedFiles().length / effectivePageSize())),
  )

  const safePage = createMemo(() => Math.min(store.page, totalPages() - 1))

  const pageFiles = createMemo(() =>
    sortedFiles().slice(safePage() * effectivePageSize(), (safePage() + 1) * effectivePageSize()),
  )

  const kindGroups = createMemo(() => {
    const groups = new Map<ArtifactFileKind, ArtifactFile[]>()
    for (const file of pageFiles()) {
      const next = groups.get(file.kind) ?? []
      next.push(file)
      groups.set(file.kind, next)
    }
    return groups
  })

  const modifiedGroups = createMemo(() => {
    const groups: Record<ModifiedSection, ArtifactFile[]> = {
      today: [],
      yesterday: [],
      previous7Days: [],
      previous30Days: [],
      older: [],
    }
    const thresholds = modifiedSectionThresholds(dayBoundary())
    for (const file of pageFiles()) {
      groups[modifiedSectionFor(file.mtime, thresholds)].push(file)
    }
    return groups
  })

  const visibleModifiedSections = createMemo(() =>
    MODIFIED_SECTION_ORDER.filter((section) => modifiedGroups()[section].length > 0),
  )

  const rangeStart = createMemo(() => safePage() * effectivePageSize() + 1)
  const rangeEnd = createMemo(() => Math.min((safePage() + 1) * effectivePageSize(), sortedFiles().length))

  const allPageSelected = createMemo(() =>
    pageFiles().length > 0 && pageFiles().every((f) => store.selected.has(f.path)),
  )

  const somePageSelected = createMemo(() =>
    !allPageSelected() && pageFiles().some((f) => store.selected.has(f.path)),
  )

  createEffect(on(
    () => store.pageSize,
    () => setStore("page", 0),
  ))

  createEffect(on(
    () => store.kindFilter,
    () => setStore("page", 0),
  ))

  createEffect(on(
    [() => store.sortKey, () => store.sortDir, () => store.pageSize, () => store.kindFilter, () => store.groupMode],
    () => {
      writeViewState(sessionId, {
        sortKey: store.sortKey,
        sortDir: store.sortDir,
        pageSize: store.pageSize,
        kindFilter: Array.from(store.kindFilter),
        groupMode: store.groupMode,
      })
    },
  ))

  return {
    store,
    setStore,
    kindCounts,
    availableKinds,
    filteredFiles,
    sortedFiles,
    pageFiles,
    kindGroups,
    modifiedGroups,
    visibleModifiedSections,
    totalPages,
    safePage,
    rangeStart,
    rangeEnd,
    allPageSelected,
    somePageSelected,
    dayBoundary,

    setFiles(files: ArtifactFile[]) {
      setStore("files", reconcile(files))
    },

    setLoading(loading: boolean) {
      setStore("loading", loading)
    },

    setError(error: string | null) {
      setStore("error", error)
    },

    setSortKey(key: SortKey) {
      setStore("sortKey", key)
    },

    setSortDir(dir: SortDir) {
      setStore("sortDir", dir)
    },

    setPageSize(size: number | "all") {
      setStore("pageSize", size)
    },

    setPage(page: number) {
      setStore("page", Math.max(0, Math.min(page, totalPages() - 1)))
    },

    setGroupMode(mode: GroupMode) {
      setStore("groupMode", mode)
    },

    toggleKindFilter(kind: ArtifactFileKind) {
      const next = new Set(store.kindFilter)
      if (next.has(kind)) next.delete(kind)
      else next.add(kind)
      setStore("kindFilter", next)
    },

    clearKindFilter() {
      setStore("kindFilter", new Set())
    },

    toggleSection(section: string) {
      const next = new Set(store.collapsedSections)
      if (next.has(section)) next.delete(section)
      else next.add(section)
      setStore("collapsedSections", next)
    },

    selectFile(path: string) {
      const next = new Set(store.selected)
      next.add(path)
      setStore("selected", next)
    },

    deselectFile(path: string) {
      const next = new Set(store.selected)
      next.delete(path)
      setStore("selected", next)
    },

    toggleFileSelection(path: string) {
      const next = new Set(store.selected)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      setStore("selected", next)
    },

    selectAllPage() {
      const next = new Set(store.selected)
      for (const file of pageFiles()) next.add(file.path)
      setStore("selected", next)
    },

    clearSelection() {
      setStore("selected", new Set())
    },

    setPreviewFile(file: ArtifactFile | null) {
      setStore("previewFile", file)
    },

    setViewMode(mode: "tabs" | "files") {
      setStore("viewMode", mode)
    },

    deleteFile(path: string) {
      setStore("files", store.files.filter((f) => f.path !== path))
      const nextSelected = new Set(store.selected)
      nextSelected.delete(path)
      setStore("selected", nextSelected)
      if (store.previewFile?.path === path) {
        setStore("previewFile", null)
      }
    },
  }
}
import { createStore } from "solid-js/store"
import { createMemo, createSignal, createEffect, on } from "solid-js"
import type { ArtifactFile, ArtifactFileKind } from "./artifact-file-api"
import { kindSortPriority } from "./artifact-file-api"

export type GroupMode = "kind" | "modified"
export type ModifiedSection = "today" | "yesterday" | "previous7Days" | "previous30Days" | "older"
export type SortKey = "name" | "kind" | "mtime"
export type SortDir = "asc" | "desc"
export { type ArtifactFile, type ArtifactFileKind, kindSortPriority }

const VIEW_STATE_KEY_PREFIX = "octo:make:design-files:view-state:v3:"
const DEFAULT_SORT_KEY: SortKey = "mtime"
const DEFAULT_SORT_DIR: SortDir = "desc"

interface PersistedViewState {
  sortKey?: SortKey
  sortDir?: SortDir
  kindFilter?: ArtifactFileKind[]
  groupMode?: GroupMode
  collapsedGenerated?: boolean
  collapsedUploaded?: boolean
  collapsedSections?: string[]
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
  currentPath: string
  generatedFiles: ArtifactFile[]
  uploadedFiles: ArtifactFile[]
  collapsedGenerated: boolean
  collapsedUploaded: boolean
  collapsedSections: Set<string>
  selected: Set<string>
  sortKey: SortKey
  sortDir: SortDir
  kindFilter: Set<ArtifactFileKind>
  groupMode: GroupMode
  loading: boolean
  error: string | null
}

function createFileListComputed(
  files: () => ArtifactFile[],
  sortKey: () => SortKey,
  sortDir: () => SortDir,
  kindFilter: () => Set<ArtifactFileKind>,
  groupMode: () => GroupMode,
  collapsedSections: () => Set<string>,
  sectionPrefix: string,
  dayBoundary: () => number,
) {
  const filesMemo = createMemo(files)

  const kindCounts = createMemo(() => {
    const counts = new Map<ArtifactFileKind, number>()
    for (const file of filesMemo()) {
      counts.set(file.kind, (counts.get(file.kind) ?? 0) + 1)
    }
    return counts
  })

  const availableKinds = createMemo(() =>
    Array.from(kindCounts().keys()).sort((a, b) => kindSortPriority(a) - kindSortPriority(b)),
  )

  const filteredFiles = createMemo(() => {
    const filter = kindFilter()
    const allFiles = filesMemo()
    if (filter.size === 0) return [...allFiles]
    return allFiles.filter((f) => filter.has(f.kind))
  })

  const sortedFiles = createMemo(() => {
    const key = sortKey()
    const dir = sortDir()
    return [...filteredFiles()].sort((a, b) => {
      let cmp: number
      if (key === "name") cmp = a.name.localeCompare(b.name)
      else if (key === "kind") cmp = kindSortPriority(a.kind) - kindSortPriority(b.kind)
      else cmp = a.mtime - b.mtime
      return dir === "asc" ? cmp : -cmp
    })
  })

  const kindGroups = createMemo(() => {
    const sorted = sortedFiles()
    const groups = new Map<ArtifactFileKind, ArtifactFile[]>()
    if (groupMode() !== "kind") return groups
    for (const file of sorted) {
      const existing = groups.get(file.kind) ?? []
      groups.set(file.kind, [...existing, file])
    }
    return groups
  })

  const modifiedGroups = createMemo(() => {
    const sorted = sortedFiles()
    const groups: Record<ModifiedSection, ArtifactFile[]> = {
      today: [],
      yesterday: [],
      previous7Days: [],
      previous30Days: [],
      older: [],
    }
    if (groupMode() !== "modified") return groups
    const thresholds = modifiedSectionThresholds(dayBoundary())
    for (const file of sorted) {
      const section = modifiedSectionFor(file.mtime, thresholds)
      groups[section] = [...groups[section], file]
    }
    return groups
  })

  const visibleModifiedSections = createMemo(() => {
    const dir = sortDir()
    const groups = modifiedGroups()
    const sections = MODIFIED_SECTION_ORDER.filter((section) => groups[section].length > 0)
    return dir === "asc" ? [...sections].reverse() : sections
  })

  const kindGroupEntries = createMemo(() =>
    Array.from(kindGroups().entries())
      .sort(([a], [b]) => kindSortPriority(a) - kindSortPriority(b)),
  )

  return {
    kindCounts,
    availableKinds,
    filteredFiles,
    sortedFiles,
    kindGroups,
    kindGroupEntries,
    modifiedGroups,
    visibleModifiedSections,
  }
}

export function createArtifactFileStore(sessionId: string) {
  const savedViewState = readViewState(sessionId)

  const [previewFile, setPreviewFile] = createSignal<ArtifactFile | null>(null)

  const [store, setStore] = createStore<ArtifactFileStore>({
    currentPath: "",
    generatedFiles: [],
    uploadedFiles: [],
    collapsedGenerated: savedViewState.collapsedGenerated ?? false,
    collapsedUploaded: savedViewState.collapsedUploaded ?? false,
    collapsedSections: new Set(savedViewState.collapsedSections ?? []),
    selected: new Set(),
    sortKey: savedViewState.sortKey ?? DEFAULT_SORT_KEY,
    sortDir: savedViewState.sortDir ?? DEFAULT_SORT_DIR,
    kindFilter: new Set(savedViewState.kindFilter ?? []),
    groupMode: savedViewState.groupMode ?? "kind",
    loading: false,
    error: null,
  })

  const [dayBoundary, setDayBoundary] = createSignal(Date.now())

  createEffect(() => {
    const now = Date.now()
    const startOfTomorrow = new Date(now)
    startOfTomorrow.setHours(24, 0, 0, 0)
    const timer = setTimeout(() => setDayBoundary(Date.now()), Math.max(1, startOfTomorrow.getTime() - now))
    return () => clearTimeout(timer)
  })

  const generatedComputed = createFileListComputed(
    () => store.generatedFiles,
    () => store.sortKey,
    () => store.sortDir,
    () => store.kindFilter,
    () => store.groupMode,
    () => store.collapsedSections,
    "generated",
    dayBoundary,
  )

  const uploadedComputed = createFileListComputed(
    () => store.uploadedFiles,
    () => store.sortKey,
    () => store.sortDir,
    () => store.kindFilter,
    () => store.groupMode,
    () => store.collapsedSections,
    "uploaded",
    dayBoundary,
  )

  const isTopLevel = createMemo(() => store.currentPath === "")

  createEffect(on(
    () => store.kindFilter,
    () => setStore("selected", new Set()),
  ))

  createEffect(on(
    () => store.currentPath,
    () => {
      setStore("selected", new Set())
      setPreviewFile(null)
    },
  ))

  createEffect(on(
    [
      () => store.sortKey,
      () => store.sortDir,
      () => store.kindFilter,
      () => store.groupMode,
      () => store.collapsedGenerated,
      () => store.collapsedUploaded,
      () => store.collapsedSections,
    ],
    () => {
      writeViewState(sessionId, {
        sortKey: store.sortKey,
        sortDir: store.sortDir,
        kindFilter: Array.from(store.kindFilter),
        groupMode: store.groupMode,
        collapsedGenerated: store.collapsedGenerated,
        collapsedUploaded: store.collapsedUploaded,
        collapsedSections: Array.from(store.collapsedSections),
      })
    },
  ))

  const allPageSelected = createMemo(() => {
    const files = isTopLevel()
      ? [...generatedComputed.sortedFiles(), ...uploadedComputed.sortedFiles()]
      : uploadedComputed.sortedFiles()
    return files.length > 0 && files.every((f) => store.selected.has(f.path))
  })

  const somePageSelected = createMemo(() =>
    !allPageSelected() && (
      isTopLevel()
        ? [...generatedComputed.sortedFiles(), ...uploadedComputed.sortedFiles()].some((f) => store.selected.has(f.path))
        : uploadedComputed.sortedFiles().some((f) => store.selected.has(f.path))
    ),
  )

  const selectedUploadedFiles = createMemo(() =>
    Array.from(store.selected).filter((path) =>
      store.uploadedFiles.some((f) => f.path === path),
    ),
  )

  return {
    store,
    setStore,
    previewFile,
    setPreviewFile,
    dayBoundary,
    isTopLevel,

    generated: generatedComputed,
    uploaded: uploadedComputed,

    allPageSelected,
    somePageSelected,
    selectedUploadedFiles,

    setLoading(loading: boolean) {
      setStore("loading", loading)
    },

    setError(error: string | null) {
      setStore("error", error)
    },

    setCurrentPath(path: string) {
      setStore("currentPath", path)
    },

    setGeneratedFiles(files: ArtifactFile[]) {
      setStore("generatedFiles", files)
    },

    setUploadedFiles(files: ArtifactFile[]) {
      setStore("uploadedFiles", files)
    },

    toggleGeneratedSection() {
      setStore("collapsedGenerated", !store.collapsedGenerated)
    },

    toggleUploadedSection() {
      setStore("collapsedUploaded", !store.collapsedUploaded)
    },

    toggleSection(section: string) {
      const next = new Set(store.collapsedSections)
      if (next.has(section)) next.delete(section)
      else next.add(section)
      setStore("collapsedSections", next)
    },

    setSortKey(key: SortKey) {
      setStore("sortKey", key)
    },

    setSortDir(dir: SortDir) {
      setStore("sortDir", dir)
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

    toggleFileSelection(path: string) {
      const next = new Set(store.selected)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      setStore("selected", next)
    },

    selectAllPage() {
      const next = new Set(store.selected)
      const files = isTopLevel()
        ? [...generatedComputed.sortedFiles(), ...uploadedComputed.sortedFiles()]
        : uploadedComputed.sortedFiles()
      for (const file of files) next.add(file.path)
      setStore("selected", next)
    },

    clearSelection() {
      setStore("selected", new Set())
    },

    deleteFile(path: string) {
      setStore("uploadedFiles", store.uploadedFiles.filter((f) => f.path !== path))
      const nextSelected = new Set(store.selected)
      nextSelected.delete(path)
      setStore("selected", nextSelected)
      if (previewFile()?.path === path) {
        setPreviewFile(null)
      }
    },

    navigateToFolder(folder: ArtifactFile) {
      if (!folder.isFolder) return
      const path = folder.relativePath.replace(/^upload-files\//, "")
      setStore("currentPath", path)
    },
  }
}
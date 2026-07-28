// SPEC-INS-014 §10.1:文件管理面板的视图状态 store。结构照抄站内 Design 模块
// (make/utils/artifact-file-store.ts)已验证的分组 / 排序 / 筛选 / 多选 / 文件夹导航逻辑——
// 这套逻辑与后端存储形态无关,只把数据源从 Design 的 ArtifactFile 换成 Insight 自己的 InsightFile。
// 文件夹导航:currentPath 相对 .octo/<sessionId>/uploads/ 根;非顶层只列 uploads/<path>/,
//   不再分"已上传/已生成"两段(generated 产物无子目录,只在顶层并排)。

import { createStore } from "solid-js/store"
import { createMemo, createSignal, createEffect, on } from "solid-js"
import type { InsightFile, InsightFileKind } from "./insight-file-api"
import { kindSortPriority } from "./insight-file-api"

export type GroupMode = "kind" | "modified"
export type ModifiedSection = "today" | "yesterday" | "previous7Days" | "previous30Days" | "older"
export type SortKey = "name" | "kind" | "mtime"
export type SortDir = "asc" | "desc"

const DEFAULT_SORT_KEY: SortKey = "mtime"
const DEFAULT_SORT_DIR: SortDir = "desc"

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
  today: "今天",
  yesterday: "昨天",
  previous7Days: "最近 7 天",
  previous30Days: "最近 30 天",
  older: "更早",
}

export type InsightFileStore = {
  currentPath: string
  uploadedFiles: InsightFile[]
  generatedFiles: InsightFile[]
  collapsedUploaded: boolean
  collapsedGenerated: boolean
  selected: Set<string>
  sortKey: SortKey
  sortDir: SortDir
  kindFilter: Set<InsightFileKind>
  groupMode: GroupMode
  loading: boolean
  error: string | null
}

function createFileListComputed(
  files: () => InsightFile[],
  sortKey: () => SortKey,
  sortDir: () => SortDir,
  kindFilter: () => Set<InsightFileKind>,
  groupMode: () => GroupMode,
  dayBoundary: () => number,
) {
  const filesMemo = createMemo(files)

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

  const kindGroupEntries = createMemo<Array<[InsightFileKind, InsightFile[]]>>(() => {
    if (groupMode() !== "kind") return []
    const groups = new Map<InsightFileKind, InsightFile[]>()
    for (const file of sortedFiles()) {
      const existing = groups.get(file.kind) ?? []
      existing.push(file)
      groups.set(file.kind, existing)
    }
    return Array.from(groups.entries()).sort(([a], [b]) => kindSortPriority(a) - kindSortPriority(b))
  })

  const modifiedGroups = createMemo(() => {
    const groups: Record<ModifiedSection, InsightFile[]> = {
      today: [],
      yesterday: [],
      previous7Days: [],
      previous30Days: [],
      older: [],
    }
    if (groupMode() !== "modified") return groups
    const thresholds = modifiedSectionThresholds(dayBoundary())
    for (const file of sortedFiles()) {
      groups[modifiedSectionFor(file.mtime, thresholds)].push(file)
    }
    return groups
  })

  const visibleModifiedSections = createMemo(() => {
    const dir = sortDir()
    const groups = modifiedGroups()
    const sections = MODIFIED_SECTION_ORDER.filter((section) => groups[section].length > 0)
    return dir === "asc" ? [...sections].reverse() : sections
  })

  return { filteredFiles, sortedFiles, kindGroupEntries, modifiedGroups, visibleModifiedSections }
}

export function createInsightFileStore() {
  const [store, setStore] = createStore<InsightFileStore>({
    currentPath: "",
    uploadedFiles: [],
    generatedFiles: [],
    collapsedUploaded: false,
    collapsedGenerated: false,
    selected: new Set(),
    sortKey: DEFAULT_SORT_KEY,
    sortDir: DEFAULT_SORT_DIR,
    kindFilter: new Set(),
    groupMode: "kind",
    loading: false,
    error: null,
  })

  // 右侧预览面板的目标文件:对齐 make/utils/artifact-file-store.ts 的 previewFile 信号模式。
  // 与批量多选(selected Set)不同,这是单文件预览目标;在切路径 / 删文件时自动清空,避免悬空预览。
  const [previewFile, setPreviewFile] = createSignal<InsightFile | null>(null)

  // 跨午夜时"今天/昨天"分桶会漂移:到下一个零点重算一次 dayBoundary,触发 modifiedGroups 重新分桶。
  const [dayBoundary, setDayBoundary] = createSignal(Date.now())
  createEffect(() => {
    const now = Date.now()
    const startOfTomorrow = new Date(now)
    startOfTomorrow.setHours(24, 0, 0, 0)
    const timer = setTimeout(() => setDayBoundary(Date.now()), Math.max(1, startOfTomorrow.getTime() - now))
    return () => clearTimeout(timer)
  })

  const uploaded = createFileListComputed(
    () => store.uploadedFiles,
    () => store.sortKey,
    () => store.sortDir,
    () => store.kindFilter,
    () => store.groupMode,
    dayBoundary,
  )
  const generated = createFileListComputed(
    () => store.generatedFiles,
    () => store.sortKey,
    () => store.sortDir,
    () => store.kindFilter,
    () => store.groupMode,
    dayBoundary,
  )

  const isTopLevel = createMemo(() => store.currentPath === "")

  // 改筛选条件后清掉已选(被筛掉的行不该继续算在选中里)
  createEffect(on(() => store.kindFilter, () => setStore("selected", new Set()), { defer: true }))

  // 切换文件夹路径:清选中(旧路径的选中不再适用)+ 清预览(旧路径下的预览文件不再可见)。
  createEffect(on(() => store.currentPath, () => {
    setStore("selected", new Set())
    setPreviewFile(null)
  }, { defer: true }))

  // kind 筛选可选项 + 各类型 count(两段文件合并统计,供工具栏筛选 popover 用)
  const kindCounts = createMemo(() => {
    const counts = new Map<InsightFileKind, number>()
    for (const file of [...store.uploadedFiles, ...store.generatedFiles]) {
      counts.set(file.kind, (counts.get(file.kind) ?? 0) + 1)
    }
    return counts
  })
  const availableKinds = createMemo(() =>
    Array.from(kindCounts().keys()).sort((a, b) => kindSortPriority(a) - kindSortPriority(b)),
  )

  // 当前页(过滤后)可见文件:顶层 = 已上传+已生成;非顶层(进文件夹)= 仅已上传。
  const pageFiles = createMemo(() =>
    isTopLevel() ? [...uploaded.sortedFiles(), ...generated.sortedFiles()] : uploaded.sortedFiles(),
  )
  // 选区只含文件:文件夹是导航项,不参与批量下载(archive 不递归目录)/批量删除,也不计入全选。
  const selectablePageFiles = createMemo(() => pageFiles().filter((f) => !f.isFolder))
  const allPageSelected = createMemo(() => {
    const files = selectablePageFiles()
    return files.length > 0 && files.every((f) => store.selected.has(f.path))
  })
  const somePageSelected = createMemo(() =>
    !allPageSelected() && selectablePageFiles().some((f) => store.selected.has(f.path)),
  )

  return {
    store,
    setStore,
    previewFile,
    setPreviewFile,
    uploaded,
    generated,
    kindCounts,
    availableKinds,
    isTopLevel,
    allPageSelected,
    somePageSelected,

    setLoading(loading: boolean) {
      setStore("loading", loading)
    },
    setError(error: string | null) {
      setStore("error", error)
    },
    setCurrentPath(p: string) {
      setStore("currentPath", p)
    },
    setUploadedFiles(files: InsightFile[]) {
      setStore("uploadedFiles", files)
    },
    setGeneratedFiles(files: InsightFile[]) {
      setStore("generatedFiles", files)
    },
    toggleUploadedSection() {
      setStore("collapsedUploaded", !store.collapsedUploaded)
    },
    toggleGeneratedSection() {
      setStore("collapsedGenerated", !store.collapsedGenerated)
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
    toggleKindFilter(kind: InsightFileKind) {
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
      if (allPageSelected()) {
        setStore("selected", new Set())
        return
      }
      const next = new Set(store.selected)
      for (const file of selectablePageFiles()) next.add(file.path)
      setStore("selected", next)
    },
    clearSelection() {
      setStore("selected", new Set())
    },
    deleteFile(path: string) {
      setStore("uploadedFiles", store.uploadedFiles.filter((f) => f.path !== path))
      setStore("generatedFiles", store.generatedFiles.filter((f) => f.path !== path))
      const nextSelected = new Set(store.selected)
      nextSelected.delete(path)
      setStore("selected", nextSelected)
      if (previewFile()?.path === path) setPreviewFile(null)
    },
    navigateToFolder(folder: InsightFile) {
      if (!folder.isFolder) return
      setStore("currentPath", folder.relativePath)
    },
  }
}

/**
 * 版本历史持久化 — 将 3D 场景每次生成/修改的状态保存到本地 JSON 文件。
 *
 * 存储位置：{directory}/.octo/design-3d/history/{sessionId}/
 *   每个版本独立存储为 {timestamp}-{description}.json
 *   索引 _versions.json 记录版本列表和当前指针
 *
 * Electron 环境通过 IPC writeFileBuffer/readFileBuffer 读写本地磁盘，
 * 浏览器环境降级使用 localStorage。
 */

import { getDesktopApi } from "./desktop-api"
import { mergeSceneObjects, type SceneModuleResult, type ScenePlanner } from "../agents/merge"
import { detectSceneConfig } from "./scene-config"

/** 一次生成/修改的完整场景状态 */
export type SceneSessionState = {
  lastIntent: Record<string, unknown> | null
  lastPlanner: ScenePlanner | null
  lastSceneObjects: SceneModuleResult[]
  mergedSceneConfig?: Record<string, unknown>
}

/** 版本列表条目（不含具体 state，用于菜单展示） */
export type VersionEntry = {
  id: string
  createdAt: number
  summary: string
}

/** 版本历史中的完整条目（含文件名，不含 state） */
type HistoryEntry = VersionEntry & { filename: string }

/** 索引文件结构 */
type VersionIndex = {
  versions: HistoryEntry[]
  current: string | null
}

/** localStorage 降级存储的前缀 */
const STORAGE_PREFIX = "octo:scene3d:history"

function indexFilePath(dir: string, sessionId: string) {
  return `${dir}/${sessionId}/_versions.json`
}

function versionFilePath(dir: string, sessionId: string, filename: string) {
  return `${dir}/${sessionId}/${filename}`
}

function sanitizeFilename(summary: string): string {
  return summary
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 80)
}

async function readIndex(dir: string, sessionId: string): Promise<VersionIndex> {
  const api = getDesktopApi()
  const path = indexFilePath(dir, sessionId)

  if (api?.readFileBuffer) {
    try {
      const buf = await api.readFileBuffer(path)
      if (!buf) return { versions: [], current: null }
      return JSON.parse(new TextDecoder().decode(buf)) as VersionIndex
    } catch {
      return { versions: [], current: null }
    }
  }

  const stored = localStorage.getItem(`${STORAGE_PREFIX}:${sessionId}:index`)
  if (!stored) return { versions: [], current: null }
  try {
    return JSON.parse(stored) as VersionIndex
  } catch {
    return { versions: [], current: null }
  }
}

async function writeIndex(dir: string, sessionId: string, index: VersionIndex) {
  const payload = JSON.stringify(index, null, 2)
  const api = getDesktopApi()
  const path = indexFilePath(dir, sessionId)

  if (api?.writeFileBuffer) {
    const encoder = new TextEncoder()
    await api.writeFileBuffer(path, encoder.encode(payload).buffer)
    return
  }
  localStorage.setItem(`${STORAGE_PREFIX}:${sessionId}:index`, payload)
}

async function readVersionFile(dir: string, sessionId: string, filename: string): Promise<SceneSessionState | null> {
  const api = getDesktopApi()
  const path = versionFilePath(dir, sessionId, filename)

  if (api?.readFileBuffer) {
    try {
      const buf = await api.readFileBuffer(path)
      if (!buf) return null
      return JSON.parse(new TextDecoder().decode(buf)) as SceneSessionState
    } catch {
      return null
    }
  }

  const stored = localStorage.getItem(`${STORAGE_PREFIX}:${sessionId}:v:${filename}`)
  if (!stored) return null
  try {
    return JSON.parse(stored) as SceneSessionState
  } catch {
    return null
  }
}

async function writeVersionFile(dir: string, sessionId: string, filename: string, state: SceneSessionState) {
  const payload = JSON.stringify(state, null, 2)
  const api = getDesktopApi()
  const path = versionFilePath(dir, sessionId, filename)

  if (api?.writeFileBuffer) {
    const encoder = new TextEncoder()
    await api.writeFileBuffer(path, encoder.encode(payload).buffer)
    return
  }
  localStorage.setItem(`${STORAGE_PREFIX}:${sessionId}:v:${filename}`, payload)
}

/**
 * 追加一个新版本到历史文件，自动设为 current。
 * @returns 新版本的 ID
 */
export async function appendSceneVersion(
  dir: string,
  sessionId: string,
  state: SceneSessionState,
  summary: string,
): Promise<string> {
  const index = await readIndex(dir, sessionId)
  const now = Date.now()
  const filename = `${now}-${sanitizeFilename(summary)}.json`
  const entry: HistoryEntry = {
    id: `v${now}`,
    createdAt: now,
    summary,
    filename,
  }
  await writeVersionFile(dir, sessionId, filename, state)
  index.versions.push(entry)
  index.current = entry.id
  await writeIndex(dir, sessionId, index)
  return entry.id
}

/**
 * 增量更新当前版本的字段（合并写入，不覆盖已有字段的其余部分）。
 * 若不存在当前版本则不做任何操作。
 */
export async function updateSceneVersion(
  dir: string,
  sessionId: string,
  partial: Partial<SceneSessionState>,
): Promise<void> {
  const index = await readIndex(dir, sessionId)
  // 无 current（调用方未先 appendSceneVersion 建立版本）：直接追加一个兜底版本，
  // 避免静默丢数据（曾导致"首次生成能预览，但切走再切回场景丢失"）。
  if (!index.current) {
    await appendSceneVersion(dir, sessionId, partial as SceneSessionState, "scene")
    return
  }
  const entry = index.versions.find((v) => v.id === index.current)
  if (!entry) {
    await appendSceneVersion(dir, sessionId, partial as SceneSessionState, "scene")
    return
  }
  const state = await readVersionFile(dir, sessionId, entry.filename)
  if (!state) return
  await writeVersionFile(dir, sessionId, entry.filename, { ...state, ...partial })
}

/**
 * 读取当前指向版本的完整页面状态。
 * @returns 当前版本的 state，无记录时返回 null
 */
export async function loadCurrentSceneState(
  dir: string,
  sessionId: string,
): Promise<SceneSessionState | null> {
  const index = await readIndex(dir, sessionId)
  if (!index.current) return null
  const entry = index.versions.find((v) => v.id === index.current)
  if (!entry) return null
  return readVersionFile(dir, sessionId, entry.filename)
}

/**
 * 列出所有版本的摘要信息（不含 state，用于菜单展示）。
 */
export async function listSceneVersions(
  dir: string,
  sessionId: string,
): Promise<{ versions: VersionEntry[]; current: string | null }> {
  const index = await readIndex(dir, sessionId)
  const api = getDesktopApi()
  const valid: typeof index.versions = []
  let needsRewrite = false

  for (const v of index.versions) {
    if (!api?.readFileBuffer) { valid.push(v); continue }
    const filePath = versionFilePath(dir, sessionId, v.filename)
    try {
      const buf = await api.readFileBuffer(filePath)
      if (!buf) { needsRewrite = true; continue }
    } catch {
      needsRewrite = true
      continue
    }
    valid.push(v)
  }

  if (needsRewrite) {
    index.versions = valid
    if (index.current && !valid.find((v) => v.id === index.current)) {
      index.current = valid.length > 0 ? valid[valid.length - 1].id : null
    }
    await writeIndex(dir, sessionId, index)
  }

  return {
    versions: valid.map((v) => ({ id: v.id, createdAt: v.createdAt, summary: v.summary })),
    current: index.current,
  }
}

/**
 * 切换到指定版本，更新 current 指针并写回文件。
 * @returns 目标版本的完整 state，版本不存在时返回 null
 */
export async function switchToVersion(
  dir: string,
  sessionId: string,
  versionId: string,
): Promise<SceneSessionState | null> {
  const index = await readIndex(dir, sessionId)
  const entry = index.versions.find((v) => v.id === versionId)
  if (!entry) return null
  index.current = versionId
  await writeIndex(dir, sessionId, index)
  return readVersionFile(dir, sessionId, entry.filename)
}

/**
 * 删除指定版本。若删除的是当前版本，current 指针移到最后一个版本。
 */
export async function deleteSceneVersion(
  dir: string,
  sessionId: string,
  versionId: string,
): Promise<void> {
  const index = await readIndex(dir, sessionId)
  const idx = index.versions.findIndex((v) => v.id === versionId)
  if (idx === -1) return
  index.versions.splice(idx, 1)
  if (index.current === versionId) {
    index.current = index.versions.length > 0
      ? index.versions[index.versions.length - 1].id
      : null
  }
  await writeIndex(dir, sessionId, index)
}

/**
 * 回退到指定版本，恢复预览。
 * @param dir        历史文件所在目录
 * @param sessionId  会话 ID
 * @param versionId  目标版本 ID
 * @param onPreview  将合并后的 SceneConfig 推送到预览页的回调
 * @returns 版本状态，失败返回 null
 */
export async function rollbackToVersion(
  dir: string,
  sessionId: string,
  versionId: string,
  onPreview: (data: unknown) => void,
) {
  const state = await switchToVersion(dir, sessionId, versionId)
  if (!state) return null

  if ((state.lastSceneObjects ?? []).length > 0) {
    const planner = (state.lastPlanner ?? {}) as ScenePlanner
    const merged =
      (state.mergedSceneConfig as unknown) ??
      mergeSceneObjects(planner, state.lastSceneObjects ?? [])
    const mergedJson = detectSceneConfig(JSON.stringify(merged))
    if (mergedJson) onPreview(mergedJson)
  }

  return state
}

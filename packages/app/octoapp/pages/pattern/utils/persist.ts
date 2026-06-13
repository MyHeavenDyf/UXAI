/**
 * 版本历史持久化 — 将 Pattern 页面每次生成/修改的状态保存到本地 JSON 文件。
 *
 * 存储位置：{directory}/.octo/design/history/{sessionId}/
 *   每个版本独立存储为 {timestamp}-{description}.json
 *   索引 _versions.json 记录版本列表和当前指针
 *
 * Electron 环境通过 IPC writeFileBuffer/readFileBuffer 读写本地磁盘，
 * 浏览器环境降级使用 localStorage。
 */

type DesktopApi = {
  writeFileBuffer?: (path: string, buffer: ArrayBuffer) => Promise<void>
  readFileBuffer?: (path: string) => Promise<ArrayBuffer | null>
}

function getDesktopApi(): DesktopApi | undefined {
  return (window as unknown as { api?: DesktopApi }).api
}

/** 一次生成/修改的完整页面状态 */
export type PatternSessionState = {
  lastIntent: Record<string, unknown> | null
  lastPlanner: Record<string, unknown> | null
  lastModules: Array<Record<string, unknown>>
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
const STORAGE_PREFIX = "octo:pattern:history"

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

async function readVersionFile(dir: string, sessionId: string, filename: string): Promise<PatternSessionState | null> {
  const api = getDesktopApi()
  const path = versionFilePath(dir, sessionId, filename)

  if (api?.readFileBuffer) {
    try {
      const buf = await api.readFileBuffer(path)
      if (!buf) return null
      return JSON.parse(new TextDecoder().decode(buf)) as PatternSessionState
    } catch {
      return null
    }
  }

  const stored = localStorage.getItem(`${STORAGE_PREFIX}:${sessionId}:v:${filename}`)
  if (!stored) return null
  try {
    return JSON.parse(stored) as PatternSessionState
  } catch {
    return null
  }
}

async function writeVersionFile(dir: string, sessionId: string, filename: string, state: PatternSessionState) {
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
export async function appendPatternVersion(
  dir: string,
  sessionId: string,
  state: PatternSessionState,
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
 * 读取当前指向版本的完整页面状态。
 * @returns 当前版本的 state，无记录时返回 null
 */
export async function loadCurrentPatternState(
  dir: string,
  sessionId: string,
): Promise<PatternSessionState | null> {
  const index = await readIndex(dir, sessionId)
  if (!index.current) return null
  const entry = index.versions.find((v) => v.id === index.current)
  if (!entry) return null
  return readVersionFile(dir, sessionId, entry.filename)
}

/**
 * 列出所有版本的摘要信息（不含 state，用于菜单展示）。
 */
export async function listPatternVersions(
  dir: string,
  sessionId: string,
): Promise<{ versions: VersionEntry[]; current: string | null }> {
  const index = await readIndex(dir, sessionId)
  return {
    versions: index.versions.map((v) => ({ id: v.id, createdAt: v.createdAt, summary: v.summary })),
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
): Promise<PatternSessionState | null> {
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
export async function deletePatternVersion(
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

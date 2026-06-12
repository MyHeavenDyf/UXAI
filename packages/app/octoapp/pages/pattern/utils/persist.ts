/**
 * 版本历史持久化 — 将 Pattern 页面每次生成/修改的状态保存到本地 JSON 文件。
 *
 * 存储位置：{directory}/.octo/pattern/history/{sessionId}.json
 * 文件格式：{ versions: HistoryEntry[], current: string | null }
 *
 * Electron 环境通过 IPC writeFileBuffer/readFileBuffer 读写本地磁盘，
 * 浏览器环境降级使用 localStorage。
 */

type DesktopApi = {
  writeFileBuffer?: (path: string, buffer: ArrayBuffer) => Promise<void>
  readFileBuffer?: (path: string) => Promise<ArrayBuffer | null>
}

/** 获取 Electron 渲染进程的 desktop API 桥接对象 */
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

/** 版本历史中的完整条目（含页面状态） */
type HistoryEntry = VersionEntry & { state: PatternSessionState }

/** 历史文件顶层结构 */
type PatternHistoryFile = {
  versions: HistoryEntry[]
  current: string | null
}

/** localStorage 降级存储的前缀 */
const STORAGE_PREFIX = "octo:pattern:history"

/** 拼接文件路径 */
function filePath(dir: string, sessionId: string) {
  return `${dir}/${sessionId}.json`
}

/**
 * 读取历史文件。
 * Electron 环境通过 IPC 读磁盘，浏览器环境从 localStorage 读取。
 */
async function readHistoryFile(dir: string, sessionId: string): Promise<PatternHistoryFile> {
  const api = getDesktopApi()
  const path = filePath(dir, sessionId)

  if (api?.readFileBuffer) {
    try {
      const buf = await api.readFileBuffer(path)
      if (!buf) return { versions: [], current: null }
      return JSON.parse(new TextDecoder().decode(buf)) as PatternHistoryFile
    } catch {
      return { versions: [], current: null }
    }
  }

  const stored = localStorage.getItem(`${STORAGE_PREFIX}:${sessionId}`)
  if (!stored) return { versions: [], current: null }
  try {
    return JSON.parse(stored) as PatternHistoryFile
  } catch {
    return { versions: [], current: null }
  }
}

/**
 * 写入历史文件。
 * Electron 环境通过 IPC 写磁盘（自动 mkdir -p），浏览器环境写 localStorage。
 */
async function writeHistoryFile(dir: string, sessionId: string, history: PatternHistoryFile) {
  const payload = JSON.stringify(history, null, 2)
  const api = getDesktopApi()
  const path = filePath(dir, sessionId)

  if (api?.writeFileBuffer) {
    const encoder = new TextEncoder()
    await api.writeFileBuffer(path, encoder.encode(payload).buffer)
    return
  }
  localStorage.setItem(`${STORAGE_PREFIX}:${sessionId}`, payload)
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
  const history = await readHistoryFile(dir, sessionId)
  const now = Date.now()
  const version: HistoryEntry = {
    id: `v${now}`,
    createdAt: now,
    summary,
    state,
  }
  history.versions.push(version)
  history.current = version.id
  await writeHistoryFile(dir, sessionId, history)
  return version.id
}

/**
 * 读取当前指向版本的完整页面状态。
 * @returns 当前版本的 state，无记录时返回 null
 */
export async function loadCurrentPatternState(
  dir: string,
  sessionId: string,
): Promise<PatternSessionState | null> {
  const history = await readHistoryFile(dir, sessionId)
  if (!history.current) return null
  const entry = history.versions.find((v) => v.id === history.current)
  return entry?.state ?? null
}

/**
 * 列出所有版本的摘要信息（不含 state，用于菜单展示）。
 */
export async function listPatternVersions(
  dir: string,
  sessionId: string,
): Promise<{ versions: VersionEntry[]; current: string | null }> {
  const history = await readHistoryFile(dir, sessionId)
  return {
    versions: history.versions.map((v) => ({ id: v.id, createdAt: v.createdAt, summary: v.summary })),
    current: history.current,
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
  const history = await readHistoryFile(dir, sessionId)
  const entry = history.versions.find((v) => v.id === versionId)
  if (!entry) return null
  history.current = versionId
  await writeHistoryFile(dir, sessionId, history)
  return entry.state
}

/**
 * 删除指定版本。若删除的是当前版本，current 指针移到最后一个版本。
 */
export async function deletePatternVersion(
  dir: string,
  sessionId: string,
  versionId: string,
): Promise<void> {
  const history = await readHistoryFile(dir, sessionId)
  const idx = history.versions.findIndex((v) => v.id === versionId)
  if (idx === -1) return
  history.versions.splice(idx, 1)
  if (history.current === versionId) {
    history.current = history.versions.length > 0
      ? history.versions[history.versions.length - 1].id
      : null
  }
  await writeHistoryFile(dir, sessionId, history)
}

import type { ResultTab } from "../components/result-viewer/tab-store"
import { getDesktopApi } from "../lib/electron-api"

export type HistoryActor = "init" | "user" | "agent"

export interface VersionEntry {
  id: string
  folderPath: string
  timestamp: number
  actor: HistoryActor
}

export interface VersionFile {
  id: string
  fileName: string
  filePath: string
  originalPath: string
  relativePath: string
}

const MAX_VERSIONS = 50
const SKIP_TYPES = ["image", "video", "audio", "pdf", "svg", "text", "local-file"]

function getSep(filePath: string): string {
  return filePath.includes("\\") ? "\\" : "/"
}

function getHistoryDir(filePath: string): string {
  const sep = getSep(filePath)
  const parts = filePath.split(/[/\\]/)
  parts.pop()
  return [...parts, ".history"].join(sep)
}

function getDir(filePath: string): string {
  const sep = getSep(filePath)
  const parts = filePath.split(/[/\\]/)
  parts.pop()
  return parts.join(sep)
}

function getBaseName(filePath: string): string {
  const fileName = filePath.split(/[/\\]/).pop() || ""
  const dot = fileName.lastIndexOf(".")
  return dot > 0 ? fileName.slice(0, dot) : fileName
}

export function getExt(filePath: string): string {
  const fileName = filePath.split(/[/\\]/).pop() || ""
  const dot = fileName.lastIndexOf(".")
  return dot > 0 ? fileName.slice(dot) : ""
}

export function relativePathToId(rel: string): string {
  if (rel === "." || rel === "./") {
    return "self"
  }
  const cleaned = rel.replace(/^\.\//, "").replace(/^\.$/, "self")
  const id = cleaned.replace(/[/\\]/g, "_")
  return id || "self"
}

export function resolveRelativePath(rel: string, sourceFilePath: string): string {
  const sep = getSep(sourceFilePath)
  const dir = getDir(sourceFilePath)
  if (rel === "." || rel === "./") {
    return sourceFilePath
  }
  const cleaned = rel.replace(/^\.\//, "")
  return dir + sep + cleaned
}

function buildVersionFolderName(baseName: string, ts: Date, actor: HistoryActor): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  const stamp = `${ts.getFullYear()}${pad(ts.getMonth() + 1)}${pad(ts.getDate())}-${pad(ts.getHours())}${pad(ts.getMinutes())}${pad(ts.getSeconds())}`
  return `${baseName}.${stamp}.${actor}`
}

function parseVersionFolder(name: string): { baseName: string; timestamp: number; actor: HistoryActor } | null {
  const m = name.match(/^(.+)\.(\d{8})-(\d{6})\.(init|user|agent)$/)
  if (!m) return null
  const [, baseName, d, t, actor] = m
  const ts = new Date(
    Number(d.slice(0, 4)),
    Number(d.slice(4, 6)) - 1,
    Number(d.slice(6, 8)),
    Number(t.slice(0, 2)),
    Number(t.slice(2, 4)),
    Number(t.slice(4, 6)),
  ).getTime()
  return { baseName, timestamp: ts, actor: actor as HistoryActor }
}

export function createHistoryStore() {
  const api = getDesktopApi()

  async function recordVersion(
    tab: ResultTab,
    actor: HistoryActor,
    files: string[],
  ): Promise<VersionEntry | null> {
    if (!api?.copyFileTo || !api?.listDirectory || !api?.deleteFile) return null
    if (!tab.filePath) return null
    if (SKIP_TYPES.includes(tab.type)) return null

    const sep = getSep(tab.filePath)
    const historyDir = getHistoryDir(tab.filePath)
    const baseName = getBaseName(tab.filePath)
    const ts = new Date()
    const versionName = buildVersionFolderName(baseName, ts, actor)
    const versionDir = historyDir + sep + versionName

    for (const rel of files) {
      const originalPath = resolveRelativePath(rel, tab.filePath!)
      const id = relativePathToId(rel)
      const ext = getExt(originalPath)
      const versionFileName = id + ext
      const versionFilePath = versionDir + sep + versionFileName
      try {
        await api.copyFileTo(originalPath, versionFilePath)
      } catch {
        // 源文件不存在则跳过该文件
      }
    }

    const entry: VersionEntry = {
      id: versionName,
      folderPath: versionDir,
      timestamp: ts.getTime(),
      actor,
    }

    await prune(historyDir, baseName)
    return entry
  }

  async function getVersionFiles(
    versionId: string,
    tab: ResultTab,
    configFiles: string[],
  ): Promise<VersionFile[]> {
    if (!api?.listDirectory || !tab.filePath) return []
    const sep = getSep(tab.filePath)
    const historyDir = getHistoryDir(tab.filePath)
    const versionDir = historyDir + sep + versionId

    const entries = await api.listDirectory(versionDir)

    return configFiles
      .map((rel) => {
        const id = relativePathToId(rel)
        const originalPath = resolveRelativePath(rel, tab.filePath!)
        const ext = getExt(originalPath)
        const versionFileName = id + ext
        const entry = entries.find((e) => {
          const name = e.path.split(/[/\\]/).pop()!
          return name === versionFileName
        })
        if (!entry) return null
        const sep = getSep(versionDir)
        return {
          id,
          fileName: versionFileName,
          filePath: versionDir + sep + versionFileName,
          originalPath,
          relativePath: rel,
        } as VersionFile
      })
      .filter((e): e is VersionFile => e !== null)
  }

  async function listVersions(tab: ResultTab): Promise<VersionEntry[]> {
    if (!api?.listDirectory || !tab.filePath) return []
    const sep = getSep(tab.filePath)
    const historyDir = getHistoryDir(tab.filePath)
    const baseName = getBaseName(tab.filePath)
    const prefix = baseName + "."

    const entries = await api.listDirectory(historyDir)
    const versionMap = new Map<string, { timestamp: number; actor: HistoryActor }>()
    for (const e of entries) {
      if (e.type !== "file") continue
      const firstSeg = e.path.split(/[/\\]/)[0]
      if (!firstSeg.startsWith(prefix)) continue
      const parsed = parseVersionFolder(firstSeg)
      if (!parsed) continue
      if (!versionMap.has(firstSeg) || versionMap.get(firstSeg)!.timestamp < parsed.timestamp) {
        versionMap.set(firstSeg, parsed)
      }
    }
    return Array.from(versionMap.entries())
      .map(([id, parsed]) => ({
        id,
        folderPath: historyDir + sep + id,
        timestamp: parsed.timestamp,
        actor: parsed.actor,
      }))
      .sort((a, b) => b.timestamp - a.timestamp)
  }

  async function prune(historyDir: string, baseName: string): Promise<void> {
    if (!api?.listDirectory || !api?.deleteFile) return
    const prefix = baseName + "."
    const entries = await api.listDirectory(historyDir)
    const versionMap = new Map<string, number>()
    for (const e of entries) {
      if (e.type !== "file") continue
      const firstSeg = e.path.split(/[/\\]/)[0]
      if (!firstSeg.startsWith(prefix)) continue
      const parsed = parseVersionFolder(firstSeg)
      if (!parsed) continue
      if (!versionMap.has(firstSeg) || versionMap.get(firstSeg)! < parsed.timestamp) {
        versionMap.set(firstSeg, parsed.timestamp)
      }
    }
    const versions = Array.from(versionMap.entries())
      .map(([id, ts]) => ({ id, ts }))
      .sort((a, b) => b.ts - a.ts)

    if (versions.length <= MAX_VERSIONS) return
    for (const item of versions.slice(MAX_VERSIONS)) {
      const filesInVersion = entries.filter((e) => e.path.split(/[/\\]/)[0] === item.id && e.type === "file")
      for (const f of filesInVersion) {
        await api.deleteFile(f.path)
      }
    }
  }

  return { recordVersion, getVersionFiles, listVersions }
}

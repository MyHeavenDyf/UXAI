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
/** 版本目录内的快照文件清单名；getVersionFiles 按 configFiles 映射文件名，不会命中它 */
export const VERSION_MANIFEST_FILE = "__manifest.json"

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
  // 去掉末尾扩展名，避免与下游 getExt 拼接时出现 data.js.js 这种重复扩展名。
  // 只去掉路径最后一段的扩展名（路径分隔符之后的部分），保留目录段中的点。
  const lastSlash = Math.max(cleaned.lastIndexOf("/"), cleaned.lastIndexOf("\\"))
  const lastDot = cleaned.lastIndexOf(".")
  const stem = lastDot > lastSlash ? cleaned.slice(0, lastDot) : cleaned
  const id = stem.replace(/[/\\]/g, "_")
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

/** FNV-1a hash：同步、纯 JS，对短文本足够精确。
 *  controller 的变更检测与 subtype handler（如 page 的入口比对）共用 */
export function fnv1aHash(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let h = 0x811c9dc5
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i]
    h = (h * 0x01000193) >>> 0
  }
  return h.toString(16)
}

export function createHistoryStore() {
  const api = getDesktopApi()

  async function recordVersion(
    tab: ResultTab,
    actor: HistoryActor,
    files: string[],
    maxVersions?: number,
  ): Promise<VersionEntry | null> {
    if (!api?.copyFileTo || !api?.listDirectory || !api?.deleteFile) return null
    if (!tab.filePath) return null
    if (SKIP_TYPES.includes(tab.type)) return null

    const sep = getSep(tab.filePath)
    const historyDir = getHistoryDir(tab.filePath)
    const baseName = getBaseName(tab.filePath)
    /** 版本时间取文件集的最大 mtime（= 该组内容最后变更时刻，NTFS 系统时钟可靠）。
     *  必须取全集最大值而非主文件：如 components 页 html 生成后不变、变化都在 data.js，
     *  只取 html 会让每条记录同名互相覆盖（表现为"新记录没出现 + 时间停在生成时刻"）。stat 全失败回退当前时间 */
    let tsMs = 0
    for (const rel of files) {
      const st = await api.statFile?.(resolveRelativePath(rel, tab.filePath!)).catch(() => null)
      if (st?.mtimeMs && st.mtimeMs > tsMs) tsMs = st.mtimeMs
    }
    const ts = tsMs > 0 ? new Date(tsMs) : new Date()
    const versionName = buildVersionFolderName(baseName, ts, actor)
    const versionDir = historyDir + sep + versionName

    const copyFileTo = api.copyFileTo
    const readFileBuffer = api.readFileBuffer
    /** 复制 + 写后校验：源正被写入时（autoSaveArtifact 进行中）复制可能抛 EBUSY，
     *  或复制出半截内容（字节数不符）。多级退避重试，且以「源/目标字节数一致」为成功标准 */
    const copyWithRetry = async (src: string, dest: string): Promise<boolean> => {
      const delays = [0, 300, 1200]
      for (const delay of delays) {
        if (delay > 0) await new Promise((r) => setTimeout(r, delay))
        try {
          await copyFileTo(src, dest)
          const srcBuf = await readFileBuffer?.(src)
          const destBuf = await readFileBuffer?.(dest)
          if (srcBuf && destBuf && srcBuf.byteLength === destBuf.byteLength) {
            return true
          }
        } catch {
          // 重试
        }
      }
      return false
    }

    let copied = 0
    for (const rel of files) {
      const originalPath = resolveRelativePath(rel, tab.filePath!)
      const id = relativePathToId(rel)
      const ext = getExt(originalPath)
      const versionFileName = id + ext
      const versionFilePath = versionDir + sep + versionFileName
      if (await copyWithRetry(originalPath, versionFilePath)) {
        copied++
      }
    }

    // 全部复制失败（如源文件未落盘、被占用）时不产生版本，避免幽灵条目
    if (copied === 0) return null

    /** 版本文件清单：记录本次快照的完整 rel 列表。恢复端（如 page）按清单还原，
     *  不受切换时磁盘状态影响（记录后新增/删除的文件也能正确还原/剔除）。
     *  旧版本无清单时恢复端回退到「当前目录发现 ∩ 版本内容」的旧行为。
     *  清单是可选元数据：写入失败（EBUSY 等）只降级恢复端能力，不能中断记录流程 */
    try {
      await api.writeFileBuffer?.(
        versionDir + sep + VERSION_MANIFEST_FILE,
        new TextEncoder().encode(JSON.stringify({ files })).buffer as ArrayBuffer,
      )
    } catch {}

    const entry: VersionEntry = {
      id: versionName,
      folderPath: versionDir,
      timestamp: ts.getTime(),
      actor,
    }

    await prune(historyDir, baseName, maxVersions)
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

  async function removeVersionsAfter(tab: Pick<ResultTab, "filePath">, cutoffMs: number): Promise<number> {
    if (!api?.listDirectory || !api?.deleteFile || !tab.filePath) return 0
    const historyDir = getHistoryDir(tab.filePath)
    const sep = getSep(historyDir)
    const prefix = getBaseName(tab.filePath) + "."

    const entries = await api.listDirectory(historyDir)
    const doomed = new Set<string>()
    for (const e of entries) {
      if (e.type !== "file") continue
      const firstSeg = e.path.split(/[/\\]/)[0]
      if (!firstSeg.startsWith(prefix)) continue
      const parsed = parseVersionFolder(firstSeg)
      if (!parsed) continue
      if (parsed.timestamp >= cutoffMs) doomed.add(firstSeg)
    }

    for (const e of entries) {
      if (e.type !== "file") continue
      if (!doomed.has(e.path.split(/[/\\]/)[0])) continue
      await api.deleteFile(historyDir + sep + e.path)
    }
    return doomed.size
  }

  async function prune(historyDir: string, baseName: string, maxVersions?: number): Promise<void> {
    const cap = maxVersions ?? MAX_VERSIONS
    if (!api?.listDirectory || !api?.deleteFile) return
    const sep = getSep(historyDir)
    const prefix = baseName + "."
    const entries = await api.listDirectory(historyDir)
    const versionMap = new Map<string, { ts: number; actor: HistoryActor }>()
    for (const e of entries) {
      if (e.type !== "file") continue
      const firstSeg = e.path.split(/[/\\]/)[0]
      if (!firstSeg.startsWith(prefix)) continue
      const parsed = parseVersionFolder(firstSeg)
      if (!parsed) continue
      if (!versionMap.has(firstSeg) || versionMap.get(firstSeg)!.ts < parsed.timestamp) {
        versionMap.set(firstSeg, { ts: parsed.timestamp, actor: parsed.actor })
      }
    }
    // init 版本豁免清理，50 上限只作用于 user/agent 版本
    const versions = Array.from(versionMap.entries())
      .map(([id, v]) => ({ id, ts: v.ts, actor: v.actor }))
      .filter((v) => v.actor !== "init")
      .sort((a, b) => b.ts - a.ts)

    if (versions.length <= cap) return
    for (const item of versions.slice(cap)) {
      const filesInVersion = entries.filter((e) => e.path.split(/[/\\]/)[0] === item.id && e.type === "file")
      for (const f of filesInVersion) {
        await api.deleteFile(historyDir + sep + f.path)
      }
    }
  }

  return { recordVersion, getVersionFiles, listVersions, removeVersionsAfter }
}

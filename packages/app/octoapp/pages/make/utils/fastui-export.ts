/**
 * fastui 代码包导出的前端侧(SPEC-DES-001 §8.6.2)
 *
 * 打包本身由主进程调 skill 的 `export-zip.mjs` 完成(前端自己压缩会跟随工程根的
 * node_modules 链接把共享池那 1GB 打进去,也拿不到 ZIP 的 UTF-8 flag);这里只负责
 * 「这个 tab 该不该有导出按钮」和「拿到 zip 之后交给用户」。
 */
import { createSignal } from "solid-js"

import { getDesktopApi } from "../lib/electron-api"
import { showOctoToast } from "../components/octo-toast"

/** dev server 跑在 127.0.0.1:<port>,一个会话一个端口 */
export function isLocalPreviewUrl(url?: string | null): boolean {
  if (!url) return false
  try {
    const u = new URL(url)
    if (u.protocol !== "http:" && u.protocol !== "https:") return false
    return u.hostname === "127.0.0.1" || u.hostname === "localhost" || u.hostname === "[::1]"
  } catch {
    return false
  }
}

/** 与 index.tsx 建会话时的拼法一致:<projectDir>/.octo/<sessionId> */
export function sessionDirOf(sdkDirectory?: string, sessionId?: string): string | null {
  if (!sdkDirectory || !sessionId) return null
  const sep = sdkDirectory.includes("\\") ? "\\" : "/"
  return [sdkDirectory, ".octo", sessionId].join(sep)
}

// ── 判据:这个会话是不是 fastui 工程 ───────────────────────────────
// subtype "url" 是所有 http(s) 链接 tab 的通用形态(链接卡片、文件管理打开外链都走它),
// 所以不能只看 tab 形态就挂导出按钮。判据取「会话目录下有没有 .octo-fastui.json」——
// 只有 fastui skill 的 new-session 会写出那个文件,是确定的存在性判断,不是猜。
const [fastuiSessions, setFastuiSessions] = createSignal<Record<string, boolean>>({})
/** 已探测过的次数;肯定结果直接从 signal 走,不再进这里 */
const probeCount = new Map<string, number>()

/**
 * 否定结果重探几次再放弃。
 *
 * 正常时序下一次就够 —— URL tab 是 skill 输出 artifact 之后才创建的,而
 * `new-session` 远早于此,那时 `.octo-fastui.json` 必然已经在磁盘上。留几次重探是
 * 防时序变化,**必须靠 setTimeout 自己驱动**:只把结果写回 signal 不会再触发探测
 * (重渲染时读到的仍是同一个否定值),那样"自愈"只是注释里的说法。
 */
const RENEGATIVE_PROBE_MS = 3000
const MAX_NEGATIVE_PROBES = 3

export function isFastuiSession(sessionDir: string): boolean {
  const known = fastuiSessions()[sessionDir]
  if (known) return true

  const tried = probeCount.get(sessionDir) ?? 0
  if (tried === 0) {
    probeCount.set(sessionDir, 1)
    void probeFastuiSession(sessionDir)
  }
  return false
}

async function probeFastuiSession(sessionDir: string): Promise<void> {
  const api = getDesktopApi()
  const sep = sessionDir.includes("\\") ? "\\" : "/"
  const statePath = [sessionDir, ".octo-fastui.json"].join(sep)

  let exists = false
  try {
    exists = !!(await api?.fileExists?.(statePath))
  } catch {
    /* 读不到就当不是 fastui 会话,按钮不出现 */
  }

  setFastuiSessions((prev) => (prev[sessionDir] === exists ? prev : { ...prev, [sessionDir]: exists }))
  if (exists) return

  const tried = probeCount.get(sessionDir) ?? 1
  if (tried >= MAX_NEGATIVE_PROBES) return
  probeCount.set(sessionDir, tried + 1)
  setTimeout(() => void probeFastuiSession(sessionDir), RENEGATIVE_PROBE_MS)
}

// ── 导出 ─────────────────────────────────────────────────────────
const [exportingDir, setExportingDir] = createSignal<string | null>(null)

/** 这个会话正在导出(按钮显示「导出中…」) */
export function isExporting(sessionDir: string | null): boolean {
  return !!sessionDir && exportingDir() === sessionDir
}

/**
 * 有任何会话正在导出。锁是全局的(一次只跑一个打包脚本),所以按钮的 disabled 也要按
 * 全局判 —— 只按自己那个会话判的话,在另一个会话的 tab 上点导出会静默什么都不发生。
 */
export function isExportingAny(): boolean {
  return exportingDir() !== null
}

function formatBytes(bytes: number): string {
  if (!bytes) return ""
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function baseNameOf(p: string): string {
  return p.split(/[\\/]/).filter(Boolean).pop() ?? "project.zip"
}

/**
 * 打包 → 让用户选保存位置 → 拷过去。
 * zip 已经在磁盘上,不走 action-bar 里 `downloadBlob` 那套(那是给内容型 tab 用的)。
 */
export async function exportFastuiZip(sessionDir: string): Promise<void> {
  if (exportingDir()) return
  const api = getDesktopApi()
  if (!api?.fastuiExportZip) {
    showOctoToast({ title: "当前环境不支持导出代码包", variant: "error" })
    return
  }

  setExportingDir(sessionDir)
  try {
    const result = await api.fastuiExportZip(sessionDir)
    if (!result?.ok) {
      showOctoToast({
        title: "导出代码包失败",
        description: result?.error || "未知原因",
        variant: "error",
      })
      return
    }

    const fileName = baseNameOf(result.zipPath)
    const size = formatBytes(result.bytes)
    const dest = await api.saveFilePicker?.({ title: "保存代码包", defaultPath: fileName })
    if (!dest) {
      // 用户取消保存:包已经生成好了,告诉他在哪,不再打扰
      showOctoToast({ title: "代码包已生成", description: result.zipPath })
      return
    }

    if (!api.copyFileTo) {
      showOctoToast({ title: "代码包已生成", description: result.zipPath })
      return
    }
    await api.copyFileTo(result.zipPath, dest)
    showOctoToast({ title: "已导出代码包", description: size ? `${fileName}（${size}）` : fileName })
  } catch (error) {
    showOctoToast({
      title: "导出代码包失败",
      description: error instanceof Error ? error.message : String(error),
      variant: "error",
    })
  } finally {
    setExportingDir(null)
  }
}

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

// ── 预览卡片的身份(SPEC-DES-004)──────────────────────────────────
// 卡片只记产物,不记端口:`fastui://<产物名>`。端口会过期(服务一停就还给系统,会被别的
// 对话捡走),产物名不会。真正的地址在预览面板打开时向主进程当场取。
const FASTUI_SCHEME = "fastui://"

export function fastuiPreviewUrl(projectName: string): string {
  return `${FASTUI_SCHEME}${projectName}`
}

/**
 * `fastui://<产物名>` → 产物名;不是这个形态返回 null。
 * 产物名为空串表示「产物未知」—— 由旧版 `http://127.0.0.1:<port>` 卡片转来,交给主进程在
 * 对话只有一个工程时确定。
 */
export function parseFastuiPreview(url?: string | null): string | null {
  const raw = (url ?? "").trim()
  if (!raw.toLowerCase().startsWith(FASTUI_SCHEME)) return null
  let name = raw.slice(FASTUI_SCHEME.length).replace(/\/+$/, "")
  try {
    name = decodeURIComponent(name)
  } catch {
    /* 不是编码过的就原样用 */
  }
  // 产物名是单段目录名;带路径分隔符或查询串的不是合法卡片
  if (/[/\\?#]/.test(name)) return null
  return name
}

/** loopback 的 http(s) 地址(旧版 fastui 卡片与其他本地服务都是这个形态) */
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
// 导出按钮挂在 subtype "fastui" 的 tab 上(SPEC-DES-005),但仍以磁盘事实为准,不只看 tab 形态:
// 判据取「会话目录下有没有 .octo-fastui.json」—— 只有 fastui skill 的 new-session 会写出
// 那个文件,是确定的存在性判断,不是猜。旧版卡片转 fastui:// 时也用它判断会话(见 index.tsx)。
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

/** 会话目录下有没有 fastui 状态文件(确定的存在性判断);结果顺带写入缓存 */
export async function sessionHasFastuiState(sessionDir: string): Promise<boolean> {
  const api = getDesktopApi()
  const sep = sessionDir.includes("\\") ? "\\" : "/"
  let exists = false
  try {
    exists = !!(await api?.fileExists?.([sessionDir, ".octo-fastui.json"].join(sep)))
  } catch {
    /* 读不到就当不是 fastui 会话 */
  }
  setFastuiSessions((prev) => (prev[sessionDir] === exists ? prev : { ...prev, [sessionDir]: exists }))
  return exists
}

async function probeFastuiSession(sessionDir: string): Promise<void> {
  const exists = await sessionHasFastuiState(sessionDir)
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
export async function exportFastuiZip(sessionDir: string, projectName?: string): Promise<void> {
  if (exportingDir()) return
  const api = getDesktopApi()
  if (!api?.fastuiExportZip) {
    showOctoToast({ title: "当前环境不支持导出代码包", variant: "error" })
    return
  }

  setExportingDir(sessionDir)
  try {
    // 带产物名导出该工程:同一对话可以有多个工程,状态文件只记最后建的那个
    const result = await api.fastuiExportZip(sessionDir, projectName || undefined)
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

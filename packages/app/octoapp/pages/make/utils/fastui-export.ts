/**
 * fastui 代码包导出的前端侧(SPEC-DES-001 §8.6.2)
 *
 * 打包本身由主进程调 skill 的 `export-zip.mjs` 完成(前端自己压缩会跟随工程根的
 * node_modules 链接把共享池那 1GB 打进去,也拿不到 ZIP 的 UTF-8 flag);这里只负责
 * 「拿到 zip 之后交给用户」。入口是 action bar 的标准下载按钮(SPEC-DES-007 §8);
 * 归档(SPEC-DES-007 §7,fastui-archive.ts)打的是同一个包,共用这里的打包锁。
 */
import { createSignal } from "solid-js"

import { type FastuiTarget, getDesktopApi } from "../lib/electron-api"
import { showOctoToast } from "../components/octo-toast"
import { DownloadCancelledError } from "../subtype-handlers/default"

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

/**
 * 卡片的目标(SPEC-DES-008 §3.7)。工程在哪由主进程按(工作区, 会话, 产物名)查 ——
 * 普通工作区在 `.octo/<sid>/outputs/<产物名>`,代码工作区在 `<工作区>/<产物名>`,前端不拼路径。
 * 产物名为空串表示「产物未知」(旧版卡片),交给主进程在对话只有一个工程时确定。
 */
export function fastuiTargetOf(workspaceDir?: string, sessionId?: string, name?: string): FastuiTarget | null {
  if (!workspaceDir || !sessionId) return null
  return { workspaceDir, sessionId, name: name || undefined }
}

/**
 * 主进程按这个目标找不找得到工程 —— 与预览同一个查找函数,是确定的存在性判断,不是猜。
 * 旧版卡片转 fastui:// 时用它判断这张卡片背后有没有 fastui 工程(见 index.tsx)。
 */
export async function hasFastuiProject(target: FastuiTarget): Promise<boolean> {
  try {
    return !!(await getDesktopApi()?.fastuiResolve?.(target))?.ok
  } catch {
    return false // 问不到就当不是 fastui 工程
  }
}

/**
 * 链接卡片里的磁盘路径 → 绝对路径(正斜杠)。与 make/index.tsx 打开链接卡片时的拼法一致:
 * 绝对路径原样归一,相对路径相对工作区。
 */
export function absoluteLinkPath(link: string, workspaceDir: string): string {
  const p = link.trim().replace(/\\/g, "/")
  if (/^([A-Za-z]:\/|\/)/.test(p)) return p.replace(/\/+/g, "/")
  return `${workspaceDir.replace(/\\/g, "/").replace(/\/+$/, "")}/${p}`.replace(/\/+/g, "/")
}

/**
 * 文件属于哪个 fastui 工程,返回产物名;不属于、或环境不支持时返回 null(SPEC-DES-008 §3.8)。
 * 判定在主进程:往上找工程标记,并按卡片的查找顺序反查同一个工程,对不上就不算。
 */
export async function fastuiProjectOfFile(target: FastuiTarget, filePath: string): Promise<string | null> {
  try {
    const r = await getDesktopApi()?.fastuiProjectOf?.({ ...target, filePath })
    return r?.ok ? r.name : null
  } catch {
    return null
  }
}

// ── 导出 ─────────────────────────────────────────────────────────
const [exporting, setExporting] = createSignal(false)

/**
 * 有工程正在打包(下载或归档)。锁是全局的(一次只跑一个打包脚本),所以 busy 也要按全局判 ——
 * 只按自己那张卡片判的话,在另一个会话的 tab 上点下载会静默什么都不发生。
 */
export function isExportingAny(): boolean {
  return exporting()
}

function formatBytes(bytes: number): string {
  if (!bytes) return ""
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function baseNameOf(p: string): string {
  return p.split(/[\\/]/).filter(Boolean).pop() ?? "project.zip"
}

type FastuiZip = { zipPath: string; bytes: number }

/**
 * 打包,并在锁内使用这个 zip。下载与归档都经过这里:主进程不加锁,同一工程的两个打包脚本
 * 会同时写同一个 `export/<产物名>.zip`,所以锁必须在这一层共用。
 * 锁被占用、环境不支持、打包失败都抛错,`error` 是可直接展示给用户的一句话。
 */
export async function withFastuiZip<T>(target: FastuiTarget, use: (zip: FastuiZip) => Promise<T>): Promise<T> {
  if (exporting()) throw new Error("已有代码包正在打包，请稍后再试")
  const api = getDesktopApi()
  if (!api?.fastuiExportZip) throw new Error("当前环境不支持导出代码包")

  setExporting(true)
  try {
    // 带产物名导出该工程:同一对话可以有多个工程
    const result = await api.fastuiExportZip(target)
    if (!result?.ok) throw new Error(result?.error || "未知原因")
    return await use(result)
  } finally {
    setExporting(false)
  }
}

/**
 * 打包 → 让用户选保存位置 → 拷过去。
 * zip 已经在磁盘上,不走 action-bar 里 `downloadBlob` 那套(那是给内容型 tab 用的)。
 *
 * 由 action bar 的 handleDownload 调用,失败与取消都抛给它统一处理:
 * - 失败抛 Error,action bar 弹「下载失败」并带上原因,这里不再自己弹错误提示
 * - 取消保存抛 DownloadCancelledError,action bar 删掉任务项;临时 zip 留在原处,与其他产物一致
 */
export async function exportFastuiZip(target: FastuiTarget): Promise<void> {
  // 正常由 handler 的 isDownloadBusy 先挡住;这里兜底,不并发跑两个打包脚本
  if (exporting()) return
  const api = getDesktopApi()
  if (!api?.fastuiExportZip || !api.saveFilePicker || !api.copyFileTo) {
    throw new Error("当前环境不支持导出代码包")
  }
  const { saveFilePicker, copyFileTo } = api

  await withFastuiZip(target, async (zip) => {
    const fileName = baseNameOf(zip.zipPath)
    const dest = await saveFilePicker({ title: "保存代码包", defaultPath: fileName })
    if (!dest) throw new DownloadCancelledError()

    await copyFileTo(zip.zipPath, dest)
    const size = formatBytes(zip.bytes)
    showOctoToast({ title: "已导出代码包", description: size ? `${fileName}（${size}）` : fileName })
  })
}

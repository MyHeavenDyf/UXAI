/**
 * 3D workspace 编排器（Step 6）—— 模板副本物化 + 版本 code delta 铺盖 + vite dev server 生命周期。
 *
 * 背景：3d-templete 是模板母版，每轮 LLM 生成在干净副本里改代码（不污染母版、可追溯历史）。
 * 全局唯一一个 workspace（方案A）：切会话/切版本 = 全量 re-materialize + 铺当前版本 code delta + 重启 dev。
 *
 * 路径约定（与 version-history.ts 一致）：
 *   - workspace 工程目录：{sdkDir}/.octo/design-3d/workspace
 *   - 版本代码归档目录：{historyDir}/{sessionId}/{versionId}/code  （historyDir = {sdkDir}/.octo/design-3d/history）
 *
 * 所有 IPC 在主进程完成（cpSync/junction/spawn/taskkill），renderer 只编排。
 * 非 Electron 环境（无 window.api）抛错——workspace 仅桌面端可用，web 端走 previewdist3d（另步）。
 */

import { getDesktopApi } from "./desktop-api"

/** workspace dev server 固定端口（CLI --strictPort，与 5173 模板端口、51856 pattern previewdist 区分开） */
export const WORKSPACE_PORT = 51857

/** workspace 工程目录绝对路径 */
export function workspaceDir(sdkDir: string): string {
  return `${sdkDir}/.octo/design-3d/workspace`
}

/**
 * 3D 源路径运行时解析（打包版支持）：
 * - 打包版：get3dSrcDirs IPC 返回 resources/3d/ 下的模板快照+组件库路径（主进程 app.isPackaged 判定）。
 *   IPC 结果必须优先于烘焙 env —— exe 里 import.meta.env.VITE_3D_* 是构建期烘焙的开发机路径，
 *   在目标机器上不存在。
 * - dev：IPC 返 null → 走 VITE_3D_* env/默认路径（现有行为，零回归）。
 */
export async function resolve3dSrcDirs(): Promise<{ templateDir: string; componentsDir: string }> {
  const res = (await getDesktopApi()?.get3dSrcDirs?.()) ?? null
  if (res && res.templateDir && res.componentsDir) return res
  // IPC 不可用 或 返回空路径（3d 仓库未找到）
  const hint = res?.error ?? "3D 源路径不可用：需在 Electron 环境运行，且 3d-templete/3d-components 已就位"
  throw new Error(hint)
}

/**
 * 物化 workspace：拷模板母版（排除 node_modules/dist/.git/.husky）→ workspace，
 * node_modules 用 Windows junction 软链，重写 vite.config.ts 别名到 3d-components 源码绝对路径。
 * 全量覆盖（主进程先 rm 再 cp），保证切版本无脏文件残留。
 */
export async function materialize(sdkDir: string): Promise<{ ok: true }> {
  const materializeWorkspace = getDesktopApi()?.materializeWorkspace
  if (!materializeWorkspace) throw new Error("workspace IPC 不可用（非 Electron 环境）")
  const dirs = await resolve3dSrcDirs()
  return materializeWorkspace(dirs.templateDir, workspaceDir(sdkDir), dirs.componentsDir + "/src")
}

/**
 * 把版本 code delta 铺到 workspace：递归读 codeDir 下所有文件 → 逐个 decode → overlay 写入 workspace。
 * codeDir 由 version-history 在 appendSceneVersion 时写入并记录在版本条目上。
 */
export async function overlayVersionCode(sdkDir: string, codeDir: string): Promise<void> {
  const api = getDesktopApi()
  const listDirectory = api?.listDirectory
  const readFileBuffer = api?.readFileBuffer
  const overlayWorkspaceFiles = api?.overlayWorkspaceFiles
  if (!listDirectory || !readFileBuffer || !overlayWorkspaceFiles)
    throw new Error("workspace IPC 不可用（非 Electron 环境）")
  const entries = await listDirectory(codeDir)
  const files: { path: string; content: string }[] = []
  for (const e of entries) {
    if (e.type !== "file") continue
    const buf = await readFileBuffer(`${codeDir}/${e.path}`)
    if (!buf) continue
    files.push({ path: e.path, content: new TextDecoder().decode(buf) })
  }
  if (files.length > 0) await overlayWorkspaceFiles(workspaceDir(sdkDir), files)
}

/** 启动 workspace vite dev server，返回 embed URL（ready 后才返回，主进程已解析 stdout 拿端口）。 */
export async function startDev(sdkDir: string): Promise<string> {
  const startWorkspaceDev = getDesktopApi()?.startWorkspaceDev
  if (!startWorkspaceDev) throw new Error("workspace IPC 不可用（非 Electron 环境）")
  const res = await startWorkspaceDev(workspaceDir(sdkDir), WORKSPACE_PORT)
  if (!res.ok) throw new Error(res.error)
  return res.url
}

/** 停掉 workspace dev server（主进程 taskkill /T /F 连子进程一起杀）。无活动 server 时 no-op。 */
export async function stopDev(): Promise<void> {
  const stopWorkspaceDev = getDesktopApi()?.stopWorkspaceDev
  if (!stopWorkspaceDev) return
  await stopWorkspaceDev()
}

/**
 * 通知 workspace dev 失效全部模块缓存（viteWorkspace.config 的 /_octo/touch 端点）。
 * overlay 落盘后、reload 前调用：iframe 下次请求必拿新 transform，不赌 chokidar 事件时序
 * （reload 早于 vite 失效 → etag 命中缓存旧代码）。失败（dev 没跑 / 旧 workspace 无端点）抛错，调用方降级。
 */
export async function touchWorkspaceDev(): Promise<void> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 2000)
  try {
    const res = await fetch(`http://127.0.0.1:${WORKSPACE_PORT}/_octo/touch`, {
      method: "POST",
      signal: controller.signal,
    })
    if (!res.ok) throw new Error(`/_octo/touch ${res.status}`)
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 切版本：stopDev → 全量 materialize → 铺该版本 code delta（若有）→ startDev。
 * 返回 dev server embed URL。调用方拿到 URL 后：bump wsNonce（iframe 强制重载）→ SCENE_READY → 推 sceneState。
 *
 * 串行化（关键）：进页面恢复 effect 与按钮点击/版本切换可能并发调 switchVersion。后到的会 stopDev
 * 杀前者刚 ready 的 vite —— 必须排队等前者完整完成（startDev resolve → 主进程 settled=true），
 * 否则前者的 startDev 在 vite 被 taskkill 时 settled 仍为 false → reject "vite 退出(code null)"。
 * 排队后前者已 settled，其 vite 被杀时 exit handler 走 else 分支（仅清句柄，不 reject）。
 */
let switchChain: Promise<unknown> = Promise.resolve()
export async function switchVersion(sdkDir: string, codeDir: string | null): Promise<string> {
  const run = switchChain.then(async () => {
    await stopDev()
    await materialize(sdkDir)
    if (codeDir) await overlayVersionCode(sdkDir, codeDir)
    return startDev(sdkDir)
  })
  // chain 永不 reject（吞掉本轮失败），保证后续调用不被阻塞；run 本身的 reject 仍原样传给调用方。
  switchChain = run.catch(() => {})
  return run
}

/**
 * workspace 所有权跟踪 —— 单例 workspace 的并发互踩防护。
 *
 * workspace 全局唯一、同 app 多会话共享：一个会话 switchVersion（stopDev→materialize→startDev）
 * 会把另一会话刚 ready 的 vite 杀掉 → 另一会话预览白屏/错乱，且无任何提示。
 * acquireWorkspace 显式标记当前 owner：接管方 toast 提醒；被接管方据 workspaceOwner !== sid
 * 显示「被另一会话接管 [恢复]」横幅 + 一键重新 acquire+switchVersion 恢复。
 *
 * 仅同 app 多会话生效（模块级状态共享）；跨 tab/进程需文件锁，另做。
 * 非强制锁（不阻塞接管 —— 仍 last-writer-wins），只把「静默互踩」变「显式 + 可恢复」。
 */
let ownerSid: string | null = null
const ownerListeners = new Set<(sid: string | null) => void>()

/** 标记 sid 为当前 workspace owner。返回是否接管了另一会话（+ 前任 owner）。 */
export function acquireWorkspace(sid: string): { tookOver: boolean; prevOwner: string | null } {
  const prev = ownerSid
  ownerSid = sid
  for (const l of ownerListeners) l(sid)
  return { tookOver: prev !== null && prev !== sid, prevOwner: prev }
}

/** 释放所有权（sid 须是当前 owner 才生效；会话切走 / 卸载时调，避免锁残留）。 */
export function releaseWorkspace(sid: string): void {
  if (ownerSid === sid) {
    ownerSid = null
    for (const l of ownerListeners) l(null)
  }
}

/** 当前 workspace owner 会话 id（无则 null）。 */
export function workspaceOwner(): string | null {
  return ownerSid
}

/** 订阅 owner 变化（同 app 所有会话共享；用于被接管方实时显示横幅）。返回取消订阅。 */
export function onWorkspaceOwnerChange(fn: (sid: string | null) => void): () => void {
  ownerListeners.add(fn)
  return () => {
    ownerListeners.delete(fn)
  }
}


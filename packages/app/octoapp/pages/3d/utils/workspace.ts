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
 * 物化 workspace：拷模板母版（排除 node_modules/dist/.git/.husky）→ workspace，
 * node_modules 用 Windows junction 软链，重写 vite.config.ts 别名到 3d-components 源码绝对路径。
 * 全量覆盖（主进程先 rm 再 cp），保证切版本无脏文件残留。
 */
export async function materialize(sdkDir: string): Promise<{ ok: true }> {
  const materializeWorkspace = getDesktopApi()?.materializeWorkspace
  if (!materializeWorkspace) throw new Error("workspace IPC 不可用（非 Electron 环境）")
  const templateDir = import.meta.env.VITE_3D_TEMPLATE_SRC ?? "D:/cyc/project/octo/3d-templete"
  const componentsSrc =
    (import.meta.env.VITE_3D_COMPONENTS_SRC ?? "D:/cyc/project/octo/3d-components") + "/src"
  return materializeWorkspace(templateDir, workspaceDir(sdkDir), componentsSrc)
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


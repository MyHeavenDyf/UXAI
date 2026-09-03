import type { DesktopApi } from "../lib/electron-api"

/**
 * 把源文件(图片与非图片同链路)导入 worktree 预会话落地区 <baseDir>/.octo/tmps/(SPEC-INS-014 §4.1),
 * 返回落地后的本地绝对路径;原样不转格式。
 *
 * 从 index.tsx copySourceToWorktree 抽出的**纯函数版**(依赖注入 api/baseDir,可单测——
 * 粘贴截图回归正是本链路断的:旧 S3 链路只要 blob 字节不要源路径,改本地路径后
 * getPathForFile 对内存 blob 返回空,若无字节写入兜底就断链。给这条链路补回归网,防再掉进去)。
 *
 * 四条分支:
 *   - 磁盘来源(选择器/拖拽):getPathForFile 拿源路径 → copyFileToWorktree 流式拷贝
 *   - 剪贴板内存 blob(截图/粘贴的文件):getPathForFile 返回空 → 字节经 writeFileToWorktree
 *     IPC 写进同一落点(落地/清洗/撞名与 copy 同一套主进程规则)
 *   - 无 baseDir / preload 未暴露对应 IPC → 返回 null(降级,由调用方决定 UI 语义)
 *   - 拷贝/写入抛错(真失败)→ 上抛,由调用方转可重试错误
 */
export async function importFileToWorktree(
  input: { filename: string; file: File },
  deps: { baseDir?: string; api?: Pick<DesktopApi, "getPathForFile" | "copyFileToWorktree" | "writeFileToWorktree"> },
): Promise<string | null> {
  const { filename, file } = input
  const { baseDir, api } = deps
  if (!baseDir) return null
  let srcPath = ""
  try {
    srcPath = api?.getPathForFile?.(file) ?? ""
  } catch {
    // 取不到真实路径(如剪贴板内存 blob,无落盘来源)→ 走下方字节写入兜底
  }
  if (srcPath) {
    if (typeof api?.copyFileToWorktree !== "function") return null
    // copyFileToWorktree 返回落地后的本地绝对路径(撞名已加后缀);抛错则上抛
    return api.copyFileToWorktree(srcPath, baseDir, filename)
  }
  // 内存 blob:file.arrayBuffer() 读字节(渲染进程本就持有该 blob),writeFileToWorktree
  // 落地/清洗/撞名与 copyFileToWorktree 同一套主进程规则,返回落地绝对路径;抛错则上抛。
  if (typeof api?.writeFileToWorktree !== "function") return null
  return api.writeFileToWorktree(await file.arrayBuffer(), baseDir, filename)
}

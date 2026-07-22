// 本地文件的"用系统应用打开" / "在文件夹中定位"——path 源(write 产物)和新增的文件管理面板
// (SPEC-INS-014 §10)共用同一套实现,原先各自内联在 action-bar.tsx,这里提出来去重。

import { showToast } from "@opencode-ai/ui/toast"
import { getDesktopApi } from "../lib/electron-api"

// shell.openPath 只回一个 OS 层的错误串,区分不了「文件已被移走」和「没有关联应用」——
// 不靠串内容做模糊判断,文案按调用场景选:
// - 磁盘上的既有文件(path 源)两种原因都可能,如实并列;
// - 刚下载落地的临时副本文件必然存在,只可能是没有关联应用。
export const OPEN_FAILED_HINT = "文件可能已被移动或删除,也可能是系统未关联可打开该类型的应用"
export const NO_APP_HINT = "系统未关联可打开该类型的应用,请安装对应应用或设置默认打开方式"
export const REVEAL_NOT_FOUND_HINT = "文件可能已被移动、重命名或删除,请刷新后重试"

export async function openFileLocally(filePath: string): Promise<void> {
  const api = getDesktopApi()
  if (typeof api?.openPath !== "function") {
    showToast({ title: "桌面端能力缺失", description: "缺少 window.api.openPath", variant: "error" })
    return
  }
  console.log("[octo:path] open-local", { filePath })
  try {
    const r = (await api.openPath(filePath)) as unknown as string | undefined
    if (typeof r === "string" && r.length > 0) {
      console.error("[octo:path] open-failed", { filePath, reason: r })
      showToast({ title: "无法打开文件", description: OPEN_FAILED_HINT, variant: "error" })
    }
  } catch (err) {
    console.error("[octo:path] open-failed", { filePath, err })
    showToast({ title: "无法打开文件", description: err instanceof Error ? err.message : String(err), variant: "error" })
  }
}

// 文件不存在时主进程回 { ok: false },不 throw —— 详见 packages/desktop/src/main/ipc.ts 的 show-item-in-folder。
export async function revealFileInFolder(filePath: string): Promise<void> {
  const api = getDesktopApi()
  if (typeof api?.showItemInFolder !== "function") {
    showToast({ title: "桌面端能力缺失", description: "缺少 window.api.showItemInFolder", variant: "error" })
    return
  }
  console.log("[octo:path] reveal-local", { filePath })
  try {
    const r = await api.showItemInFolder(filePath)
    if (r && r.ok === false) {
      console.error("[octo:path] reveal-failed", { filePath, reason: r.reason })
      showToast({ title: "无法定位文件", description: REVEAL_NOT_FOUND_HINT, variant: "error" })
    }
  } catch (err) {
    console.error("[octo:path] reveal-failed", { filePath, err })
    showToast({ title: "无法定位文件", description: err instanceof Error ? err.message : String(err), variant: "error" })
  }
}

// SPEC-INS-014 §10.1:文件管理面板的"上传"——脱离对话框也能往 .octo/<sessionId>/uploads/ 塞文件。
// 复用输入框附件那条既有落地链路(不新造上传通道):copyFileToWorktree 拷进预会话区 uploads/ →
// movePendingUploadToSession rename 进本会话目录。文件管理面板一定处在真实会话里,故拷完直接归属;
// 撞名加后缀、sanitize 都由主进程处理。返回落地成功数,调用方据此决定是否刷新列表。
export async function copyFilesToSessionUploads(
  files: File[],
  baseDir: string,
  sessionId: string,
): Promise<{ ok: number; failed: number }> {
  const api = getDesktopApi()
  if (
    !baseDir ||
    !sessionId ||
    typeof api?.getPathForFile !== "function" ||
    typeof api?.copyFileToWorktree !== "function"
  ) {
    showToast({ title: "无法上传", description: "未选择项目目录或当前非桌面端环境", variant: "error" })
    return { ok: 0, failed: files.length }
  }
  let ok = 0
  let failed = 0
  for (const file of files) {
    let srcPath = ""
    try {
      srcPath = api.getPathForFile(file)
    } catch {
      // 拿不到真实路径(如剪贴板内存 blob)→ 无法磁盘拷贝,跳过
    }
    if (!srcPath) {
      failed++
      console.warn("[octo:worktree] upload-copy skipped (no source path)", { filename: file.name })
      continue
    }
    try {
      const dest = await api.copyFileToWorktree(srcPath, baseDir, file.name)
      let finalPath = dest
      if (typeof api.movePendingUploadToSession === "function") {
        try {
          finalPath = await api.movePendingUploadToSession(dest, baseDir, sessionId)
        } catch (err) {
          console.warn("[octo:worktree] upload-move failed, kept in pending area", { dest, err })
        }
      }
      console.log("[octo:worktree] upload-copy ok", { srcPath, dest: finalPath, sessionId })
      ok++
    } catch (err) {
      failed++
      console.error("[octo:worktree] upload-copy failed", { srcPath, filename: file.name, err })
    }
  }
  if (ok > 0) showToast({ title: "上传完成", description: `已导入 ${ok} 个文件`, variant: "success", duration: 2000 })
  if (failed > 0) showToast({ title: "部分文件未能上传", description: `${failed} 个文件失败`, variant: "error" })
  return { ok, failed }
}

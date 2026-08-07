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
// openFileOrReveal 三步全败(开文件 / 定位 / 开父目录)时用:此时多半是路径本身就错(文件与父目录都不在),
// 与 OPEN_FAILED_HINT 的「无关联应用」语义无关,单列更准。
export const OPEN_OR_REVEAL_FAILED_HINT = "文件及其所在目录均无法打开,请确认路径是否正确"

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

// 点一下既要打开的场景(如权限浮窗点路径):先尝试用系统默认应用打开文件,失败(无关联应用 /
// 文件被移走)再退而在文件夹中定位该文件;若文件本身不存在(showItemInFolder 判 not-found),
// 再退一步打开其父目录(优先 external_directory 的 metadata.parentDir,缺省时从文件路径推),
// 三条路都走不通才报错。不复用 openFileLocally:它在失败时即弹"无法打开文件",而这里期望
// fallback 成功时不打扰用户。shell.openPath 约定为空串=成功、非空串=错误说明,仅 IPC 层异常才
// reject,故 reject 也归一为非空串参与 fallback 判定。
export async function openFileOrReveal(filePath: string, parentDir?: string): Promise<void> {
  const api = getDesktopApi()
  if (typeof api?.openPath !== "function") {
    showToast({ title: "桌面端能力缺失", description: "缺少 window.api.openPath", variant: "error" })
    return
  }
  // parentDir 缺省时从目标路径推一个(external_directory 传权威值;read 权限 metadata 空时兜底),
  // 让"开父目录"这步在所有权限类型下都可用,而非只在传了 parentDir 时才兜得住。
  const sep = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"))
  const dir = parentDir ?? (sep > 0 ? filePath.slice(0, sep) : undefined)
  console.log("[octo:path] open-or-reveal", { filePath, dir })
  const openResult = await api
    .openPath(filePath)
    .catch((err: unknown) => (err instanceof Error ? err.message : String(err)))
  // 空串/非字符串 = 打开成功,直接返回
  if (typeof openResult !== "string" || openResult.length === 0) return
  // 打开失败(非空错误串):文件在则定位到文件夹
  if (typeof api.showItemInFolder === "function") {
    console.warn("[octo:path] open-failed-fallback-reveal", { filePath, reason: openResult })
    const reveal = await api.showItemInFolder(filePath).catch(() => undefined)
    if (reveal?.ok) return
  }
  // 文件不在 / 定位失败:打开其父目录(父目录通常仍在,至少让用户看到落点而非死弹窗)
  if (dir) {
    console.warn("[octo:path] reveal-failed-fallback-dir", { dir, reason: openResult })
    const dirResult = await api
      .openPath(dir)
      .catch((err: unknown) => (err instanceof Error ? err.message : String(err)))
    if (typeof dirResult !== "string" || dirResult.length === 0) return
  }
  console.error("[octo:path] open-or-reveal-failed", { filePath, reason: openResult })
  showToast({ title: "无法打开文件", description: OPEN_OR_REVEAL_FAILED_HINT, variant: "error" })
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

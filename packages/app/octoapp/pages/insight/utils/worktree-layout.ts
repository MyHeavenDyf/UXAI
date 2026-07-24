// Insight 本地工作目录布局 —— 渲染端单一真相源。
//
// 布局 SOT(唯一真相源)是 SPEC-INS-014 `docs/specs/infra/insight-worktree-layout.md` §2。
// 真正的落盘由**主进程** `packages/desktop/src/main/ipc.ts` 完成(copy-file-to-worktree /
// move-pending-upload-to-session),它才是布局的权威实现;本模块是渲染端为「发送时要不要搬迁」
// 所需的**镜像判据**。两处受进程边界隔离、无法共享同一常量(desktop 主进程不 import 渲染端包),
// 因此布局一旦变更,必须同步改三处:① 本文件常量 ② ipc.ts 落点构造 ③ SPEC-INS-014 §2。
//
// 背景:v7 迁移(PR #411)把落点从 `insight/uploads` 收进 `.octo/tmps`,ipc.ts 改了、渲染端判据
// 漏改(只改注释、函数体仍找 `insight`)→ 判据恒假 → 附件搬不进会话(PR #424 修)。把判据从页面
// 组件抽到本模块并集中布局常量,就是为了让「布局知识」有唯一入口、可单测,避免再次脱节。

/** 全局本地根(v7):所有模块的本地落点统一收进此目录。 */
export const OCTO_ROOT = ".octo"

/** 预会话落地区目录段:`<projectDir>/.octo/tmps/`(SPEC-INS-014 §4.1.2)。
 *  非图片附件在没有真实 sessionId 时先落这里,发送时 rename 进 `.octo/<sessionId>/uploads/`。 */
export const PENDING_UPLOAD_SEGMENT = "tmps"

/** 附件本地路径是否还在预会话落地区 `<projectDir>/.octo/tmps/`——发送时据此决定要不要 rename 进
 *  `.octo/<sessionId>/uploads/`。已归属会话的(路径已是 `.octo/<sessionId>/uploads/`)返回 false,不重复挪。 */
export function isPendingUploadPath(filePath: string): boolean {
  const segs = filePath.split(/[\\/]/)
  const i = segs.lastIndexOf(OCTO_ROOT)
  return i !== -1 && segs[i + 1] === PENDING_UPLOAD_SEGMENT
}

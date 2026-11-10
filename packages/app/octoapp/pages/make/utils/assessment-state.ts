import { createSignal } from "solid-js"
import type { WorkspaceKind } from "@/context/server"
import { getDesktopApi } from "../lib/electron-api"
import { showOctoToast } from "../components/octo-toast"
import { tracker } from "@/utils/tracker"


export type AssessmentSolution = { desc: string; suggest: string }

/** 评审数据单条。type 为单个子类字符串（如 "颜色"），主分类由 ASSESSMENT_CATEGORY_OF 反查 */
export type AssessmentReviewItem = {
  xpath: string
  pin: number
  title: string
  type: string
  solution: AssessmentSolution[]
}

/** 三大分类 → 子类（面板一级 Tab / 二级筛选 / pin 类型标签共用） */
export const ASSESSMENT_CATEGORIES: Record<string, string[]> = {
  Token遵从度: ["颜色", "字体", "间距与尺寸", "边框/圆角/阴影", "Token有效性"],
  组件遵从度: ["页面骨架", "核心 Block", "基础控件", "规范可追溯性"],
  页面完整度: ["页面结构", "业务内容", "可见渲染", "构建交付"],
}

/** 子类 → 主分类 */
export const ASSESSMENT_CATEGORY_OF: Record<string, string> = Object.fromEntries(
  Object.entries(ASSESSMENT_CATEGORIES).flatMap(([cat, subs]) => subs.map((sub) => [sub, cat])),
)

/** 校验并归一化 annotations.json 内容。
 *  语义：空数组 `[]` 为**合法空结果**（返回 `[]`——面板走「本次评估未发现问题」空态）；
 *  非数组或全部条目非法返回 null（结构异常）；部分非法时丢弃并告警，返回合法子集。 */
export function parseReviewItems(raw: unknown): AssessmentReviewItem[] | null {
  if (!Array.isArray(raw)) return null
  if (raw.length === 0) return []
  const items: AssessmentReviewItem[] = []
  let dropped = 0
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") {
      dropped++
      continue
    }
    const o = entry as Record<string, unknown>
    const solution = Array.isArray(o.solution)
      ? o.solution.flatMap((s) => {
          if (!s || typeof s !== "object") return []
          const so = s as Record<string, unknown>
          if (typeof so.desc !== "string" || typeof so.suggest !== "string") return []
          return [{ desc: so.desc, suggest: so.suggest }]
        })
      : []
    const { xpath, pin, title, type } = o
    if (typeof xpath !== "string" || xpath.length === 0 || typeof pin !== "number" || typeof title !== "string" || typeof type !== "string" || solution.length === 0) {
      dropped++
      continue
    }
    items.push({ xpath, pin, title, type, solution })
  }
  if (items.length === 0) return null
  if (dropped > 0) console.warn(`[assessment] annotations.json 含 ${dropped} 条非法条目，已丢弃`)
  return items
}

// ── 待修改状态（idle / pending / paused）───────────────────────────────

export type PendingAssessment = {
  /** 评估文件绝对路径 */
  fileKey: string
  /** 正斜杠归一化路径（发送文案用） */
  filePath: string
  /** 评估时选中的二级菜单技能名 */
  skillName: string
  reviewData: AssessmentReviewItem[]
}

export type AssessmentStatus = "idle" | "pending" | "paused"

const [status, setStatus] = createSignal<AssessmentStatus>("idle")
const [pending, setPending] = createSignal<PendingAssessment | null>(null)

export const assessmentStatus = status
export const pendingAssessment = pending

// ── 二级菜单选中技能项（按文件隔离）────────────────────────────────────

const [selectedSkills, setSelectedSkills] = createSignal<Record<string, string>>({})

export function selectedSkillFor(fileKey: string): string | undefined {
  return selectedSkills()[fileKey]
}

export function selectAssessmentSkill(fileKey: string, skillName: string) {
  setSelectedSkills((prev) => ({ ...prev, [fileKey]: skillName }))
}

// ── 路径推导（依赖 make 页注入的上下文）───────────────────────────────

let assessCtx: { projectDir: string; sessionId: string; workspaceKind: WorkspaceKind } | null = null

export function setAssessmentContext(ctx: { projectDir: string; sessionId: string; workspaceKind: WorkspaceKind }) {
  assessCtx = ctx
}

const sepOf = (p: string) => (p.includes("\\") ? "\\" : "/")

/** 评审数据文件（技能写入，前端只读）：
 *  <被评估文件所在目录>/评估报告_<文件名去扩展名>_<技能名>/annotations.json
 *  评估报告文件夹与被评估 html 同级（提示词"评估结果保存到目录: <文件所在目录>"），与工作区类型无关 */
export function computeAssessmentReviewPath(filePath: string, skillName: string): string | null {
  if (!filePath) return null
  const normalized = filePath.replace(/\\/g, "/")
  const base = (normalized.split("/").pop() ?? "").replace(/\.[^.]+$/, "")
  const slashIdx = normalized.lastIndexOf("/")
  const dir = slashIdx === -1 ? "" : normalized.slice(0, slashIdx)
  return [dir, `评估报告_${base}_${skillName}`, "annotations.json"].join("/")
}

/** 状态文件（前端写/读/删）：
 *  normal = .octo/<sid>/assessment/<safe>.json；code = .octo/assessment/<safe>.json（项目级，同标注的跨会话约定）
 *  safe = 评估文件相对项目根路径（兜底文件名），分隔符替换为 _ */
export function computeAssessmentStatePath(fileKey: string): string | null {
  if (!assessCtx) return null
  const { projectDir, sessionId, workspaceKind } = assessCtx
  const sep = sepOf(projectDir)
  const normFile = fileKey.replace(/\\/g, "/")
  const normDir = projectDir.replace(/\\/g, "/")
  const rel = normFile.startsWith(normDir + "/")
    ? normFile.slice(normDir.length + 1)
    : (normFile.split("/").pop() ?? normFile)
  const dir = workspaceKind === "code"
    ? [projectDir, ".octo", "assessment"].join(sep)
    : [projectDir, ".octo", sessionId, "assessment"].join(sep)
  return [dir, `${rel.replace(/[\\/]/g, "_")}.json`].join(sep)
}

// ── 磁盘持久化（desktop IPC，writeFileBuffer 自动建父目录）─────────────

type PersistedAssessment = PendingAssessment & { savedAt: number }

async function persistPending(data: PendingAssessment) {
  const path = computeAssessmentStatePath(data.fileKey)
  const api = getDesktopApi()
  if (!path || !api?.writeFileBuffer) return
  try {
    const payload: PersistedAssessment = { ...data, savedAt: Date.now() }
    await api.writeFileBuffer(path, new TextEncoder().encode(JSON.stringify(payload)).buffer as ArrayBuffer)
  } catch (err) {
    console.warn("[assessment] 状态落盘失败", err)
  }
}

export async function loadPersistedAssessment(fileKey: string): Promise<PendingAssessment | null> {
  const path = computeAssessmentStatePath(fileKey)
  const api = getDesktopApi()
  if (!path || !api?.readFileBuffer) return null
  try {
    const buf = await api.readFileBuffer(path)
    if (!buf) return null
    const parsed = JSON.parse(new TextDecoder().decode(buf)) as Partial<PersistedAssessment>
    const reviewData = parseReviewItems(parsed.reviewData)
    if (!parsed.fileKey || !parsed.filePath || !parsed.skillName || !reviewData) return null
    return { fileKey: parsed.fileKey, filePath: parsed.filePath, skillName: parsed.skillName, reviewData }
  } catch {
    return null
  }
}

async function clearPersistedAssessment(fileKey: string) {
  const path = computeAssessmentStatePath(fileKey)
  const api = getDesktopApi()
  if (!path || !api?.deleteFile) return
  try {
    await api.deleteFile(path)
  } catch (err) {
    console.warn("[assessment] 状态文件清除失败", err)
  }
}

// ── 状态流转 ──────────────────────────────────────────────────────────

export function enterPending(data: PendingAssessment) {
  setPending(data)
  setStatus("pending")
  selectAssessmentSkill(data.fileKey, data.skillName)
  void persistPending(data)
}

/** 暂停：关闭评估结果面板、隐藏 pin（组件按 status 响应，Phase 3/4 接线），磁盘数据保留 */
export function pauseAssessment() {
  if (status() !== "pending") return
  setStatus("paused")
}

/** 恢复：暂停态重新进入待修改状态 */
export function resumeAssessment() {
  if (status() !== "paused" || !pending()) return
  setStatus("pending")
}

/** 退出：清磁盘状态数据、移除 pin、关闭面板（组件按 status 响应）、清选中态 */
export function exitPendingAssessment() {
  const data = pending()
  if (!data) return
  setStatus("idle")
  setPending(null)
  setSelectedSkills((prev) => {
    if (!(data.fileKey in prev)) return prev
    const next = { ...prev }
    delete next[data.fileKey]
    return next
  })
  void clearPersistedAssessment(data.fileKey)
}

// ── 评审数据采集（busy→idle 钩子调用）─────────────────────────────────

const [assessmentTurn, setAssessmentTurn] = createSignal<{ fileKey: string; filePath: string; skillName: string } | null>(null)

/** sendAssessment 发送前记录本回合，供回合结束后按 (文件, 技能) 拼 annotations.json 路径 */
export function recordAssessmentTurn(opts: { fileKey: string; filePath: string; skillName: string }) {
  setAssessmentTurn(opts)
}

/** 发送失败（ack 失败）时清除回合标记，避免下次 busy→idle 误采集 */
export function clearAssessmentTurn() {
  setAssessmentTurn(null)
}


export async function harvestAssessmentReview(): Promise<void> {
  const turn = assessmentTurn()
  if (!turn) return
  setAssessmentTurn(null)
  const reviewPath = computeAssessmentReviewPath(turn.filePath, turn.skillName)
  const api = getDesktopApi()
  if (!reviewPath || !api?.readFileBuffer) return
  // 采集结果打点：有没有生成评审数据 + 成功时的条数（skill 字段可区分 DMG预审 的预期未产出）
  const track = (fields: Record<string, unknown>) =>
    tracker.interaction({ module: "design", name: "assessment-harvest", extend: JSON.stringify({ skill: turn.skillName, ...fields }) })
  let raw: unknown
  try {
    const buf = await api.readFileBuffer(reviewPath)
    if (!buf) {
      // 文件夹存在但 annotations.json 缺失 = 命名错误（toast 提示）；文件夹不存在 = 技能未产出（静默，DMG预审 正常路径）
      const dir = reviewPath.replace(/[\\/][^\\/]+$/, "")
      const folderExists = await api.dirExists?.(dir)
      if (folderExists) {
        showOctoToast({ title: "评审数据文件缺失", description: "请将评审数据文件命名为 annotations.json", variant: "error" })
      }
      track({ ok: false, reason: folderExists ? "file-missing-in-folder" : "file-missing" })
      return
    }
    raw = JSON.parse(new TextDecoder().decode(buf))
  } catch (err) {
    console.warn("[assessment] 读取 annotations.json 失败", reviewPath, err)
    showOctoToast({ title: "评审数据读取失败", description: "annotations.json 不是合法的 JSON", variant: "error" })
    track({ ok: false, reason: "json-parse" })
    return
  }
  const reviewData = parseReviewItems(raw)
  if (!reviewData) {
    console.warn("[assessment] annotations.json 结构非法", reviewPath)
    showOctoToast({ title: "评审数据格式异常", description: "annotations.json 结构不符合评审数据契约", variant: "error" })
    track({ ok: false, reason: "invalid-structure" })
    return
  }
  track({ ok: true, count: reviewData.length })
  enterPending({ fileKey: turn.fileKey, filePath: turn.filePath, skillName: turn.skillName, reviewData })
}

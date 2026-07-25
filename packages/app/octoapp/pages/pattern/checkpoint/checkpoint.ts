/**
 * Checkpoint — 统一的检查点持久化方案
 * 文件路径: {dir}/{sessionId}/checkpoint.json
 * 一个 session 一个 checkpoint.json，通过 stage 字段区分当前阶段。
 */
import { getDesktopApi } from "../utils/desktop-api"
import type { BlockModuleItem } from "../utils/pattern-resource"

// ─── 通用读写机制 ───
const CHECKPOINT_FILENAME = "checkpoint"

export async function saveCheckpoint(dir: string, sessionId: string, data: Checkpoint): Promise<void> {
  const api = getDesktopApi()
  const path = `${dir}/${sessionId}/${CHECKPOINT_FILENAME}.json`
  const payload = JSON.stringify(data, null, 2)
  if (api?.writeFileBuffer) {
    const encoder = new TextEncoder()
    await api.writeFileBuffer(path, encoder.encode(payload).buffer)
  }
}

export async function loadCheckpoint(dir: string, sessionId: string): Promise<Checkpoint | null> {
  const api = getDesktopApi()
  const path = `${dir}/${sessionId}/${CHECKPOINT_FILENAME}.json`
  if (api?.readFileBuffer) {
    try {
      const buf = await api.readFileBuffer(path)
      if (!buf) return null
      return JSON.parse(new TextDecoder().decode(buf)) as Checkpoint
    } catch {
      return null
    }
  }
  return null
}

export async function clearCheckpoint(dir: string, sessionId: string): Promise<void> {
  const api = getDesktopApi()
  const path = `${dir}/${sessionId}/${CHECKPOINT_FILENAME}.json`
  if (api?.deleteFile) {
    await api.deleteFile(path)
  }
}

// ─── 统一 Checkpoint 类型 ───

export type CheckpointStage = "intent_confirm" | "block_matching" | "pattern_page" | "intent_create" | "planner_create" | "modules_create"

export type ModuleCheckpoint = {
  sectionId: string
  elementId: string
  idPrefix: string
  status: "done" | "failed"
  ui_json?: any
  error?: string
}

export type Checkpoint = {
  /** 当前 pipeline 阶段 */
  stage: CheckpointStage

  /** 用户原始输入 */
  userInput: string

  /** 设计系统主题（如 ICT3.1） */
  designSystem: string

  /** root session ID */
  rootSessionId: string

  /** checkpoint 创建时间 */
  createdAt: number

  /** 缺失维度选项（为空 = agent 报错） */
  options?: Record<string, unknown>
  /** 匹配到的 block 模板列表 */
  blockMatches?: BlockModuleItem[]
  /** 选中的 page pattern 规范 MD（用于 block 匹配 + 重试时复用） */
  pagePattern?: string
  /** 用户选中的 block 外层信息，传给 intent 和 planner */
  patterns?: any[]
  /** 页面级 pattern 匹配结果 */
  patternPageResult?: { matches: any[] }
  /** 意图扩展结果 */
  intentResult?: { intent_description: Record<string, unknown> }
  /** 布局规划结果 */
  planner?: Record<string, unknown>
  /** 各模块生成状态（用于只重跑失败模块） */
  modules?: ModuleCheckpoint[]
}

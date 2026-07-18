/**
 * Checkpoint — 统一的检查点持久化方案
 * 文件路径: {dir}/{sessionId}/checkpoint.json
 * 一个 session 一个 checkpoint.json，通过 stage 字段区分当前阶段。
 */
import { getDesktopApi } from "../utils/desktop-api"
import type { PatternMatchItem } from "../utils/pattern-resource"

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

export type CheckpointStage = "intent_confirm" | "block_matching" | "intent_create" | "planner_create" | "modules_create"

export type ModuleCheckpoint = {
  sectionId: string
  elementId: string
  idPrefix: string
  status: "done" | "failed"
  ui_json?: any
  error?: string
}

export type Checkpoint = {
  stage: CheckpointStage
  userInput: string
  designSystem: string
  rootSessionId: string
  createdAt: number

  // intent_confirm 阶段
  options?: Record<string, unknown>

  // Stage 1 中间结果（逐步填充）
  patternPageResult?: { matches: PatternMatchItem[] }
  intentResult?: { intent_description: Record<string, unknown> }

  // planner_create 阶段（Stage 1 完成）
  planner?: Record<string, unknown>

  // modules_create 阶段（Stage 2）
  modules?: ModuleCheckpoint[]
}

/**
 * 3D 场景检查点持久化 — 统一单文件方案（对标 pattern/checkpoint/checkpoint.ts）
 *
 * 3D pipeline 暂停点：
 *   1. intent_confirm：scene_3d_intent_confirm 返回选项后、用户确认前
 *   2. planner_create：planner_create 完成后、module_create 前（规划审查）
 *
 * 存储位置：{directory}/.octo/design-3d/history/{sessionId}/checkpoint.json
 * 一个 session 一个文件，通过 stage 字段区分当前阶段。
 *
 * Electron 环境通过 IPC 读写，pipeline 完成后清除；重开时检测到则恢复对应视图。
 */

import { getDesktopApi } from "./desktop-api"
import type { IntentConfirmResult } from "../agents/scene-intent-confirm"
import type { ScenePlanner } from "../agents/merge"

// ─── 通用读写机制 ───

const CHECKPOINT_FILENAME = "checkpoint"

export async function saveCheckpoint(dir: string, sessionId: string, data: SceneCheckpoint): Promise<void> {
  const api = getDesktopApi()
  const path = `${dir}/${sessionId}/${CHECKPOINT_FILENAME}.json`
  const payload = JSON.stringify(data, null, 2)
  if (api?.writeFileBuffer) {
    const encoder = new TextEncoder()
    await api.writeFileBuffer(path, encoder.encode(payload).buffer)
  }
}

export async function loadCheckpoint(dir: string, sessionId: string): Promise<SceneCheckpoint | null> {
  const api = getDesktopApi()
  const path = `${dir}/${sessionId}/${CHECKPOINT_FILENAME}.json`
  if (api?.readFileBuffer) {
    try {
      const buf = await api.readFileBuffer(path)
      if (!buf) return null
      return JSON.parse(new TextDecoder().decode(buf)) as SceneCheckpoint
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

// ─── 统一 SceneCheckpoint 类型 ───

export type SceneCheckpointStage =
  | "intent_confirm"    // 意图确认暂停点
  | "planner_create"    // 场景规划审查暂停点
  | "intent_create"     // 意图扩展生成中（非暂停点，用于断点续传）
  | "modules_create"    // 模块生成中（非暂停点，用于断点续传）

export type ModuleCheckpoint = {
  sectionId: string
  elementId: string
  idPrefix: string
  status: "done" | "failed"
  scene_objects?: unknown[]
  error?: string
}

export type SceneCheckpoint = {
  /** 当前 pipeline 阶段 */
  stage: SceneCheckpointStage

  /** 用户原始输入 */
  userInput: string

  /** root session ID */
  rootSessionId: string

  /** checkpoint 创建时间 */
  createdAt: number

  /** 意图确认选项（intent_confirm 阶段有值） */
  options?: IntentConfirmResult["options"]

  /** 意图扩展结果 */
  intentResult?: { intent_description: Record<string, unknown> }

  /** 场景规划结果（planner_create 阶段有值） */
  planner?: ScenePlanner

  /** 意图描述（传递给 planner） */
  intentDescription?: Record<string, unknown>

  /** 各模块生成状态（用于只重跑失败模块） */
  modules?: ModuleCheckpoint[]
}

// ─── 兼容旧格式读取 ───
// 旧格式用两个独立文件：scene_intent_confirm.json + scene_review_planner.json
// 新格式统一为 checkpoint.json。以下函数优先读新格式，回退读旧格式。

function oldIntentConfirmPath(dir: string, sessionId: string) {
  return `${dir}/${sessionId}/scene_intent_confirm.json`
}

function oldReviewPlannerPath(dir: string, sessionId: string) {
  return `${dir}/${sessionId}/scene_review_planner.json`
}

async function readJsonFile(api: any, path: string): Promise<any | null> {
  if (!api?.readFileBuffer) return null
  try {
    const buf = await api.readFileBuffer(path)
    if (!buf) return null
    return JSON.parse(new TextDecoder().decode(buf))
  } catch {
    return null
  }
}

/** 读取检查点，优先新格式，回退旧格式 */
export async function loadSceneCheckpoint(dir: string, sessionId: string): Promise<SceneCheckpoint | null> {
  // 优先读新格式
  const ckpt = await loadCheckpoint(dir, sessionId)
  if (ckpt) return ckpt

  // 回退读旧格式
  const api = getDesktopApi()
  const intentCkpt = await readJsonFile(api, oldIntentConfirmPath(dir, sessionId))
  if (intentCkpt) {
    return {
      stage: "intent_confirm",
      userInput: intentCkpt.userInput ?? "",
      rootSessionId: intentCkpt.rootSessionId ?? sessionId,
      createdAt: intentCkpt.createdAt ?? Date.now(),
      options: intentCkpt.options,
    }
  }

  const reviewCkpt = await readJsonFile(api, oldReviewPlannerPath(dir, sessionId))
  if (reviewCkpt) {
    return {
      stage: "planner_create",
      userInput: reviewCkpt.userInput ?? "",
      rootSessionId: reviewCkpt.rootSessionId ?? sessionId,
      createdAt: reviewCkpt.createdAt ?? Date.now(),
      planner: reviewCkpt.planner,
      intentDescription: reviewCkpt.intentDescription,
    }
  }

  return null
}

/** 清除检查点（同时清除新旧格式文件） */
export async function clearSceneCheckpoint(dir: string, sessionId: string): Promise<void> {
  const api = getDesktopApi()
  await clearCheckpoint(dir, sessionId)
  if (api?.deleteFile) {
    await api.deleteFile(oldIntentConfirmPath(dir, sessionId)).catch(() => {})
    await api.deleteFile(oldReviewPlannerPath(dir, sessionId)).catch(() => {})
  }
}

// ─── 兼容旧接口的 wrapper（逐步迁移后删除） ───

export type IntentConfirmCheckpoint = {
  options: IntentConfirmResult["options"]
  userInput: string
  rootSessionId: string
  createdAt: number
}

export async function saveIntentConfirmCheckpoint(
  dir: string,
  sessionId: string,
  checkpoint: IntentConfirmCheckpoint,
): Promise<void> {
  const existing = await loadCheckpoint(dir, sessionId)
  await saveCheckpoint(dir, sessionId, {
    stage: "intent_confirm",
    userInput: checkpoint.userInput,
    rootSessionId: checkpoint.rootSessionId,
    createdAt: checkpoint.createdAt,
    options: checkpoint.options,
    // 保留已有的 intentResult/planner 等字段
    intentResult: existing?.intentResult,
    planner: existing?.planner,
    intentDescription: existing?.intentDescription,
    modules: existing?.modules,
  })
}

export async function loadIntentConfirmCheckpoint(
  dir: string,
  sessionId: string,
): Promise<IntentConfirmCheckpoint | null> {
  const ckpt = await loadSceneCheckpoint(dir, sessionId)
  if (ckpt?.stage === "intent_confirm" && ckpt.options) {
    return {
      options: ckpt.options,
      userInput: ckpt.userInput,
      rootSessionId: ckpt.rootSessionId,
      createdAt: ckpt.createdAt,
    }
  }
  return null
}

export async function clearIntentConfirmCheckpoint(
  dir: string,
  sessionId: string,
): Promise<void> {
  await clearSceneCheckpoint(dir, sessionId)
}

export type SceneReviewCheckpoint = {
  planner: ScenePlanner
  intentDescription: Record<string, unknown>
  userInput: string
  rootSessionId: string
  createdAt: number
}

export async function saveSceneReviewCheckpoint(
  dir: string,
  sessionId: string,
  checkpoint: SceneReviewCheckpoint,
): Promise<void> {
  const existing = await loadCheckpoint(dir, sessionId)
  await saveCheckpoint(dir, sessionId, {
    stage: "planner_create",
    userInput: checkpoint.userInput,
    rootSessionId: checkpoint.rootSessionId,
    createdAt: checkpoint.createdAt,
    planner: checkpoint.planner,
    intentDescription: checkpoint.intentDescription,
    // 保留已有的 options 等字段
    options: existing?.options,
    intentResult: existing?.intentResult,
    modules: existing?.modules,
  })
}

export async function loadSceneReviewCheckpoint(
  dir: string,
  sessionId: string,
): Promise<SceneReviewCheckpoint | null> {
  const ckpt = await loadSceneCheckpoint(dir, sessionId)
  if (ckpt?.stage === "planner_create" && ckpt.planner) {
    return {
      planner: ckpt.planner,
      intentDescription: ckpt.intentDescription ?? {},
      userInput: ckpt.userInput,
      rootSessionId: ckpt.rootSessionId,
      createdAt: ckpt.createdAt,
    }
  }
  return null
}

export async function clearSceneReviewCheckpoint(
  dir: string,
  sessionId: string,
): Promise<void> {
  await clearSceneCheckpoint(dir, sessionId)
}

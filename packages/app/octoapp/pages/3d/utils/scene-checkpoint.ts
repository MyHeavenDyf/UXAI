/**
 * 3D 场景检查点持久化 — 合并 pattern 的 intent-checkpoint + review-checkpoint。
 *
 * 3D 只有两个暂停点：
 *   1. 意图确认（intent_confirm）：scene_3d_intent_confirm 返回选项后、用户确认前
 *   2. 场景规划审查（review_planner）：planner_create 完成后、module_create 前
 *
 * 存储位置：{directory}/.octo/design-3d/history/{sessionId}/
 *   - scene_intent_confirm.json（意图确认检查点）
 *   - scene_review_planner.json（场景规划审查检查点）
 *
 * Electron 环境通过 IPC 读写，用户确认后删除；重开时检测到则恢复对应视图。
 */

import { getDesktopApi } from "./desktop-api"
import type { IntentConfirmResult } from "../agents/scene-intent-confirm"
import type { ScenePlanner } from "../agents/merge"

// ── 意图确认检查点 ──

export type IntentConfirmCheckpoint = {
  options: IntentConfirmResult["options"]
  userInput: string
  rootSessionId: string
  createdAt: number
}

function intentConfirmCheckpointPath(dir: string, sessionId: string) {
  return `${dir}/${sessionId}/scene_intent_confirm.json`
}

export async function saveIntentConfirmCheckpoint(
  dir: string,
  sessionId: string,
  checkpoint: IntentConfirmCheckpoint,
): Promise<void> {
  const api = getDesktopApi()
  const path = intentConfirmCheckpointPath(dir, sessionId)
  const payload = JSON.stringify(checkpoint, null, 2)
  if (api?.writeFileBuffer) {
    const encoder = new TextEncoder()
    await api.writeFileBuffer(path, encoder.encode(payload).buffer)
  }
}

export async function loadIntentConfirmCheckpoint(
  dir: string,
  sessionId: string,
): Promise<IntentConfirmCheckpoint | null> {
  const api = getDesktopApi()
  const path = intentConfirmCheckpointPath(dir, sessionId)
  if (api?.readFileBuffer) {
    try {
      const buf = await api.readFileBuffer(path)
      if (!buf) return null
      return JSON.parse(new TextDecoder().decode(buf)) as IntentConfirmCheckpoint
    } catch {
      return null
    }
  }
  return null
}

export async function clearIntentConfirmCheckpoint(
  dir: string,
  sessionId: string,
): Promise<void> {
  const api = getDesktopApi()
  const path = intentConfirmCheckpointPath(dir, sessionId)
  if (api?.deleteFile) {
    await api.deleteFile(path)
  }
}

// ── 场景规划审查检查点 ──

export type SceneReviewCheckpoint = {
  planner: ScenePlanner
  intentDescription: Record<string, unknown>
  userInput: string
  rootSessionId: string
  createdAt: number
}

function reviewCheckpointPath(dir: string, sessionId: string) {
  return `${dir}/${sessionId}/scene_review_planner.json`
}

export async function saveSceneReviewCheckpoint(
  dir: string,
  sessionId: string,
  checkpoint: SceneReviewCheckpoint,
): Promise<void> {
  const api = getDesktopApi()
  const path = reviewCheckpointPath(dir, sessionId)
  const payload = JSON.stringify(checkpoint, null, 2)
  if (api?.writeFileBuffer) {
    const encoder = new TextEncoder()
    await api.writeFileBuffer(path, encoder.encode(payload).buffer)
    return
  }
}

export async function loadSceneReviewCheckpoint(
  dir: string,
  sessionId: string,
): Promise<SceneReviewCheckpoint | null> {
  const api = getDesktopApi()
  const path = reviewCheckpointPath(dir, sessionId)
  if (api?.readFileBuffer) {
    try {
      const buf = await api.readFileBuffer(path)
      if (!buf) return null
      return JSON.parse(new TextDecoder().decode(buf)) as SceneReviewCheckpoint
    } catch {
      return null
    }
  }
  return null
}

export async function clearSceneReviewCheckpoint(
  dir: string,
  sessionId: string,
): Promise<void> {
  const api = getDesktopApi()
  const path = reviewCheckpointPath(dir, sessionId)
  if (api?.deleteFile) {
    await api.deleteFile(path)
    return
  }
}

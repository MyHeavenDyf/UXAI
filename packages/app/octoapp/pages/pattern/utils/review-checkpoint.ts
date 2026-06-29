/**
 * Review Checkpoint — 设计师审查阶段的持久化检查点
 * 当 planner_create 完成后、module_create 执行前，把 planner + intent 写入磁盘。
 * 用户确认后删除；关闭软件重开时检测到此文件则恢复到审查视图。
 */

import { getDesktopApi } from "./desktop-api"

export type ReviewCheckpoint = {
  planner: Record<string, unknown>
  intentDescription: Record<string, unknown>
  userInput: string
  rootSessionId: string
  createdAt: number
}

function reviewCheckpointPath(dir: string, sessionId: string) {
  return `${dir}/${sessionId}/review_planner.json`
}

export async function saveReviewCheckpoint(
  dir: string,
  sessionId: string,
  checkpoint: ReviewCheckpoint,
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

export async function loadReviewCheckpoint(
  dir: string,
  sessionId: string,
): Promise<ReviewCheckpoint | null> {
  const api = getDesktopApi()
  const path = reviewCheckpointPath(dir, sessionId)
  if (api?.readFileBuffer) {
    try {
      const buf = await api.readFileBuffer(path)
      if (!buf) return null
      return JSON.parse(new TextDecoder().decode(buf)) as ReviewCheckpoint
    } catch {
      return null
    }
  }
  return null
}

export async function clearReviewCheckpoint(
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

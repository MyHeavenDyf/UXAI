/**
 * Intent Confirm Checkpoint — 意图确认阶段的持久化检查点
 * 当 proto_intent_confirm 返回选项后、用户确认前，把选项写入磁盘。
 * 用户确认后删除；关闭软件重开时检测到此文件则恢复到意图确认视图。
 */

import { getDesktopApi } from "./desktop-api"
import type { IntentConfirmResult } from "../agents/proto-intent-confirm"

export type IntentConfirmCheckpoint = {
  options: IntentConfirmResult["options"]
  userInput: string
  rootSessionId: string
  createdAt: number
}

function intentConfirmCheckpointPath(dir: string, sessionId: string) {
  return `${dir}/${sessionId}/intent_confirm.json`
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

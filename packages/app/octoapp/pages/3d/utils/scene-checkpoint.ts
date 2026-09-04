/**
 * 3D 场景检查点持久化 — 统一单文件方案（对标 pattern/checkpoint/checkpoint.ts）
 *
 * Step 7 后 3D 唯一检查点 = codegen stage（9a 门控失败后重试喂回 priorGateFindings）。
 * 旧 8-agent 流水线的 intent_confirm / planner_create 暂停点已废弃（2026-09-04 全清）：
 * stage 字面量与旧格式文件清理逻辑保留仅为兼容历史落盘数据（读到即按无可恢复处理）。
 *
 * 存储位置：{directory}/.octo/design-3d/history/{sessionId}/checkpoint.json
 * 一个 session 一个文件，通过 stage 字段区分当前阶段。
 *
 * Electron 环境通过 IPC 读写，pipeline 完成后清除；重开时检测到则恢复对应视图。
 */

import { getDesktopApi } from "./desktop-api"

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
  | "codegen" // 9a：codegen 进行中（供门控失败后重试喂回 priorGateFindings）
  // 以下为已废弃的旧 8-agent 流水线 stage（仅历史落盘数据会出现，读到按无可恢复处理）
  | "intent_confirm"
  | "planner_create"
  | "intent_create"
  | "modules_create"

export type SceneCheckpoint = {
  /** 当前 pipeline 阶段 */
  stage: SceneCheckpointStage

  /** 用户原始输入 */
  userInput: string

  /** root session ID */
  rootSessionId: string

  /** checkpoint 创建时间 */
  createdAt: number
}

/** 读取检查点（新格式 checkpoint.json；旧 8-agent 流水线的 stage 读到由调用方按无可恢复处理） */
export async function loadSceneCheckpoint(dir: string, sessionId: string): Promise<SceneCheckpoint | null> {
  return await loadCheckpoint(dir, sessionId)
}

/** 清除检查点（同时清除旧 8-agent 流水线遗留的两个独立文件，防残留） */
export async function clearSceneCheckpoint(dir: string, sessionId: string): Promise<void> {
  const api = getDesktopApi()
  await clearCheckpoint(dir, sessionId)
  if (api?.deleteFile) {
    await api.deleteFile(`${dir}/${sessionId}/scene_intent_confirm.json`).catch(() => {})
    await api.deleteFile(`${dir}/${sessionId}/scene_review_planner.json`).catch(() => {})
  }
}

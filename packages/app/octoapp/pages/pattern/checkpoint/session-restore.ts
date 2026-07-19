/**
 * Session Restore — 统一的会话恢复入口
 * 读取单个 checkpoint.json，通过 stage 字段判断恢复到哪个阶段。
 * 优先级: checkpoint.json (stage 判断) → version-history (已完成) → empty
 */

import { loadCheckpoint, type Checkpoint } from "./checkpoint"
import { loadCurrentPatternState, type PatternSessionState } from "../utils/version-history"

export type RestoreResult =
  | { type: "intent_confirm"; checkpoint: Checkpoint }
  | { type: "block_matching"; checkpoint: Checkpoint }
  | { type: "planner_create"; checkpoint: Checkpoint }
  | { type: "pipeline_error"; checkpoint: Checkpoint }
  | { type: "completed"; state: PatternSessionState }
  | { type: "empty" }

export async function restoreSession(
  dir: string,
  sessionId: string,
): Promise<RestoreResult> {
  const ckpt = await loadCheckpoint(dir, sessionId)
  if (ckpt) {
    switch (ckpt.stage) {
      case "intent_confirm":
        // options 有值说明显示卡片正在让用户选，归为 intent_confirm
        // options 为空说明反问SKILL还没跑完或报错了，归为 pipeline_error
        if (ckpt.options && Object.keys(ckpt.options).length > 0) {
          return { type: "intent_confirm", checkpoint: ckpt }
        }
        return { type: "pipeline_error", checkpoint: ckpt }
      case "block_matching":
        // block 匹配成功（有结果）→ 恢复卡片, 显示选项让用户选 pattern
        // block 匹配报错（无结果）→ 恢复卡片，显示报错信息让用户重试
        return { type: "block_matching", checkpoint: ckpt }
      case "planner_create":
        return { type: "planner_create", checkpoint: ckpt }
      case "intent_create":
      case "modules_create":
        return { type: "pipeline_error", checkpoint: ckpt }
    }
  }

  // 已完成状态（modules 已生成，checkpoint 已清理）
  const state = await loadCurrentPatternState(dir, sessionId)
  if (state) return { type: "completed", state }

  return { type: "empty" }
}

import proto_intent_confirm from "../agents/proto-intent-confirm"
import proto_pattern_block from "../agents/proto_pattern_block"
import proto_planner_create from "../agents/proto-planner-create"
import proto_module_create from "../agents/proto-module-create"
import proto_intent from "../agents/proto-intent"
import { mergeModules } from "../agents/merge"
import { readPatternPreview } from "../utils/pattern-resource"
import {
  saveCheckpoint,
  loadCheckpoint,
  clearCheckpoint,
  type Checkpoint,
  type ModuleCheckpoint,
} from "../checkpoint/checkpoint"

export type ProtoCreateJsonInput = {
  // 公共sdk
  sdk: any
  // 公共流式数据
  sync: any
  // 当前使用的模型
  modelKey: any
  // 根节点session
  rootSession: string
  // 用户输入
  userInput: string
  // 额外补充信息，透传到工具 ctx.extra 的数据
  extra?: Record<string, unknown>
  // 历史文件保存地址
  checkpointDir: string
  // 子 session 创建回调
  onSessionCreated?: (childSessionID: string) => void
}

// 意图确认（返回缺失维度的选项清单，由前端渲染 UI 暂停等待用户）
export async function create_intent_confirm(inputCtx: ProtoCreateJsonInput) {
  // 调 intent_confirm 前先存 checkpoint（只有 userInput，没有 options）
  // 这样即使 agent 报错，checkpoint 已落盘，用户点重试能恢复
  await saveCheckpoint(inputCtx.checkpointDir, inputCtx.rootSession, {
    stage: "intent_confirm",
    userInput: inputCtx.userInput,
    designSystem: inputCtx.extra?.designSystem as string,
    rootSessionId: inputCtx.rootSession,
    createdAt: Date.now(),
  })
  const result = await proto_intent_confirm(inputCtx)
  // agent 成功且有 options 时，更新 checkpoint 补上 options,这样切换 session 回来后能恢复弹窗
  if (Object.keys(result.options).length > 0) {
    await saveCheckpoint(inputCtx.checkpointDir, inputCtx.rootSession, {
      stage: "intent_confirm",
      userInput: inputCtx.userInput,
      designSystem: inputCtx.extra?.designSystem as string,
      rootSessionId: inputCtx.rootSession,
      createdAt: Date.now(),
      options: result.options,
    })
  }
  return result
}

// block 模板匹配：调 proto_pattern_block + 落盘 blockMatches
export async function create_block_match(inputCtx: ProtoCreateJsonInput): Promise<{ matches: any[]; previewUrls: Map<string, string> }> {
  const sid = inputCtx.rootSession
  const theme = (inputCtx.extra?.designSystem as string) || "ICT3.1"
  // 推进 stage 到 block_matching
  if (inputCtx.checkpointDir) {
    const ckpt = await loadCheckpoint(inputCtx.checkpointDir, sid)
    if (ckpt) {
      ckpt.stage = "block_matching"
      ckpt.userInput = inputCtx.userInput
      await saveCheckpoint(inputCtx.checkpointDir, sid, ckpt)
    }
  }
  const result = await proto_pattern_block(inputCtx)
  // 为每个匹配加载预览图
  for (const match of result.matches) {
    if (!match.pattern.preview) continue
    match.previewUrl = await readPatternPreview("block", match.pattern.preview, theme)
  }
  // 落盘 blockMatches
  if (inputCtx.checkpointDir) {
    const ckpt = await loadCheckpoint(inputCtx.checkpointDir, sid)
    if (ckpt) {
      ckpt.blockMatches = result.matches
      await saveCheckpoint(inputCtx.checkpointDir, sid, ckpt)
    }
  }
  return { matches: result.matches, previewUrls: new Map() }
}

// 阶段 2：意图扩展 + 布局规划
export async function create_planner_json(inputCtx: ProtoCreateJsonInput) {
  const sid = inputCtx.rootSession
  let checkpoint: Checkpoint | null = null
  if (inputCtx.checkpointDir) {
    checkpoint = await loadCheckpoint(inputCtx.checkpointDir, sid)
    if (checkpoint) {
      checkpoint.stage = "intent_create"
      checkpoint.userInput = inputCtx.userInput
      checkpoint.patterns = inputCtx.extra?.patterns as any[] | undefined
      await saveCheckpoint(inputCtx.checkpointDir, sid, checkpoint)
    }
  }

  // 步骤 1：intent_create
  let intentResult: { intent_description: Record<string, unknown> }
  if (checkpoint?.intentResult) {
    console.log("[Pipeline] 跳过 proto_intent（已有 checkpoint）")
    intentResult = checkpoint.intentResult
  } else {
    intentResult = await proto_intent({
      ...inputCtx,
      extra: inputCtx.extra,
    })
  }
  if (inputCtx.checkpointDir && checkpoint) {
    checkpoint.intentResult = { intent_description: intentResult.intent_description }
    checkpoint.stage = "intent_create"
    await saveCheckpoint(inputCtx.checkpointDir, sid, checkpoint)
  }

  // 步骤 2：planner_create
  let planner: any
  if (checkpoint?.planner) {
    console.log("[Pipeline] 跳过 proto_planner_create（已有 checkpoint）")
    planner = checkpoint.planner
  } else {
    const pageDescriptionStr = JSON.stringify(intentResult.intent_description)
    planner = await proto_planner_create({ ...inputCtx, intentDescription: pageDescriptionStr, extra: inputCtx.extra })
  }

  if (inputCtx.checkpointDir && checkpoint) {
    checkpoint.planner = planner.layout_planner ?? planner
    checkpoint.stage = "planner_create"
    await saveCheckpoint(inputCtx.checkpointDir, sid, checkpoint)
  }

  return {
    planner,
    intent: intentResult,
    current_step: "planner_create",
  }
}

// 阶段 3：并行生成各模块 JSON + 合并（设计师确认后续跑）
export async function create_modules_json(
  inputCtx: ProtoCreateJsonInput,
  planner: any,
  intent: Record<string, unknown>,
  onFinished: (finalJson: any) => Promise<void>,
) {
  const sid = inputCtx.rootSession
  const slots = planner.slots as Array<any>
  let moduleCheckpoints: Record<string, ModuleCheckpoint> = {}
  let checkpoint: Checkpoint | null = null
  if (inputCtx.checkpointDir) {
    checkpoint = await loadCheckpoint(inputCtx.checkpointDir, sid)
    if (checkpoint?.modules) {
      for (const m of checkpoint.modules) {
        if (m.status === "done" && m.ui_json) {
          moduleCheckpoints[m.sectionId] = m
        }
      }
    }
  }

  const pendingSlots = slots.filter(slot => !moduleCheckpoints[slot.section_id])
  if (pendingSlots.length > 0) {
    console.log(`[Pipeline] 需要生成 ${pendingSlots.length}/${slots.length} 个模块`)
  }

  const results = await Promise.allSettled(
    pendingSlots.map(slot =>
      proto_module_create({
        ...inputCtx,
        idPrefix: slot.id_prefix,
        sectionId: slot.section_id,
        elementId: slot.element_id,
        layoutPlanner: planner,
        intentDescription: intent,
      })
    )
  )

  const failedModules: string[] = []
  for (let i = 0; i < pendingSlots.length; i++) {
    const slot = pendingSlots[i]
    const result = results[i]
    if (result.status === "fulfilled") {
      moduleCheckpoints[slot.section_id] = {
        sectionId: slot.section_id,
        elementId: slot.element_id,
        idPrefix: slot.id_prefix,
        status: "done",
        ui_json: result.value.ui_json,
      }
    } else {
      moduleCheckpoints[slot.section_id] = {
        sectionId: slot.section_id,
        elementId: slot.element_id,
        idPrefix: slot.id_prefix,
        status: "failed",
        error: String(result.reason instanceof Error ? result.reason.message : result.reason),
      }
      failedModules.push(slot.section_id)
    }
  }

  if (inputCtx.checkpointDir && checkpoint) {
    checkpoint.modules = Object.values(moduleCheckpoints)
    checkpoint.stage = "modules_create"
    await saveCheckpoint(inputCtx.checkpointDir, sid, checkpoint)
  }

  if (failedModules.length > 0) {
    throw new Error(`模块生成失败: ${failedModules.join(", ")}`)
  }

  const modules = slots.map(slot => moduleCheckpoints[slot.section_id].ui_json)

  const merged = mergeModules(
    { rootId: planner.rootId as string, elements: planner.elements as any },
    modules as any,
  )

  if (inputCtx.checkpointDir) {
    await clearCheckpoint(inputCtx.checkpointDir, sid)
  }

  await onFinished({
    // 页面意图描述
    pageIntent: intent,
    // 布局规划
    layoutPlanner: planner,
    // 每个模块的 JSON
    modulesJson: modules,
    // 完整页面的 JSON
    pageJson: merged
  })
}

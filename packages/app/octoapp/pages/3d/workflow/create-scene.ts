/**
 * 3D 场景生成工作流（类比 pattern/workflow/create-json.ts）
 *
 * 三阶段编排（去掉 pattern 的 pattern_page 匹配，3D 无模板库）：
 *   阶段1：意图确认（暂停点1，返回缺失维度选项清单，前端渲染 UI 暂停等待用户）
 *   阶段2：意图扩展 + 场景规划（生成到此为止，等待设计师审查场景规划树 = 暂停点3）
 *   阶段3：并行生成各分区物体 + 合并（审查确认后跑，产完整 SceneConfig）
 */
import scene_3d_intent_confirm from "../agents/scene-intent-confirm"
import scene_3d_intent from "../agents/scene-intent"
import scene_3d_planner_create from "../agents/scene-planner-create"
import scene_3d_module_create from "../agents/scene-module-create"
import { mergeSceneObjects, type SceneModuleResult, type ScenePlanner } from "../agents/merge"
import type { SceneConfig } from "../utils/scene-config"
import { saveDebugSnapshot } from "../utils/debug-log"

export type SceneCreateInput = {
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
  // 子 session 创建回调
  onSessionCreated?: (childSessionID: string) => void
}

const historyDir = (sdk: any) => `${sdk.directory}/.octo/design-3d/history`

// 阶段 1：意图确认（返回缺失维度的选项清单，由前端渲染 UI 暂停等待用户）
export async function create_intent_confirm(inputCtx: SceneCreateInput) {
  return await scene_3d_intent_confirm(inputCtx)
}

// 阶段 2：意图扩展 + 场景规划（生成到此为止，等待设计师审查场景规划树）
export async function create_planner_json(inputCtx: SceneCreateInput) {
  const historyD = historyDir(inputCtx.sdk)
  // 意图扩展
  const intentResult = await scene_3d_intent(inputCtx)
  void saveDebugSnapshot(historyD, inputCtx.rootSession, "create_intent")

  // 场景规划
  const pageDescriptionStr = JSON.stringify(intentResult.intent_description)
  const planner = await scene_3d_planner_create({
    ...inputCtx,
    intentDescription: pageDescriptionStr,
  })
  void saveDebugSnapshot(historyD, inputCtx.rootSession, "create_planner", {
    lastIntent: intentResult.intent_description,
    lastPlanner: planner.layout_planner as unknown as Record<string, unknown>,
  })

  return {
    planner: planner,
    intent: intentResult,
    current_step: "planner_create",
  }
}

// 阶段 3：并行生成各分区物体 + 合并（设计师确认后续跑）
export async function create_modules_json(
  inputCtx: SceneCreateInput,
  planner: ScenePlanner,
  intent: Record<string, unknown>,
  onFinished: (finalJson: { sceneIntent: any; layoutPlanner: any; modulesJson: SceneModuleResult[]; sceneConfig: SceneConfig }) => Promise<void>,
) {
  const historyD = historyDir(inputCtx.sdk)
  // 并行生成各分区物体
  const slots = (planner.slots ?? []) as Array<{
    section_id: string
    element_id: string
    id_prefix: string
  }>
  const modules: SceneModuleResult[] = await Promise.all(
    slots.map((slot) =>
      scene_3d_module_create({
        ...inputCtx,
        idPrefix: slot.id_prefix,
        sectionId: slot.section_id,
        elementId: slot.element_id,
        layoutPlanner: planner,
        intentDescription: intent,
      }),
    ),
  )

  // 合并完整 SceneConfig
  const merged = mergeSceneObjects(planner, modules)
  void saveDebugSnapshot(historyD, inputCtx.rootSession, "create_modules_merged", {
    modulesJson: modules,
    sceneConfig: merged,
  })

  await onFinished({
    // 场景意图描述
    sceneIntent: intent,
    // 布局规划
    layoutPlanner: planner,
    // 每个分区的物体
    modulesJson: modules,
    // 完整场景的 SceneConfig
    sceneConfig: merged,
  })
}

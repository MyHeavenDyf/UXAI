import proto_intent from "../agents/proto_intent"
import proto_planner_create from "../agents/proto_planner_create"
import proto_module_create from "../agents/proto_module_create"
import { mergeModules } from "../agents/merge"

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
  // 透传到工具 ctx.extra 的数据
  extra?: Record<string, unknown>
  // 子 session 创建回调
  onSessionCreated?: (childSessionID: string) => void
}

// 阶段 1：意图扩展 + 布局规划（生成到此为止，等待设计师审查）
export async function create_planner_json(inputCtx: ProtoCreateJsonInput) {
  // 第一步：意图扩展
  const intentResult = await proto_intent(inputCtx)

  // 第二步：页面布局
  const pageDescriptionStr = JSON.stringify(intentResult.intent_description)
  const planner = await proto_planner_create({ ...inputCtx, intentDescription: pageDescriptionStr })
  return {
    planner: planner,
    intent: intentResult,
    current_step: "planner_create",
  }
}

// 阶段 2：并行生成各模块 JSON + 合并（设计师确认后续跑）
export async function create_modules_json(
  inputCtx: ProtoCreateJsonInput,
  planner: any,
  intent: Record<string, unknown>,
  onFinished: (finalJson: any) => Promise<void>,
) {
  // 并行生成 A2UI JSON
  const modules = await Promise.all(
    (planner.slots as Array<any>).map(slot =>
      proto_module_create({
        ...inputCtx,
        idPrefix: slot.id_prefix,
        sectionId: slot.section_id,
        elementId: slot.element_id,
        layoutPlanner: planner,
        intentDescription: intent
      }).then(r => r.ui_json)
    )
  )

  // 合并完整 UI JSON
  const merged = mergeModules(
    {
      rootId: planner.rootId as string,
      elements: planner.elements as any,
    },
    modules as any,
  )
  
  await onFinished({
    // 页面意图描述
    pageIntent: intent.intent_page,
    // 布局规划
    layoutPlanner: planner,
    // 每个模块的 JSON
    modulesJson: modules,
    // 完整页面的 JSON
    pageJson: merged
  })
}

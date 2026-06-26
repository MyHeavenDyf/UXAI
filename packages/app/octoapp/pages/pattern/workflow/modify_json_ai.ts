import proto_intent from "../agents/proto_intent"
import proto_triage from "../agents/proto_triage"
import proto_planner_create from "../agents/proto_planner_create"
import proto_planner_modify from "../agents/proto_planner_modify"
import proto_module_create from "../agents/proto_module_create"
import proto_module_modify from "../agents/proto_module_modify" 
import { mergeModules } from "../agents/merge"

type ProtoModifyJsonInput = {
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
  // 子 session 创建回调
  onSessionCreated?: (childSessionID: string) => void
}

type LastDataInput = {
    // 页面意图
    lastIntent: any,
    // 布局规划
    lastPlanner: any,
    // 模块JSON
    lastModules: any
} 

export default async function modify_json_ai(inputCtx: ProtoModifyJsonInput, lastData: LastDataInput, onFinshed: (finalJson: any) => Promise<void>){
    // 上轮生成的页面数据
    let lastIntent = lastData.lastIntent;
    let lastPlanner = lastData.lastPlanner;
    let lastModules = lastData.lastModules;
    
    // 分诊，判断是修改，还是重新生成，还是简单回答用户问题
    const triage = await proto_triage({ 
        ...inputCtx, 
        ...lastData
    })
    
    // 暂时屏蔽非修改场景
    if (triage.routing !== "modify"){
        return {}
    }
    // 执行 AI 修改 UI JSON
    if (triage.routing === "modify") {
        // 重新布局规划
        const modifyResult = await proto_planner_modify({
            ...inputCtx,
            input: {
                intentReason: triage.reason,
                intentDelete: triage.delete,
                intentAdd: triage.add,
                intentModify: triage.modify,
                intentPage: triage.updated_intent,
                layoutPlanner: lastPlanner,
            },
        })

        const updatedIntent = { ...triage.updated_intent }
        const prevModules = lastModules;

        const modulePromises = modifyResult.output.slots.map((slot) => {
            // 保留未改动部分
            if (slot.operation === "none") {
                const existing = prevModules.find((m:any) => m.rootId === slot.element_id)
                return existing ?? null
            }
            // 新增模块
            if (slot.operation === "create") {
                return proto_module_create({
                    ...inputCtx,
                    idPrefix: slot.id_prefix,
                    sectionId: slot.section_id,
                    elementId: slot.element_id,
                    layoutPlanner: modifyResult.output as unknown as Record<string, unknown>,
                    intentDescription: updatedIntent as any,
                }).then((r) => r.ui_json)
            }
            // 修改模块
            if (slot.operation === "modify") {
                const originModule = prevModules.find((m: any) => m.rootId === slot.element_id)
                const modAction = triage.modify.find((m) => m.section_id === slot.section_id)
                if (!originModule || !modAction) return null
                return proto_module_modify({
                    ...inputCtx,
                    input: {
                        layoutPlanner: modifyResult.output as unknown as Record<string, unknown>,
                        idPrefix: slot.id_prefix,
                        sectionId: slot.section_id,
                        originModules: originModule,
                        modifications: modAction as unknown as Record<string, unknown>,
                    },
                }).then((r) => r.ui_json)
            }
            return null
        })

        const moduleResults = await Promise.all(modulePromises)
        const allModules = moduleResults.filter(Boolean) as typeof prevModules
        const merged = mergeModules(
            { 
                rootId: modifyResult.output.rootId as string, 
                elements: modifyResult.output.elements as any 
            },
            allModules as any,
        )

        // 执行完成的回调
        await onFinshed({
            // 页面意图描述
            pageIntent: updatedIntent,
            // 布局规划
            layoutPlanner: modifyResult.output,
            // 每个模块的 JSON
            modulesJson: allModules,
            // 完整页面的 JSON
            pageJson: merged
        })    
    }
}
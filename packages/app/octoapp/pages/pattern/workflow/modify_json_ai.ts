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
  // 强制刷新预览 iframe
  refreshPreview?: () => void
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
        const oldSlots = ((lastPlanner.slots ?? lastPlanner.layout_planner?.slots) as Array<{ section_id: string; element_id: string }>) ?? []
        const oldElementBySection = new Map(oldSlots.map((s) => [s.section_id, s.element_id]))

        // 修复 Planner LLM 可能错误修改 shell 层 element_id 的问题
        // modify 类型的 slot 应保持原 element_id 不变，同时修正 shell elements 中被篡改的元素
        const oldShellElements = (lastPlanner.elements ?? []) as Array<{ id: string; component?: string; props?: Record<string, unknown>; children?: string[] }>
        for (const slot of modifyResult.output.slots) {
            if (slot.operation === "modify") {
                const origElementId = oldElementBySection.get(slot.section_id)
                if (!origElementId || slot.element_id === origElementId) continue
                console.warn(`[Planner Fix] section="${slot.section_id}" Planner 错误地将 element_id 从 "${origElementId}" 改为 "${slot.element_id}"，已自动修正`)
                // 修正 shell elements：将被替换的元素恢复原样
                const origShellEl = oldShellElements.find((e) => e.id === origElementId)
                const wrongIdx = modifyResult.output.elements.findIndex((e) => e.id === slot.element_id)
                if (wrongIdx !== -1 && origShellEl) {
                    modifyResult.output.elements[wrongIdx] = {
                        id: origElementId,
                        component: (origShellEl as any).component ?? "div",
                        props: (origShellEl as any).props ?? {},
                        children: [],
                    }
                } else {
                    console.warn(`[Planner Fix] section="${slot.section_id}" 无法在 shell elements 中定位原元素 "${origElementId}"`)
                }
                // 修正父元素的 children 引用
                for (const el of modifyResult.output.elements) {
                    if (!el.children) continue
                    for (let i = 0; i < el.children.length; i++) {
                        if (el.children[i] === slot.element_id) {
                            el.children[i] = origElementId
                        }
                    }
                }
                slot.element_id = origElementId
            }
        }

        const modulePromises = modifyResult.output.slots.map((slot) => {
            const findPrevModule = () => {
                const byNewId = prevModules.find((m: any) => m.rootId === slot.element_id)
                if (byNewId) return byNewId
                const oldId = oldElementBySection.get(slot.section_id)
                if (oldId && oldId !== slot.element_id) {
                    return prevModules.find((m: any) => m.rootId === oldId) ?? null
                }
                // 沿旧 planner 元素树向上查找父元素匹配
                const oldElements = (lastPlanner.elements ?? []) as Array<{ id: string; children?: string[] }>
                const childParentMap = new Map<string, string>()
                for (const el of oldElements) {
                    for (const childId of el.children ?? []) {
                        childParentMap.set(childId, el.id)
                    }
                }
                const visited = new Set<string>()
                let cursor: string | undefined = slot.element_id
                while (cursor) {
                    if (visited.has(cursor)) break
                    visited.add(cursor)
                    const match = prevModules.find((m: any) => m.rootId === cursor)
                    if (match) return match
                    cursor = childParentMap.get(cursor)
                }
                return null
            }
            // 保留未改动部分
            if (slot.operation === "none") {
                return findPrevModule() ?? null
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
                const originModule = findPrevModule()
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
                        intentDescription: updatedIntent as any,
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
            modifyResult.output.slots,
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
        inputCtx.refreshPreview?.()

    }
}
import proto_intent from "../agents/proto_intent"
import proto_intent_audit from "../agents/proto_intent_audit"
import proto_planner_create from "../agents/proto_planner_create"
import proto_module_create from "../agents/proto_module_create"
import { mergeModules } from "../agents/merge"

type ProtoCreateJsonInput = {
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
}

export default async function create_json(inputCtx: ProtoCreateJsonInput, onFinshed: (finalJson: any) => Promise<void>){
    // 第一步：意图扩展
    let intentResult = await proto_intent(inputCtx)
    
    // 第二步：意图检查 - 最多进行N(当前1)次审查 --- 未提升运行速度，暂时屏蔽
    // for (let attempt = 0; attempt < 1; attempt++) {
    //   let descriptionStr = JSON.stringify(intentResult.intent_description);
    //   const audit = await proto_intent_audit({ ...inputCtx, intentDescription: descriptionStr });
    //   if (audit.intent_audit_pass) break;
    //   intentResult = await proto_intent({
    //     ...inputCtx,
    //     auditFeedback: audit.intent_audit_feedback as string,
    //     intentAuditPass: audit.intent_audit_pass as boolean,
    //     pageDescription: descriptionStr
    //   })
    // }
          
    // 第三步：页面局部
    let pageDescriptionStr = JSON.stringify(intentResult.intent_description);
    const planner = await proto_planner_create({ ...inputCtx, intentDescription: pageDescriptionStr });
          
    // 第四步：并行生成 A2UI JSON
    const modules = await Promise.all(
        (planner.layout_planner.slots as Array<any>).map(slot =>
            proto_module_create({
                ...inputCtx,
                idPrefix: slot.id_prefix,
                sectionId: slot.section_id,
                elementId: slot.element_id,
                layoutPlanner: planner.layout_planner,
                intentDescription: intentResult.intent_description
            }).then(r => r.ui_json)
        )
    )

    // 第五步：合并完整UI JSON
    const merged = mergeModules(
        { 
            rootId: planner.layout_planner.rootId as string, 
            elements: planner.layout_planner.elements as any 
        },
        modules as any,
        planner.layout_planner.slots as any,
    )

    // 执行完成的回调
    await onFinshed({
        // 页面意图描述
        pageIntent: intentResult.intent_page,
        // 布局规划
        layoutPlanner: planner.layout_planner,
        // 每个模块的 JSON
        modulesJson: modules,
        // 完整页面的 JSON
        pageJson: merged
    })    
}
import { extractJson } from '../../utils/json_parser';
import { runChildSession } from '../run_child_session';

const AGENT_NAME = "proto_module_create";

type ProtoModuleCreateInput = {
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
  // 用户输入
  idPrefix: string
  // 本模块对应意图模块
  sectionId: string
  // 本模块对应父容器
  elementId: string
  // 完整布局规划
  layoutPlanner: any
  // 意图扩展结论
  intentDescription: any
  // 子 session 创建回调
  onSessionCreated?: (childSessionID: string) => void
}

export default async function proto_module_create(input: ProtoModuleCreateInput) {
  const {
    sdk,
    sync,
    modelKey,
    rootSession,
    userInput,
    idPrefix,
    sectionId,
    elementId,
    layoutPlanner,
    intentDescription,
    onSessionCreated 
  } = input
  // 组装输入提示词
  const humanMessage = buildHumanMessage(idPrefix, sectionId, elementId, layoutPlanner, intentDescription)
  console.log("----- 模块渲染Agent开始执行 ----- ");
  const startTime = Date.now()
  // 执行模块渲染
  const moduleResult = await runChildSession({
    client: sdk.client,
    directory: sdk.directory,
    parentSessionID: rootSession,
    agent: AGENT_NAME,
    modelKey,
    prompt: humanMessage,
    sync,
    onSessionCreated,
  })
  console.log("----- 模块渲染Agent运行结束，耗时：", (Date.now() - startTime) / 1000, 's -----');
  // 转换成 a2ui json
  const moduleJson = extractJson(moduleResult)
  if (!moduleJson) throw new Error("----- Module JSON did not return valid JSON -----")
  return {
    "ui_json": moduleJson,
    "section_id": sectionId,
    "element_id": elementId,
    "id_prefix": idPrefix
  }
}

// 组装模块生成的输入文本
function buildHumanMessage(idPrefix: string, sectionId: string, elementId: string, layoutPlanner: any, intentDescription: any) {
  // 拓展意图
  let userInput = intentDescription.userInput ?? "";
  let intentAnalysis = intentDescription.intentAnalysis ?? "";
  let pageDescription = intentDescription.pageDescription ?? "";
  intentAnalysis += pageDescription;
  let layoutDesc = intentDescription.layoutDescription ?? "";
  let sections = intentDescription.sections ?? [];
  let sectionsStr = JSON.stringify(sections, null, 2);

  // 布局规划
  let elements = layoutPlanner.elements ?? [];
  let slotElement = elements.find((e: any) => e?.id === elementId) ?? {};
  let slotElemnetStr = JSON.stringify(slotElement, null, 2);

  // 该模块详细意图
  let sectionDetailList = intentDescription.sectionDetailList ?? [];
  let sectionDetail = sectionDetailList.find((item: any) => item?.id === sectionId) ?? {};
  let sectionDetailStr = JSON.stringify(sectionDetail, null, 2);
  let humanMessage: string;
  humanMessage = `请为以下模块生成 A2UI JSON：

  [完整页面蓝图:] ==================================
  - 用户输入: ${userInput}
  - 意图分析: ${intentAnalysis}
  - 布局描述: ${layoutDesc}
  - 页面结构: ${sectionsStr}

  [模块顶层容器:] ==================================
  - Root ID: ${elementId}
  - Root UI:
    ${slotElemnetStr}
    
  [需要被渲染的模块详细蓝图:] ==================================
  ${sectionDetailStr}

  [需要被渲染模块的根节点:] ${elementId}
  [模块内部元素id前缀:] ${idPrefix} (注：该模块内所有 element id 必须以此开头)

  请先调用 *load_module_components* 工具查询组件 API，然后生成该模块的 JSON（包含 state 子集和 elements 数组）。`;
  return humanMessage;
}

import type { Message, Session } from '@opencode-ai/sdk/v2/client';
import { extractJson, getResultFromMessages } from '../../utils/json_parser';

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
    intentDescription } = input
  // 组装输入提示词
  const humanMessage = buildHumanMessage(idPrefix, sectionId, elementId, layoutPlanner, intentDescription)
  // 执行模块渲染
  const moduleResult = await runAgent(sdk, sync, modelKey, rootSession, humanMessage)
  debugger
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

// run OpenCode SDK
async function runAgent(sdk: any, sync: any, modelKey: string, rootSession: string, humanMessage: string): Promise<string> {
  // create new session
  const newSession = await sdk.client.session.create({
    directory: sdk.directory,
    parentID: rootSession,
    agent: AGENT_NAME,
  })
  const sessionData = newSession.data as Session | undefined
  if (!sessionData) throw new Error("----- Failed to create new session -----")

  // run session 
  await sdk.client.session.promptAsync({
    sessionID: sessionData.id,
    agent: AGENT_NAME,
    model: modelKey,
    parts: [{ type: "text", text: humanMessage }]
  })

  // get result
  let result = getResultFromMessages(sdk, sessionData.id, false);
  if (!result) throw new Error("----- Intent Audit agent returned NULL -----")
  return result;
}

// 组装模块生成的输入文本
function buildHumanMessage(idPrefix: string, sectionId: string, elementId: string, layoutPlanner: any, intentDescription: any){
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
  let slotElement = elements.find((e:any) => e?.id === elementId) ?? {};
  let slotElemnetStr = JSON.stringify(slotElement, null, 2);

  // 该模块详细意图
  let sectionDetailList = intentDescription.sectionDetailList ?? [];
  let sectionDetail = sectionDetailList.find((item:any) => item?.id === sectionId) ?? {};
  let sectionDetailStr = JSON.stringify(sectionDetail, null, 2);
  debugger
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
    
// async function waitForAssistant(sdk: ProtoModuleCreateContext["sdk"], sessionId: string, signal: AbortSignal): Promise<string> {
//   while (!signal.aborted) {
//     await new Promise((r) => setTimeout(r, 2000))
//     if (signal.aborted) throw new Error("aborted")
//     try {
//       const res = await sdk.client.session.messages({ sessionID: sessionId, limit: 20 })
//       const items = res.data as Array<{ info: { role: string; id: string; time: { completed?: number } }; parts: Part[] }> | undefined
//       if (!items) continue
//       for (const item of items) {
//         for (const part of item.parts) {
//           if (part.type === "tool-call" && (part as any).toolName === "load_components_docs") {
//             console.log("[module_create] load_components_docs called:", (part as any).input)
//           }
//         }
//       }
//       for (let i = items.length - 1; i >= 0; i--) {
//         const msg = items[i].info
//         if (msg.role !== "assistant") continue
//         if (msg.time.completed == null) break
//         for (let j = items[i].parts.length - 1; j >= 0; j--) {
//           // @ts-ignore
//           if (items[i].parts[j].type !== "text" || !items[i].parts[j].text) continue
//           // @ts-ignore
//           const json = extractA2UIJson(items[i].parts[j].text)
//           if (json)
//           // @ts-ignore
//             return items[i].parts[j].text
//         }
//       }
//     } catch { }
//   }
//   throw new Error("aborted")
// }

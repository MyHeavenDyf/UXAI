import type { Message, Session } from "@opencode-ai/sdk/v2/client"

const AGENT_NAME = "proto_intent"

type ProtoIntentInput = {
  // 公共sdk
  sdk: any
  // 公共流式数据
  sync: any
  modelKey: string
  rootSession: string
  userInput: string
  auditFeedback: string
  intentAuditPass: boolean
  pageDescription: string
}

export default async function proto_intent(input: ProtoIntentInput) {
  const { sdk, sync, modelKey, rootSession, userInput, auditFeedback, intentAuditPass, pageDescription } = input
  // 组装输入提示词
  const humanMessage = buildHumanMessage(userInput, auditFeedback, intentAuditPass, pageDescription)
  // 执行 Agent
  const intentResult = await runAgent(sdk, sync, modelKey, rootSession, humanMessage)
  // 转换成 audit json
  const intentJson = extractJsonFromText(intentResult)
  if (!intentJson) throw new Error("----- Intent Audit did not return valid JSON -----")
  return {
    "intent_description": intentJson,
    "current_step": "intent_expansion"
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
  await sdk.client.session.prompt({
    sessionID: sessionData.id,
    agent: AGENT_NAME,
    model: modelKey,
    parts: [{ type: "text", text: humanMessage }]
  })

  // get result
  let result = getLastAssistantText(sessionData.id, sync);
  if (!result) throw new Error("----- Intent gent returned NULL -----")
  return result;
}

// 组装意图扩展的输入文本
function buildHumanMessage(userInput: string, auditFeedback: string, intentAuditPass: boolean, pageDescription: string){
  let humanMessage: string;
  if(auditFeedback && !intentAuditPass){
    humanMessage = `你上一次生成的蓝图未通过审核校验，请务必参考以下反馈进行迭代修复：
    [用户的原始需求:] ==================================
    ${userInput}

    [待修正界面蓝图:] ==================================
    ${pageDescription}

    [蓝图审核结果:] ==================================
    ${auditFeedback}
    
    请根据评审意见结论修正界面蓝图。`;
  }else{
    humanMessage = `[用户的需求:] ==================================
    ${userInput}

    请开始意图扩展。`;
  }
  return humanMessage;
}

// 获取最终结果数据
function getLastAssistantText(sessionId: string, sync:any): string | null {
  const messages = (sync.data.message[sessionId] ?? []) as Message[]
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.role !== "assistant") continue
    const parts = (sync.data.part[msg.id] ?? []) as Array<{ type: string; text?: string }>
    for (const p of [...parts].reverse()) {
      if (p.type === "text" && p.text) return p.text
    }
  }
  return null
}

// transfrom text to json
function extractJsonFromText(text: string): Record<string, unknown> | null {
  try {
    const raw = text.includes("```json") ? text.match(/```json\s*\n([\s\S]*?)\n?```/)?.[1] ?? text : text;
    const parsed = JSON.parse(raw.trim())
    if (parsed && typeof parsed === "object") return parsed
  } catch {}
  return null
}


// 1. 定义数据类型 (根据你的 Python 代码推断)

interface SectionDetail {
  id: string | number; // 根据你的实际业务调整为 string 或 number
  intent?: string;
  function?: string;
  [key: string]: any; // 允许存在其他我们不需要提取的字段
}

interface Section {
  id: string | number;
  name?: string;
  [key: string]: any;
}

interface ComplexData {
  intentAnalysis?: string;
  layoutDescription?: string;
  sectionDetailList?: SectionDetail[];
  sections?: Section[];
}

interface SimplifiedSection {
  id: string | number;
  name: string;
  intent: string;
  function: string; 
}

interface SimplifiedData {
  pageDescription: string;
  layoutDescription: string;
  sections: SimplifiedSection[];
}

// 2. 实现转换函数

export function simplifyData(complexData: ComplexData | null | undefined): SimplifiedData {
  /**
   * 将复杂的 intent_description 数据转换为精简版 intent_page
   */
  
  // 1. 提取并重命名基础字段
  // 使用 ?. (可选链) 防止对象为空报错，使用 ?? (空值合并) 提供默认值 ""
  const pageDescription = complexData?.intentAnalysis ?? "";
  const layoutDescription = complexData?.layoutDescription ?? "";

  // 2. 将 sectionDetailList 转为字典，方便按 id 快速查找
  // Python 的字典推导式在这里用数组的 reduce 方法实现
  const sectionDetailList = complexData?.sectionDetailList ?? [];
  const detailMap = sectionDetailList.reduce((acc, detail) => {
    acc[detail.id] = detail;
    return acc;
  }, {} as Record<string | number, SectionDetail>);

  // 3. 重新整理 sections
  // Python 的 for...in 循环在这里用数组的 map 方法更符合前端函数式编程习惯
  const originalSections = complexData?.sections ?? [];
  const newSections: SimplifiedSection[] = originalSections.map((section) => {
    const sectionId = section.id;
    const sectionName = section.name ?? "";

    // 获取对应的详情信息
    const detail = detailMap[sectionId] ?? {};
    const intent = detail.intent ?? "";
    const func = detail.function ?? ""; // 注意：JS中 'function' 是关键字，作为变量名建议用 func，但作为对象属性名不受影响

    // 构建新的 section 对象
    return {
      id: sectionId,
      name: sectionName,
      intent: intent,
      function: func,
    };
  });

  // 4. 构建并返回最终的简单数据结构
  const simplifiedData: SimplifiedData = {
    pageDescription,
    layoutDescription,
    sections: newSections,
  };

  return simplifiedData;
}
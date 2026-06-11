import { extractJson } from '../../utils/json_parser';
import { runChildSession } from '../run-child-session';
import intentDescriptionSchema from './schema';

const AGENT_NAME = "proto_intent"

type ProtoIntentInput = {
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
  // 上一轮审查意见
  auditFeedback?: string
  // 上一轮审查是否通过
  intentAuditPass?: boolean
  // 上一轮的意图输出
  pageDescription?: string
  // 子 session 创建回调
  onSessionCreated?: (childSessionID: string) => void
}

export default async function proto_intent(input: ProtoIntentInput) {
  const { sdk, sync, modelKey, rootSession, userInput, auditFeedback, intentAuditPass, pageDescription, onSessionCreated } = input
  // 组装输入提示词
  const humanMessage = buildHumanMessage(userInput, auditFeedback, intentAuditPass, pageDescription)
  // 执行 Agent
  const intentResult = await runChildSession({
    client: sdk.client,
    directory: sdk.directory,
    parentSessionID: rootSession,
    agent: AGENT_NAME,
    modelKey,
    prompt: humanMessage,
    sync,
    onSessionCreated,
  })
  // 转换成 audit json
  debugger
  const intentJson = extractJson(intentResult)
  if (!intentJson) throw new Error("----- Intent Audit did not return valid JSON -----")
  return {
    "intent_description": intentJson,
    "intent_page": simplifyData(intentJson),
    "current_step": "intent_expansion"
  }
}

// 组装意图扩展的输入文本
function buildHumanMessage(userInput: string, auditFeedback: string | undefined, intentAuditPass: boolean | undefined, pageDescription: string | undefined){
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

// 将复杂的 intent_description 数据转换为精简版 intent_page
function simplifyData(complexData: any) {
    // 防御性处理：防止传入 null 或 undefined 导致报错
    const data = complexData ?? {};

    // 1. 提取并重命名基础字段（设置默认值为空字符串）
    const pageDescription = data.intentAnalysis ?? "";
    const layoutDescription = data.layoutDescription ?? "";
    
    // 2. 将 sectionDetailList 转为对象（Map），方便按 id 快速查找
    // 对应 Python 的字典推导式
    const sectionDetailList = data.sectionDetailList ?? [];
    const detailMap = sectionDetailList.reduce((map: any, detail: any) => {
        if (detail?.id) {
            map[detail.id] = detail;
        }
        return map;
    }, {});
    
    // 3. 重新整理 sections
    const sections = data.sections ?? [];
    const newSections = sections.map((section: any) => {
        const sectionId = section?.id;
        const sectionName = section?.name;
        
        // 获取对应的详情信息
        const detail = detailMap[sectionId] ?? {};
        const intent = detail.intent ?? "";
        const functionField = detail.function ?? ""; // 注意：js中function是关键字，变量名改用 functionField 避免混淆风险（对象key不受影响）
        
        // 构建新的 section 对象
        return {
            id: sectionId,
            name: sectionName,
            intent: intent,
            function: functionField
        };
    });
        
    // 4. 构建并返回最终的简单数据结构
    return {
        pageDescription,
        layoutDescription,
        sections: newSections
    };
}
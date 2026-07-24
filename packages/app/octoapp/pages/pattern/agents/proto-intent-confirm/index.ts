import { extractJson } from '../../utils/json-parser'
import { runChildSession } from '../run-child-session'
import { logAgentParsed } from '../../utils/debug-log'
import { INTENT_CONFIRM_FORMAT } from './schema'
import { agentThrow } from '../../utils/error-msg'

const AGENT_NAME = "proto_intent_confirm"

export type IntentConfirmDimension = {
  id: string
  name: string
  score: number
  file?: string
  preview?: string
}

export type IntentConfirmResult = {
  results: IntentConfirmDimension[]
  current_step: string
}

type ProtoIntentConfirmInput = {
  sdk: any
  sync: any
  modelKey: any
  rootSession: string
  userInput: string
  onSessionCreated?: (childSessionID: string) => void
}

export default async function proto_intent_confirm(input: ProtoIntentConfirmInput): Promise<IntentConfirmResult> {
  const { sdk, sync, modelKey, rootSession, userInput, onSessionCreated } = input

  const humanMessage = buildHumanMessage(userInput)

  const result = await runChildSession({
    sync,
    modelKey,
    onSessionCreated,
    agent: AGENT_NAME,
    client: sdk.client,
    prompt: humanMessage,
    directory: sdk.directory,
    parentSessionID: rootSession,
    schema: INTENT_CONFIRM_FORMAT.schema,
  })
  var json = extractJson(result.text)

  if (!json) {
    logAgentParsed(result.childSessionId, { error: "Failed to parse JSON", raw: result.text })
    agentThrow(AGENT_NAME, result.childSessionId, "Intent Confirm did not return valid JSON")
  }
  // 访问云端向量数据库，补充文档和预览图资源
  // 此处模拟补充完的信息状态，后续会编写真的信息补充接口，还要写接口访问报错的throw error机制？待定
  json = {
    "results": [
        {
            "id": "966",
            "name": "管理页-表格模式",
            "score": 88,
            "file": "https://xx.xx.com/acada.md",
            "preview": "https://gips2.baidu.com/it/u=195724436,3554684702&fm=3028&app=3028&f=JPEG&fmt=auto?w=1280&h=960"
        },
        {
            "id": "1017",
            "name": "管理页-卡片模式",
            "score": 85,
            "file": "https://xx.xx.com/acada.md",
            "preview": "https://gips2.baidu.com/it/u=195724436,3554684702&fm=3028&app=3028&f=JPEG&fmt=auto?w=1280&h=960"
        },
        {
            "id": "1021",
            "name": "详情页-页面级详情",
            "score": 45,
            "file": "https://xx.xx.com/acada.md",
            "preview": "https://gips2.baidu.com/it/u=195724436,3554684702&fm=3028&app=3028&f=JPEG&fmt=auto?w=1280&h=960"
        },
        {
            "id": "1022",
            "name": "详情页-抽屉级详情",
            "score": 42,
            "file": "https://xx.xx.com/acada.md",
            "preview": "https://gips2.baidu.com/it/u=195724436,3554684702&fm=3028&app=3028&f=JPEG&fmt=auto?w=1280&h=960"
        }
    ]
}
  const returnValue: IntentConfirmResult = {
    results: json.results ?? [],
    current_step: "intent_confirm",
  }
  logAgentParsed(result.childSessionId, returnValue)
  return returnValue
}

function buildHumanMessage(userInput: string): string {
  return `[用户的需求:] ==================================
${userInput}

请分析用户需求，匹配合适的Pattern。`
}

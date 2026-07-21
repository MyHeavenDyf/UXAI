import { extractJson } from '../../utils/json-parser'
import { runChildSession } from '../run-child-session'
import { logAgentParsed } from '../../utils/debug-log'
import { REPLANNER_FORMAT } from './schema'

const AGENT_NAME = "proto_replanner"

type ProtoReplannerInput = {
  sdk: any
  sync: any
  modelKey: any
  rootSession: string
  finalA2UIJson: Record<string, unknown>
  onSessionCreated?: (childSessionID: string) => void
}

export type ReplannerSlot = {
  section_id: string
  element_id: string
  id_prefix: string
}

export type ReplannerResult = {
  rootId: string
  elements: Record<string, unknown>[]
  slots: ReplannerSlot[]
}

export default async function proto_replanner(input: ProtoReplannerInput): Promise<ReplannerResult> {
  const { sdk, sync, modelKey, rootSession, finalA2UIJson, onSessionCreated } = input
  const humanMessage = buildHumanMessage(finalA2UIJson)
  console.log("----- 重新生成plannerAgent开始执行 -----")
  const startTime = Date.now()

  const result = await runChildSession({
    client: sdk.client,
    directory: sdk.directory,
    parentSessionID: rootSession,
    agent: AGENT_NAME,
    modelKey,
    prompt: humanMessage,
    sync,
    onSessionCreated,
    schema: REPLANNER_FORMAT.schema,
  })

  console.log("----- 重新生成plannerAgent运行结束，耗时：", (Date.now() - startTime) / 1000, 's -----')

  const replannerJson = extractJson(result.text)
  if (!replannerJson) {
    logAgentParsed(result.childSessionId, { error: "Failed to parse JSON", raw: result.text })
    throw new Error("----- Replanner did not return valid JSON -----")
  }

  const returnValue: ReplannerResult = {
    rootId: (replannerJson.rootId as string) ?? "",
    elements: (replannerJson.elements as Record<string, unknown>[]) ?? [],
    slots: ((replannerJson.slots as ReplannerSlot[]) ?? []).map((s) => ({
      section_id: s.section_id ?? "",
      element_id: s.element_id ?? "",
      id_prefix: s.id_prefix ?? "",
    })),
  }
  logAgentParsed(result.childSessionId, returnValue)
  return returnValue
}

function buildHumanMessage(finalA2UIJson: Record<string, unknown>): string {
  return JSON.stringify(finalA2UIJson, null, 2)
}

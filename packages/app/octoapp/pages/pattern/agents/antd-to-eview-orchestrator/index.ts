import { runChildSession } from '../run-child-session'

const AGENT_NAME = "antd_to_eview_orchestrator"

type AntdToEviewOrchestratorInput = {
  sdk: { client: any; directory: string; url: string }
  sync: any
  modelKey: { providerID: string; modelID: string } | undefined
  rootSession: string
  srcDirectory: string
  onSessionCreated?: (childSessionID: string) => void
}

export type AntdToEviewOrchestratorResult = {
  text: string
  childSessionId: string
  error?: string
}

export default async function antdToEviewOrchestrator(
  input: AntdToEviewOrchestratorInput,
): Promise<AntdToEviewOrchestratorResult> {
  const { sdk, sync, modelKey, rootSession, srcDirectory, onSessionCreated } = input

  const humanMessage = [
    `当前工作目录（SRC）：${srcDirectory}`,
    `目标工程根：${srcDirectory}-vite`,
    '',
    '请开始执行三阶段流水线。',
  ].join('\n')

  console.log("----- antd_to_eview_orchestrator 开始执行 -----")
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
  })

  console.log(
    "----- antd_to_eview_orchestrator 运行结束，耗时：",
    (Date.now() - startTime) / 1000,
    's -----',
  )

  return result
}

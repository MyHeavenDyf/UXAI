import { runChildSession } from '../run-child-session'

export type AntdToEviewTarget = 'eview-react' | 'eview-ui'

/** target → 后端编排 agent（两条路线都先走 umd-to-antd-vite，之后接不同 skill） */
const AGENT_NAMES: Record<AntdToEviewTarget, string> = {
  'eview-react': "antd_to_eview_orchestrator",
  'eview-ui': "antd_to_eviewui_orchestrator",
}

type AntdToEviewOrchestratorInput = {
  sdk: { client: any; directory: string; url: string }
  sync: any
  modelKey: { providerID: string; modelID: string } | undefined
  rootSession: string
  srcDirectory: string
  /** 目标组件库：eview-react（默认，antd→@nce/eview-react）/ eview-ui（antd→eview-ui，骨架换血路线） */
  target?: AntdToEviewTarget
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
  const target: AntdToEviewTarget = input.target ?? 'eview-react'
  const agent = AGENT_NAMES[target]

  const projectName = srcDirectory.split(/[/\\]/).pop() ?? `download-${target}`

  const humanMessage = [
    `当前工作目录（SRC）：${srcDirectory}`,
    `源项目名：${projectName}`,
    `源项目标题：${projectName}`,
    `目标组件库（TARGET）：${target}`,
    '请开始执行编排流水线。',
  ].join('\n')

  console.log(`----- ${agent} 开始执行 -----`)
  const startTime = Date.now()

  const result = await runChildSession({
    client: sdk.client,
    directory: sdk.directory,
    parentSessionID: rootSession,
    agent,
    modelKey,
    prompt: humanMessage,
    sync,
    onSessionCreated,
  })

  console.log(
    `----- ${agent} 运行结束，耗时：`,
    (Date.now() - startTime) / 1000,
    's -----',
  )

  return result
}

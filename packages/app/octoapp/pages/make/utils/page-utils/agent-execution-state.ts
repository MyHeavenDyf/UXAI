import { createSignal } from "solid-js"

export interface AgentExecutionState {
  childSessionId: string
  title: string
  visible: boolean
}

const [agentExecution, setAgentExecution] = createSignal<Record<string, AgentExecutionState>>({})

export { agentExecution, setAgentExecution }

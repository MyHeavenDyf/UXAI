import type { Agent, Project, Provider, ProviderListResponse } from "@opencode-ai/sdk/v2/client"
export { pathKey as directoryKey, type PathKey as DirectoryKey } from "@/utils/path-key"

export const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
const REMOVED_PROVIDER_IDS = new Set(["opencode", "bpit"])

function isAgent(input: unknown): input is Agent {
  if (!input || typeof input !== "object") return false
  const item = input as { name?: unknown; mode?: unknown }
  if (typeof item.name !== "string") return false
  return item.mode === "subagent" || item.mode === "primary" || item.mode === "all"
}

export function normalizeAgentList(input: unknown): Agent[] {
  if (Array.isArray(input)) return input.filter(isAgent)
  if (isAgent(input)) return [input]
  if (!input || typeof input !== "object") return []
  return Object.values(input).filter(isAgent)
}

export function normalizeProviderList(input: ProviderListResponse): ProviderListResponse {
  const all = input.all.filter((provider) => !REMOVED_PROVIDER_IDS.has(provider.id))
  const ids = new Set(all.map((provider) => provider.id))
  return {
    ...input,
    all: all.map((provider) => ({
      ...provider,
      models: Object.fromEntries(Object.entries(provider.models).filter(([, info]) => info.status !== "deprecated")),
    })),
    connected: input.connected.filter((id) => ids.has(id)),
    default: Object.fromEntries(Object.entries(input.default).filter(([id]) => ids.has(id))),
  }
}

export function replaceProviderList(current: ProviderListResponse, incoming: Provider[]): ProviderListResponse {
  const remote = incoming.filter((provider) => !REMOVED_PROVIDER_IDS.has(provider.id))
  const remoteIDs = new Set(remote.map((provider) => provider.id))
  const custom = current.all.filter(
    (provider) => provider.source === "config" && !remoteIDs.has(provider.id) && !REMOVED_PROVIDER_IDS.has(provider.id),
  )
  const all = [...remote, ...custom]
  return {
    ...current,
    all,
    connected: [
      ...remote.map((provider) => provider.id),
      ...custom.filter((provider) => current.connected.includes(provider.id)).map((provider) => provider.id),
    ],
    default: Object.fromEntries(
      all.flatMap((provider) => {
        const existing = current.default[provider.id]
        const modelID = existing && provider.models[existing] ? existing : Object.keys(provider.models)[0]
        return modelID ? [[provider.id, modelID] as const] : []
      }),
    ),
  }
}

export function sanitizeProject(project: Project) {
  if (!project.icon?.url && !project.icon?.override) return project
  return {
    ...project,
    icon: {
      ...project.icon,
      url: undefined,
      override: undefined,
    },
  }
}

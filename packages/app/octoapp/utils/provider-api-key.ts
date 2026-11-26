import type { Config } from "@opencode-ai/sdk/v2/client"

export function isLegacyOpencodeProvider(provider: { id: string; source?: string }) {
  return provider.id === "opencode" && provider.source !== "remote"
}

export async function saveProviderApiKey(input: {
  provider: { id: string; source?: string }
  apiKey: string
  updateConfig: (config: Config) => Promise<unknown>
  setAuth: (input: { providerID: string; auth: { type: "api"; key: string } }) => Promise<unknown>
}) {
  if (isLegacyOpencodeProvider(input.provider)) {
    return input.updateConfig({ provider: { [input.provider.id]: { options: { apiKey: input.apiKey } } } })
  }
  return input.setAuth({ providerID: input.provider.id, auth: { type: "api", key: input.apiKey } })
}

export function isProviderApiKeyMissing(provider?: { options?: Record<string, unknown> }) {
  return provider?.options?.requires_api_key === true && provider.options.api_key_configured !== true
}

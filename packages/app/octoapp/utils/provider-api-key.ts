export function isProviderApiKeyMissing(provider?: { options?: Record<string, unknown> }) {
  return provider?.options?.requires_api_key === true && provider.options.api_key_configured !== true
}

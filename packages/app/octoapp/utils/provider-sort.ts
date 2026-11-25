type Provider = { id: string; options?: Record<string, unknown> }

export function providerSortOrder(provider: Provider) {
  const value = provider.options?.sortOrder
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

export function compareProviderSortOrder(a: Provider, b: Provider) {
  const first = providerSortOrder(a)
  const second = providerSortOrder(b)
  if (first === undefined) return second === undefined ? 0 : 1
  if (second === undefined) return -1
  return first - second
}

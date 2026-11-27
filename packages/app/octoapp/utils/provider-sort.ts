type Provider = { id: string; options?: Record<string, unknown> }

export const modelProviderGrouping = {
  groupBy: (model: { provider: { id: string } }) => model.provider.id,
  groupHeader: (group: { category: string; items: { provider: { name: string } }[] }) =>
    group.items[0]?.provider.name ?? group.category,
}

// Keep model pickers in the same order as Settings > Models.
export function modelListSorting() {
  return {
    groupBy: modelProviderGrouping.groupBy,
    sortGroupsBy: (
      a: { items: { provider: Provider & { name: string } }[] },
      b: { items: { provider: Provider & { name: string } }[] },
    ) => compareProviderSortOrder(a.items[0].provider, b.items[0].provider),
  }
}

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

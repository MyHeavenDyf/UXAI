import { expect, test } from "bun:test"
import { fileURLToPath } from "node:url"

test("same-name providers remain separate and ordered in model lists", () => {
  // Run the real filtered list with Solid's browser effects, without replacing its implementation.
  const result = Bun.spawnSync(
    [
      process.execPath,
      "--conditions=browser",
      "-e",
      `
      import { createRoot } from "solid-js"
      import { useFilteredList } from ${JSON.stringify(fileURLToPath(new URL("../../../ui/src/hooks/use-filtered-list.tsx", import.meta.url)))}
      import { modelsApiProviders, modelsApiListForProviders } from ${JSON.stringify(fileURLToPath(new URL("../network/models-api.ts", import.meta.url)))}
      import { compareProviderSortOrder, modelProviderGrouping } from ${JSON.stringify(fileURLToPath(new URL("./provider-sort.ts", import.meta.url)))}
      const catalog = {
        early: { id: "early", name: "Shared", sortOrder: 1, models: { z: { id: "z", name: "Zulu" } } },
        late: { id: "late", name: "Shared", sortOrder: 3, models: { a: { id: "a", name: "Alpha" } } },
        middle: { id: "middle", name: "Middle", sortOrder: 2, models: { m: { id: "m", name: "Middle" } } },
      }
      const providers = modelsApiProviders(catalog)
      const items = modelsApiListForProviders(catalog, providers)
      const root = createRoot(dispose => ({
        dispose,
        list: useFilteredList({
          items,
          key: model => model.provider.id + "/" + model.id,
          filterKeys: ["provider.name", "name", "id"],
          sortBy: (a, b) => a.name.localeCompare(b.name),
          groupBy: modelProviderGrouping.groupBy,
          sortGroupsBy: (a, b) => compareProviderSortOrder(a.items[0].provider, b.items[0].provider),
        }),
      }))
      for (let i = 0; i < 8; i++) await Promise.resolve()
      const groups = root.list.grouped.latest.map(group => ({
        id: group.category,
        name: modelProviderGrouping.groupHeader(group),
        modelIDs: group.items.map(model => model.id),
      }))
      const providerOrder = providers.toSorted(compareProviderSortOrder).map(provider => provider.id)
      const modelOrder = root.list.flat().map(model => model.provider.id)
      root.list.onInput("Alpha")
      for (let i = 0; i < 8; i++) await Promise.resolve()
      const filtered = root.list.grouped.latest.map(group => ({ id: group.category, name: modelProviderGrouping.groupHeader(group) }))
      root.dispose()
      console.log(JSON.stringify({ groups, providerOrder, modelOrder, filtered }))
    `,
    ],
    { cwd: fileURLToPath(new URL("../../", import.meta.url)) },
  )

  expect(result.exitCode).toBe(0)
  expect(result.stderr.toString()).toBe("")
  expect(JSON.parse(result.stdout.toString())).toEqual({
    groups: [
      { id: "early", name: "Shared", modelIDs: ["z"] },
      { id: "middle", name: "Middle", modelIDs: ["m"] },
      { id: "late", name: "Shared", modelIDs: ["a"] },
    ],
    providerOrder: ["early", "middle", "late"],
    modelOrder: ["early", "middle", "late"],
    filtered: [{ id: "late", name: "Shared" }],
  })
})

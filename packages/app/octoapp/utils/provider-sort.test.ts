import { describe, expect, test } from "bun:test"
import { modelsApiProviders } from "../network/models-api"
import { replaceProviderList } from "../context/global-sync/utils"
import { compareProviderSortOrder, providerSortOrder } from "./provider-sort"

describe("provider sort order", () => {
  test("sorts providers by finite numeric rank, including zero and negative ranks", () => {
    const providers = [
      { id: "last", options: { sortOrder: 10 } },
      { id: "missing" },
      { id: "zero", options: { sortOrder: 0 } },
      { id: "first", options: { sortOrder: -1 } },
      { id: "middle", options: { sortOrder: 3 } },
    ]
    expect(providers.toSorted(compareProviderSortOrder).map((provider) => provider.id)).toEqual([
      "first",
      "zero",
      "middle",
      "last",
      "missing",
    ])
  })

  test("equal or missing ranks preserve the caller's existing ordering", () => {
    expect(compareProviderSortOrder({ id: "a" }, { id: "b" })).toBe(0)
    expect(
      compareProviderSortOrder({ id: "a", options: { sortOrder: 3 } }, { id: "b", options: { sortOrder: 3 } }),
    ).toBe(0)
    expect([{ id: "b" }, { id: "a" }].sort(compareProviderSortOrder).map((provider) => provider.id)).toEqual(["b", "a"])
  })

  test("invalid ranks are treated as unconfigured", () => {
    for (const sortOrder of [undefined, null, "1", Number.NaN, Number.POSITIVE_INFINITY]) {
      const provider = { id: "invalid", options: { sortOrder } }
      expect(providerSortOrder(provider)).toBeUndefined()
      expect(compareProviderSortOrder(provider, { id: "valid", options: { sortOrder: 3 } })).toBeGreaterThan(0)
    }
  })

  test("provider and model groups follow refreshed catalog ranks without changing models", () => {
    const catalog = (first: number, second: number) =>
      modelsApiProviders({
        first: {
          id: "first",
          name: "First",
          sortOrder: first,
          requires_api_key: true,
          models: {
            selected: { id: "selected", name: "Selected" },
          },
        },
        second: {
          id: "second",
          name: "Second",
          sortOrder: second,
          models: {
            selected: { id: "selected", name: "Selected" },
          },
        },
      })
    const original = catalog(3, 1)
    const current = {
      all: original,
      connected: ["first", "second"],
      default: { first: "selected", second: "selected" },
    }
    original[0].options.api_key_configured = true
    const refreshed = replaceProviderList(current, catalog(0, 4))
    expect(original.toSorted(compareProviderSortOrder).map((provider) => provider.id)).toEqual(["second", "first"])
    expect(refreshed.all.toSorted(compareProviderSortOrder).map((provider) => provider.id)).toEqual(["first", "second"])
    const groups = refreshed.all.map((provider) => ({ provider, models: Object.keys(provider.models) }))
    expect(
      groups.sort((a, b) => compareProviderSortOrder(a.provider, b.provider)).map((group) => group.provider.id),
    ).toEqual(["first", "second"])
    expect(refreshed.all[0].options.api_key_configured).toBe(true)
    expect(refreshed.default).toEqual(current.default)
    expect(groups.map((group) => group.models)).toEqual([["selected"], ["selected"]])
  })
})

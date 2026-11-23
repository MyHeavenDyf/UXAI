import { describe, expect, test } from "bun:test"
import { ConfigAliases } from "../../src/config/aliases"
import { ConfigParse } from "../../src/config/parse"
import { Config } from "../../src/config/config"

describe("config field aliases", () => {
  test("accepts plural fields and retains the original object", () => {
    const data = { providers: { custom: { models: { "222": { name: "222" } } } }, plugins: ["example-plugin"] }
    expect(ConfigAliases.normalize(data, "test")).toEqual({ provider: data.providers, plugin: data.plugins })
    expect(data.providers.custom.models["222"].name).toBe("222")
    expect("providers" in data).toBe(true)
  })

  test("merges providers and plugins with canonical spelling taking precedence", () => {
    expect(
      ConfigAliases.normalize(
        {
          providers: {
            custom: { name: "old", models: { old: { name: "Old" } }, options: { baseURL: "https://example.com" } },
          },
          provider: { custom: { name: "new", models: { new: { name: "New" } } } },
          plugins: [["example-plugin", { mode: "old" }], "other-plugin"],
          plugin: [["example-plugin", { mode: "new" }]],
        },
        "test",
      ),
    ).toEqual({
      provider: {
        custom: {
          name: "new",
          models: { old: { name: "Old" }, new: { name: "New" } },
          options: { baseURL: "https://example.com" },
        },
      },
      plugin: ["other-plugin", ["example-plugin", { mode: "new" }]],
    })
  })

  test.each([
    { providers: [] },
    { providers: null },
    { plugins: {} },
    { plugins: "bad" },
    { providers: { custom: {} }, provider: [] },
    { plugins: ["valid"], plugin: "bad" },
    { providers: { custom: { models: { invalid: { limit: { context: "bad" } } } } } },
    { plugins: [["example-plugin", "bad-options"]] },
  ])("rejects invalid alias data rather than silently discarding it: %j", (data) => {
    expect(() => ConfigAliases.normalize(data, "test")).toThrow()
  })

  test("does not relax unknown-field checking", () => {
    expect(() =>
      ConfigParse.effectSchema(Config.Info, ConfigAliases.normalize({ providers: {}, typo: true }, "test"), "test"),
    ).toThrow()
  })

  test("preserves JSONC comments outside migrated fields and removes aliases on save", () => {
    const text = `{
      // keep this comment
      "providers": { "custom": { "name": "Custom" } },
      "plugins": ["example-plugin"],
      "model": "custom/222",
    }`
    const result = ConfigAliases.canonicalize(text, "config.jsonc")
    expect(result).toContain("// keep this comment")
    expect(ConfigParse.jsonc(result, "test")).toEqual({
      provider: { custom: { name: "Custom" } },
      plugin: ["example-plugin"],
      model: "custom/222",
    })
    expect(ConfigAliases.canonicalize(result, "config.jsonc")).toBe(result)
  })

  test("leaves singular-only configuration unchanged", () => {
    const text = '{ "provider": {}, "plugin": [] }'
    expect(ConfigAliases.canonicalize(text, "config.json")).toBe(text)
  })
})

import { describe, expect, test } from "bun:test"
import { hasImageInput, modalityRow, setImageInput, validateCustomProvider } from "./dialog-custom-provider-form"

const t = (key: string) => key

describe("image input checkbox", () => {
  test("creates only the two specified modalities and saves them", () => {
    const modalities = setImageInput([], true)
    expect(hasImageInput(modalities)).toBe(true)
    const result = validateCustomProvider({
      form: {
        providerID: "custom-provider",
        name: "Provider",
        baseURL: "https://api.example.com",
        apiKey: "",
        models: [{ row: "m0", id: "vision", name: "Vision", modalities, err: { modalities: [] } }],
        headers: [],
        err: {},
      },
      t,
      disabledProviders: [],
      existingProviderIDs: new Set(),
    })
    expect(result.result?.config.models.vision).toEqual({
      name: "Vision",
      modalities: { input: ["text", "image"], output: ["text"] },
    })
    expect(hasImageInput(setImageInput(modalities, false))).toBe(false)
    expect(setImageInput(modalities, false)).toEqual([])
  })

  test("does not duplicate image when enabled and removes modalities when disabled", () => {
    const rows = [modalityRow("input", '["text","audio","image"]'), modalityRow("output", '["text","audio"]')]
    expect(hasImageInput(rows)).toBe(true)
    const enabled = setImageInput(rows, true)
    expect(JSON.parse(enabled.find((item) => item.key === "input")!.value)).toEqual(["text", "audio", "image"])
    const disabled = setImageInput(enabled, false)
    expect(disabled).toEqual([])
    expect(setImageInput([], false)).toEqual([])
  })
})

describe("validateCustomProvider", () => {
  test.each([
    {
      limit: { context: "128000", input: "112000", output: "16000" },
      expected: { context: 128000, input: 112000, output: 16000 },
    },
    { limit: { context: "", input: "", output: "16000" }, expected: { output: 16000 } },
    { limit: { context: "", input: "", output: "" }, expected: undefined },
    {
      limit: { context: "128000", input: "128000", output: "16000" },
      expected: { context: 128000, input: 128000, output: 16000 },
    },
  ])("saves optional limits: $limit", ({ limit, expected }) => {
    const result = validateCustomProvider({
      form: {
        providerID: "custom",
        name: "Custom",
        baseURL: "https://example.com",
        apiKey: "",
        models: [{ row: "m0", id: "model", name: "Model", limit, modalities: [], err: { modalities: [] } }],
        headers: [],
        err: {},
      },
      t,
      disabledProviders: [],
      existingProviderIDs: new Set(),
    })
    expect(result.result).toBeDefined()
    expect(result.result?.config.models.model.limit).toEqual<unknown>(expected)
  })

  test.each(["0", "-1", "1.5", "NaN", "Infinity", "129000"])("rejects invalid input limit %s", (value) => {
    const result = validateCustomProvider({
      form: {
        providerID: "custom",
        name: "Custom",
        baseURL: "https://example.com",
        apiKey: "",
        models: [
          {
            row: "m0",
            id: "model",
            name: "Model",
            limit: { context: "128000", input: value, output: "" },
            modalities: [],
            err: { modalities: [] },
          },
        ],
        headers: [],
        err: {},
      },
      t,
      disabledProviders: [],
      existingProviderIDs: new Set(),
    })
    expect(result.result).toBeUndefined()
    expect(result.models[0].limit).toBeDefined()
  })

  test("builds trimmed config payload", () => {
    const result = validateCustomProvider({
      form: {
        providerID: "custom-provider",
        name: " Custom Provider ",
        baseURL: "https://api.example.com ",
        apiKey: " {env: CUSTOM_PROVIDER_KEY} ",
        models: [{ row: "m0", id: " model-a ", name: " Model A ", modalities: [], err: { modalities: [] } }],
        headers: [
          { row: "h0", key: " X-Test ", value: " enabled ", err: {} },
          { row: "h1", key: "", value: "", err: {} },
        ],
        err: {},
      },
      t,
      disabledProviders: [],
      existingProviderIDs: new Set(),
    })

    expect(result.result).toEqual({
      providerID: "custom-provider",
      name: "Custom Provider",
      key: undefined,
      config: {
        npm: "@ai-sdk/openai-compatible",
        name: "Custom Provider",
        env: ["CUSTOM_PROVIDER_KEY"],
        options: {
          baseURL: "https://api.example.com",
          __octo_custom_provider: true,
          headers: {
            "X-Test": "enabled",
          },
        },
        models: {
          "model-a": { name: "Model A" },
        },
      },
    })
  })

  test("flags duplicate rows and allows reconnecting disabled providers", () => {
    const result = validateCustomProvider({
      form: {
        providerID: "custom-provider",
        name: "Provider",
        baseURL: "https://api.example.com",
        apiKey: "secret",
        models: [
          { row: "m0", id: "model-a", name: "Model A", modalities: [], err: { modalities: [] } },
          {
            row: "m1",
            id: "model-a",
            name: "Model A 2",
            modalities: [],
            err: { modalities: [] },
          },
        ],
        headers: [
          { row: "h0", key: "Authorization", value: "one", err: {} },
          { row: "h1", key: "authorization", value: "two", err: {} },
        ],
        err: {},
      },
      t,
      disabledProviders: ["custom-provider"],
      existingProviderIDs: new Set(["custom-provider"]),
    })

    expect(result.result).toBeUndefined()
    expect(result.err.providerID).toBeUndefined()
    expect(result.models[1]).toEqual({
      id: "provider.custom.error.duplicate",
      name: undefined,
      modalities: [],
    })
    expect(result.headers[1]).toEqual({
      key: "provider.custom.error.duplicate",
      value: undefined,
    })
  })

  test("builds modalities from key-value rows", () => {
    const result = validateCustomProvider({
      form: {
        providerID: "custom-provider",
        name: "Provider",
        baseURL: "https://api.example.com",
        apiKey: "",
        models: [
          {
            row: "m0",
            id: "vision-model",
            name: "Vision Model",
            modalities: [
              { row: "mm0", key: "input", value: '["text", "image"]', err: {} },
              { row: "mm1", key: "output", value: '["text"]', err: {} },
            ],
            err: { modalities: [] },
          },
        ],
        headers: [{ row: "h0", key: "", value: "", err: {} }],
        err: {},
      },
      t,
      disabledProviders: [],
      existingProviderIDs: new Set(),
    })

    expect(result.result?.config.models).toEqual({
      "vision-model": {
        name: "Vision Model",
        modalities: {
          input: ["text", "image"],
          output: ["text"],
        },
      },
    })
  })

  test("validates modalities JSON, keys, and required pairs", () => {
    const result = validateCustomProvider({
      form: {
        providerID: "custom-provider",
        name: "Provider",
        baseURL: "https://api.example.com",
        apiKey: "",
        models: [
          {
            row: "m0",
            id: "vision-model",
            name: "Vision Model",
            modalities: [
              { row: "mm0", key: "input", value: '["text", "unknown"]', err: {} },
              { row: "mm1", key: "extra", value: "not-json", err: {} },
            ],
            err: { modalities: [] },
          },
        ],
        headers: [{ row: "h0", key: "", value: "", err: {} }],
        err: {},
      },
      t,
      disabledProviders: [],
      existingProviderIDs: new Set(),
    })

    expect(result.result).toBeUndefined()
    expect(result.models[0]?.modalities).toEqual([
      {
        key: "provider.custom.error.modalities.required",
        value: "provider.custom.error.modalities.value",
      },
      {
        key: "provider.custom.error.modalities.key",
        value: "provider.custom.error.modalities.array",
      },
    ])
  })

  test("allows the current provider ID in edit mode", () => {
    const result = validateCustomProvider({
      form: {
        providerID: "custom-provider",
        name: "Provider",
        baseURL: "https://api.example.com",
        apiKey: "",
        models: [
          {
            row: "m0",
            id: "model-a",
            name: "Model A",
            modalities: [],
            err: { modalities: [] },
          },
        ],
        headers: [{ row: "h0", key: "", value: "", err: {} }],
        err: {},
      },
      t,
      disabledProviders: [],
      existingProviderIDs: new Set(["custom-provider"]),
      editingProviderID: "custom-provider",
    })

    expect(result.result?.providerID).toBe("custom-provider")
  })
})

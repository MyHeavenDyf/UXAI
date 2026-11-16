import { describe, expect, test } from "bun:test"
import { type ModelRow, validateCustomProvider } from "./dialog-custom-provider-form"

const t = (key: string) => key

describe("validateCustomProvider", () => {
  const advanced = (model: Partial<ModelRow>) =>
    validateCustomProvider({
      form: {
        providerID: "custom-provider",
        name: "Provider",
        baseURL: "https://api.example.com/v1",
        apiKey: "",
        models: [{ row: "m0", id: "model", name: "Model", modalities: [], err: { modalities: [] }, ...model }],
        headers: [],
        err: {},
      },
      t,
      disabledProviders: [],
      existingProviderIDs: new Set(),
    })

  test("writes advanced model capabilities and token limits", () => {
    expect(
      advanced({ imageInput: true, inputLimit: "128000", outputLimit: "16000" }).result?.config.models.model,
    ).toMatchObject({
      modalities: { input: ["text", "image"], output: ["text"] },
      limit: { input: 128000, output: 16000 },
    })
  })

  test("preserves independent existing limits when only output is edited", () => {
    expect(
      advanced({ limit: { context: 256000, input: 200000, output: 16000 }, outputLimit: "32000" }).result?.config.models
        .model.limit,
    ).toEqual({ context: 256000, input: 200000, output: 32000 })
  })

  test("editing input preserves existing context and output", () => {
    expect(
      advanced({ limit: { context: 256000, input: 200000, output: 16000 }, inputLimit: "128000" }).result?.config.models
        .model.limit,
    ).toEqual({ context: 256000, input: 128000, output: 16000 })
  })

  test("clearing limits removes overrides and preserves unrelated context", () => {
    expect(
      advanced({ limit: { context: 256000, input: 200000, output: 16000 }, inputLimit: "", outputLimit: "" }).result
        ?.config.models.model.limit,
    ).toEqual({ context: 256000 })
    expect(
      advanced({ limit: { input: 200000, output: 16000 }, inputLimit: "", outputLimit: "" }).result?.config.models
        .model,
    ).not.toHaveProperty("limit")
  })

  test("editing one limit does not introduce overrides for the other limits", () => {
    expect(advanced({ outputLimit: "16000" }).result?.config.models.model.limit).toEqual({ output: 16000 })
    expect(advanced({ inputLimit: "128000" }).result?.config.models.model.limit).toEqual({ input: 128000 })
  })

  test("image toggle preserves other configured input and output modalities", () => {
    expect(advanced({ imageInput: true }).result?.config.models.model).not.toHaveProperty("attachment")
    expect(advanced({ imageInput: false }).result?.config.models.model).not.toHaveProperty("attachment")
    expect(
      advanced({
        imageInput: false,
        modalities: [
          { row: "i", key: "input", value: '["text", "image", "pdf"]', err: {} },
          { row: "o", key: "output", value: '["text", "audio"]', err: {} },
        ],
      }).result?.config.models.model.modalities,
    ).toEqual({ input: ["text", "pdf"], output: ["text", "audio"] })
  })

  test("disabling image-only input produces a configuration that can be edited again", () => {
    const result = advanced({
      imageInput: false,
      modalities: [
        { row: "i", key: "input", value: '["image"]', err: {} },
        { row: "o", key: "output", value: '["text"]', err: {} },
      ],
    }).result
    expect(result).toBeDefined()
    expect(result?.config.models.model.modalities).toEqual({ input: ["text"], output: ["text"] })
    const reopened = advanced({
      modalities: Object.entries(result!.config.models.model.modalities!).map(([key, value]) => ({
        row: key,
        key,
        value: JSON.stringify(value),
        err: {},
      })),
    })
    expect(reopened.result).toBeDefined()
    expect(reopened.result?.config.models.model.modalities).toEqual(result?.config.models.model.modalities)
  })

  test("rejects invalid token limits and accepts empty defaults", () => {
    for (const value of ["0", "-1", "3.5", "32K", "Infinity", "9007199254740992"]) {
      expect(advanced({ inputLimit: value }).result).toBeUndefined()
      expect(advanced({ outputLimit: value }).result).toBeUndefined()
    }
    expect(advanced({ inputLimit: "", outputLimit: "" }).result?.config.models.model).not.toHaveProperty("limit")
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

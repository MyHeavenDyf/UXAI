import { beforeEach, describe, expect, test } from "bun:test"
import {
  hasModelsApiToken,
  modelsApiHeaders,
  modelsApiProviders,
  modelsApiThirdToken,
  modelsApiToken,
  fetchModelsApi,
  MODELS_API_URL_STORAGE_KEY,
} from "./models-api"

describe("modelsApiProviders", () => {
  test("preserves provider sorting metadata without changing other options", () => {
    const result = modelsApiProviders({
      ranked: { name: "Ranked", sortOrder: 0, requires_api_key: true, models: {} },
      missing: { name: "Missing", models: {} },
      invalid: { name: "Invalid", sortOrder: Number.NaN, models: {} },
    })
    expect(result[0].options).toEqual({ sortOrder: 0, requires_api_key: true, api_key_configured: false })
    expect(result[1].options.sortOrder).toBeUndefined()
    expect(result[2].options.sortOrder).toBeUndefined()
  })

  test("requires an explicitly configured API key only when requested by the catalog", () => {
    const result = modelsApiProviders({
      paid: { id: "paid", name: "Paid", requires_api_key: true, models: {} },
      free: { id: "free", name: "Free", models: {} },
    })
    expect(result[0].options).toMatchObject({ requires_api_key: true, api_key_configured: false })
    expect(result[1].options.requires_api_key).toBeUndefined()
  })
  test("converts remote provider arrays into app provider models", () => {
    const result = modelsApiProviders({
      w3: {
        id: "w3",
        name: "Octo AI",
        api: "http://octoai-llm.ucd.huawei.com/v1",
        npm: "@ai-sdk/openai-compatible",
        title_model: [" missing ", " GLM-V5_1 "],
        models: [
          {
            id: "GLM-V5_1",
            name: "GLM V5.1",
            isExternal: true,
            defaultDisabled: true,
            release_date: "2025-01-01",
            attachment: true,
            reasoning: false,
            temperature: true,
            tool_call: true,
            limit: { context: 128_000, output: 128_000 },
          },
        ],
      },
      xiaomi: {
        id: "xiaomi",
        name: "Xiaomi",
        api: "https://api.xiaomimimo.com/v1",
        npm: "@ai-sdk/openai-compatible",
        models: {
          "mimo-v2.5": {
            id: "mimo-v2.5",
            name: "MiMo V2.5",
            release_date: "2025-01-01",
            attachment: false,
            reasoning: true,
            temperature: true,
            tool_call: true,
            limit: { context: 128_000, output: 16_000 },
          },
        },
      },
    })

    expect(result).toHaveLength(2)
    expect(result[0].id).toBe("w3")
    expect(result[0].source).toBe("remote")
    expect(result[0].title_model).toEqual(["missing", "GLM-V5_1"])
    expect(result[0].models["GLM-V5_1"]).toMatchObject({
      id: "GLM-V5_1",
      providerID: "w3",
      isExternal: true,
      defaultDisabled: true,
      api: {
        url: "http://octoai-llm.ucd.huawei.com/v1",
        npm: "@ai-sdk/openai-compatible",
      },
      capabilities: {
        attachment: true,
        reasoning: false,
        temperature: true,
        toolcall: true,
      },
      limit: { context: 128_000, output: 128_000 },
    })
    expect(result[1]).toMatchObject({
      id: "xiaomi",
      source: "remote",
      options: { baseURL: "https://api.xiaomimimo.com/v1" },
    })
    expect(result[1].models["mimo-v2.5"].api.url).toBe("https://api.xiaomimimo.com/v1")
  })

  test("loads opencode and bpit from remote catalogs like any other provider", async () => {
    const catalog = {
      opencode: { id: "opencode", name: "Octo AI", models: { selected: { id: "selected", name: "Selected" } } },
      bpit: { id: "bpit", name: "BPIT", models: { selected: { id: "selected", name: "Selected" } } },
    }
    const previous = localStorage.getItem(MODELS_API_URL_STORAGE_KEY)
    localStorage.setItem(
      MODELS_API_URL_STORAGE_KEY,
      `data:application/json,${encodeURIComponent(JSON.stringify({ content: catalog }))}`,
    )
    try {
      const received = await fetchModelsApi()
      const providers = modelsApiProviders(received)
      expect(providers.map((provider) => provider.id)).toEqual(["opencode", "bpit"])
      for (const provider of providers) {
        expect(provider.source).toBe("remote")
        expect(provider.models.selected.providerID).toBe(provider.id)
      }
    } finally {
      previous === null
        ? localStorage.removeItem(MODELS_API_URL_STORAGE_KEY)
        : localStorage.setItem(MODELS_API_URL_STORAGE_KEY, previous)
    }
  })
})

describe("modelsApiHeaders", () => {
  beforeEach(() => localStorage.clear())

  test("reads the latest token value from storage", () => {
    expect(hasModelsApiToken()).toBe(false)
    localStorage.setItem("uiplusToken", " old-token ")
    expect(modelsApiToken()).toBe("old-token")
    localStorage.setItem("uiplusToken", "new-token")
    expect(modelsApiToken()).toBe("new-token")
  })

  test("includes the account from userInfo for the local server", () => {
    localStorage.setItem("userInfo", JSON.stringify({ account: " j60099994 " }))
    expect(modelsApiHeaders()["x-opencode-w3-account"]).toBe("j60099994")
  })

  test("forwards thirdToken from userInfo as the model authentication token", () => {
    localStorage.setItem("userInfo", JSON.stringify({ thirdToken: " third-token " }))

    expect(modelsApiThirdToken()).toBe("third-token")
    expect(modelsApiHeaders()["X-Auth-Token"]).toBe("third-token")
  })

  test("omits the account when userInfo is invalid", () => {
    localStorage.setItem("userInfo", "invalid JSON")
    expect(modelsApiHeaders()).not.toHaveProperty("x-opencode-w3-account")
  })
})

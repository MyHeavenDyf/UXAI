import { beforeEach, describe, expect, test } from "bun:test"
import { modelsApiHeaders, modelsApiProviders } from "./models-api"

describe("modelsApiProviders", () => {
  test("converts remote provider arrays into app provider models", () => {
    const result = modelsApiProviders({
      opencode: {
        id: "opencode",
        name: "Octo AI",
        api: "http://octoai-llm.ucd.huawei.com/v1",
        npm: "@ai-sdk/openai-compatible",
        models: [
          {
            id: "GLM-V5_1",
            name: "GLM V5.1",
            release_date: "2025-01-01",
            attachment: true,
            reasoning: false,
            temperature: true,
            tool_call: true,
            limit: { context: 128_000, output: 128_000 },
          },
        ],
      },
    })

    expect(result).toHaveLength(1)
    expect(result[0].id).toBe("opencode")
    expect(result[0].models["GLM-V5_1"]).toMatchObject({
      id: "GLM-V5_1",
      providerID: "opencode",
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
  })
})

describe("modelsApiHeaders", () => {
  beforeEach(() => localStorage.clear())

  test("includes the account from userInfo for the local server", () => {
    localStorage.setItem("userInfo", JSON.stringify({ account: " j60099994 " }))
    expect(modelsApiHeaders()["x-opencode-w3-account"]).toBe("j60099994")
  })

  test("omits the account when userInfo is invalid", () => {
    localStorage.setItem("userInfo", "invalid JSON")
    expect(modelsApiHeaders()).not.toHaveProperty("x-opencode-w3-account")
  })
})

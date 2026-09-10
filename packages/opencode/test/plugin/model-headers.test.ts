import { describe, expect, test } from "bun:test"
import { configureModelsApiHeaders, modelRequestBody, parseModelsApi } from "@/plugin/model-headers"

test("normalizes array models from the remote catalog", () => {
  const catalog = parseModelsApi({
    content: {
      bpit: {
        id: "bpit",
        name: "BPIT",
        env: ["MODEL_API_KEY"],
        npm: "@ai-sdk/openai-compatible",
        api: "https://api.example.com/v1",
        models: [
          {
            id: "remote-only-model",
            name: "Remote only model",
            attachment: true,
            reasoning: false,
            temperature: true,
            tool_call: true,
            limit: { context: 128_000, output: 16_000 },
          },
        ],
      },
    },
  })

  expect((catalog.bpit as Record<string, unknown>).models).toEqual({
    "remote-only-model": expect.objectContaining({
      id: "remote-only-model",
      name: "Remote only model",
      release_date: "",
    }),
  })
})

describe("model request body", () => {
  test("adds model network type and user account", () => {
    configureModelsApiHeaders({
      "x-opencode-models-api-source": "local",
      uiplustoken: "ui-plus-token",
      "x-opencode-w3-account": "j60099994",
    })

    expect(modelRequestBody({ model: "mimo-v2.5" }, true)).toEqual({
      model: "mimo-v2.5",
      isExternal: true,
      w3Account: "j60099994",
    })
  })

  test("defaults missing model network type to false", () => {
    expect(modelRequestBody({ model: "mimo-v2.5" })).toMatchObject({ isExternal: false })
  })
})

import { describe, expect, test } from "bun:test"
import { configureModelsApiHeaders, modelRequestBody, parseModelsApi } from "@/plugin/model-headers"

test("normalizes array models from the remote catalog", () => {
  const catalog = parseModelsApi({
    content: {
      w3: {
        id: "w3",
        name: "W3",
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

  expect((catalog.w3 as Record<string, unknown>).models).toEqual({
    "remote-only-model": expect.objectContaining({
      id: "remote-only-model",
      name: "Remote only model",
      release_date: "",
    }),
  })
})

test("excludes removed providers from the remote catalog", () => {
  expect(
    parseModelsApi({
      content: {
        opencode: { id: "opencode", name: "Octo AI", models: {} },
        bpit: { id: "bpit", name: "BPIT", models: {} },
      },
    }),
  ).toEqual({})
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

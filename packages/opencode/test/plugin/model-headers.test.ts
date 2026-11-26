import { describe, expect, test } from "bun:test"
import { configureModelsApiHeaders, ModelHeadersPlugin, modelRequestBody, parseModelsApi } from "@/plugin/model-headers"
import { Schema } from "effect"
import { ModelsDev } from "@/provider/models"

test.each(
  [undefined, null, "3", "", true, {}, [], Number.NaN, Number.POSITIVE_INFINITY].map((sortOrder) => ({ sortOrder })),
)("invalid optional sort order %j does not invalidate a remote provider", (input) => {
  const catalog = parseModelsApi({
    content: {
      gateway: { id: "gateway", name: "Gateway", sortOrder: input.sortOrder, models: [{ id: "remote-model" }] },
    },
  })
  const provider = Schema.decodeUnknownSync(ModelsDev.Provider)(catalog.gateway)
  expect(provider.id).toBe("gateway")
  expect(provider.sortOrder).toBeUndefined()
  expect(provider.models["remote-model"].id).toBe("remote-model")
})

test.each([0, -1, 3])("preserves valid remote sort order %j", (sortOrder) => {
  const catalog = parseModelsApi({ gateway: { id: "gateway", name: "Gateway", sortOrder, models: {} } })
  expect(Schema.decodeUnknownSync(ModelsDev.Provider)(catalog.gateway).sortOrder).toBe(sortOrder)
})

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

test("retains opencode and bpit in the remote catalog", () => {
  const catalog = parseModelsApi({
    content: {
      opencode: { id: "opencode", name: "Octo AI", models: [{ id: "selected" }] },
      bpit: { id: "bpit", name: "BPIT", models: [{ id: "selected" }] },
    },
  })
  expect(Object.keys(catalog)).toEqual(["opencode", "bpit"])
  for (const provider of Object.values(catalog)) {
    expect(Schema.decodeUnknownSync(ModelsDev.Provider)(provider).models.selected.id).toBe("selected")
  }
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

test("adds thirdToken to model conversation headers", async () => {
  configureModelsApiHeaders({
    "x-opencode-models-api-source": "local",
    "x-auth-token": "third-token",
  })
  const headers = {}
  const model = {
    providerID: "w3",
    id: "model",
    api: { id: "model" },
    headers: { "x-auth-token": "catalog-token" },
  }
  const hook = (await ModelHeadersPlugin(undefined as never))["chat.headers"]

  await hook?.(
    {
      model,
    } as never,
    { headers } as never,
  )

  expect(headers).toEqual({ "X-Auth-Token": "third-token" })
  expect(Object.keys(model.headers)).toEqual([])
})

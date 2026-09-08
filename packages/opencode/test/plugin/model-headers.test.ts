import { describe, expect, test } from "bun:test"
import { configureModelsApiHeaders, modelRequestHeaders } from "@/plugin/model-headers"

describe("model headers plugin", () => {
  test("adds model network type and user account to chat headers", () => {
    configureModelsApiHeaders({
      "x-opencode-models-api-source": "local",
      UiplusToken: "ui-plus-token",
      w3account: "j60099994",
    })
    expect(
      modelRequestHeaders(
        { providerID: "w3", modelID: "model", apiID: "model-api-id" },
        {
          w3: {
            models: {
              model: {
                id: "model-api-id",
                isExternal: true,
                headers: { "x-model-header": "model-value" },
              },
            },
          },
        },
      ),
    ).toEqual({
      "x-model-header": "model-value",
      isExternal: "true",
      UiplusToken: "ui-plus-token",
      w3Account: "j60099994",
    })
  })

  test("uses the selected model network type without a remote catalog", () => {
    expect(
      modelRequestHeaders({ providerID: "opencode", modelID: "model", apiID: "model", isExternal: false }),
    ).toMatchObject({ isExternal: "false" })
  })

  test("defaults missing model network type to false", () => {
    expect(modelRequestHeaders({ providerID: "xiaomi", modelID: "mimo-v2.5", apiID: "mimo-v2.5" })).toMatchObject({
      isExternal: "false",
    })
  })
})

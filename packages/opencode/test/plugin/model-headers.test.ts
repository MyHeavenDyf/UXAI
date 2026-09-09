import { describe, expect, test } from "bun:test"
import { configureModelsApiHeaders, modelRequestBody } from "@/plugin/model-headers"

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
    expect(modelRequestBody({ model: "mimo-v2.5" })).toMatchObject({
      isExternal: false,
    })
  })
})

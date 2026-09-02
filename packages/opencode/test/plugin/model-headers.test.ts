import { expect, test } from "bun:test"
import { configureModelsApi, modelsApiCatalog, modelsApiSource } from "@/plugin/model-headers"

const response = {
  alias: {
    id: "w3",
    name: "Remote W3",
    env: ["W3_KEY"],
    npm: "@ai-sdk/openai-compatible",
    api: "https://example.com/v1",
    models: {
      "remote-only": {
        id: "remote-only",
        name: "Remote Only",
        release_date: "2026-09-01",
        attachment: false,
        reasoning: false,
        isExternal: true,
        temperature: true,
        tool_call: true,
        limit: { context: 128_000, output: 16_000 },
      },
    },
  },
}

test("HTTP models catalog is authoritative and keyed by provider id", async () => {
  using server = Bun.serve({ port: 0, fetch: () => Response.json(response) })
  configureModelsApi({ source: "http", url: `${server.url}api.json` })

  const catalog = await modelsApiCatalog(true)

  expect(modelsApiSource()).toBe("http")
  expect(catalog?.alias).toBeUndefined()
  expect(catalog?.w3.name).toBe("Remote W3")
  expect(catalog?.w3.models["remote-only"].isExternal).toBe(true)
  configureModelsApi({ source: "local" })
})

test("HTTP models catalog keeps the last valid response when refresh fails", async () => {
  const state = { available: true }
  using server = Bun.serve({
    port: 0,
    fetch: () => (state.available ? Response.json(response) : new Response(undefined, { status: 503 })),
  })
  configureModelsApi({ source: "http", url: `${server.url}api.json` })
  expect((await modelsApiCatalog(true))?.w3.models["remote-only"]).toBeDefined()

  state.available = false
  expect((await modelsApiCatalog(true))?.w3.models["remote-only"]).toBeDefined()
  configureModelsApi({ source: "local" })
})

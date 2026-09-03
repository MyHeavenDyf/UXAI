import { afterEach, expect, test } from "bun:test"
import { configureModelsApi, modelsApiCatalog } from "@/plugin/model-headers"

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

afterEach(() => configureModelsApi({ url: process.env["OPENCODE_MODELS_URL"] }))

test("HTTP models catalog is authoritative and keyed by provider id", async () => {
  using server = Bun.serve({ port: 0, fetch: () => Response.json(response) })
  configureModelsApi({ url: `${server.url}api.json` })

  const catalog = await modelsApiCatalog()

  expect(catalog?.alias).toBeUndefined()
  expect(catalog?.w3.name).toBe("Remote W3")
  expect(catalog?.w3.models["remote-only"].isExternal).toBe(true)
})

test("HTTP models catalog fails instead of returning a previous response", async () => {
  const state = { available: true, calls: 0 }
  using server = Bun.serve({
    port: 0,
    fetch: () => {
      state.calls++
      return state.available ? Response.json(response) : new Response(undefined, { status: 503 })
    },
  })
  configureModelsApi({ url: `${server.url}api.json` })
  expect((await modelsApiCatalog()).w3.models["remote-only"]).toBeDefined()

  state.available = false
  expect(modelsApiCatalog()).rejects.toThrow("503")
  expect(state.calls).toBe(2)
})

test("HTTP models catalog forwards optional request headers", async () => {
  const received: Record<string, string> = {}
  using server = Bun.serve({
    port: 0,
    fetch: (request) => {
      request.headers.forEach((value, key) => (received[key] = value))
      return Response.json(response)
    },
  })
  configureModelsApi({
    url: `${server.url}api.json`,
    headers: { uiplustoken: "internal-token" },
  })

  await modelsApiCatalog()

  expect(received.uiplustoken).toBe("internal-token")
})

test("HTTP models catalog accepts provider models arrays", async () => {
  using server = Bun.serve({
    port: 0,
    fetch: () =>
      Response.json({
        content: {
          opencode: {
            ...response.alias,
            id: "opencode",
            models: Object.values(response.alias.models),
          },
        },
        success: true,
        errorCode: 200,
        errorMessage: null,
      }),
  })
  configureModelsApi({ url: `${server.url}api.json` })

  const catalog = await modelsApiCatalog()

  expect(catalog.opencode.models["remote-only"].name).toBe("Remote Only")
})

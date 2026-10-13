import { expect } from "bun:test"
import { Effect, Layer } from "effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { MCP } from "../../src/mcp/index"
import { resultFacts } from "../../src/tracking/call-data"
import { record } from "../../src/tracking/facts"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.mergeAll(MCP.defaultLayer, CrossSpawnSpawner.defaultLayer))

it.live("MCP adapter preserves real SDK timeout and protocol error classifications", () =>
  Effect.gen(function* () {
    const server = yield* Effect.acquireRelease(
      Effect.sync(() => Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        async fetch(request) {
          if (request.method !== "POST") return new Response(null, { status: 405 })
          const body = record(await request.json())
          if (body.id === undefined) return new Response(null, { status: 202 })
          const response = (result: unknown) => Response.json({ jsonrpc: "2.0", id: body.id, result })
          if (body.method === "initialize") return response({
            protocolVersion: record(body.params).protocolVersion,
            capabilities: { tools: {} },
            serverInfo: { name: "tracking-fixture", version: "1" },
          })
          if (body.method === "tools/list") return response({
            tools: [{ name: "probe", inputSchema: { type: "object", properties: { mode: { type: "string" } } } }],
          })
          if (body.method !== "tools/call") return response({})
          const mode = record(record(body.params).arguments).mode
          if (mode === "protocol") return Response.json({
            jsonrpc: "2.0", id: body.id, error: { code: -32603, message: "fixture protocol error" },
          })
          if (mode === "timeout") await Bun.sleep(500)
          return response({ content: [{ type: "text", text: "fixture result" }], isError: mode === "business" })
        },
      })),
      (server) => Effect.sync(() => server.stop(true)),
    )
    yield* provideTmpdirInstance(() => Effect.gen(function* () {
      const mcp = yield* MCP.Service
      const tools = yield* mcp.tools()
      const execute = tools.tracking_probe.execute!
      for (const mode of ["success", "business", "timeout", "protocol"]) {
        const execute = tools[mode === "protocol" ? "protocol_probe" : "tracking_probe"].execute!
        const result = yield* Effect.promise(() => Promise.resolve(execute({ mode }, { toolCallId: mode, messages: [] })))
        const facts = resultFacts("tracking_probe", "tracking", result)
        expect(Object.keys(record(result)).sort()).toEqual(["content", "isError"])
        if (mode === "timeout") {
          expect(facts).toMatchObject({ status: "timeout", errorCode: "-32001", errorType: "McpError" })
          expect(JSON.stringify(result)).toContain("may be reconnecting")
          continue
        }
        if (mode === "protocol") {
          expect(facts).toMatchObject({ status: "failure", errorCode: "-32603", errorType: "McpError" })
          continue
        }
        if (mode === "business") {
          expect(facts).toMatchObject({ status: "failure", errorCode: "MCP_TOOL_ERROR", errorType: "ToolResultError" })
          continue
        }
        expect(facts.status).toBe("success")
      }
    }), { config: { mcp: { tracking: { type: "remote", url: server.url.href, oauth: false, timeout: 100 }, protocol: { type: "remote", url: server.url.href, oauth: false, timeout: 100 } } } })
  }),
  30_000,
)

import { afterEach, expect, test } from "bun:test"
import { createServer } from "node:http"
import { clearStudioPermissionCache, ensureStudioPermission, studioPermissionState } from "./studio-permission-store"

afterEach(clearStudioPermissionCache)

async function serve(fetch: () => Response | Promise<Response>) {
  const server = createServer(async (request, response) => {
    response.setHeader("access-control-allow-origin", "*")
    response.setHeader("access-control-allow-methods", "POST, OPTIONS")
    response.setHeader("access-control-allow-headers", "content-type")
    if (request.method === "OPTIONS") {
      response.writeHead(204)
      response.end()
      return
    }
    const result = await fetch()
    response.writeHead(result.status, { "content-type": "application/json" })
    response.end(await result.text())
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Missing test server address")
  afterEach(() => {
    server.closeAllConnections()
    server.close()
  })
  return { url: `http://127.0.0.1:${address.port}` }
}

test("reuses pending and completed permissions until explicitly cleared", async () => {
  let calls = 0
  const http = await serve(() => {
      calls++
      return Response.json({ code: 200, data: [false, true, true] })
  })
  const first = ensureStudioPermission(http, "user")
  expect(ensureStudioPermission(http, "user")).toBe(first)
  await first
  expect(studioPermissionState).toMatchObject({ status: "ready", video: false, seedream: true, createStyleTemplate: true })
  await ensureStudioPermission(http, "user")
  expect(calls).toBe(1)
  clearStudioPermissionCache()
  expect(studioPermissionState).toMatchObject({ status: "idle", seedream: false, createStyleTemplate: false })
  await ensureStudioPermission(http, "user")
  expect(calls).toBe(2)
})

test("caches denied permissions but requires explicit retry after invalid responses", async () => {
  let calls = 0
  const http = await serve(() => {
      calls++
      return Response.json(calls === 1 ? { code: 500 } : { resp_code: 200, data: [false, false, false] })
  })
  await ensureStudioPermission(http)
  expect(studioPermissionState.status).toBe("error")
  await ensureStudioPermission(http)
  expect(calls).toBe(1)
  clearStudioPermissionCache()
  await ensureStudioPermission(http)
  expect(studioPermissionState).toMatchObject({ status: "ready", video: false, seedream: false, createStyleTemplate: false })
  await ensureStudioPermission(http)
  expect(calls).toBe(2)
})

test("clearing an in-flight request isolates the next request", async () => {
  const entered = Promise.withResolvers<void>()
  const response = Promise.withResolvers<Response>()
  let calls = 0
  const http = await serve(() => {
      calls++
      if (calls > 1) return Response.json({ code: 200, data: [false, false, true] })
      entered.resolve()
      return response.promise
  })
  const old = ensureStudioPermission(http)
  await entered.promise
  clearStudioPermissionCache()
  const next = ensureStudioPermission(http)
  response.resolve(Response.json({ code: 200, data: [true, true, false] }))
  await Promise.all([old, next])
  expect(studioPermissionState).toMatchObject({ status: "ready", video: false, seedream: false, createStyleTemplate: true })
  await ensureStudioPermission(http)
  expect(calls).toBe(2)
})

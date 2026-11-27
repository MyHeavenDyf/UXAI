import { expect, test } from "bun:test"
import { checkUpdateReadiness } from "./update-readiness"

test("update readiness fails closed without a backend connection", async () => {
  expect((await checkUpdateReadiness()).ready).toBe(false)
})

test("update readiness authenticates with the sidecar and rejects invalid or failed responses", async () => {
  const state = { response: { ready: false, reason: "Agent is running" } as unknown, status: 200 }
  const server = Bun.serve({ port: 0, fetch(request) {
    expect(new URL(request.url).pathname).toBe("/global/update-readiness")
    expect(request.headers.get("authorization")).toBe(`Basic ${Buffer.from("opencode:test-password").toString("base64")}`)
    return Response.json(state.response, { status: state.status })
  } })
  try {
    const connection = { url: server.url.toString(), username: "opencode", password: "test-password" }
    expect(await checkUpdateReadiness(connection)).toEqual({ ready: false, reason: "Agent is running" })
    state.response = { ready: true }
    expect((await checkUpdateReadiness(connection)).ready).toBe(true)
    state.response = { ready: "true" }
    expect((await checkUpdateReadiness(connection)).ready).toBe(false)
    state.response = { ready: true }
    state.status = 500
    expect((await checkUpdateReadiness(connection)).ready).toBe(false)
  } finally { await server.stop(true) }
})

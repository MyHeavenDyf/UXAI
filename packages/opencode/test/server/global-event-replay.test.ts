import { afterEach, describe, expect, test } from "bun:test"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Server } from "../../src/server/server"
import { GlobalPaths } from "../../src/server/routes/instance/httpapi/groups/global"
import { Permission } from "../../src/permission"
import { PermissionID } from "../../src/permission/schema"
import {
  clearPendingAsks,
  trackPendingAsk,
  untrackPendingAsk,
} from "../../src/permission/pending-registry"
import { SessionID } from "../../src/session/schema"
import * as Log from "@opencode-ai/core/util/log"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances } from "../fixture/fixture"

void Log.init({ print: false })

const original = Flag.OPENCODE_EXPERIMENTAL_HTTPAPI

function app(experimental = true) {
  Flag.OPENCODE_EXPERIMENTAL_HTTPAPI = experimental
  return experimental ? Server.Default().app : Server.Legacy().app
}

async function readStreamUntil(response: Response, needle: string, timeoutMs = 3_000) {
  if (!response.body) throw new Error("missing response body")
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let text = ""
  const deadline = Date.now() + timeoutMs
  try {
    while (Date.now() < deadline) {
      const remaining = deadline - Date.now()
      const result = await Promise.race([
        reader.read(),
        new Promise<{ done: true; value: undefined }>((resolve) =>
          setTimeout(() => resolve({ done: true as const, value: undefined }), remaining),
        ),
      ])
      if (result.done) break
      if (result.value) text += decoder.decode(result.value, { stream: true })
      if (text.includes(needle)) break
    }
  } finally {
    await reader.cancel()
  }
  return text
}

afterEach(async () => {
  Flag.OPENCODE_EXPERIMENTAL_HTTPAPI = original
  await disposeAllInstances()
  await resetDatabase()
  clearPendingAsks()
})

describe("global event stream pending permission replay", () => {
  test("replays pending permission asks after server.connected (both backends)", async () => {
    const info = new Permission.Request({
      id: PermissionID.make("per_route_replay"),
      sessionID: SessionID.make("session_route_replay"),
      permission: "edit",
      patterns: ["foo.ts"],
      metadata: {},
      always: [],
    })
    trackPendingAsk(info.id, { directory: "/tmp/global-replay-test", project: "proj_replay", info })
    try {
      for (const experimental of [true, false]) {
        const response = await app(experimental).request(GlobalPaths.event)
        expect(response.status).toBe(200)

        const text = await readStreamUntil(response, "permission.asked")
        const first = text.indexOf("server.connected")
        const replay = text.indexOf("permission.asked")
        expect(first).toBeGreaterThanOrEqual(0)
        expect(replay).toBeGreaterThan(first)
        expect(text).toContain(String(info.id))
      }
    } finally {
      untrackPendingAsk(info.id)
    }
  })

  test("emits no permission frames when nothing is pending", async () => {
    const response = await app().request(GlobalPaths.event)
    expect(response.status).toBe(200)

    const text = await readStreamUntil(response, "x", 600)
    expect(text).toContain("server.connected")
    expect(text).not.toContain("permission.asked")
  })
})

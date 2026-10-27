import { afterEach, describe, expect, spyOn, test } from "bun:test"
import path from "path"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Server } from "../../src/server/server"
import * as Log from "@opencode-ai/core/util/log"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, tmpdir } from "../fixture/fixture"
import { waitGlobalBusEventPromise } from "./global-bus"

void Log.init({ print: false })

const original = Flag.OPENCODE_EXPERIMENTAL_HTTPAPI

function app() {
  Flag.OPENCODE_EXPERIMENTAL_HTTPAPI = true
  return Server.Default().app
}

async function waitDisposed(directory: string) {
  await waitGlobalBusEventPromise({
    message: "timed out waiting for instance disposal",
    predicate: (event) => event.payload.type === "server.instance.disposed" && event.directory === directory,
  })
}

afterEach(async () => {
  Flag.OPENCODE_EXPERIMENTAL_HTTPAPI = original
  await disposeAllInstances()
  await resetDatabase()
})

describe("config HttpApi", () => {
  test("records config read stages without logging credentials or the config body", async () => {
    await using tmp = await tmpdir({ config: { username: "private-config-value", formatter: false, lsp: false } })
    const info = spyOn(console, "info")
    try {
      const response = await app().request(`/config?directory=${encodeURIComponent(tmp.path)}`, {
        headers: { uiplustoken: "private-auth-token" },
      })
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({ username: "private-config-value" })
      const entries = info.mock.calls.filter((call) => call[0] === "[octo:config]")
        .map((call) => JSON.parse(String(call[1])))
      expect(entries).toContainEqual(expect.objectContaining({ stage: "request", directory: tmp.path }))
      expect(entries).toContainEqual(expect.objectContaining({ stage: "read:start", backend: "httpapi", directory: tmp.path }))
      expect(entries).toContainEqual(expect.objectContaining({ stage: "read:success", backend: "httpapi", directory: tmp.path }))
      expect(entries).toContainEqual(expect.objectContaining({ stage: "response", backend: "httpapi", status: 200 }))
      expect(JSON.stringify(entries)).not.toContain("private-config-value")
      expect(JSON.stringify(entries)).not.toContain("private-auth-token")
    } finally {
      info.mockRestore()
    }
  })

  test("serves config update through Hono bridge", async () => {
    await using tmp = await tmpdir({ config: { formatter: false, lsp: false } })
    const disposed = waitDisposed(tmp.path)

    const response = await app().request("/config", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "x-opencode-directory": tmp.path,
      },
      body: JSON.stringify({ username: "patched-user", formatter: false, lsp: false }),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ username: "patched-user", formatter: false, lsp: false })
    await disposed
    expect(await Bun.file(path.join(tmp.path, "config.json")).json()).toMatchObject({
      username: "patched-user",
      formatter: false,
      lsp: false,
    })
  })
})

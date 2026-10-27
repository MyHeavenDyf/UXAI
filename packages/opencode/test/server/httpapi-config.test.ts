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
  test("correlates legacy Hono config requests and reads without changing their response", async () => {
    await using tmp = await tmpdir({ config: { formatter: false, lsp: false } })
    const info = spyOn(console, "info")
    Flag.OPENCODE_EXPERIMENTAL_HTTPAPI = false
    try {
      const response = await Server.Legacy().app.request(`/config?directory=${encodeURIComponent(tmp.path)}`)
      expect(response.status).toBe(200)
      const entries = info.mock.calls.filter((call) => call[0] === "[octo:config]")
        .map((call) => JSON.parse(String(call[1])))
      expect(entries.map((entry) => entry.stage)).toEqual(["request", "read:start", "read:success", "response"])
      expect(entries.every((entry) => entry.backend === "hono")).toBe(true)
      expect(new Set(entries.map((entry) => entry.requestID)).size).toBe(1)
    } finally {
      info.mockRestore()
    }
  })

  test("logs config loading failures and their source file without logging invalid values", async () => {
    await using tmp = await tmpdir()
    await Bun.write(path.join(tmp.path, "opencode.json"), JSON.stringify({ username: { token: "invalid-config-secret" } }))
    const info = spyOn(console, "info")
    const error = spyOn(console, "error")
    try {
      const response = await app().request(`/config?directory=${encodeURIComponent(tmp.path)}`)
      expect(response.status).toBeGreaterThanOrEqual(400)
      const entries = [...info.mock.calls, ...error.mock.calls].filter((call) => call[0] === "[octo:config]")
        .map((call) => JSON.parse(String(call[1])))
      expect(entries).toContainEqual(expect.objectContaining({ stage: "request:failed" }))
      expect(JSON.stringify(entries)).toContain("ConfigInvalidError")
      expect(JSON.stringify(entries)).toContain("opencode.json")
      expect(JSON.stringify(entries)).not.toContain("invalid-config-secret")
    } finally {
      info.mockRestore()
      error.mockRestore()
    }
  })

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
      expect(new Set(entries.map((entry) => entry.requestID)).size).toBe(1)
      expect(entries.every((entry) => entry.diagnosticVersion === 2)).toBe(true)
      expect(entries.every((entry) => !("configProbe" in entry))).toBe(true)
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

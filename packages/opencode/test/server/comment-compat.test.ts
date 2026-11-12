import { afterEach, describe, expect, test } from "bun:test"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Server } from "../../src/server/server"
import * as Log from "@opencode-ai/core/util/log"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, tmpdir } from "../fixture/fixture"

void Log.init({ print: false })

const original = Flag.OPENCODE_EXPERIMENTAL_HTTPAPI

afterEach(async () => {
  Flag.OPENCODE_EXPERIMENTAL_HTTPAPI = original
  await disposeAllInstances()
  await resetDatabase()
})

const comment = {
  id: "c1",
  filePath: "index.html",
  elementId: "el1",
  selector: "#app",
  label: "Label",
  text: "Text",
  position: { x: 0, y: 0, w: 10, h: 10 },
  htmlHint: "<div/>",
  note: "note",
  createdAt: 1,
  updatedAt: 1,
}

// Both the legacy Hono backend and the Effect HttpApi backend must keep
// accepting the pre-rename `filePath` field as an alias for `commentFilePath`.
describe("comment filePath alias", () => {
  for (const experimental of [false, true]) {
    test(`accepts filePath in query and body (experimental-httpapi=${experimental})`, async () => {
      Flag.OPENCODE_EXPERIMENTAL_HTTPAPI = experimental
      const server = Server.Default().app
      await using tmp = await tmpdir({ git: true })
      const headers = { "x-opencode-directory": tmp.path }

      const empty = await server.request("/comment/file?sessionId=ses_compat&filePath=index.html", { headers })
      expect(empty.status).toBe(200)
      expect(await empty.json()).toMatchObject({ comments: [] })

      const saved = await server.request("/comment/file", {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ sessionId: "ses_compat", filePath: "index.html", comment }),
      })
      expect(saved.status).toBe(200)
      expect(await saved.json()).toMatchObject({ ok: true })

      // Reading through the documented field name returns the alias-saved comment.
      const loaded = await server.request("/comment/file?sessionId=ses_compat&commentFilePath=index.html", {
        headers,
      })
      expect(loaded.status).toBe(200)
      expect(await loaded.json()).toMatchObject({ comments: [{ id: "c1" }] })

      // Legacy DELETE path keeps working too.
      const deleted = await server.request(
        "/comment/file/c1?sessionId=ses_compat&filePath=index.html",
        { method: "DELETE", headers },
      )
      expect(deleted.status).toBe(200)
      expect(await deleted.json()).toMatchObject({ ok: true })
    })
  }
})

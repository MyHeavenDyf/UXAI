// Run after build:beta/build:prod, using Electron's Node runtime (ELECTRON_RUN_AS_NODE=1).
// No GUI, user project, company endpoint, or existing database is opened.
import assert from "node:assert/strict"
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { createServer } from "node:http"
import { setTimeout } from "node:timers/promises"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const dir = await mkdtemp(path.join(tmpdir(), "octo-artifact-build-"))
const names = ["artifact-file-write", "artifact-file-edit", "artifact-mcp-return"]
const received = []
const receiver = createServer((request, response) => {
  const chunks = []
  request.on("data", (chunk) => chunks.push(chunk))
  request.on("end", () => {
    received.push(JSON.parse(Buffer.concat(chunks).toString()))
    response.end("{}")
  })
})
await new Promise((resolve) => receiver.listen(0, "127.0.0.1", resolve))
Object.assign(process.env, {
  OPENCODE_DB: path.join(dir, "test.db"),
  OPENCODE_TEST_HOME: dir,
  XDG_DATA_HOME: path.join(dir, "data"),
  XDG_CONFIG_HOME: path.join(dir, "config"),
  XDG_CACHE_HOME: path.join(dir, "cache"),
  XDG_STATE_HOME: path.join(dir, "state"),
  OCTO_REPORT_BASE_URL: `http://127.0.0.1:${receiver.address().port}`,
  OCTO_ARTIFACT_SUCCESS: "http-2xx",
})
const state = {}
try {
  const main = await readFile(path.join(root, "out/main/index.js"), "utf8")
  assert.match(main, /env\.OCTO_REPORT_BASE_URL\s*=/)
  const assets = path.join(root, "out/renderer/assets")
  for (const file of await readdir(assets)) {
    if (!file.endsWith(".js")) continue
    const content = await readFile(path.join(assets, file), "utf8")
    for (const name of names) assert.ok(!content.includes(name), `renderer still contains ${name}: ${file}`)
  }
  const chunks = path.join(root, "out/main/chunks")
  const bundle = (await readdir(chunks)).find((file) => /^node-.*\.js$/.test(file))
  assert.ok(bundle, "missing compiled server bundle")
  const { Database, Server } = await import(pathToFileURL(path.join(chunks, bundle)).href)
  state.database = Database
  const sqlite = Database.Client().$client
  for (const name of names) {
    sqlite.prepare(`INSERT INTO insight_artifact_delivery_event
      (id, message_id, part_id, name, payload, created_at, next_at)
      VALUES (?, 'build-test', 'build-test', ?, ?, 1, 0)`).run(name, name, JSON.stringify({ datas: [{ name }] }))
  }
  state.listener = await Server.listen({ hostname: "127.0.0.1", port: 0 })
  for (let attempt = 0; attempt < 150; attempt++) {
    if (sqlite.prepare("SELECT count(*) AS n FROM insight_artifact_delivery_event WHERE state = 'sent'").get().n === 3) break
    await setTimeout(100)
  }
  assert.deepEqual(received.map((body) => body.datas[0].name).sort(), [...names].sort())
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM insight_artifact_delivery_event WHERE state = 'sent'").get().n, 3)
  console.log("PASS: compiled Electron server sends all three names; renderer has none; no project opened")
} catch (error) {
  console.error(error)
  process.exitCode = 1
} finally {
  await state.listener?.stop(true)
  receiver.closeAllConnections()
  receiver.close()
  state.database?.close()
  // Validate the exact generated temporary directory before recursive cleanup.
  assert.equal(path.dirname(path.resolve(dir)), path.resolve(tmpdir()))
  assert.ok(path.basename(dir).startsWith("octo-artifact-build-"))
  await rm(dir, { recursive: true, force: true })
  process.exit(process.exitCode ?? 0)
}

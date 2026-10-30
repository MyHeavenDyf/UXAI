import { expect, test } from "bun:test"
import path from "node:path"
import { mkdir } from "node:fs/promises"
import { Effect } from "effect"
import { importSharedSession, inspectSharedSession, parseSharedSessionLink, prepareSharedSession } from "../../../desktop/src/main/shared-session"
import JSZip from "jszip"
import { AppRuntime } from "@/effect/app-runtime"
import { exportPortableSession, importPortableSession } from "@/session/portable"
import { Session } from "@/session/session"
import { MessageID, PartID, SessionID } from "@/session/schema"
import { ModelID, ProviderID } from "@/provider/schema"
import { provideTestInstance, tmpdir } from "../fixture/fixture"

test("only accepts supported app share links with valid codes", () => {
  expect(parseSharedSessionLink("octo-agent://share?uniqueId=Ab12Cd34Ef")).toBe("Ab12Cd34Ef")
  expect(parseSharedSessionLink("octo-agent-beta://share?uniqueId=Ab12Cd34Ef")).toBe("Ab12Cd34Ef")
  for (const input of ["https://example.com/share?uniqueId=abc", "octo-agent://other?uniqueId=abc", "octo-agent://share", "octo-agent://share?uniqueId=../zip"]) {
    expect(parseSharedSessionLink(input)).toBeUndefined()
  }
})

test.each([
  ["import", 500, JSON.stringify({ name: "UnknownError", data: { message: "EACCES: permission denied", token: "hidden-credential" } }), "EACCES: permission denied"],
  ["session", 404, JSON.stringify({ message: "Session not found" }), "Session not found"],
  ["import", 500, "<html>hidden-credential</html>", "后端未返回可用的错误详情"],
  ["import", 200, "invalid json", "后端未返回有效 JSON"],
  ["import", 500, JSON.stringify({ message: "Authorization: Bearer hidden-credential" }), "[REDACTED]"],
] as const)("reports %s %s errors with correlation IDs and cleans the ZIP", async (stage, status, body, reason) => {
  await using target = await tmpdir()
  const temporary = path.join(target.path, "download")
  await mkdir(temporary)
  const archive = path.join(temporary, "session.zip")
  await Bun.write(archive, "test archive")
  const events: { event: string; details: Record<string, unknown> }[] = []
  const server = Bun.serve({ port: 0, fetch(request) {
    if (stage === "session" && new URL(request.url).pathname === "/session/import") {
      return Response.json({ sessionID: "imported-session" })
    }
    return new Response(body, { status, headers: { "Content-Type": "application/json" } })
  } })
  try {
    await expect(importSharedSession({
      uniqueId: "TestCode", directory: target.path, scope: "project",
      uploadURL: "http://localhost/share", remoteFetch: fetch,
      server: { url: `http://127.0.0.1:${server.port}`, username: null, password: null },
      prepared: { temporary, archive, agent: "octo_make", module: "design" },
      log: (event, details) => events.push({ event, details }),
    })).rejects.toThrow(reason)
    expect(events[0].event).toBe("start")
    expect(events[0].details.zipBytes).toBe(12)
    expect(events.at(-1)?.event).toBe("failed")
    expect(events.every((entry) => entry.details.requestID === events[0].details.requestID)).toBe(true)
    expect(JSON.stringify(events)).not.toContain("hidden-credential")
    expect(await Bun.file(archive).exists()).toBe(false)
  } finally {
    server.stop(true)
  }
})

test.each([
  ["octo_make", "design"], ["octo_insight", "insight"], ["proto_triage", "pattern"],
])("identifies legacy ZIP module from root agent %s without restoring sessions", async (agent, module) => {
  await using source = await tmpdir()
  const zip = new JSZip()
  zip.file("manifest.json", JSON.stringify({
    format: "octo-session", version: 1, rootSessionID: "root",
    sessions: [{ info: { id: "child", agent: "different-child-agent" } }, { info: { id: "root", agent } }],
  }))
  const archive = path.join(source.path, "session.zip")
  await Bun.write(archive, await zip.generateAsync({ type: "uint8array" }))
  expect(await inspectSharedSession(archive)).toEqual({ agent, module })
})

test("rejects an unknown root agent rather than defaulting to the currently open module", async () => {
  await using source = await tmpdir()
  const zip = new JSZip()
  zip.file("manifest.json", JSON.stringify({
    format: "octo-session", version: 1, rootSessionID: "root", sessions: [{ info: { id: "root", agent: "unknown" } }],
  }))
  const archive = path.join(source.path, "unknown.zip")
  await Bun.write(archive, await zip.generateAsync({ type: "uint8array" }))
  await expect(inspectSharedSession(archive)).rejects.toThrow("无法识别分享所属模块")
})

test.each([["octo_make", "design"], ["octo_insight", "insight"]])("prepares %s before importing into the selected folder and cleans the temporary ZIP", async (agent, module) => {
  await using source = await tmpdir({ git: true })
  await using target = await tmpdir({ git: true })
  const directory = path.join(target.path, "默认选中的文件夹")
  await mkdir(directory)
  const exported = await provideTestInstance({ directory: source.path, fn: async () => {
    const session = await AppRuntime.runPromise(Session.Service.use((svc) => svc.create({ title: "共享对话", agent })))
    await AppRuntime.runPromise(Session.Service.use((svc) => Effect.gen(function* () {
      const messageID = MessageID.ascending()
      yield* svc.updateMessage({
        id: messageID, sessionID: session.id, role: "user", time: { created: Date.now() }, agent,
        model: { modelID: ModelID.make("test"), providerID: ProviderID.make("test") },
      })
      yield* svc.updatePart({ id: PartID.ascending(), messageID, sessionID: session.id, type: "text", text: "生成登录HTML" })
    })))
    await Bun.write(path.join(source.path, ".octo", session.id, "outputs", "index.html"), "<h1>共享产物</h1>")
    return AppRuntime.runPromise(exportPortableSession({ sessionID: session.id, output: path.join(source.path, "session.zip") }))
  } })
  const downloadedPaths: string[] = []
  const downloads: string[] = []
  const server = Bun.serve({ port: 0, async fetch(request) {
    const url = new URL(request.url)
    if (url.pathname === "/agentSession/getShareSessionInfo") {
      expect(url.searchParams.get("uniqueId")).toBe("Ab12Cd34Ef")
      return Response.json({ success: true, content: { versionInfo: [{ fileName: "共享对话.zip", filePath: "/designAgentPreview/312/433" }] } })
    }
    if (url.pathname === "/tool/designAgentPreview/312/433/" + encodeURIComponent("共享对话.zip")) {
      downloads.push(url.pathname)
      return new Response(Bun.file(exported.output))
    }
    expect(request.headers.get("authorization")).toBe("Basic " + Buffer.from("opencode:test").toString("base64"))
    expect(request.headers.get("x-opencode-directory")).toBe(encodeURIComponent(directory))
    if (url.pathname === "/session/import") {
      const body: unknown = await request.json()
      if (!body || typeof body !== "object" || !("path" in body) || typeof body.path !== "string") return new Response(null, { status: 400 })
      const file = body.path
      downloadedPaths.push(file)
      const scope = "scope" in body && body.scope === "project" ? "project" : undefined
      expect(scope).toBe("project")
      return Response.json(await provideTestInstance({ directory, fn: () => AppRuntime.runPromise(importPortableSession(file, scope)) }))
    }
    const sessionID = SessionID.make(url.pathname.split("/").at(-1)!)
    return Response.json(await provideTestInstance({ directory, fn: () => AppRuntime.runPromise(Session.Service.use((svc) => svc.get(sessionID))) }))
  } })
  try {
    const input = {
      uniqueId: "Ab12Cd34Ef", directory,
      scope: "project" as const,
      uploadURL: `http://127.0.0.1:${server.port}/agentSession/createShareSession`,
      server: { url: `http://127.0.0.1:${server.port}`, username: "opencode", password: "test" },
      remoteFetch: fetch,
    }
    const prepared = await prepareSharedSession(input)
    expect(prepared.module).toBe(module)
    expect(await Bun.file(prepared.archive).exists()).toBe(true)
    expect(downloadedPaths).toHaveLength(0)
    const result = await importSharedSession({ ...input, prepared })
    expect(downloads).toHaveLength(1)
    expect(result.agent).toBe(agent)
    expect(result.directory).toBe(directory)
    expect((await provideTestInstance({ directory, fn: () => AppRuntime.runPromise(Session.Service.use((svc) => svc.get(SessionID.make(result.sessionID)))) })).directory).toBe(directory)
    expect(await Bun.file(path.join(directory, ".octo", result.sessionID, "outputs", "index.html")).text()).toBe("<h1>共享产物</h1>")
    expect(downloadedPaths).toHaveLength(1)
    expect(await Bun.file(downloadedPaths[0]).exists()).toBe(false)
    await provideTestInstance({ directory, fn: () => AppRuntime.runPromise(Session.Service.use((svc) => svc.remove(SessionID.make(result.sessionID)))) })
    const reimported = await importSharedSession(input)
    expect(reimported.sessionID).not.toBe(result.sessionID)
    await provideTestInstance({ directory, fn: async () => {
      const session = await AppRuntime.runPromise(Session.Service.use((svc) => svc.get(SessionID.make(reimported.sessionID))))
      const messages = await AppRuntime.runPromise(Session.Service.use((svc) => svc.messages({ sessionID: session.id })))
      expect(session.title).toBe("共享对话")
      expect(session.agent).toBe(agent)
      expect(messages).toHaveLength(1)
      expect(messages[0].parts[0]).toMatchObject({ type: "text", text: "生成登录HTML", sessionID: session.id })
      const listed = await AppRuntime.runPromise(Session.Service.use((svc) => svc.list({ directory })))
      expect(listed.some((item) => item.id === session.id && item.title === "共享对话")).toBe(true)
      expect(listed.some((item) => item.id === result.sessionID)).toBe(false)
    } })
    expect(await Bun.file(path.join(directory, ".octo", reimported.sessionID, "outputs", "index.html")).text()).toBe("<h1>共享产物</h1>")
    expect(downloadedPaths).toHaveLength(2)
    expect(await Bun.file(downloadedPaths[1]).exists()).toBe(false)
  } finally {
    server.stop(true)
  }
})

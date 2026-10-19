import { expect, test } from "bun:test"
import path from "node:path"
import { mkdir } from "node:fs/promises"
import { Effect } from "effect"
import { importSharedSession, parseSharedSessionLink } from "../../../desktop/src/main/shared-session"
import { AppRuntime } from "@/effect/app-runtime"
import { exportPortableSession, importPortableSession } from "@/session/portable"
import { Session } from "@/session/session"
import { SessionID } from "@/session/schema"
import { provideTestInstance, tmpdir } from "../fixture/fixture"

test("only accepts supported app share links with valid codes", () => {
  expect(parseSharedSessionLink("octo-agent://share?uniqueId=Ab12Cd34Ef")).toBe("Ab12Cd34Ef")
  expect(parseSharedSessionLink("octo-agent-beta://share?uniqueId=Ab12Cd34Ef")).toBe("Ab12Cd34Ef")
  for (const input of ["https://example.com/share?uniqueId=abc", "octo-agent://other?uniqueId=abc", "octo-agent://share", "octo-agent://share?uniqueId=../zip"]) {
    expect(parseSharedSessionLink(input)).toBeUndefined()
  }
})

test("imports a shared archive into the selected folder with real artifacts and cleans the temporary ZIP", async () => {
  await using source = await tmpdir({ git: true })
  await using target = await tmpdir({ git: true })
  const directory = path.join(target.path, "默认选中的文件夹")
  await mkdir(directory)
  const exported = await provideTestInstance({ directory: source.path, fn: async () => {
    const session = await AppRuntime.runPromise(Session.Service.use((svc) => svc.create({ title: "共享对话", agent: "octo_make" })))
    await Bun.write(path.join(source.path, ".octo", session.id, "outputs", "index.html"), "<h1>共享产物</h1>")
    return AppRuntime.runPromise(exportPortableSession({ sessionID: session.id, output: path.join(source.path, "session.zip") }))
  } })
  const downloadedPaths: string[] = []
  const server = Bun.serve({ port: 0, async fetch(request) {
    const url = new URL(request.url)
    if (url.pathname === "/agentSession/getShareSessionInfo") {
      expect(url.searchParams.get("uniqueId")).toBe("Ab12Cd34Ef")
      return Response.json({ success: true, content: { versionInfo: [{ fileName: "共享对话.zip", filePath: "/designAgentPreview/312/433" }] } })
    }
    if (url.pathname === "/tool/designAgentPreview/312/433/" + encodeURIComponent("共享对话.zip")) {
      return new Response(Bun.file(exported.output))
    }
    expect(request.headers.get("authorization")).toBe("Basic " + Buffer.from("opencode:test").toString("base64"))
    expect(request.headers.get("x-opencode-directory")).toBe(encodeURIComponent(directory))
    if (url.pathname === "/session/import") {
      const body: unknown = await request.json()
      if (!body || typeof body !== "object" || !("path" in body) || typeof body.path !== "string") return new Response(null, { status: 400 })
      const file = body.path
      downloadedPaths.push(file)
      return Response.json(await provideTestInstance({ directory, fn: () => AppRuntime.runPromise(importPortableSession(file)) }))
    }
    const sessionID = SessionID.make(url.pathname.split("/").at(-1)!)
    return Response.json(await provideTestInstance({ directory, fn: () => AppRuntime.runPromise(Session.Service.use((svc) => svc.get(sessionID))) }))
  } })
  try {
    const result = await importSharedSession({
      uniqueId: "Ab12Cd34Ef", directory,
      uploadURL: `http://127.0.0.1:${server.port}/agentSession/createShareSession`,
      server: { url: `http://127.0.0.1:${server.port}`, username: "opencode", password: "test" },
      remoteFetch: fetch,
    })
    expect(result.agent).toBe("octo_make")
    expect(result.directory).toBe(directory)
    expect((await provideTestInstance({ directory, fn: () => AppRuntime.runPromise(Session.Service.use((svc) => svc.get(SessionID.make(result.sessionID)))) })).directory).toBe(directory)
    expect(await Bun.file(path.join(directory, ".octo", result.sessionID, "outputs", "index.html")).text()).toBe("<h1>共享产物</h1>")
    expect(downloadedPaths).toHaveLength(1)
    expect(await Bun.file(downloadedPaths[0]).exists()).toBe(false)
  } finally {
    server.stop(true)
  }
})

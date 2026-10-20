import { describe, expect, spyOn, test } from "bun:test"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { symlink } from "node:fs/promises"
import JSZip from "jszip"
import { Effect } from "effect"
import { AppRuntime } from "@/effect/app-runtime"
import { MessageV2 } from "@/session/message-v2"
import {
  exportPortableSession,
  importPortableSession,
  isPortableSessionFile,
  remapPart,
  sharePortableSession,
} from "@/session/portable"
import { MessageID, PartID, SessionID } from "@/session/schema"
import { ModelID, ProviderID } from "@/provider/schema"
import { Session } from "@/session/session"
import { Todo } from "@/session/todo"
import { provideTestInstance, tmpdir } from "../fixture/fixture"

const runSession = <A>(fn: (service: Session.Interface) => Effect.Effect<A, unknown>) =>
  AppRuntime.runPromise(Session.Service.use(fn))

const runTodo = <A>(fn: (service: Todo.Interface) => Effect.Effect<A>) => AppRuntime.runPromise(Todo.Service.use(fn))

describe("portable session", () => {
  test.each([false, true])("preflights duplicate shared attachment names across imported sessions (conflict: %s)", async (conflict) => {
    await using source = await tmpdir({ git: true })
    await using target = await tmpdir({ git: true })
    const archive = await provideTestInstance({ directory: source.path, fn: async () => {
      const root = await runSession((svc) => svc.create({ title: "Root" }))
      const child = await runSession((svc) => svc.create({ parentID: root.id, title: "Child" }))
      await Bun.write(path.join(source.path, ".octo", root.id, "uploads", "brief.txt"), "root attachment")
      await Bun.write(path.join(source.path, ".octo", child.id, "uploads", "brief.txt"), conflict ? "child attachment" : "root attachment")
      return AppRuntime.runPromise(exportPortableSession({ sessionID: root.id, output: path.join(source.path, "session.zip") }))
    } })
    await provideTestInstance({ directory: target.path, fn: async () => {
      if (conflict) {
        await expect(AppRuntime.runPromise(importPortableSession(archive.output, "project"))).rejects.toThrow("共享附件同名且内容不同")
        expect(await Bun.file(path.join(target.path, "brief.txt")).exists()).toBe(false)
        expect(await runSession((svc) => svc.list({ directory: target.path }))).toHaveLength(0)
        return
      }
      const imported = await AppRuntime.runPromise(importPortableSession(archive.output, "project"))
      expect(imported.files).toBe(3)
      expect(await Bun.file(path.join(target.path, "brief.txt")).text()).toBe("root attachment")
    } })
  })

  test.each([undefined, "project"] as const)("restores private uploads without changing chat references (target scope: %s)", async (scope) => {
    await using source = await tmpdir({ git: true })
    await using target = await tmpdir({ git: true })
    const archive = await provideTestInstance({ directory: source.path, fn: async () => {
      const session = await runSession((svc) => svc.create({ title: "Uploaded attachment" }))
      const messageID = MessageID.ascending()
      await runSession((svc) => svc.updateMessage({
        id: messageID, sessionID: session.id, role: "user", time: { created: Date.now() }, agent: "build",
        model: { providerID: ProviderID.make("test"), modelID: ModelID.make("test") },
      }))
      await Bun.write(path.join(source.path, ".octo", session.id, "uploads", "资料", "说明.txt"), "attachment")
      await runSession((svc) => svc.updatePart({
        id: PartID.ascending(), messageID, sessionID: session.id, type: "file", filename: "说明.txt", mime: "text/plain",
        url: pathToFileURL(path.join(source.path, ".octo", session.id, "uploads", "资料", "说明.txt")).href,
      }))
      return AppRuntime.runPromise(exportPortableSession({ sessionID: session.id, output: path.join(source.path, "session.zip") }))
    } })
    await provideTestInstance({ directory: target.path, fn: async () => {
      const imported = await AppRuntime.runPromise(importPortableSession(archive.output, scope))
      const attachment = path.join(target.path, ".octo", imported.sessionID, "uploads", "资料", "说明.txt")
      expect(await Bun.file(attachment).text()).toBe("attachment")
      expect(await Bun.file(path.join(target.path, "资料", "说明.txt")).exists()).toBe(scope === "project")
      const messages = await runSession((svc) => svc.messages({ sessionID: imported.sessionID }))
      expect(messages[0].parts[0]).toMatchObject({ type: "file", url: pathToFileURL(attachment).href })
      if (scope !== "project") return
      expect(await Bun.file(path.join(target.path, "资料", "说明.txt")).text()).toBe("attachment")
      // Reimporting identical attachments reuses the shared file instead of overwriting it.
      await AppRuntime.runPromise(importPortableSession(archive.output, scope))
      await Bun.write(path.join(target.path, "资料", "说明.txt"), "existing file")
      const count = (await runSession((svc) => svc.list({ directory: target.path }))).length
      await expect(AppRuntime.runPromise(importPortableSession(archive.output, scope))).rejects.toThrow("共享文件已存在且内容不同")
      expect(await Bun.file(path.join(target.path, "资料", "说明.txt")).text()).toBe("existing file")
      expect((await runSession((svc) => svc.list({ directory: target.path }))).length).toBe(count)
    } })
  })

  test("includes shared workspace files once, preserves references, and keeps ordinary exports isolated", async () => {
    await using source = await tmpdir({ git: true })
    await using target = await tmpdir({ git: true })
    const archive = path.join(source.path, "shared.zip")
    const original = await provideTestInstance({
      directory: source.path,
      fn: async () => {
        const root = await runSession((svc) => svc.create({ title: "Shared workspace" }))
        await runSession((svc) => svc.create({ parentID: root.id, title: "Child" }))
        const other = await runSession((svc) => svc.create({ title: "Unrelated session" }))
        await Bun.write(path.join(source.path, "index.html"), '<link href="assets/theme.css">')
        await Bun.write(path.join(source.path, "assets/theme.css"), "body { color: blue }")
        await Bun.write(path.join(source.path, "brief.txt"), "shared attachment")
        await Bun.write(path.join(source.path, "other-session.html"), "unrelated shared artifact")
        await Bun.write(path.join(source.path, ".env"), "secret")
        await Bun.write(path.join(source.path, "assets/.secret"), "secret")
        await Bun.write(path.join(source.path, "node_modules/library/index.js"), "dependency")
        await Bun.write(path.join(source.path, ".octo", other.id, "outputs/private.txt"), "other session")
        await Bun.write(path.join(source.path, ".octo", root.id, "uploads/brief.txt"), "shared attachment")
        await Bun.write(archive, "previous export must not be embedded")
        const messageID = MessageID.ascending()
        await runSession((svc) =>
          svc.updateMessage({
            id: messageID,
            sessionID: root.id,
            role: "user",
            time: { created: Date.now() },
            agent: "build",
            model: { providerID: ProviderID.make("test"), modelID: ModelID.make("test") },
          }),
        )
        await runSession((svc) =>
          svc.updatePart({
            id: PartID.ascending(),
            messageID,
            sessionID: root.id,
            type: "file",
            filename: "brief.txt",
            mime: "text/plain",
            url: pathToFileURL(path.join(source.path, "brief.txt")).href,
          }),
        )
        const isolated = await AppRuntime.runPromise(exportPortableSession({ sessionID: root.id, output: archive }))
        expect(isolated.files).toBe(1)
        return AppRuntime.runPromise(exportPortableSession({ sessionID: root.id, output: archive, scope: "project" }))
      },
    })
    expect(original.sessions).toBe(2)
    expect(original.files).toBe(5)
    const zip = await JSZip.loadAsync(await Bun.file(archive).arrayBuffer())
    const manifest = JSON.parse(await zip.file("manifest.json")!.async("string"))
    expect(
      manifest.files
        .filter((file: { scope: string }) => file.scope === "project")
        .map((file: { path: string }) => file.path)
        .sort(),
    ).toEqual(["assets/theme.css", "brief.txt", "index.html", "other-session.html"])
    expect(Object.keys(zip.files).filter((name) => name.startsWith("blobs/") && !zip.files[name].dir)).toHaveLength(4)
    await Bun.write(path.join(target.path, "brief.txt"), "shared attachment")
    const result = await provideTestInstance({
      directory: target.path,
      fn: async () => {
        const imported = await AppRuntime.runPromise(importPortableSession(archive))
        const messages = await runSession((svc) => svc.messages({ sessionID: imported.sessionID }))
        expect(messages[0].parts[0]).toMatchObject({ url: pathToFileURL(path.join(target.path, "brief.txt")).href })
        return imported
      },
    })
    expect(result.files).toBe(5)
    expect(await Bun.file(path.join(target.path, "index.html")).text()).toBe('<link href="assets/theme.css">')
    expect(await Bun.file(path.join(target.path, "assets/theme.css")).text()).toBe("body { color: blue }")
    expect(await Bun.file(path.join(target.path, ".octo", result.sessionID, "uploads/brief.txt")).text()).toBe(
      "shared attachment",
    )
    expect(await Bun.file(path.join(target.path, ".env")).exists()).toBe(false)
    expect(await Bun.file(path.join(target.path, "other-session.html")).text()).toBe("unrelated shared artifact")
  })

  test("rejects conflicting or symlinked shared paths without overwriting existing files", async () => {
    await using source = await tmpdir({ git: true })
    await using target = await tmpdir({ git: true })
    await using outside = await tmpdir()
    const archive = await provideTestInstance({
      directory: source.path,
      fn: async () => {
        const session = await runSession((svc) => svc.create({ title: "Shared conflict" }))
        await Bun.write(path.join(source.path, "assets/index.html"), "new artifact")
        return AppRuntime.runPromise(
          exportPortableSession({
            sessionID: session.id,
            output: path.join(source.path, "session.zip"),
            scope: "project",
          }),
        )
      },
    })
    await Bun.write(path.join(target.path, "assets/index.html"), "existing artifact")
    await provideTestInstance({
      directory: target.path,
      fn: async () => {
        await expect(AppRuntime.runPromise(importPortableSession(archive.output))).rejects.toThrow(
          "共享文件已存在且内容不同",
        )
        expect(await Bun.file(path.join(target.path, "assets/index.html")).text()).toBe("existing artifact")
      },
    })
    await symlink(outside.path, path.join(outside.path, "assets"), process.platform === "win32" ? "junction" : "dir")
    await provideTestInstance({
      directory: outside.path,
      fn: async () => {
        await expect(AppRuntime.runPromise(importPortableSession(archive.output))).rejects.toThrow("符号链接")
        expect(await Bun.file(path.join(outside.path, "index.html")).exists()).toBe(false)
      },
    })
  })

  test("logs the upload response before validation and redacts credentials", async () => {
    const logging = spyOn(console, "info")
    const server = Bun.serve({ port: 0, fetch: () => Response.json({
      success: false,
      content: { agentDeliverableId: 313 },
      errorMessage: "请先登录",
      token: "secret-token-value",
      nested: { Cookie: "secret-cookie-value" },
    }) })
    const previousUpload = process.env.OCTO_SHARE_API_URL
    const previousPage = process.env.OCTO_SHARE_PAGE_URL
    process.env.OCTO_SHARE_API_URL = `http://127.0.0.1:${server.port}/upload`
    process.env.OCTO_SHARE_PAGE_URL = "https://share.example/session"
    try {
      await using source = await tmpdir({ git: true })
      await provideTestInstance({ directory: source.path, fn: async () => {
        const session = await runSession((svc) => svc.create({ title: "Upload diagnostics" }))
        await expect(AppRuntime.runPromise(sharePortableSession({ sessionID: session.id }))).rejects.toThrow("请先登录")
      } })
      const output = logging.mock.calls.map((call) => call.join(" ")).join("\n")
      expect(output).toContain("[octo:share] upload response")
      expect(output).toContain("agentDeliverableId")
      expect(output).toContain("请先登录")
      expect(output).toContain("[REDACTED]")
      expect(output).not.toContain("secret-token-value")
      expect(output).not.toContain("secret-cookie-value")
    } finally {
      logging.mockRestore()
      server.stop(true)
      if (previousUpload === undefined) delete process.env.OCTO_SHARE_API_URL
      else process.env.OCTO_SHARE_API_URL = previousUpload
      if (previousPage === undefined) delete process.env.OCTO_SHARE_PAGE_URL
      else process.env.OCTO_SHARE_PAGE_URL = previousPage
    }
  })

  test("uploads a generated ZIP and returns a share page URL", async () => {
    const uploads: { fileName: string; description: string; size: number }[] = []
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        expect(request.headers.get("uiplustoken")).toBe("current-ui-token")
        expect(request.headers.get("x-auth-token")).toBeNull()
        expect(request.headers.get("authorization")).toBeNull()
        expect(request.headers.get("x-opencode-models-api-url")).toBeNull()
        expect(request.headers.get("cookie")).toBe("sessionID=current-session; oc-uuid=current-user")
        expect(request.headers.get("x-opencode-share-cookie")).toBeNull()
        const form = await request.formData()
        const file = form.get("file")
        if (!(file instanceof File)) return new Response("file is required", { status: 400 })
        const zip = await JSZip.loadAsync(await file.arrayBuffer())
        const manifest = JSON.parse(await zip.file("manifest.json")!.async("string"))
        expect(manifest.files).toEqual([expect.objectContaining({ scope: "project", path: "shared.html" })])
        uploads.push({
          fileName: file.name,
          description: String(form.get("description") ?? ""),
          size: file.size,
        })
        return Response.json({ content: { uniqueId: "Ab12Cd34Ef" }, success: true })
      },
    })

    const previousUpload = process.env.OCTO_SHARE_API_URL
    const previousPage = process.env.OCTO_SHARE_PAGE_URL
    process.env.OCTO_SHARE_API_URL = `http://127.0.0.1:${server.port}/upload`
    process.env.OCTO_SHARE_PAGE_URL = "https://share.example/session"
    const result = await (async () => {
      await using source = await tmpdir({ git: true })
      return provideTestInstance({
        directory: source.path,
        fn: async () => {
          const session = await runSession((service) => service.create({ title: "Shared session" }))
          await Bun.write(path.join(source.path, "shared.html"), "<h1>Shared</h1>")
          return AppRuntime.runPromise(
            sharePortableSession({
              sessionID: session.id,
              scope: "project",
              headers: {
                UiPlusToken: "current-ui-token",
                "x-auth-token": "current-third-token",
                Authorization: "Basic local-backend-only",
                "x-opencode-models-api-url": "https://models.example/catalog",
                Cookie: "unrelated-cookie",
                "X-OpenCode-Share-Cookie": "sessionID=current-session; oc-uuid=current-user",
              },
            }),
          )
        },
      })
    })().finally(() => {
      server.stop(true)
      if (previousUpload === undefined) delete process.env.OCTO_SHARE_API_URL
      else process.env.OCTO_SHARE_API_URL = previousUpload
      if (previousPage === undefined) delete process.env.OCTO_SHARE_PAGE_URL
      else process.env.OCTO_SHARE_PAGE_URL = previousPage
    })

    expect(result).toEqual({ uniqueId: "Ab12Cd34Ef", url: "https://share.example/session?uniqueId=Ab12Cd34Ef" })
    expect(uploads).toHaveLength(1)
    expect(uploads[0].fileName).toBe("Shared session.zip")
    expect(uploads[0].description).toBe("Shared session")
    expect(uploads[0].size).toBeGreaterThan(0)
  })

  test("rewrites Windows attachment paths when imported on macOS", () => {
    const originalSessionID = SessionID.descending()
    const importedSessionID = SessionID.descending()
    const messageID = MessageID.ascending()
    const part = remapPart(
      {
        id: PartID.ascending(),
        messageID,
        sessionID: originalSessionID,
        type: "file",
        mime: "text/plain",
        filename: "brief.txt",
        url: `file:///C:/Users/Alice/project/.octo/${originalSessionID}/uploads/brief.txt`,
        source: {
          type: "file",
          path: `C:\\Users\\Alice\\project\\.octo\\${originalSessionID}\\uploads\\brief.txt`,
          text: { value: "source attachment", start: 0, end: 17 },
        },
      },
      {
        sessionID: importedSessionID,
        messageID,
        partID: PartID.ascending(),
        messageIDs: new Map(),
        sessionIDs: new Map([[originalSessionID, importedSessionID]]),
        sourceDirectory: "C:\\Users\\Alice\\project",
        targetDirectory: "/Users/bob/project",
      },
    ) as MessageV2.FilePart

    const expected = `/Users/bob/project/.octo/${importedSessionID}/uploads/brief.txt`
    expect(part.url).toBe(pathToFileURL(expected).href)
    expect(part.source?.type === "file" && part.source.path).toBe(expected)

    const text = remapPart(
      {
        id: PartID.ascending(),
        messageID,
        sessionID: originalSessionID,
        type: "text",
        text: `[Artifact Folder]: C:\\Users\\Alice\\project\\.octo\\${originalSessionID}\\outputs`,
      },
      {
        sessionID: importedSessionID,
        messageID,
        partID: PartID.ascending(),
        messageIDs: new Map(),
        sessionIDs: new Map([[originalSessionID, importedSessionID]]),
        sourceDirectory: "C:\\Users\\Alice\\project",
        targetDirectory: "/Users/bob/project",
      },
    ) as MessageV2.TextPart
    expect(text.text).toBe(`[Artifact Folder]: /Users/bob/project/.octo/${importedSessionID}/outputs`)
  })

  test(
    "exports and imports a complete session tree with files and fresh IDs",
    async () => {
      await using source = await tmpdir({ git: true })
      await using target = await tmpdir({ git: true })
      const exportTarget = path.join(source.path, "complete-session")
      const archive = `${exportTarget}.zip`

      const original = await provideTestInstance({
        directory: source.path,
        fn: async () => {
          const root = await runSession((service) => service.create({ title: "Portable root", agent: "build" }))
          const child = await runSession((service) => service.create({ parentID: root.id, title: "Portable child" }))
          const messageID = MessageID.ascending()
          const upload = path.join(source.path, ".octo", root.id, "uploads", "brief.txt")
          const output = path.join(source.path, ".octo", child.id, "outputs", "result.txt")
          await Bun.write(upload, "source attachment")
          await Bun.write(output, "generated artifact")
          await Bun.write(
            path.join(source.path, ".octo", root.id, "resource", "assets_config.json"),
            JSON.stringify({ asset: "keep" }),
          )
          await Bun.write(path.join(source.path, ".octo", root.id, ".octo-fastui.json"), "{}")
          await Bun.write(
            path.join(source.path, ".octo", "design", "history", root.id, "theme.json"),
            JSON.stringify({ theme: "portable" }),
          )
          await runSession((service) =>
            service.updateMessage({
              id: messageID,
              sessionID: root.id,
              role: "user",
              time: { created: Date.now() },
              agent: "build",
              model: { providerID: ProviderID.make("test"), modelID: ModelID.make("test") },
            }),
          )
          await runSession((service) =>
            service.updatePart({
              id: PartID.ascending(),
              messageID,
              sessionID: root.id,
              type: "file",
              mime: "text/plain",
              filename: "brief.txt",
              url: pathToFileURL(upload).href,
              source: {
                type: "file",
                path: upload,
                text: { value: "source attachment", start: 0, end: 17 },
              },
            }),
          )
          await runTodo((service) =>
            service.update({
              sessionID: root.id,
              todos: [{ content: "keep the todo", status: "completed", priority: "high" }],
            }),
          )
          await runSession((service) =>
            service.setSummary({
              sessionID: root.id,
              summary: { additions: 0, deletions: 0, files: 0 },
            }),
          )
          const exported = await AppRuntime.runPromise(exportPortableSession({ sessionID: root.id, output: exportTarget }))
          return { root, child, messageID, exported }
        },
      })

      expect(original.exported.sessions).toBe(2)
      expect(original.exported.files).toBe(5)
      expect(original.exported.output).toBe(archive)
      expect(await isPortableSessionFile(archive)).toBe(true)

      const imported = await provideTestInstance({
        directory: target.path,
        fn: async () => {
          const result = await AppRuntime.runPromise(importPortableSession(archive))
          const root = await runSession((service) => service.get(result.sessionID))
          const child = (await runSession((service) => service.children(root.id)))[0]
          const messages = await runSession((service) => service.messages({ sessionID: root.id }))
          const todos = await runTodo((service) => service.get(root.id))
          return { result, root, child, messages, todos }
        },
      })

      expect(imported.result).toEqual({ sessionID: imported.root.id, sessions: 2, files: 5 })
      expect(imported.root.id).not.toBe(original.root.id)
      expect(imported.child.id).not.toBe(original.child.id)
      expect(imported.child.parentID).toBe(imported.root.id)
      expect(imported.root.title).toBe("Portable root")
      expect(imported.root.summary).toEqual({ additions: 0, deletions: 0, files: 0 })
      expect(imported.child.title).toBe("Portable child")
      expect(imported.todos).toEqual([{ content: "keep the todo", status: "completed", priority: "high" }])
      expect(imported.messages[0].info.id).not.toBe(original.messageID)
      const file = imported.messages[0].parts[0] as MessageV2.FilePart
      expect(file.url).toBe(
        pathToFileURL(path.join(target.path, ".octo", imported.root.id, "uploads", "brief.txt")).href,
      )
      expect(await Bun.file(path.join(target.path, ".octo", imported.root.id, "uploads", "brief.txt")).text()).toBe(
        "source attachment",
      )
      expect(await Bun.file(path.join(target.path, ".octo", imported.child.id, "outputs", "result.txt")).text()).toBe(
        "generated artifact",
      )
      expect(
        await Bun.file(path.join(target.path, ".octo", imported.root.id, "resource", "assets_config.json")).json(),
      ).toEqual({ asset: "keep" })
      expect(await Bun.file(path.join(target.path, ".octo", imported.root.id, ".octo-fastui.json")).text()).toBe("{}")
      expect(
        await Bun.file(
          path.join(target.path, ".octo", "design", "history", imported.root.id, "theme.json"),
        ).json(),
      ).toEqual({ theme: "portable" })

      await provideTestInstance({
        directory: target.path,
        fn: () => runSession((service) => service.remove(imported.root.id)),
      })
      await provideTestInstance({
        directory: source.path,
        fn: () => runSession((service) => service.remove(original.root.id)),
      })
    },
    { timeout: 30000 },
  )
})

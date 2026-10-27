import { describe, expect, spyOn, test } from "bun:test"
import path from "node:path"
import { createHash } from "node:crypto"
import { pathToFileURL } from "node:url"
import { symlink } from "node:fs/promises"
import JSZip from "jszip"
import { Effect } from "effect"
import { Global } from "@opencode-ai/core/global"
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
import { SessionStatus } from "@/session/status"
import { Todo } from "@/session/todo"
import { provideTestInstance, tmpdir } from "../fixture/fixture"

const runSession = <A>(fn: (service: Session.Interface) => Effect.Effect<A, unknown>) =>
  AppRuntime.runPromise(Session.Service.use(fn))

const runTodo = <A>(fn: (service: Todo.Interface) => Effect.Effect<A>) => AppRuntime.runPromise(Todo.Service.use(fn))

describe("portable session", () => {
  test("exports and imports shared website-root references unchanged alongside project source files", async () => {
    await using source = await tmpdir({ git: true })
    await using target = await tmpdir({ git: true })
    const html = '<script type="module" src="/src/entry.ts"></script>'
    const exported = await provideTestInstance({ directory: source.path, fn: async () => {
      const session = await runSession((svc) => svc.create({ title: "Website-root dependency" }))
      await Bun.write(path.join(source.path, "unrelated/index.html"), html)
      await Bun.write(path.join(source.path, "src/entry.ts"), "export const ready = true")
      return AppRuntime.runPromise(exportPortableSession({
        sessionID: session.id,
        output: path.join(source.path, "bundle.zip"),
        scope: "project",
      }))
    } })
    const zip = await JSZip.loadAsync(await Bun.file(exported.output).arrayBuffer())
    const manifest = JSON.parse(await zip.file("manifest.json")!.async("string")) as {
      files: { path: string; blob: string }[]
    }
    expect(manifest.files.map((file) => file.path).sort()).toEqual(["src/entry.ts", "unrelated/index.html"])
    expect(await zip.file(manifest.files.find((file) => file.path === "unrelated/index.html")!.blob)!.async("string")).toBe(html)
    await provideTestInstance({ directory: target.path, fn: async () => {
      await AppRuntime.runPromise(importPortableSession(exported.output, "project"))
      expect(await Bun.file(path.join(target.path, "unrelated/index.html")).text()).toBe(html)
      expect(await Bun.file(path.join(target.path, "src/entry.ts")).text()).toBe("export const ready = true")
    } })
  })

  test.each(["busy", "retry"] as const)("rejects sharing a %s session without blocking ordinary export", async (type) => {
    await using source = await tmpdir({ git: true })
    await provideTestInstance({ directory: source.path, fn: async () => {
      const session = await runSession((svc) => svc.create({ title: "Busy session" }))
      await AppRuntime.runPromise(SessionStatus.Service.use((status) => status.set(session.id,
        type === "busy" ? { type } : { type, attempt: 1, message: "Retrying", next: Date.now() + 1000 },
      )))
      await expect(AppRuntime.runPromise(sharePortableSession({ sessionID: session.id })))
        .rejects.toThrow("对话正在进行中，请等待结束后再分享")
      const exported = await AppRuntime.runPromise(exportPortableSession({
        sessionID: session.id,
        output: path.join(source.path, "bundle.zip"),
      }))
      expect(await Bun.file(exported.output).exists()).toBe(true)
    } })
  })

  test.each(["missing", "unavailable"] as const)("does not exclude files when remote blacklist is %s and uncached", async (mode) => {
    await using source = await tmpdir({ git: true })
    const previous = process.env.OCTO_PORTABLE_BLACKLIST_URL
    const server = mode === "unavailable" ? Bun.serve({ port: 0, fetch: () => new Response(null, { status: 503 }) }) : undefined
    process.env.OCTO_PORTABLE_BLACKLIST_URL = server ? `http://127.0.0.1:${server.port}/blacklist.json` : ""
    try {
      const exported = await provideTestInstance({ directory: source.path, fn: async () => {
        const session = await runSession((svc) => svc.create({ title: "Empty blacklist fallback" }))
        await Bun.write(path.join(source.path, ".octo", session.id, "outputs", "app.asar"), "archive bytes")
        return AppRuntime.runPromise(exportPortableSession({ sessionID: session.id, output: path.join(source.path, "bundle.zip") }))
      } })
      const zip = await JSZip.loadAsync(await Bun.file(exported.output).arrayBuffer())
      const manifest = JSON.parse(await zip.file("manifest.json")!.async("string")) as { files: { path: string }[]; exclusions: string[] }
      expect(manifest.files.map((file) => file.path)).toEqual(["outputs/app.asar"])
      expect(manifest.exclusions).not.toContain("*.asar files and archive contents")
    } finally {
      if (previous === undefined) delete process.env.OCTO_PORTABLE_BLACKLIST_URL
      else process.env.OCTO_PORTABLE_BLACKLIST_URL = previous
      server?.stop(true)
    }
  })

  test.each([undefined, "project"] as const)("excludes ASAR archives without excluding unpacked files (scope: %s)", async (scope) => {
    await using source = await tmpdir({ git: true })
    const previous = process.env.OCTO_PORTABLE_BLACKLIST_URL
    const server = Bun.serve({ port: 0, fetch: () => Response.json({ version: 1, excludedExtensions: [".asar"] }) })
    process.env.OCTO_PORTABLE_BLACKLIST_URL = `http://127.0.0.1:${server.port}/portable-blacklist.json`
    try {
    const exported = await provideTestInstance({ directory: source.path, fn: async () => {
      const session = await runSession((svc) => svc.create({ title: "ASAR blacklist" }))
      const root = path.join(source.path, ".octo", session.id, "outputs")
      await Bun.write(path.join(root, "app.asar"), "archive bytes")
      await Bun.write(path.join(root, "UPPER.ASAR"), "archive bytes")
      await Bun.write(path.join(root, "virtual.asar", "entry.js"), "must not traverse archive contents")
      await Bun.write(path.join(root, "app.asar.unpacked", "native.node"), "native bytes")
      await Bun.write(path.join(root, "index.html"), '<script src="./virtual.asar/entry.js"></script><script src="./app.asar"></script>')
      await Bun.write(path.join(source.path, ".octo", "design", "history", session.id, "old.asar"), "archive bytes")
      await Bun.write(path.join(source.path, "project.asar"), "archive bytes")
      await Bun.write(path.join(source.path, "project.asar.unpacked", "library.dll"), "library bytes")
      return AppRuntime.runPromise(exportPortableSession({ sessionID: session.id, output: path.join(source.path, "bundle.zip"), scope }))
    } })
    const zip = await JSZip.loadAsync(await Bun.file(exported.output).arrayBuffer())
    const manifest = JSON.parse(await zip.file("manifest.json")!.async("string")) as { files: { path: string; blob: string }[]; exclusions: string[] }
    expect(manifest.files.map((file) => file.path).sort()).toEqual(scope === "project"
      ? ["outputs/app.asar.unpacked/native.node", "outputs/index.html", "project.asar.unpacked/library.dll"]
      : ["outputs/app.asar.unpacked/native.node", "outputs/index.html"])
    expect(manifest.exclusions).toContain("*.asar files and archive contents")
    expect(await zip.file(manifest.files.find((file) => file.path.endsWith("native.node"))!.blob)!.async("string")).toBe("native bytes")
    } finally {
      if (previous === undefined) delete process.env.OCTO_PORTABLE_BLACKLIST_URL
      else process.env.OCTO_PORTABLE_BLACKLIST_URL = previous
      server.stop(true)
    }
  })

  test.each(["session", "project"] as const)(
    "imports legacy colon filenames and rewrites page/chat references (%s)",
    async (scope) => {
      await using source = await tmpdir({ git: true })
      await using target = await tmpdir({ git: true })
      const exported = await provideTestInstance({
        directory: source.path,
        fn: async () => {
          const session = await runSession((svc) => svc.create({ title: "Legacy filenames" }))
          const root = path.join(source.path, ".octo", session.id, "outputs")
          await Bun.write(path.join(root, "assets_README.md"), "readme")
          await Bun.write(path.join(root, "index.html"), '<a href="./assets_README.md">Readme</a>')
          const messageID = MessageID.ascending()
          await runSession((svc) =>
            svc.updateMessage({
              id: messageID,
              sessionID: session.id,
              role: "user",
              time: { created: Date.now() },
              agent: "octo_make",
              model: { providerID: ProviderID.make("test"), modelID: ModelID.make("test") },
            }),
          )
          await runSession((svc) =>
            svc.updatePart({
              id: PartID.ascending(),
              messageID,
              sessionID: session.id,
              type: "text",
              text: path.join(root, "assets_README.md").replaceAll("\\", "/"),
            }),
          )
          return AppRuntime.runPromise(
            exportPortableSession({ sessionID: session.id, output: path.join(source.path, "legacy.zip") }),
          )
        },
      })
      const zip = await JSZip.loadAsync(await Bun.file(exported.output).arrayBuffer())
      const manifest = JSON.parse(await zip.file("manifest.json")!.async("string"))
      manifest.sessions[0].messages[0].parts[0].text = manifest.sessions[0].messages[0].parts[0].text.replace(
        "assets_README.md",
        "assets:README.md",
      )
      manifest.sessions[0].messages[0].parts.push({
        id: PartID.ascending(), messageID: manifest.sessions[0].messages[0].info.id, sessionID: manifest.rootSessionID,
        type: "file", mime: "text/markdown", filename: "assets:README.md",
        url: pathToFileURL(path.join(source.path, ".octo", manifest.rootSessionID, "outputs", "assets:README.md")).href,
      })
      for (const file of manifest.files) {
        file.path = file.path.replace("assets_README.md", "assets:README.md")
        if (!file.path.endsWith("index.html")) continue
        const text = '<a href="./assets:README.md">Readme</a><a href="./assets%3AREADME.md">Encoded</a><script>const example = `unrelated?\nfirst line\nsecond line`;</script>'
        file.size = Buffer.byteLength(text)
        file.sha256 = createHash("sha256").update(text).digest("hex")
        file.blob = `blobs/${file.sha256}`
        zip.file(file.blob, text)
      }
      zip.file("manifest.json", JSON.stringify(manifest))
      await Bun.write(exported.output, await zip.generateAsync({ type: "uint8array" }))
      await provideTestInstance({
        directory: target.path,
        fn: async () => {
          const result = await AppRuntime.runPromise(importPortableSession(exported.output, scope))
          const root = path.join(target.path, ".octo", result.sessionID, "outputs")
          expect(await Bun.file(path.join(root, "assets~003a~README.md")).text()).toBe("readme")
          expect(await Bun.file(path.join(root, "index.html")).text()).toBe(
            '<a href="./assets~003a~README.md">Readme</a><a href="./assets~003a~README.md">Encoded</a><script>const example = `unrelated?\nfirst line\nsecond line`;</script>',
          )
          const messages = await runSession((svc) => svc.messages({ sessionID: result.sessionID }))
          expect(messages[0].parts[0]).toMatchObject({
            text: path.join(root, "assets~003a~README.md").replaceAll("\\", "/"),
          })
          expect(messages[0].parts[1]).toMatchObject({ filename: "assets~003a~README.md", url: pathToFileURL(path.join(root, "assets~003a~README.md")).href })
          if (scope === "project")
            expect(await Bun.file(path.join(target.path, "assets~003a~README.md")).text()).toBe("readme")
        },
      })
      // Never mutate the original archive while importing it.
      expect(await zip.file("manifest.json")!.async("string")).toContain("assets:README.md")
    },
  )

  test.skipIf(process.platform === "win32")(
    "exports macOS colon filenames without modifying source files",
    async () => {
      await using source = await tmpdir({ git: true })
      await using target = await tmpdir({ git: true })
      await Bun.write(path.join(source.path, "assets:README.md"), "readme")
      await Bun.write(path.join(source.path, "index.html"), '<a href="./assets:README.md">Readme</a>')
      const exported = await provideTestInstance({
        directory: source.path,
        fn: async () => {
          const session = await runSession((svc) => svc.create({ title: "Mac filenames" }))
          return AppRuntime.runPromise(
            exportPortableSession({ sessionID: session.id, output: path.join(source.path, "session.zip"), scope: "project" }),
          )
        },
      })
      const zip = await JSZip.loadAsync(await Bun.file(exported.output).arrayBuffer())
      const manifest = JSON.parse(await zip.file("manifest.json")!.async("string"))
      expect(manifest.files.map((file: { path: string }) => file.path)).not.toContain("assets:README.md")
      expect(manifest.pathMappings).toEqual(expect.arrayContaining([expect.objectContaining({ from: "assets:README.md", to: "assets~003a~README.md" })]))
      await provideTestInstance({
        directory: target.path,
        fn: () => AppRuntime.runPromise(importPortableSession(exported.output, "project")),
      })
      expect(await Bun.file(path.join(target.path, "assets~003a~README.md")).text()).toBe("readme")
      expect(await Bun.file(path.join(source.path, "assets:README.md")).text()).toBe("readme")
    },
  )

  test.each([
    ["path", "../escape.md"],
    ["path", "C:\\escape.md"],
    ["path", "C:escape.md"],
    ["path", "/escape.md"],
    ["directory", ".."],
    ["blob", "blobs/a:b"],
  ] as const)("rejects unsafe or conflicting legacy names before creating sessions (%s: %s)", async (field, value) => {
    await using source = await tmpdir({ git: true })
    await using target = await tmpdir({ git: true })
    const exported = await provideTestInstance({
      directory: source.path,
      fn: async () => {
        const session = await runSession((svc) => svc.create({ title: "Unsafe paths" }))
        await Bun.write(path.join(source.path, ".octo", session.id, "outputs/assets_README.md"), "readme")
        return AppRuntime.runPromise(
          exportPortableSession({ sessionID: session.id, output: path.join(source.path, "unsafe.zip") }),
        )
      },
    })
    const zip = await JSZip.loadAsync(await Bun.file(exported.output).arrayBuffer())
    const manifest = JSON.parse(await zip.file("manifest.json")!.async("string"))
    manifest.files.push({ ...manifest.files[0], [field]: value })
    zip.file("manifest.json", JSON.stringify(manifest))
    await Bun.write(exported.output, await zip.generateAsync({ type: "uint8array" }))
    await provideTestInstance({
      directory: target.path,
      fn: async () => {
        const before = await runSession((svc) => svc.list({ directory: target.path }))
        await expect(AppRuntime.runPromise(importPortableSession(exported.output))).rejects.toThrow(
          field === "blob" ? "unsafe path" : "分享包路径不兼容",
        )
        expect(await runSession((svc) => svc.list({ directory: target.path }))).toEqual(before)
      },
    })
  })

  test.each([undefined, "session", "project"] as const)(
    "does not inherit pinned state from an archive for root or child sessions (scope: %s)",
    async (scope) => {
      await using source = await tmpdir({ git: true })
      await using target = await tmpdir({ git: true })
      const exported = await provideTestInstance({ directory: source.path, fn: async () => {
        const root = await runSession((svc) => svc.create({ title: "Pinned root" }))
        const child = await runSession((svc) => svc.create({ parentID: root.id, title: "Pinned child" }))
        for (const sessionID of [root.id, child.id]) {
          await runSession((svc) => svc.setPinned({ sessionID, pinned: true }))
        }
        const archive = await AppRuntime.runPromise(exportPortableSession({ sessionID: root.id, output: path.join(source.path, "pinned.zip") }))
        expect((await runSession((svc) => svc.get(root.id))).pinned).toBe(true)
        expect((await runSession((svc) => svc.get(child.id))).pinned).toBe(true)
        return archive
      } })
      const zip = await JSZip.loadAsync(await Bun.file(exported.output).arrayBuffer())
      const manifest = JSON.parse(await zip.file("manifest.json")!.async("string")) as {
        sessions: { info: { pinned: boolean } }[]
      }
      // Existing archives may still contain pinned=true; import must ignore that local UI preference.
      expect(manifest.sessions.map((entry) => entry.info.pinned)).toEqual([true, true])
      await provideTestInstance({ directory: target.path, fn: async () => {
        const result = await AppRuntime.runPromise(importPortableSession(exported.output, scope))
        const root = await runSession((svc) => svc.get(result.sessionID))
        const children = await runSession((svc) => svc.children(root.id))
        expect(root.pinned).toBe(false)
        expect(children).toHaveLength(1)
        expect(children[0].pinned).toBe(false)
      } })
    },
  )

  test("keeps the complete shared directory and HTML references unchanged despite missing resources in another page", async () => {
    await using source = await tmpdir({ git: true })
    await using target = await tmpdir({ git: true })
    const html = '<img src="./outputs/resource/icon/icon.svg">'
    await Bun.write(path.join(source.path, "register.html"), html)
    await Bun.write(path.join(source.path, "output/login.html"), html)
    await Bun.write(path.join(source.path, "outputs/resource/icon/icon.svg"), "<svg/>")
    const exported = await provideTestInstance({ directory: source.path, fn: async () => {
      const session = await runSession((svc) => svc.create({ title: "Register" }))
      return AppRuntime.runPromise(exportPortableSession({ sessionID: session.id, output: path.join(source.path, "session.zip"), scope: "project" }))
    } })
    const zip = await JSZip.loadAsync(await Bun.file(exported.output).arrayBuffer())
    const manifest = JSON.parse(await zip.file("manifest.json")!.async("string"))
    expect(manifest.files.map((file: { path: string }) => file.path).sort()).toEqual([
      "output/login.html", "outputs/resource/icon/icon.svg", "register.html",
    ])
    for (const file of manifest.files as { path: string; blob: string }[]) {
      expect(await zip.file(file.blob)!.async("string")).toBe(file.path.endsWith(".html") ? html : "<svg/>")
    }
    await provideTestInstance({ directory: target.path, fn: async () => {
      await AppRuntime.runPromise(importPortableSession(exported.output, "project"))
    } })
    expect(await Bun.file(path.join(target.path, "register.html")).text()).toBe(html)
    expect(await Bun.file(path.join(target.path, "output/login.html")).text()).toBe(html)
    expect(await Bun.file(path.join(target.path, "outputs/resource/icon/icon.svg")).text()).toBe("<svg/>")
    expect(await Bun.file(path.join(target.path, "output/outputs/resource/icon/icon.svg")).exists()).toBe(false)
  })

  test("exports installed preview assets as real files and imports them into private and shared layouts", async () => {
    await using source = await tmpdir({ git: true })
    await using resources = await tmpdir()
    await using target = await tmpdir({ git: true })
    const assets = path.join(resources.path, "skill", "ict-react-coder", "scripts", "preview", "assets")
    await Bun.write(path.join(assets, "library/babel.min.js"), "window.Babel = {}")
    await Bun.write(path.join(assets, "font/Regular.woff2"), "font bytes")
    await Bun.write(path.join(assets, "library/unused.js"), "not referenced")
    const exported = await provideTestInstance({ directory: source.path, fn: async () => {
      const session = await runSession((svc) => svc.create({ title: "Linked preview assets" }))
      const preview = path.join(source.path, ".octo", session.id, "outputs", "preview")
      await Bun.write(path.join(preview, "index.page.html"), '<script src="assets/library/babel.min.js"></script><style>@font-face { src: url("assets/font/Regular.woff2") }</style>')
      await symlink(assets, path.join(preview, "assets"), process.platform === "win32" ? "junction" : "dir")
      return AppRuntime.runPromise(exportPortableSession({ sessionID: session.id, output: path.join(source.path, "session.zip") }).pipe(
        Effect.provideService(Global.Service, Global.make({ octoConfig: resources.path })),
      ))
    } })
    const zip = await JSZip.loadAsync(await Bun.file(exported.output).arrayBuffer())
    const manifest = JSON.parse(await zip.file("manifest.json")!.async("string"))
    expect(manifest.files.map((file: { path: string }) => file.path).sort()).toEqual([
      "outputs/preview/assets/font/Regular.woff2", "outputs/preview/assets/library/babel.min.js", "outputs/preview/index.page.html",
    ])
    await provideTestInstance({ directory: target.path, fn: async () => {
      const privateSession = await AppRuntime.runPromise(importPortableSession(exported.output, "session"))
      expect(await Bun.file(path.join(target.path, ".octo", privateSession.sessionID, "outputs/preview/assets/library/babel.min.js")).text()).toBe("window.Babel = {}")
      await AppRuntime.runPromise(importPortableSession(exported.output, "project"))
      expect(await Bun.file(path.join(target.path, "preview/assets/font/Regular.woff2")).text()).toBe("font bytes")
    } })
  })

  test("imports a shared archive privately into its source directory without rewriting paths twice", async () => {
    await using source = await tmpdir({ git: true })
    await provideTestInstance({ directory: source.path, fn: async () => {
      const session = await runSession((svc) => svc.create({ title: "Same directory" }))
      await Bun.write(path.join(source.path, "index.html"), "<h1>page</h1>")
      const messageID = MessageID.ascending()
      await runSession((svc) => svc.updateMessage({
        id: messageID, sessionID: session.id, role: "user", time: { created: Date.now() }, agent: "build",
        model: { providerID: ProviderID.make("test"), modelID: ModelID.make("test") },
      }))
      await runSession((svc) => svc.updatePart({
        id: PartID.ascending(), messageID, sessionID: session.id, type: "text",
        text: `${path.join(source.path, "index.html")}:12\n${path.join(source.path, "index.html")}，完成\n${path.join(source.path, "index.html")}.bak`,
      }))
      const archive = await AppRuntime.runPromise(exportPortableSession({ sessionID: session.id, output: path.join(source.path, "session.zip"), scope: "project" }))
      const imported = await AppRuntime.runPromise(importPortableSession(archive.output, "session"))
      const messages = await runSession((svc) => svc.messages({ sessionID: imported.sessionID }))
      const restored = path.join(source.path, ".octo", imported.sessionID, "outputs", "index.html").replaceAll("\\", "/")
      expect(messages[0].parts[0]).toMatchObject({ text: `${restored}:12\n${restored}，完成\n${path.join(source.path, "index.html").replaceAll("\\", "/")}.bak` })
      expect(await Bun.file(path.join(source.path, "index.html")).text()).toBe("<h1>page</h1>")
    } })
  })

  test("relocates Windows shared file paths and encoded URLs into private directories", async () => {
    await using source = await tmpdir({ git: true })
    await using target = await tmpdir({ git: true })
    const windows = "C:\\Users\\Alice\\项目 空间"
    const archive = await provideTestInstance({ directory: source.path, fn: async () => {
      const session = await runSession((svc) => svc.create({ title: "Windows shared files" }))
      await Bun.write(path.join(source.path, "index.html"), "<h1>page</h1>")
      await Bun.write(path.join(source.path, "需求.txt"), "attachment")
      const messageID = MessageID.ascending()
      await runSession((svc) => svc.updateMessage({
        id: messageID, sessionID: session.id, role: "user", time: { created: Date.now() }, agent: "build",
        model: { providerID: ProviderID.make("test"), modelID: ModelID.make("test") },
      }))
      const url = new URL("file:///C:/")
      url.pathname = "/C:/Users/Alice/项目 空间/需求.txt"
      await runSession((svc) => svc.updatePart({
        id: PartID.ascending(), messageID, sessionID: session.id, type: "file", filename: "需求.txt", mime: "text/plain", url: url.href,
      }))
      url.pathname = "/C:/Users/Alice/项目 空间/index.html"
      await runSession((svc) => svc.updatePart({
        id: PartID.ascending(), messageID, sessionID: session.id, type: "text",
        text: `${windows}\\index.html\n[页面](${url.href})`,
      }))
      return AppRuntime.runPromise(exportPortableSession({ sessionID: session.id, output: path.join(source.path, "session.zip"), scope: "project" }))
    } })
    const zip = await JSZip.loadAsync(await Bun.file(archive.output).arrayBuffer())
    const manifest = JSON.parse(await zip.file("manifest.json")!.async("string"))
    manifest.sourceDirectory = windows
    zip.file("manifest.json", JSON.stringify(manifest))
    await Bun.write(archive.output, await zip.generateAsync({ type: "uint8array" }))
    await provideTestInstance({ directory: target.path, fn: async () => {
      const imported = await AppRuntime.runPromise(importPortableSession(archive.output, "session"))
      const root = path.join(target.path, ".octo", imported.sessionID)
      const messages = await runSession((svc) => svc.messages({ sessionID: imported.sessionID }))
      expect(messages[0].parts.find((part) => part.type === "file")).toMatchObject({ url: pathToFileURL(path.join(root, "uploads", "需求.txt")).href })
      expect(messages[0].parts.find((part) => part.type === "text")).toMatchObject({
        text: `${path.join(root, "outputs", "index.html").replaceAll("\\", "/")}\n[页面](${pathToFileURL(path.join(root, "outputs", "index.html")).href})`,
      })
      expect(await Bun.file(path.join(root, "uploads", "需求.txt")).text()).toBe("attachment")
      expect(await Bun.file(path.join(root, "outputs", "需求.txt")).text()).toBe("attachment")
    } })
  })

  test.each([false, true])("preflights shared/private destination collisions (conflict: %s)", async (conflict) => {
    await using source = await tmpdir({ git: true })
    await using target = await tmpdir({ git: true })
    const archive = await provideTestInstance({ directory: source.path, fn: async () => {
      const session = await runSession((svc) => svc.create({ title: "Mixed files" }))
      await Bun.write(path.join(source.path, "index.html"), "shared page")
      await Bun.write(path.join(source.path, ".octo", session.id, "outputs", "index.html"), conflict ? "private page" : "shared page")
      return AppRuntime.runPromise(exportPortableSession({ sessionID: session.id, output: path.join(source.path, "session.zip"), scope: "project" }))
    } })
    await provideTestInstance({ directory: target.path, fn: async () => {
      if (conflict) {
        await expect(AppRuntime.runPromise(importPortableSession(archive.output, "session"))).rejects.toThrow("私有文件同名且内容不同")
        expect(await runSession((svc) => svc.list({ directory: target.path }))).toHaveLength(0)
        return
      }
      const imported = await AppRuntime.runPromise(importPortableSession(archive.output, "session"))
      expect(imported.files).toBe(1)
      expect(await Bun.file(path.join(target.path, ".octo", imported.sessionID, "outputs", "index.html")).text()).toBe("shared page")
    } })
  })

  test.each([
    { sourceScope: undefined, targetScope: "session" },
    { sourceScope: undefined, targetScope: "project" },
    { sourceScope: "project", targetScope: "session" },
    { sourceScope: "project", targetScope: "project" },
  ] as const)("restores artifacts, attachments and references across layouts: %j", async ({ sourceScope, targetScope }) => {
    await using source = await tmpdir({ git: true })
    await using target = await tmpdir({ git: true })
    const archive = await provideTestInstance({ directory: source.path, fn: async () => {
      const session = await runSession((svc) => svc.create({ title: "Layout compatibility" }))
      const outputs = sourceScope ? source.path : path.join(source.path, ".octo", session.id, "outputs")
      const uploads = sourceScope ? source.path : path.join(source.path, ".octo", session.id, "uploads")
      await Bun.write(path.join(outputs, "index.html"), '<link href="assets/theme.css">')
      await Bun.write(path.join(outputs, "assets", "theme.css"), "body { color: blue }")
      await Bun.write(path.join(uploads, "资料 空间", "需求.txt"), "uploaded attachment")
      await Bun.write(path.join(uploads, "guide.pdf"), "uploaded document")
      const messageID = MessageID.ascending()
      await runSession((svc) => svc.updateMessage({
        id: messageID, sessionID: session.id, role: "user", time: { created: Date.now() }, agent: "build",
        model: { providerID: ProviderID.make("test"), modelID: ModelID.make("test") },
      }))
      await runSession((svc) => svc.updatePart({
        id: PartID.ascending(), messageID, sessionID: session.id, type: "file", filename: "需求.txt", mime: "text/plain",
        url: pathToFileURL(path.join(uploads, "资料 空间", "需求.txt")).href,
      }))
      await runSession((svc) => svc.updatePart({
        id: PartID.ascending(), messageID, sessionID: session.id, type: "text",
        text: `查看 [页面](${pathToFileURL(path.join(outputs, "index.html")).href})；附件：${path.join(uploads, "资料 空间", "需求.txt")}`,
      }))
      await runSession((svc) => svc.updatePart({
        id: PartID.ascending(), messageID, sessionID: session.id, type: "text", synthetic: true,
        text: `[附件]\n- guide.pdf: ${path.join(uploads, "guide.pdf")}`,
      }))
      return AppRuntime.runPromise(exportPortableSession({ sessionID: session.id, output: path.join(source.path, "session.zip"), scope: sourceScope }))
    } })
    // Importing privately must not overwrite or expose unrelated files in the target project root.
    if (targetScope === "session") await Bun.write(path.join(target.path, "index.html"), "unrelated file")
    await provideTestInstance({ directory: target.path, fn: async () => {
      const imported = await AppRuntime.runPromise(importPortableSession(archive.output, targetScope))
      const privateRoot = path.join(target.path, ".octo", imported.sessionID)
      const outputs = targetScope === "session" ? path.join(privateRoot, "outputs") : target.path
      const uploads = targetScope === "session" || !sourceScope ? path.join(privateRoot, "uploads") : target.path
      expect(await Bun.file(path.join(outputs, "index.html")).text()).toBe('<link href="assets/theme.css">')
      expect(await Bun.file(path.join(outputs, "assets", "theme.css")).text()).toBe("body { color: blue }")
      expect(await Bun.file(path.join(uploads, "资料 空间", "需求.txt")).text()).toBe("uploaded attachment")
      expect(await Bun.file(path.join(uploads, "guide.pdf")).text()).toBe("uploaded document")
      const messages = await runSession((svc) => svc.messages({ sessionID: imported.sessionID }))
      expect(messages[0].parts.find((part) => part.type === "file")).toMatchObject({
        url: pathToFileURL(path.join(uploads, "资料 空间", "需求.txt")).href,
      })
      // A private source retains its private references even when also exposed in the shared tree.
      const page = !sourceScope ? path.join(privateRoot, "outputs", "index.html") : path.join(outputs, "index.html")
      expect(messages[0].parts.find((part) => part.type === "text")).toMatchObject({
        text: `查看 [页面](${pathToFileURL(page).href})；附件：${path.join(uploads, "资料 空间", "需求.txt").replaceAll("\\", "/")}`,
      })
      if (targetScope === "project") expect(await Bun.file(path.join(target.path, "资料 空间", "需求.txt")).text()).toBe("uploaded attachment")
      if (targetScope !== "session") return
      expect(await Bun.file(path.join(target.path, "index.html")).text()).toBe("unrelated file")
      const again = await AppRuntime.runPromise(importPortableSession(archive.output, targetScope))
      expect(again.sessionID).not.toBe(imported.sessionID)
      expect(await Bun.file(path.join(target.path, ".octo", again.sessionID, "outputs", "index.html")).text())
        .toBe('<link href="assets/theme.css">')
    } })
  })

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
        await expect(AppRuntime.runPromise(importPortableSession(archive.output, "project"))).rejects.toThrow("共享文件同名且内容不同")
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

  test("uploads a generated ZIP despite a missing dependency in another shared page and returns a share page URL", async () => {
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
        expect(manifest.files).toHaveLength(2)
        expect(manifest.files).toEqual(expect.arrayContaining([
          expect.objectContaining({ scope: "project", path: "shared.html" }),
          expect.objectContaining({ scope: "project", path: "output/login.html" }),
        ]))
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
          await AppRuntime.runPromise(SessionStatus.Service.use((status) => status.set(session.id, { type: "busy" })))
          await expect(AppRuntime.runPromise(sharePortableSession({ sessionID: session.id })))
            .rejects.toThrow("对话正在进行中，请等待结束后再分享")
          expect(uploads).toHaveLength(0)
          await AppRuntime.runPromise(SessionStatus.Service.use((status) => status.set(session.id, { type: "idle" })))
          await Bun.write(path.join(source.path, "shared.html"), "<h1>Shared</h1>")
          await Bun.write(path.join(source.path, "output/login.html"), '<img src="./outputs/resource/icon/missing.svg">')
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

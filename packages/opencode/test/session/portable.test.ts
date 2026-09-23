import { describe, expect, test } from "bun:test"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { Effect } from "effect"
import { AppRuntime } from "@/effect/app-runtime"
import { MessageV2 } from "@/session/message-v2"
import { exportPortableSession, importPortableSession, isPortableSessionFile, remapPart } from "@/session/portable"
import { MessageID, PartID, SessionID } from "@/session/schema"
import { ModelID, ProviderID } from "@/provider/schema"
import { Session } from "@/session/session"
import { Todo } from "@/session/todo"
import { provideTestInstance, tmpdir } from "../fixture/fixture"

const runSession = <A>(fn: (service: Session.Interface) => Effect.Effect<A, unknown>) =>
  AppRuntime.runPromise(Session.Service.use(fn))

const runTodo = <A>(fn: (service: Todo.Interface) => Effect.Effect<A>) => AppRuntime.runPromise(Todo.Service.use(fn))

describe("portable session", () => {
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
      const archive = path.join(source.path, "complete-session.octosession")

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
          const exported = await AppRuntime.runPromise(exportPortableSession({ sessionID: root.id, output: archive }))
          return { root, child, messageID, exported }
        },
      })

      expect(original.exported.sessions).toBe(2)
      expect(original.exported.files).toBe(5)
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

import { expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Database } from "@/storage/db"
import { MessageTable, PartTable } from "@/session/session.sql"
import { ModelID, ProviderID } from "@/provider/schema"
import type { MessageV2 } from "@/session/message-v2"
import { MessageID, PartID } from "@/session/schema"
import { Session } from "@/session/session"
import { SessionStatus } from "@/session/status"
import { previewSession } from "@/session/share-preview"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.mergeAll(Session.defaultLayer, SessionStatus.defaultLayer))

it.instance("shows the same user input as Design instead of injected artifact or workspace prompts", () =>
  Effect.gen(function* () {
    const service = yield* Session.Service
    const session = yield* service.create({ title: "生成登录HTML" })
    const samples = [
      {
        raw: "[Artifact Folder]: /private/outputs\nPrefer the <artifact> tag\n[Existing artifacts in this session]\n- /private/old.html\n---\n生成一个登录的html文件",
        expected: "生成一个登录的html文件",
      },
      {
        raw: "[Workspace]: /private/project\n内部说明\n---\n最初问题\n---\n真正显示的正文",
        expected: "真正显示的正文",
      },
      {
        raw: "[Artifact Folder]: " + "内部路径".repeat(100000) + "\n---\n生成一个登录的html文件",
        expected: "生成一个登录的html文件",
      },
      { raw: "[Workspace]: /private/project\n---\n" + "a".repeat(8190), expected: "a".repeat(8190) },
      { raw: "内部\n---\n---\n最终正文", expected: "最终正文" },
      { raw: "\n---\n".repeat(4000) + "最终正文", expected: "最终正文" },
      { raw: "内部\n---\n" + "中".repeat(8192), expected: "中".repeat(8192) },
      {
        raw: "原始模型提示\n---\n不是展示文本",
        display: "  @设计技能 生成登录界面  ",
        expected: "@设计技能 生成登录界面",
      },
      { raw: "内部原文", lateDisplay: "后面的展示文本优先", expected: "后面的展示文本优先" },
      { raw: "**原样输入**\n- 这不是助手的Markdown", expected: "**原样输入**\n- 这不是助手的Markdown" },
      { raw: "/compact", synthetic: true, expected: "/compact" },
    ]
    for (const [index, sample] of samples.entries()) {
      const message = yield* service.updateMessage({
        id: MessageID.ascending(),
        sessionID: session.id,
        role: "user",
        agent: "build",
        time: { created: index },
        model: { providerID: ProviderID.make("test"), modelID: ModelID.make("test") },
      })
      yield* service.updatePart({
        id: PartID.ascending(),
        messageID: message.id,
        sessionID: session.id,
        type: "text",
        text: sample.raw,
        synthetic: sample.synthetic,
        metadata: sample.display ? { displayText: sample.display } : undefined,
      })
      yield* service.updatePart({
        id: PartID.ascending(),
        messageID: message.id,
        sessionID: session.id,
        type: "text",
        text: "PRIVATE_EXTRA_INJECTION",
      })
      if (sample.lateDisplay) {
        for (const index of Array.from({ length: 20 }, (_, index) => index)) {
          yield* service.updatePart({
            id: PartID.ascending(),
            messageID: message.id,
            sessionID: session.id,
            type: "text",
            text: `PRIVATE_EXTRA_INJECTION ${index}`,
          })
        }
        yield* service.updatePart({
          id: PartID.ascending(),
          messageID: message.id,
          sessionID: session.id,
          type: "text",
          text: "内部原文",
          metadata: { displayText: sample.lateDisplay },
        })
      }
    }
    const page = yield* previewSession({ sessionID: session.id })
    expect(page.messages.map((message) => message.text)).toEqual(samples.map((sample) => sample.expected))
    expect(JSON.stringify(page)).not.toContain("PRIVATE_EXTRA_INJECTION")
    expect(JSON.stringify(page)).not.toContain("Artifact Folder")
    expect(JSON.stringify(page)).not.toContain("/private/")
  }),
)

it.instance("keeps a thousand-message session bounded to one preview page", () =>
  Effect.gen(function* () {
    const session = yield* (yield* Session.Service).create({ title: "千条消息预览" })
    // Bulk persisted history fixture: avoid creating a thousand unrelated bus events.
    const ids = Array.from({ length: 1000 }, () => MessageID.ascending())
    for (const offset of Array.from({ length: 10 }, (_, index) => index * 100)) {
      Database.use((db) =>
        db
          .insert(MessageTable)
          .values(
            ids.slice(offset, offset + 100).map((id, index) => ({
              id,
              session_id: session.id,
              time_created: offset + index,
              data: {
                role: "user" as const,
                agent: "build",
                time: { created: offset + index },
                model: { providerID: ProviderID.make("test"), modelID: ModelID.make("test") },
              },
            })),
          )
          .run(),
      )
      Database.use((db) =>
        db
          .insert(PartTable)
          .values(
            ids.slice(offset, offset + 100).map((id) => ({
              id: PartID.ascending(),
              session_id: session.id,
              message_id: id,
              data: { type: "text" as const, text: "历史记录" },
            })),
          )
          .run(),
      )
    }
    const page = yield* previewSession({ sessionID: session.id })
    expect(page.messages).toHaveLength(20)
    expect(page.messages.map((message) => message.id)).toEqual(ids.slice(980))
    expect(JSON.stringify(page).length).toBeLessThan(5000)
  }),
)

it.instance("paginates real preview messages in chronological order without duplicates", () =>
  Effect.gen(function* () {
    const service = yield* Session.Service
    const session = yield* service.create({ title: "预览分页" })
    const ids = Array.from({ length: 45 }, () => MessageID.ascending())
    for (const [index, id] of ids.entries()) {
      yield* service.updateMessage({
        id,
        sessionID: session.id,
        role: "user",
        time: { created: index },
        agent: "build",
        model: { providerID: ProviderID.make("test"), modelID: ModelID.make("test") },
      })
      yield* service.updatePart({
        id: PartID.ascending(),
        messageID: id,
        sessionID: session.id,
        type: "text",
        text: `正文 ${index}`,
      })
    }
    const first = yield* previewSession({ sessionID: session.id })
    expect(first.messages.map((message) => message.id)).toEqual(ids.slice(25))
    const second = yield* previewSession({ sessionID: session.id, before: first.before })
    expect(second.messages.map((message) => message.id)).toEqual(ids.slice(5, 25))
    const last = yield* previewSession({ sessionID: session.id, before: second.before })
    expect(last.messages.map((message) => message.id)).toEqual(ids.slice(0, 5))
    expect(last.before).toBeUndefined()
    expect(first.running).toBe(false)
    yield* (yield* SessionStatus.Service).set(session.id, { type: "busy" })
    expect((yield* previewSession({ sessionID: session.id, limit: 1000 })).messages).toHaveLength(20)
    expect((yield* previewSession({ sessionID: session.id })).running).toBe(true)
  }),
)

it.instance("bounds large text and part counts and excludes reasoning, tool output and file URLs", () =>
  Effect.gen(function* () {
    const service = yield* Session.Service
    const session = yield* service.create({ title: "大消息" })
    const message = yield* service.updateMessage({
      id: MessageID.ascending(),
      sessionID: session.id,
      role: "user",
      agent: "build",
      time: { created: 1 },
      model: { providerID: ProviderID.make("test"), modelID: ModelID.make("test") },
    })
    const base = { messageID: message.id, sessionID: session.id }
    const parts: MessageV2.Part[] = [
      { ...base, id: PartID.ascending(), type: "text", text: "a".repeat(1_000_000) },
      {
        ...base,
        id: PartID.ascending(),
        type: "file",
        filename: "附件.html",
        mime: "text/html",
        url: "data:text/html;base64,PRIVATE_FILE_DATA",
      },
      { ...base, id: PartID.ascending(), type: "reasoning", text: "PRIVATE_REASONING", time: { start: 1 } },
      { ...base, id: PartID.ascending(), type: "text", text: "PRIVATE_SYNTHETIC", synthetic: true },
      {
        ...base,
        id: PartID.ascending(),
        type: "tool",
        callID: "call_preview",
        tool: "read",
        state: {
          status: "completed",
          input: {},
          output: "PRIVATE_TOOL".repeat(100000),
          title: "read",
          metadata: {},
          time: { start: 1, end: 2 },
        },
      },
      ...Array.from({ length: 30 }, () => ({ ...base, id: PartID.ascending(), type: "text" as const, text: "extra" })),
    ]
    for (const part of parts) yield* service.updatePart(part)
    const page = yield* previewSession({ sessionID: session.id })
    expect(page.messages[0].text.length).toBe(8192)
    expect(page.messages[0].truncated).toBe(true)
    expect(page.messages[0].files).toEqual([{ name: "附件.html", mime: "text/html" }])
    expect(JSON.stringify(page)).not.toContain("PRIVATE_")
    expect(JSON.stringify(page).length).toBeLessThan(10000)
  }),
)

it.instance("handles empty and hidden-only pages without losing the history cursor", () =>
  Effect.gen(function* () {
    const service = yield* Session.Service
    const session = yield* service.create({ title: "空预览" })
    expect((yield* previewSession({ sessionID: session.id })).messages).toEqual([])
    for (const index of Array.from({ length: 21 }, (_, index) => index)) {
      yield* service.updateMessage({
        id: MessageID.ascending(),
        sessionID: session.id,
        role: "user",
        time: { created: index },
        agent: "build",
        model: { providerID: ProviderID.make("test"), modelID: ModelID.make("test") },
      })
    }
    const page = yield* previewSession({ sessionID: session.id })
    expect(page.messages).toEqual([])
    expect(page.before).toBeString()
  }),
)

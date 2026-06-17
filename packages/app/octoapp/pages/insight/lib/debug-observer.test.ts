import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import type { Event, Message, Part } from "@opencode-ai/sdk/v2/client"
import {
  installInsightDebug,
  type DebugDeps,
  type InsightDebug,
  type SendRecord,
} from "./debug-observer"

// ── 测试用 deps 工厂 ──────────────────────────────────────────
type ListenCb = (e: { name: string; details: Event }) => void

function makeDeps(sessionID = "ses_test"): {
  deps: DebugDeps
  simulateEvent: (ev: { type: string; properties?: Record<string, unknown> }) => void
  store: DebugDeps["syncData"]
  currentID: { value: string | undefined }
} {
  let captured: ListenCb | undefined
  const store: DebugDeps["syncData"] = {
    message: {},
    part: {},
    session_status: {},
    permission: {},
    question: {},
  }
  const currentID = { value: sessionID as string | undefined }

  const deps: DebugDeps = {
    globalSDK: {
      url: "http://localhost:8080",
      event: {
        listen(cb) {
          captured = cb
          return () => { captured = undefined }
        },
      },
    },
    syncData: store,
    currentSessionID: () => currentID.value,
  }

  const simulateEvent = (ev: { type: string; properties?: Record<string, unknown> }) => {
    captured?.({
      name: ev.properties?.sessionID as string ?? "global",
      details: ev as unknown as Event,
    })
  }

  return { deps, simulateEvent, store, currentID }
}

function makeSendRecord(overrides: Partial<SendRecord> = {}): SendRecord {
  return {
    ts: Date.now(),
    source: "user",
    sessionID: "ses_test",
    messageID: "msg_test",
    model: { providerID: "openai", modelID: "gpt-4" },
    modelResolved: true,
    statusAtSend: "idle",
    cleanText: "hello",
    uploadBlock: "",
    attachmentsCount: 0,
    endpoint: "http://localhost:8080",
    ...overrides,
  }
}

// ── 每个测试独立安装/dispose ──────────────────────────────────
let debug: InsightDebug | undefined

afterEach(() => {
  debug?.dispose()
  debug = undefined
})

describe("installInsightDebug", () => {
  test("returns recordSend and dispose", () => {
    const { deps } = makeDeps()
    debug = installInsightDebug(deps)
    expect(typeof debug.recordSend).toBe("function")
    expect(typeof debug.dispose).toBe("function")
  })

  test("installs window.octoDebug with expected commands", () => {
    const { deps } = makeDeps()
    debug = installInsightDebug(deps)
    const w = window as unknown as { octoDebug?: Record<string, unknown> }
    expect(w.octoDebug).toBeDefined()
    for (const cmd of ["state", "dump", "events", "logs", "sends", "lastSend", "pending", "why", "snapshot", "mode", "verbose"]) {
      expect(typeof w.octoDebug![cmd]).toBe("function")
    }
  })

  test("dispose removes window.octoDebug", () => {
    const { deps } = makeDeps()
    debug = installInsightDebug(deps)
    debug.dispose()
    const w = window as unknown as { octoDebug?: unknown }
    expect(w.octoDebug).toBeUndefined()
    debug = undefined
  })
})

describe("event ring (§4.6.1)", () => {
  test("SSE event for current session is captured", () => {
    const { deps, simulateEvent } = makeDeps("ses_1")
    debug = installInsightDebug(deps)

    simulateEvent({
      type: "session.status",
      properties: { sessionID: "ses_1", status: { type: "busy" } },
    })

    const w = window as unknown as { octoDebug: { events: (n?: number) => unknown[] } }
    const events = w.octoDebug.events(10)
    expect(events.length).toBe(1)
    expect((events[0] as { type: string }).type).toBe("session.status")
  })

  test("SSE event for different session is ignored", () => {
    const { deps, simulateEvent } = makeDeps("ses_1")
    debug = installInsightDebug(deps)

    simulateEvent({
      type: "session.status",
      properties: { sessionID: "ses_other", status: { type: "busy" } },
    })

    const w = window as unknown as { octoDebug: { events: (n?: number) => unknown[] } }
    expect(w.octoDebug.events(10).length).toBe(0)
  })

  test("global events are always captured", () => {
    const { deps, simulateEvent } = makeDeps("ses_1")
    debug = installInsightDebug(deps)

    simulateEvent({ type: "server.connected", properties: {} })

    const w = window as unknown as { octoDebug: { events: (n?: number) => unknown[] } }
    expect(w.octoDebug.events(10).length).toBe(1)
  })

  test("server.heartbeat 被忽略:不入 event ring(降噪)", () => {
    const { deps, simulateEvent } = makeDeps("ses_1")
    debug = installInsightDebug(deps)

    simulateEvent({ type: "server.heartbeat", properties: {} })
    simulateEvent({ type: "server.heartbeat", properties: {} })
    simulateEvent({ type: "session.status", properties: { sessionID: "ses_1", status: { type: "busy" } } })

    const w = window as unknown as { octoDebug: { events: (n?: number) => { type: string }[] } }
    const evs = w.octoDebug.events(10)
    expect(evs.every((e) => e.type !== "server.heartbeat")).toBe(true)
    expect(evs.length).toBe(1) // 只有 session.status 入 ring
  })
})

describe("send ring", () => {
  test("recordSend pushes to ring", () => {
    const { deps } = makeDeps()
    debug = installInsightDebug(deps)
    debug.recordSend(makeSendRecord({ messageID: "msg_001" }))

    const w = window as unknown as { octoDebug: { sends: (n?: number) => SendRecord[] } }
    const sends = w.octoDebug.sends()
    expect(sends.length).toBe(1)
    expect(sends[0].messageID).toBe("msg_001")
  })

  test("lastSend returns the last record", () => {
    const { deps } = makeDeps()
    debug = installInsightDebug(deps)
    debug.recordSend(makeSendRecord({ messageID: "msg_A" }))
    debug.recordSend(makeSendRecord({ messageID: "msg_B" }))

    const w = window as unknown as { octoDebug: { lastSend: () => SendRecord } }
    expect(w.octoDebug.lastSend().messageID).toBe("msg_B")
  })
})

describe("log ring (§4.6.2/4.6.3)", () => {
  beforeEach(() => {
    // happy-dom provides console; we need originals reset after each test (dispose handles it)
  })

  test("console.error is mirrored to logRing", () => {
    const { deps } = makeDeps()
    debug = installInsightDebug(deps)
    console.error("[octo:test] something failed")

    const w = window as unknown as { octoDebug: { logs: (n?: number) => { source: string; args: unknown[] }[] } }
    const logs = w.octoDebug.logs(10)
    expect(logs.some((l) => l.source === "console.error")).toBe(true)
    expect(logs.some((l) => String(l.args[0]).includes("[octo:test]"))).toBe(true)
  })

  test("console.warn is mirrored to logRing", () => {
    const { deps } = makeDeps()
    debug = installInsightDebug(deps)
    console.warn("[octo:test] warning")

    const w = window as unknown as { octoDebug: { logs: (n?: number) => { source: string }[] } }
    const logs = w.octoDebug.logs(10)
    expect(logs.some((l) => l.source === "console.warn")).toBe(true)
  })

  test("dispose restores original console.error", () => {
    const origError = console.error
    const { deps } = makeDeps()
    debug = installInsightDebug(deps)
    // After install, console.error is overridden
    expect(console.error).not.toBe(origError)
    debug.dispose()
    debug = undefined
    expect(console.error).toBe(origError)
  })

  test("console.log:[octo:* 前缀被镜像,[octo:event] 排除,普通 log 忽略", () => {
    const { deps } = makeDeps()
    debug = installInsightDebug(deps)
    console.log("[octo:upload] 3/5 uploading")
    console.log("[octo:event] observer self output")
    console.log("plain log not mirrored")

    const w = window as unknown as { octoDebug: { logs: (n?: number) => { source: string; args: unknown[] }[] } }
    const mirrored = w.octoDebug.logs(20).filter((l) => l.source === "console.log")
    expect(mirrored.some((l) => String(l.args[0]).includes("[octo:upload]"))).toBe(true)
    expect(mirrored.some((l) => String(l.args[0]).includes("[octo:event]"))).toBe(false)
    expect(mirrored.some((l) => String(l.args[0]).includes("plain log"))).toBe(false)
  })
})

describe("why() rules (§5.3)", () => {
  test("rule 1: send with no events after → SSE 断提示", () => {
    const { deps } = makeDeps("ses_w")
    debug = installInsightDebug(deps)
    debug.recordSend(makeSendRecord({ sessionID: "ses_w", ts: Date.now() - 5000 }))

    const w = window as unknown as { octoDebug: { why: () => string[] } }
    const results = w.octoDebug.why()
    expect(results.some((r) => r.includes("发送后无服务器事件"))).toBe(true)
  })

  test("rule 1: suppressed when events exist after send", () => {
    const { deps, simulateEvent } = makeDeps("ses_w")
    debug = installInsightDebug(deps)
    debug.recordSend(makeSendRecord({ sessionID: "ses_w" }))
    simulateEvent({ type: "session.status", properties: { sessionID: "ses_w", status: { type: "busy" } } })

    const w = window as unknown as { octoDebug: { why: () => string[] } }
    const results = w.octoDebug.why()
    expect(results.every((r) => !r.includes("发送后无服务器事件"))).toBe(true)
  })

  test("rule 2: pending permission → 卡在等用户", () => {
    const { deps, store } = makeDeps("ses_w")
    store.permission["ses_w"] = [{} as unknown]
    debug = installInsightDebug(deps)

    const w = window as unknown as { octoDebug: { why: () => string[] } }
    const results = w.octoDebug.why()
    expect(results.some((r) => r.includes("卡在等用户"))).toBe(true)
  })

  test("rule 3: modelResolved=false → 模型未解析", () => {
    const { deps } = makeDeps("ses_w")
    debug = installInsightDebug(deps)
    debug.recordSend(makeSendRecord({ modelResolved: false }))

    const w = window as unknown as { octoDebug: { why: () => string[] } }
    const results = w.octoDebug.why()
    expect(results.some((r) => r.includes("模型未解析"))).toBe(true)
  })

  test("rule 5: 无 message 条目(undefined)+ 有活动 → 疑白屏", () => {
    const { deps, store } = makeDeps("ses_w")
    delete store.message["ses_w"] // 未加载 = undefined
    debug = installInsightDebug(deps)
    debug.recordSend(makeSendRecord({ sessionID: "ses_w" })) // 制造活动

    const w = window as unknown as { octoDebug: { why: () => string[] } }
    const results = w.octoDebug.why()
    expect(results.some((r) => r.includes("疑似白屏"))).toBe(true)
  })

  test("rule 5: 空 message 数组([])属正常空会话,不报白屏", () => {
    const { deps, store } = makeDeps("ses_w")
    store.message["ses_w"] = []
    debug = installInsightDebug(deps)
    debug.recordSend(makeSendRecord({ sessionID: "ses_w" }))

    const w = window as unknown as { octoDebug: { why: () => string[] } }
    const results = w.octoDebug.why()
    expect(results.some((r) => r.includes("疑似白屏"))).toBe(false)
  })
})

describe("snapshot() (§5.1/5.4)", () => {
  test("returns string with header line", () => {
    const { deps } = makeDeps("ses_snap")
    debug = installInsightDebug(deps)

    const w = window as unknown as { octoDebug: { snapshot: (opts?: object) => string } }
    const text = w.octoDebug.snapshot()
    expect(typeof text).toBe("string")
    expect(text).toContain("== snapshot @")
    expect(text).toContain("session=ses_snap")
  })

  test("{last:'1s'} only includes entries in the last 1s", () => {
    const { deps } = makeDeps("ses_snap")
    debug = installInsightDebug(deps)
    // recordSend 5s ago — outside 1s window
    debug.recordSend(makeSendRecord({ ts: Date.now() - 5000, sessionID: "ses_snap" }))

    const w = window as unknown as { octoDebug: { snapshot: (opts: object) => string } }
    const text = w.octoDebug.snapshot({ last: "1s" })
    expect(text).toContain("0 条")
  })

  test("{profile:'errors'} header includes profile hint suppression", () => {
    const { deps } = makeDeps("ses_snap")
    debug = installInsightDebug(deps)

    const w = window as unknown as { octoDebug: { snapshot: (opts: object) => string } }
    const text = w.octoDebug.snapshot({ profile: "errors" })
    // profile 指定时不显示"可用 profile"提示
    expect(text).not.toContain("可用 profile:")
  })

  test("default window shows '可用 profile' hint", () => {
    const { deps } = makeDeps("ses_snap")
    debug = installInsightDebug(deps)

    const w = window as unknown as { octoDebug: { snapshot: () => string } }
    const text = w.octoDebug.snapshot()
    expect(text).toContain("可用 profile:")
  })

  test("{full:true} appends message/part dump", () => {
    const { deps, store } = makeDeps("ses_snap")
    store.message["ses_snap"] = [{ id: "msg_1", sessionID: "ses_snap", role: "user" } as Message]
    store.part["msg_1"] = [{ id: "part_1", type: "text" } as unknown as Part]
    debug = installInsightDebug(deps)

    const w = window as unknown as { octoDebug: { snapshot: (opts: object) => string } }
    const text = w.octoDebug.snapshot({ full: true })
    expect(text).toContain("-- full dump:")
    expect(text).toContain("msg_1")
  })

  test("{profile:'upload'} 抓 [octo:upload] console.log,排除其他 [octo:* 链路", () => {
    const { deps } = makeDeps()
    debug = installInsightDebug(deps)
    console.log("[octo:upload] 3/5 uploading file.pdf")
    console.log("[octo:prompt] unrelated send")

    const w = window as unknown as { octoDebug: { snapshot: (opts: object) => string } }
    const text = w.octoDebug.snapshot({ profile: "upload", last: "1m" })
    expect(text).toContain("[octo:upload]")
    expect(text).not.toContain("[octo:prompt]")
  })
})

describe("dispose cleanup", () => {
  test("dispose unsubscribes from event.listen", () => {
    let unsubCalled = false
    const deps: DebugDeps = {
      globalSDK: {
        url: "http://localhost",
        event: {
          listen() { return () => { unsubCalled = true } },
        },
      },
      syncData: { message: {}, part: {}, session_status: {}, permission: {}, question: {} },
      currentSessionID: () => undefined,
    }
    debug = installInsightDebug(deps)
    debug.dispose()
    debug = undefined
    expect(unsubCalled).toBe(true)
  })

  test("dispose restores window.onerror", () => {
    const orig = window.onerror
    const { deps } = makeDeps()
    debug = installInsightDebug(deps)
    debug.dispose()
    debug = undefined
    expect(window.onerror).toBe(orig)
  })
})

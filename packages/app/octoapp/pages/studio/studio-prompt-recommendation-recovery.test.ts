import { expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createStore } from "solid-js/store"
import { createGlobalEmitter } from "@solid-primitives/event-bus"
import type { Event, Message, Part } from "@opencode-ai/sdk/v2/client"
import { createPromptRecommendation } from "./studio-prompt-recommendation"
import { createRecommendationSwitch } from "./studio-recommendation-mode"
import { mountRecommendation } from "./studio-prompt-recommendation.fixture"
import { createStudioSessionData } from "./studio-session-data"
import { promptMetadata, recommendationActivity, recommendationMessagesCurrent } from "./studio-prompt-state"
import { buildStudioTurns } from "./turns"

test("ordinary message reload failures do not create recommendation recovery state", async () => {
  const scope = crypto.randomUUID()
  const notices: string[] = []
  const page = mountRecommendation({
    scope: () => scope,
    sessionID: () => "ordinary",
    snapshotReady: () => true,
    messagesCurrent: () => true,
    mode: createRecommendationSwitch(),
    request: async () => Response.json({ stateToken: "token", recommendation: null }),
    reload: async () => { throw new Error("messages unavailable") },
    notice: (message) => notices.push(message),
  })
  try {
    await Bun.sleep(0)
    await page.api.recover()
    expect(page.api.ready()).toBe(true)
    expect(page.api.needsRecovery()).toBe(false)
    expect(notices).toEqual([])
  } finally { page.dispose() }
})

test.each(["visit", "retry", "revision", "current"].flatMap((scenario) =>
  [false, true].map((pending) => ({ scenario, pending }))),
)("only current state failures invalidate recovery (scenario=$scenario, pending=$pending)", async ({ scenario, pending }) => {
  const scope = crypto.randomUUID()
  const storageKey = `studio.prompt-recommendation.pending:${JSON.stringify([scope, "A"])}`
  if (pending) sessionStorage.setItem(storageKey, JSON.stringify({
    kind: "submit", requestID: "request", sessionID: "A", guidePartID: "guide",
  }))
  const first = Promise.withResolvers<Response>()
  const [state, setState] = createStore({ session: "A", revision: "" })
  const notices: string[] = []
  let reads = 0
  const page = mountRecommendation({
    scope: () => scope,
    sessionID: () => state.session,
    revision: () => state.revision,
    snapshotReady: () => true,
    messagesCurrent: () => true,
    activity: () => state.session === "A" ? { sessionID: "A", guidePartID: "guide", assistantMessageID: "msg_2",
      resultRevision: 1, status: "running" } : undefined,
    mode: createRecommendationSwitch(),
    request: async () => ++reads === 1 ? first.promise : Response.json({
      stateToken: "token", recommendation: state.session === "B" ? null : {
        sessionID: "A", guidePartID: "guide", guideMessageID: "msg_1", guideRevision: 2,
        assistantMessageID: "msg_2", resultRevision: 1, status: "running", submission: { requestID: "request" },
      },
    }),
    notice: (message) => notices.push(message),
  })
  try {
    await Bun.sleep(0)
    if (scenario === "current") {
      first.reject(new Error("current state request timed out"))
      await Bun.sleep(0)
      expect(page.api.ready()).toBe(false)
      expect(page.api.needsRecovery()).toBe(true)
      expect(notices).toEqual(["扩写状态同步失败，请重新同步会话。"])
      expect(sessionStorage.getItem(storageKey) !== null).toBe(pending)
      return
    }
    if (scenario === "visit") {
      setState("session", "B")
      await Bun.sleep(0)
      setState("session", "A")
    }
    if (scenario === "retry") await page.api.recover()
    if (scenario === "revision") setState("revision", "accepted")
    await Bun.sleep(0)
    expect(page.api.ready()).toBe(true)
    expect(page.api.state()?.unknown).toBe(false)
    first.reject(new Error("obsolete state request timed out"))
    await Bun.sleep(0)
    expect(page.api.ready()).toBe(true)
    expect(page.api.state()?.unknown).toBe(false)
    expect(page.api.busy()).toBe(true)
    expect(notices).toEqual([])
    expect(sessionStorage.getItem(storageKey)).toBeNull()
  } finally {
    first.resolve(Response.json({ stateToken: "token", recommendation: null }))
    page.dispose()
    sessionStorage.removeItem(storageKey)
  }
})

test.each(["armed", "running"])("closing during message recovery preserves the %s task semantics", async (status) => {
  const scope = crypto.randomUUID()
  const key = JSON.stringify([scope, "session"])
  const [state, setState] = createStore<{ current: boolean; status: string }>({ current: false, status })
  const calls: string[] = []
  let loads = 0
  const page = createRoot((dispose) => {
    const mode = createRecommendationSwitch()
    const api = createPromptRecommendation({
      scope: () => scope,
      sessionID: () => "session",
      revision: () => "",
      snapshotReady: () => true,
      messagesCurrent: () => state.current,
      mode,
      request: async (path, body) => {
        if (body !== undefined) calls.push(path)
        if (path.endsWith("/dismiss")) setState("status", "dismissed")
        const recommendation = { sessionID: "session", guidePartID: "guide", guideMessageID: "msg_1", guideRevision: 2,
          status: state.status, ...(status === "running" ? { assistantMessageID: "msg_2", resultRevision: 1 } : {}) }
        return Response.json(body === undefined ? { stateToken: "token", recommendation } : { ...recommendation, stateToken: "token" })
      },
      reload: async () => {
        if (++loads === 1) throw new Error("message synchronization failed")
        setState("current", true)
      },
      uploadImage: async () => ({ path: "/uploaded" }),
      navigate: () => {},
      notice: () => {},
    })
    return { dispose, api, mode }
  })
  try {
    await Bun.sleep(0)
    expect(page.api.needsRecovery()).toBe(true)
    page.mode.save(key, true)
    await page.api.exit()
    await Bun.sleep(0)
    expect(page.mode.enabled(key)).toBe(false)
    expect(page.api.needsRecovery()).toBe(false)
    expect(page.api.exiting()).toBe(false)
    expect(state.status).toBe(status === "armed" ? "dismissed" : "running")
    expect(page.api.busy()).toBe(status === "running")
    expect(calls).toEqual(status === "armed" ? ["/studio/sessions/session/prompt-recommendations/guide/dismiss"] : [])
  } finally { page.dispose() }
})

test.each([false, true])("message synchronization stays recoverable across failed retries (SSE=%s)", async (sse) => {
  const [state, setState] = createStore({ current: false, revision: "" })
  const retry = Promise.withResolvers<void>()
  const notices: string[] = []
  let loads = 0
  const page = mountRecommendation({
    scope: () => "message-retry",
    revision: () => state.revision,
    snapshotReady: () => true,
    messagesCurrent: () => state.current,
    mode: createRecommendationSwitch(),
    request: async () => Response.json({ stateToken: "token", recommendation: {
      sessionID: "session", guidePartID: "guide", guideMessageID: "msg_1", guideRevision: 2,
      assistantMessageID: "msg_2", resultRevision: 2, status: "completed",
    } }),
    reload: async () => {
      if (++loads === 1) throw new Error("automatic synchronization failed")
      if (loads === 2) return retry.promise
      setState("current", true)
    },
    notice: (message) => notices.push(message),
  })
  try {
    await Bun.sleep(0)
    expect(page.api.needsRecovery()).toBe(true)
    expect(page.api.state()?.unknown).toBe(false)
    setState("revision", "background-state-refresh")
    await Bun.sleep(0)
    expect(page.api.needsRecovery()).toBe(true)
    const recovering = page.api.recover().catch(() => {})
    await Bun.sleep(0)
    expect(loads).toBe(2)
    expect(page.api.needsRecovery()).toBe(true)
    if (sse) setState("current", true)
    retry.reject(new Error("manual synchronization failed"))
    await recovering
    await Bun.sleep(0)
    expect(page.api.needsRecovery()).toBe(!sse)
    expect(notices).toHaveLength(sse ? 1 : 2)
    if (!sse) await page.api.recover()
    expect(page.api.needsRecovery()).toBe(false)
    expect(state.current).toBe(true)
    expect(loads).toBe(sse ? 2 : 3)
  } finally {
    retry.resolve()
    page.dispose()
  }
})

test.each(["messages", "version", "visit", "retry", "current-failure"] as const)(
  "only a current failed synchronization can lock the session (scenario=%s)",
  async (scenario) => {
    const scope = crypto.randomUUID()
    const first = Promise.withResolvers<void>()
    const next = Promise.withResolvers<void>()
    const [state, setState] = createStore({ session: "A", current: false, revision: 2 })
    const notices: string[] = []
    let loads = 0
    const page = mountRecommendation({
      scope: () => scope,
      sessionID: () => state.session,
      revision: () => String(state.revision),
      snapshotReady: () => true,
      messagesCurrent: () => state.current,
      mode: createRecommendationSwitch(),
      request: async () => Response.json({ stateToken: "token", recommendation: state.session === "B" ? null : {
        sessionID: "A", guidePartID: "guide", guideMessageID: "msg_1", guideRevision: 2,
        assistantMessageID: "msg_2", resultRevision: state.revision, status: "completed",
      } }),
      reload: () => ++loads === 1 ? first.promise : next.promise,
      notice: (message) => notices.push(message),
    })
    try {
      await Bun.sleep(0)
      expect(loads).toBe(1)
      if (scenario === "messages") setState("current", true)
      if (scenario === "version") setState("revision", 3)
      if (scenario === "visit") {
        setState("session", "B")
        await Bun.sleep(0)
        setState("session", "A")
      }
      const retry = scenario === "retry" ? page.api.recover() : Promise.resolve()
      await Bun.sleep(0)
      expect(loads).toBe(scenario === "messages" || scenario === "current-failure" ? 1 : 2)
      first.reject(new Error("message load failed"))
      await Bun.sleep(0)
      expect(page.api.needsRecovery()).toBe(scenario === "current-failure")
      expect(page.api.state()?.unknown).toBe(false)
      expect(notices).toEqual(scenario === "current-failure" ? ["扩写消息同步失败，请重新同步会话。"] : [])
      if (scenario === "current-failure") return
      setState("current", true)
      next.resolve()
      await retry
      await Bun.sleep(0)
      expect(page.api.state()?.unknown).toBe(false)
      expect(page.api.needsRecovery()).toBe(false)
      expect(notices).toEqual([])
    } finally {
      first.resolve()
      next.resolve()
      page.dispose()
    }
  },
)

test.each([false, true])("only an explicit close releases an unconfirmed submission after remount (close=%s)", async (close) => {
  const scope = crypto.randomUUID()
  const key = JSON.stringify([scope, "session"])
  const storageKey = `studio.prompt-recommendation.pending:${key}`
  const gate = Promise.withResolvers<void>()
  const [events, setEvents] = createStore({ revision: "" })
  const calls: string[] = []
  let server: {
    sessionID: string
    guidePartID: string
    guideMessageID: string
    guideRevision: number
    status: string
    assistantMessageID?: string
    resultRevision?: number
    submission?: { requestID: string }
  } = { sessionID: "session", guidePartID: "guide", guideMessageID: "msg_1", guideRevision: 1, status: "armed" }
  const mount = () => createRoot((dispose) => {
    const mode = createRecommendationSwitch()
    const api = createPromptRecommendation({
      scope: () => scope,
      sessionID: () => "session",
      revision: () => events.revision,
      mode,
      request: async (path, body) => {
        if (body !== undefined) calls.push(path)
        if (path === "/studio/prompt-expansions") {
          await gate.promise
          if (server.status === "dismissed")
            return Response.json({ data: { code: "INVALID_RECOMMENDATION_STATE" } }, { status: 409 })
          server = { ...server, status: "running", assistantMessageID: "msg_2", resultRevision: 1,
            submission: { requestID: (body as { requestID: string }).requestID } }
          setEvents("revision", "accepted")
        }
        if (path.endsWith("/dismiss")) server = { ...server, status: "dismissed" }
        return Response.json(body === undefined ? { stateToken: "token", recommendation: server } : { ...server, stateToken: "token" })
      },
      uploadImage: async () => ({ path: "/uploaded" }),
      reload: async () => {},
      navigate: () => {},
      notice: () => {},
    })
    return { api, mode, dispose }
  })
  const first = mount()
  await Bun.sleep(0)
  first.mode.save(key, true)
  const submission = first.api.expand({ prompt: "城市", images: [], availableModels: [] }, () => {})
  await Bun.sleep(0)
  const original = JSON.parse(sessionStorage.getItem(storageKey)!) as { requestID: string }
  if (close) await first.api.exit()
  first.dispose()
  const returning = mount()
  try {
    await Bun.sleep(0)
    expect(returning.mode.enabled(key)).toBe(false)
    expect(calls.some((path) => path.endsWith("/dismiss"))).toBe(close)
    if (close) {
      expect(sessionStorage.getItem(storageKey)).toBeNull()
      expect(server.status).toBe("dismissed")
      return
    }
    expect(JSON.parse(sessionStorage.getItem(storageKey)!).requestID).toBe(original.requestID)
    expect(returning.api.state()?.unknown).toBe(true)
    gate.resolve()
    await submission
    await Bun.sleep(0)
    expect(sessionStorage.getItem(storageKey)).toBeNull()
    expect(returning.api.state()?.unknown).toBe(false)
    expect(returning.api.busy()).toBe(true)
    expect(returning.api.state()?.state?.recommendation?.submission?.requestID).toBe(original.requestID)
    expect(returning.mode.enabled(key)).toBe(false)
    expect(calls).toEqual(["/studio/prompt-expansions"])
  } finally {
    gate.resolve()
    await submission
    first.dispose()
    returning.dispose()
    sessionStorage.removeItem(storageKey)
  }
})

test.each(["running", "completed", "failed", "cancelled"].flatMap((status) =>
  [false, true].flatMap((messagesFirst) => (status === "running" ? [false] : [false, true])
    .map((failedRetries) => ({ status, messagesFirst, failedRetries })))),
)("reconciles stale messages without SSE (status=$status, messagesFirst=$messagesFirst, failedRetries=$failedRetries)", async ({ status, messagesFirst, failedRetries }) => {
  const scope = crypto.randomUUID()
  const gate = Promise.withResolvers<void>()
  const resultRevision = status === "running" ? 1 : 2
  const recommendation = { sessionID: "session", guidePartID: "guide", guideMessageID: "msg_2", guideRevision: 2,
    assistantMessageID: "msg_4", resultRevision, status }
  const messages = ["msg_1", "msg_2", "msg_3", "msg_4"].map((id, index): Message => index % 2 === 0 ? {
    id, sessionID: "session", role: "user", time: { created: index }, agent: "octo_studio",
    model: { providerID: "test", modelID: "test" },
  } : {
    id, sessionID: "session", role: "assistant", parentID: `msg_${index}`, time: { created: index },
    agent: "octo_studio", mode: "octo_studio", providerID: "test", modelID: "test",
    path: { cwd: "/tmp", root: "/tmp" }, cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  })
  const guide = { id: "guide", messageID: "msg_2", sessionID: "session", type: "text", text: "推荐引导",
    metadata: { studioPromptRecommendation: { version: 1, kind: "guide", revision: 2, status: "consumed" } },
  } satisfies Part
  const result = (fresh: boolean): Part => ({
    id: "result", messageID: "msg_4", sessionID: "session", type: "text", text: fresh ? "扩写终态正文" : "",
    metadata: { studioPromptExpansion: { version: 1, kind: "result", guidePartID: "guide",
      revision: fresh ? resultRevision : 1, status: fresh ? status : "running" } },
  })
  let loads = 0
  const sdk = {
    event: createGlobalEmitter<{ [key: string]: Event }>(),
    client: { session: {
      get: async () => ({ data: { agent: "octo_studio" } }),
      messages: async () => {
        const fresh = ++loads > 1
        if (failedRetries && loads > 1 && loads < 4) throw new Error("messages unavailable")
        if (!fresh && !messagesFirst) await gate.promise
        return { data: messages.map((info) => ({ info, parts: info.id === "msg_2" ? [guide]
          : info.id === "msg_4" ? [result(fresh)] : [] })) }
      },
    } },
  } as unknown as Parameters<typeof createStudioSessionData>[0]["globalSDK"]
  const page = createRoot((dispose) => {
    const data = createStudioSessionData({ sessionID: () => "session", globalSDK: sdk })
    const api = createPromptRecommendation({
      scope: () => scope,
      sessionID: () => "session",
      snapshotReady: data.snapshotReady,
      messagesCurrent: (state) => recommendationMessagesCurrent(state, data.dataStore.part),
      revision: () => (data.dataStore.part.msg_4 ?? []).map((part) => promptMetadata(part)?.revision ?? 0).join("|"),
      activity: () => recommendationActivity("session", data.dataStore.message.session ?? [], data.dataStore.part),
      mode: createRecommendationSwitch(),
      request: async () => {
        if (messagesFirst) await gate.promise
        return Response.json({ stateToken: "token", recommendation })
      },
      reload: data.loadSessionMessages,
      uploadImage: async () => ({ path: "/uploaded" }),
      navigate: () => {},
      notice: () => {},
    })
    return { dispose, api, data }
  })
  try {
    await Bun.sleep(0)
    gate.resolve()
    await Bun.sleep(0)
    expect(loads).toBe(status === "running" ? 1 : 2)
    if (failedRetries) {
      expect(page.api.needsRecovery()).toBe(true)
      expect(buildStudioTurns({ messages: page.data.dataStore.message.session, parts: page.data.dataStore.part })
        .at(-1)?.recommendation?.status).toBe("running")
      await page.api.recover()
      expect(page.api.needsRecovery()).toBe(true)
      expect(loads).toBe(3)
      await page.api.recover()
      expect(page.api.needsRecovery()).toBe(false)
      expect(loads).toBe(4)
    }
    const turns = buildStudioTurns({ messages: page.data.dataStore.message.session, parts: page.data.dataStore.part })
    expect(turns.at(-1)?.recommendation?.status).toBe(status)
    if (status !== "running") expect(turns.at(-1)?.assistantText).toBe("扩写终态正文")
    expect(page.api.busy()).toBe(status === "running")
    await page.api.recover(false)
    expect(loads).toBe(failedRetries ? 4 : status === "running" ? 1 : 2)
  } finally { gate.resolve(); page.dispose() }
})

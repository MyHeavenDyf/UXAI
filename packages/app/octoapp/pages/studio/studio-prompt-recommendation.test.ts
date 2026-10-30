import { expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createStore } from "solid-js/store"
import { createPromptRecommendation } from "./studio-prompt-recommendation"

const guide = {
  sessionID: "session",
  guidePartID: "guide",
  guideMessageID: "assistant",
  guideRevision: 1,
  status: "armed",
}

test("failed initial state reads allow ordinary sending without inventing a recommendation", async () => {
  const scope = crypto.randomUUID()
  const requests: { path: string; timeout?: number }[] = []
  let dispose = () => {}
  const api = createRoot((cleanup) => {
    dispose = cleanup
    return createPromptRecommendation({
      scope: () => scope,
      sessionID: () => "session",
      revision: () => "",
      request: async (path, _body, timeout) => {
        requests.push({ path, timeout })
        throw new Error("state unavailable")
      },
      uploadImage: async () => ({ path: "/uploaded/image.webp" }),
      reload: async () => {},
      navigate: () => {},
      notice: () => {},
    })
  })
  try {
    await Bun.sleep(0)
    expect(api.ready()).toBe(true)
    expect(api.armed()).toBe(false)
    expect(api.busy()).toBe(false)
    expect(api.state()?.unknown).toBe(false)
    await api.initialize()
    expect(api.ready()).toBe(true)
    expect(api.state()?.unknown).toBe(false)
    expect(requests.every((request) => request.timeout === 5_000)).toBe(true)
    expect(requests.every((request) => request.path.includes("/prompt-recommendation"))).toBe(true)
  } finally {
    dispose()
  }
})

test("failed recovery preserves a pending submission instead of falling back to ordinary sending", async () => {
  const scope = crypto.randomUUID()
  const storageKey = `studio.prompt-recommendation.pending:${JSON.stringify([scope, "session"])}`
  const saved = JSON.stringify({ kind: "submit", requestID: "request", sessionID: "session", guidePartID: "guide" })
  sessionStorage.setItem(storageKey, saved)
  let dispose = () => {}
  const api = createRoot((cleanup) => {
    dispose = cleanup
    return createPromptRecommendation({
      scope: () => scope,
      sessionID: () => "session",
      revision: () => "",
      request: async () => {
        throw new Error("state unavailable")
      },
      uploadImage: async () => ({ path: "/uploaded/image.webp" }),
      reload: async () => {},
      navigate: () => {},
      notice: () => {},
    })
  })
  try {
    await Bun.sleep(0)
    expect(api.ready()).toBe(false)
    expect(api.state()?.unknown).toBe(true)
    expect(sessionStorage.getItem(storageKey)).toBe(saved)
  } finally {
    dispose()
    sessionStorage.removeItem(storageKey)
  }
})

test.each(["armed", "running", "cancelling"] as const)(
  "failed later reads preserve the known %s state",
  async (status) => {
    let fail = false
    let dispose = () => {}
    const scope = crypto.randomUUID()
    const api = createRoot((cleanup) => {
      dispose = cleanup
      return createPromptRecommendation({
        scope: () => scope,
        sessionID: () => "session",
        revision: () => "",
        request: async () => {
          if (fail) throw new Error("state unavailable")
          return Response.json({ stateToken: "token", recommendation: { ...guide, status } })
        },
        uploadImage: async () => ({ path: "/uploaded/image.webp" }),
        reload: async () => {},
        navigate: () => {},
        notice: () => {},
      })
    })
    try {
      await Bun.sleep(0)
      fail = true
      await expect(api.recover()).rejects.toThrow("state unavailable")
      expect(api.state()?.state?.recommendation?.status).toBe(status)
      expect(api.armed()).toBe(status === "armed")
      expect(api.busy()).toBe(status !== "armed")
    } finally {
      dispose()
    }
  },
)

test("initialization waits for persistence, navigates and clears its pending request", async () => {
  const scope = crypto.randomUUID()
  const requests: unknown[] = []
  let navigated = ""
  let dispose = () => {}
  const api = createRoot((cleanup) => {
    dispose = cleanup
    return createPromptRecommendation({
      scope: () => scope,
      sessionID: () => undefined,
      revision: () => "",
      request: async (_path, body, timeout) => {
        expect(timeout).toBe(35_000)
        requests.push(body)
        return Response.json({ ...guide, stateToken: "token" })
      },
      uploadImage: async () => ({ path: "/uploaded/image.webp" }),
      reload: async () => {},
      navigate: (id) => {
        navigated = id
      },
      notice: () => {},
    })
  })
  try {
    await Bun.sleep(0)
    await Promise.all([api.initialize(), api.initialize()])
    expect(requests).toHaveLength(1)
    expect(navigated).toBe("session")
    expect(
      sessionStorage.getItem(`studio.prompt-recommendation.pending:${JSON.stringify([scope, "blank"])}`),
    ).toBeNull()
  } finally {
    dispose()
  }
})

test("replaying a lost response preserves the original payload and a newer draft", async () => {
  const scope = crypto.randomUUID()
  const sent: unknown[] = []
  let draft = "A"
  let uploaded = 0
  let dispose = () => {}
  const api = createRoot((cleanup) => {
    dispose = cleanup
    return createPromptRecommendation({
      scope: () => scope,
      sessionID: () => "session",
      revision: () => "",
      request: async (path, body) => {
        if (path === "/studio/prompt-expansions") {
          sent.push(body)
          if (sent.length === 1) throw new Error("response lost")
          return Response.json({ ...guide, stateToken: "token", status: "running" })
        }
        return Response.json({ stateToken: "token", recommendation: guide })
      },
      uploadImage: async () => {
        uploaded++
        return { path: "/uploaded/image.webp" }
      },
      reload: async () => {},
      navigate: () => {},
      notice: () => {},
    })
  })
  try {
    await Bun.sleep(0)
    const request = {
      prompt: "A",
      images: [{ mime: "image/png", base64: "image" }],
      availableModels: [{ providerID: "test", modelID: "test" }],
    }
    await api.submit(request, () => {
      if (draft === "A") draft = ""
    })
    draft = "B"
    await api.submit({ ...request, prompt: "B" }, () => {
      if (draft === "B") draft = ""
    })
    expect(sent).toHaveLength(2)
    expect(sent[1]).toEqual(sent[0])
    expect(draft).toBe("B")
    expect(uploaded).toBe(1)
    expect(sent[0]).toMatchObject({ images: [{ path: "/uploaded/image.webp" }] })
    expect(JSON.stringify(sent[0])).not.toContain("base64")
  } finally {
    dispose()
  }
})

test("upload failure keeps the draft and retries only the missing upload", async () => {
  const scope = crypto.randomUUID()
  const uploaded: string[] = []
  const sent: unknown[] = []
  let fail = true
  let cleared = false
  let dispose = () => {}
  const api = createRoot((cleanup) => {
    dispose = cleanup
    return createPromptRecommendation({
      scope: () => scope,
      sessionID: () => "session",
      revision: () => "",
      uploadImage: async (_id, image) => {
        uploaded.push(image.base64)
        if (image.base64 === "second" && fail) {
          fail = false
          throw new Error("upload failed")
        }
        return { path: `/uploaded/${image.base64}.png` }
      },
      request: async (path, body) => {
        if (path === "/studio/prompt-expansions") {
          sent.push(body)
          return Response.json({ ...guide, stateToken: "token", status: "running" })
        }
        return Response.json({ stateToken: "token", recommendation: guide })
      },
      reload: async () => {},
      navigate: () => {},
      notice: () => {},
    })
  })
  try {
    await Bun.sleep(0)
    const request = {
      prompt: "参考图",
      availableModels: [{ providerID: "test", modelID: "test" }],
      images: [
        { mime: "image/png", base64: "first" },
        { mime: "image/png", base64: "second" },
      ],
    }
    await api.submit(request, () => {
      cleared = true
    })
    expect(sent).toHaveLength(0)
    expect(cleared).toBe(false)
    expect(api.state()?.unknown).toBe(false)
    expect(
      sessionStorage.getItem(`studio.prompt-recommendation.pending:${JSON.stringify([scope, "session"])}`),
    ).toBeNull()
    await api.submit(request, () => {
      cleared = true
    })
    expect(uploaded).toEqual(["first", "second", "second"])
    expect(sent).toHaveLength(1)
    expect(cleared).toBe(true)
  } finally {
    dispose()
  }
})

test.each([
  [503, "NO_ELIGIBLE_MODEL", "没有支持本次输入的扩写模型"],
  [503, "PREPARATION_TIMEOUT", "准备超时，本次未受理"],
  [400, "INVALID_INPUT", "文字或参考图格式不符合要求"],
  [409, "SESSION_BUSY", "正在处理其他任务"],
  [503, "UNEXPECTED_FAILURE", "503 / UNEXPECTED_FAILURE"],
] as const)("rejected submissions show the reason and retain the draft: %s %s", async (status, code, message) => {
  const scope = crypto.randomUUID()
  const notices: string[] = []
  let cleared = false
  let dispose = () => {}
  const api = createRoot((cleanup) => {
    dispose = cleanup
    return createPromptRecommendation({
      scope: () => scope,
      sessionID: () => "session",
      revision: () => "",
      request: async (path) =>
        path === "/studio/prompt-expansions"
          ? Response.json({ data: { code } }, { status })
          : Response.json({ stateToken: "token", recommendation: guide }),
      uploadImage: async () => ({ path: "/uploaded/image.webp" }),
      reload: async () => {},
      navigate: () => {},
      notice: (value) => notices.push(value),
    })
  })
  try {
    await Bun.sleep(0)
    await api.submit(
      { prompt: "参考图", images: [], availableModels: [{ providerID: "test", modelID: "test" }] },
      () => {
        cleared = true
      },
    )
    expect(notices.at(-1)).toContain(message)
    expect(cleared).toBe(false)
  } finally {
    dispose()
  }
})

test("returning to armed A retains its lock while refresh waits or fails after visiting B", async () => {
  let dispose = () => {}
  let fail = false
  let release = () => {}
  const scope = crypto.randomUUID()
  const [session, setSession] = createStore({ id: "session" })
  const api = createRoot((cleanup) => {
    dispose = cleanup
    return createPromptRecommendation({
      scope: () => scope,
      sessionID: () => session.id,
      revision: () => "",
      request: async () => {
        if (session.id === "B") return Response.json({ stateToken: "B", recommendation: null })
        if (fail) {
          await new Promise<void>((resolve) => {
            release = resolve
          })
          throw new Error("state unavailable")
        }
        return Response.json({ stateToken: "A", recommendation: guide })
      },
      uploadImage: async () => ({ path: "/uploaded/image.webp" }),
      reload: async () => {},
      navigate: () => {},
      notice: () => {},
    })
  })
  try {
    await Bun.sleep(0)
    expect(api.armed()).toBe(true)
    setSession("id", "B")
    await Bun.sleep(0)
    expect(api.armed()).toBe(false)
    fail = true
    setSession("id", "session")
    await Bun.sleep(0)
    expect(api.ready()).toBe(false)
    expect(api.armed()).toBe(true)
    release()
    await Bun.sleep(0)
    expect(api.armed()).toBe(true)
    expect(api.ready()).toBe(false)
  } finally {
    release()
    dispose()
  }
})

function modeSetup(
  options: {
    status?: string
    enabled?: boolean
    waitInitialize?: Promise<void>
    waitUpload?: Promise<void>
    waitSubmit?: Promise<void>
    loseSubmitResponse?: boolean
    loseUnacceptedSubmitResponse?: boolean
    loseDismissResponse?: boolean
  } = {},
) {
  const scope = crypto.randomUUID()
  const calls: { path: string; body: unknown }[] = []
  const [mode, setMode] = createStore({ enabled: "enabled" in options ? options.enabled : true })
  let server: typeof guide & { submission?: { requestID: string } } = {
    ...guide,
    status: options.status ?? "completed",
  }
  let serial = 0
  let dispose = () => {}
  const api = createRoot((cleanup) => {
    dispose = cleanup
    return createPromptRecommendation({
      scope: () => scope,
      sessionID: () => "session",
      revision: () => "",
      mode: { ready: () => true, enabled: () => mode.enabled, save: (_key, enabled) => setMode("enabled", enabled) },
      request: async (path, body) => {
        calls.push({ path, body })
        if (path === "/studio/prompt-recommendations") {
          await options.waitInitialize
          server = { ...guide, guidePartID: `guide-${++serial}`, status: "armed" }
        }
        if (path === "/studio/prompt-expansions") {
          await options.waitSubmit
          if (options.loseUnacceptedSubmitResponse) {
            options.loseUnacceptedSubmitResponse = false
            throw new Error("request lost before acceptance")
          }
          server = {
            ...server,
            status: "completed",
            submission: { requestID: (body as { requestID: string }).requestID },
          }
          if (options.loseSubmitResponse) {
            options.loseSubmitResponse = false
            throw new Error("response lost")
          }
        }
        if (path.endsWith("/dismiss") && server.status === "armed") {
          server = { ...server, status: "dismissed", guideRevision: server.guideRevision + 1 }
          if (options.loseDismissResponse) {
            options.loseDismissResponse = false
            throw new Error("dismiss response lost")
          }
        }
        return Response.json(
          body === undefined
            ? { stateToken: `token-${serial}`, recommendation: server }
            : { ...server, stateToken: `token-${serial}` },
        )
      },
      uploadImage: async () => {
        await options.waitUpload
        return { path: "/uploaded/image.webp" }
      },
      reload: async () => {},
      navigate: () => {},
      notice: () => {},
    })
  })
  return { api, mode, setMode, calls, dispose }
}

const expansionInput = {
  prompt: "城市",
  images: [],
  availableModels: [{ providerID: "test", modelID: "test" }],
}

test.each([true, false, undefined])("shortcut expansion preserves effective recommendation mode enabled=%s", async (enabled) => {
  const value = modeSetup({ enabled })
  try {
    await Bun.sleep(0)
    expect(value.mode.enabled).toBe(enabled)
    await value.api.expandShortcut(expansionInput)
    await value.api.expandShortcut({ ...expansionInput, prompt: "另一条固定提示词" })
    expect(value.mode.enabled).toBe(enabled === true)
    expect(value.calls.filter((call) => call.path === "/studio/prompt-expansions").map((call) => call.body)).toEqual([
      expect.objectContaining({ ...expansionInput, guidePartID: "guide-1" }),
      expect.objectContaining({ ...expansionInput, prompt: "另一条固定提示词", guidePartID: "guide-2" }),
    ])
    expect(value.calls.some((call) => call.path.endsWith("/dismiss"))).toBe(false)
    expect(value.calls.filter((call) => call.path === "/studio/prompt-recommendations").map((call) => call.body))
      .toEqual([expect.objectContaining({ showGuide: false }), expect.objectContaining({ showGuide: false })])
  } finally { value.dispose() }
})

test.each(["running", "cancelling"])("shortcut expansion is blocked while an expansion is %s", async (status) => {
  const value = modeSetup({ enabled: false, status })
  try {
    await Bun.sleep(0)
    await value.api.expandShortcut(expansionInput)
    expect(value.calls.every((call) => call.body === undefined)).toBe(true)
    expect(value.mode.enabled).toBe(false)
  } finally { value.dispose() }
})

test("shortcut preparation ignores mode exit and rejects duplicate clicks", async () => {
  const gate = Promise.withResolvers<void>()
  const value = modeSetup({ waitInitialize: gate.promise })
  try {
    await Bun.sleep(0)
    const expanding = value.api.expandShortcut(expansionInput)
    await Bun.sleep(0)
    expect(value.api.busy()).toBe(true)
    await value.api.exit()
    await value.api.expandShortcut({ ...expansionInput, prompt: "重复点击" })
    gate.resolve()
    await expanding
    expect(value.mode.enabled).toBe(false)
    expect(value.calls.filter((call) => call.path === "/studio/prompt-expansions").map((call) => call.body))
      .toEqual([expect.objectContaining({ prompt: expansionInput.prompt })])
  } finally { gate.resolve(); value.dispose() }
})

test("shortcut preparation can still be cancelled while recommendation mode is off", async () => {
  const gate = Promise.withResolvers<void>()
  const value = modeSetup({ enabled: false, waitInitialize: gate.promise })
  try {
    await Bun.sleep(0)
    const expanding = value.api.expandShortcut(expansionInput)
    await Bun.sleep(0)
    await value.api.cancel()
    gate.resolve()
    await expanding
    await Bun.sleep(0)
    expect(value.calls.some((call) => call.path === "/studio/prompt-expansions")).toBe(false)
    expect(value.api.armed()).toBe(false)
    expect(value.mode.enabled).toBe(false)
  } finally { gate.resolve(); value.dispose() }
})

test.each([true, false])("shortcut response recovery preserves mode off (accepted=%s)", async (accepted) => {
  const value = modeSetup({ enabled: false, loseSubmitResponse: accepted, loseUnacceptedSubmitResponse: !accepted })
  try {
    await Bun.sleep(0)
    await value.api.expandShortcut(expansionInput)
    expect(value.api.state()?.unknown).toBe(true)
    await value.api.expandShortcut({ ...expansionInput, prompt: "另一个按钮" })
    const submissions = value.calls.filter((call) => call.path === "/studio/prompt-expansions")
    expect(submissions).toHaveLength(accepted ? 1 : 2)
    if (!accepted) expect(submissions[1]?.body).toEqual(submissions[0]?.body)
    expect(value.mode.enabled).toBe(false)
    expect(value.api.state()?.unknown).toBe(false)
  } finally { value.dispose() }
})

test("persistent mode prepares a distinct silent guide for every subsequent expansion", async () => {
  const value = modeSetup()
  try {
    await Bun.sleep(0)
    let cleared = 0
    await value.api.expand(expansionInput, () => {
      cleared++
    })
    await value.api.expand(expansionInput, () => {
      cleared++
    })
    expect(cleared).toBe(2)
    expect(value.mode.enabled).toBe(true)
    expect(
      value.calls.filter((call) => call.path === "/studio/prompt-recommendations").map((call) => call.body),
    ).toEqual([expect.objectContaining({ showGuide: false }), expect.objectContaining({ showGuide: false })])
    expect(value.calls.filter((call) => call.path === "/studio/prompt-expansions").map((call) => call.body)).toEqual([
      expect.objectContaining({ guidePartID: "guide-1" }),
      expect.objectContaining({ guidePartID: "guide-2" }),
    ])
    expect(value.api.armed()).toBe(false)
  } finally {
    value.dispose()
  }
})

test("exit releases armed but does not cancel an accepted expansion", async () => {
  for (const status of ["armed", "running"]) {
    const value = modeSetup({ status })
    try {
      await Bun.sleep(0)
      await value.api.exit()
      expect(value.mode.enabled).toBe(false)
      expect(value.calls.some((call) => call.path.endsWith("/dismiss"))).toBe(status === "armed")
      expect(value.calls.some((call) => call.path.endsWith("/cancel"))).toBe(false)
      expect(value.api.busy()).toBe(status === "running")
    } finally {
      value.dispose()
    }
  }
})

test("exit during silent preparation releases its late guide without submitting or clearing", async () => {
  const gate = Promise.withResolvers<void>()
  const value = modeSetup({ waitInitialize: gate.promise })
  try {
    await Bun.sleep(0)
    let cleared = false
    const expanding = value.api.expand(expansionInput, () => {
      cleared = true
    })
    await Bun.sleep(0)
    await value.api.exit()
    gate.resolve()
    await expanding
    await Bun.sleep(0)
    expect(value.mode.enabled).toBe(false)
    expect(value.calls.some((call) => call.path === "/studio/prompt-expansions")).toBe(false)
    expect(value.calls.some((call) => call.path.endsWith("/dismiss"))).toBe(true)
    expect(value.api.armed()).toBe(false)
    expect(cleared).toBe(false)
  } finally {
    gate.resolve()
    value.dispose()
  }
})

test("exit during image upload preserves the draft and prevents submission", async () => {
  const gate = Promise.withResolvers<void>()
  const value = modeSetup({ status: "armed", waitUpload: gate.promise })
  try {
    await Bun.sleep(0)
    let cleared = false
    const expanding = value.api.expand({ ...expansionInput, images: [{ mime: "image/png", base64: "abc" }] }, () => {
      cleared = true
    })
    await Bun.sleep(0)
    await value.api.exit()
    gate.resolve()
    await expanding
    await Bun.sleep(0)
    expect(value.calls.some((call) => call.path === "/studio/prompt-expansions")).toBe(false)
    expect(value.api.armed()).toBe(false)
    expect(cleared).toBe(false)
  } finally {
    gate.resolve()
    value.dispose()
  }
})

test("a lost accepted response recovers the original request before another expansion", async () => {
  const value = modeSetup({ loseSubmitResponse: true })
  try {
    await Bun.sleep(0)
    let cleared = 0
    await value.api.expand(expansionInput, () => {
      cleared++
    })
    expect(value.api.state()?.unknown).toBe(true)
    await value.api.expand(expansionInput, () => {
      cleared++
    })
    expect(value.calls.filter((call) => call.path === "/studio/prompt-expansions")).toHaveLength(1)
    expect(cleared).toBe(1)
    expect(value.api.state()?.unknown).toBe(false)
    expect(value.mode.enabled).toBe(true)
  } finally {
    value.dispose()
  }
})

test("a lost dismiss response stays closed and can be recovered idempotently", async () => {
  const value = modeSetup({ status: "armed", loseDismissResponse: true })
  try {
    await Bun.sleep(0)
    await value.api.exit()
    expect(value.mode.enabled).toBe(false)
    expect(value.api.exiting()).toBe(true)
    expect(value.api.state()?.unknown).toBe(true)
    await value.api.recover()
    expect(value.api.exiting()).toBe(false)
    expect(value.api.state()?.unknown).toBe(false)
    expect(value.api.armed()).toBe(false)
    expect(value.mode.enabled).toBe(false)
  } finally {
    value.dispose()
  }
})

test("stopping during upload cancels the pending send while retaining recommendation mode", async () => {
  const gate = Promise.withResolvers<void>()
  const value = modeSetup({ status: "armed", waitUpload: gate.promise })
  try {
    await Bun.sleep(0)
    let cleared = false
    const expanding = value.api.expand({ ...expansionInput, images: [{ mime: "image/png", base64: "abc" }] }, () => {
      cleared = true
    })
    await Bun.sleep(0)
    await value.api.cancel()
    gate.resolve()
    await expanding
    await Bun.sleep(0)
    expect(value.mode.enabled).toBe(true)
    expect(value.calls.some((call) => call.path === "/studio/prompt-expansions")).toBe(false)
    expect(value.api.armed()).toBe(true)
    expect(cleared).toBe(false)
  } finally {
    gate.resolve()
    value.dispose()
  }
})

test("closing while the first blank-page initialization is pending migrates the closed intent", async () => {
  const scope = crypto.randomUUID()
  const blank = JSON.stringify([scope, "blank"])
  const session = JSON.stringify([scope, "session"])
  const [state, setState] = createStore<{ id?: string; modes: Record<string, boolean> }>({ modes: {} })
  const gate = Promise.withResolvers<void>()
  let status = "armed"
  let dispose = () => {}
  const api = createRoot((cleanup) => {
    dispose = cleanup
    return createPromptRecommendation({
      scope: () => scope,
      sessionID: () => state.id,
      revision: () => "",
      mode: {
        ready: () => true,
        enabled: (key) => state.modes[key],
        save: (key, enabled) => setState("modes", key, enabled),
      },
      request: async (path, body) => {
        if (path === "/studio/prompt-recommendations") await gate.promise
        if (path.endsWith("/dismiss")) status = "dismissed"
        return Response.json(
          body === undefined
            ? { stateToken: "token", recommendation: { ...guide, status } }
            : { ...guide, status, stateToken: "token" },
        )
      },
      uploadImage: async () => ({ path: "/uploaded" }),
      reload: async () => {},
      navigate: (id) => setState("id", id),
      notice: () => {},
    })
  })
  try {
    await Bun.sleep(0)
    const initializing = api.initialize()
    await Bun.sleep(0)
    await api.exit()
    gate.resolve()
    await initializing
    await Bun.sleep(0)
    expect(state.id).toBe("session")
    expect(state.modes[session]).toBe(false)
    expect(state.modes[blank]).toBe(false)
    expect(api.armed()).toBe(false)
    expect(status).toBe("dismissed")
  } finally {
    gate.resolve()
    dispose()
  }
})

test.each([false, true])(
  "sending after failed blank-page initialization preserves the draft until acceptance (reject=%s)",
  async (reject) => {
    const scope = crypto.randomUUID()
    const [state, setState] = createStore<{ id?: string; modes: Record<string, boolean> }>({ modes: {} })
    const calls: { path: string; body: unknown }[] = []
    let initializations = 0
    let draft = "城市"
    let assets = ["reference"]
    let cleared = 0
    let preserved = false
    let dispose = () => {}
    const api = createRoot((cleanup) => {
      dispose = cleanup
      return createPromptRecommendation({
        scope: () => scope,
        sessionID: () => state.id,
        revision: () => "",
        mode: {
          ready: () => true,
          enabled: (key) => state.modes[key],
          save: (key, enabled) => setState("modes", key, enabled),
        },
        request: async (path, body) => {
          calls.push({ path, body })
          if (path === "/studio/prompt-recommendations" && ++initializations === 1)
            return Response.json({ data: { code: "PREPARATION_TIMEOUT" } }, { status: 503 })
          if (path === "/studio/prompt-expansions" && reject)
            return Response.json({ data: { code: "INVALID_INPUT" } }, { status: 400 })
          return Response.json(
            body === undefined
              ? { stateToken: "token", recommendation: guide }
              : { ...guide, stateToken: "token", status: path === "/studio/prompt-expansions" ? "running" : "armed" },
          )
        },
        uploadImage: async (id) => {
          expect(id).toBe("session")
          return { path: "/uploaded/reference.png" }
        },
        reload: async () => {},
        navigate: (id, preserveDraft) => {
          // Mirror the page's session-change draft reset.
          preserved = preserveDraft === true
          if (!preserveDraft) {
            draft = ""
            assets = []
          }
          setState("id", id)
        },
        notice: () => {},
      })
    })
    try {
      await Bun.sleep(0)
      await api.initialize()
      expect(state.id).toBeUndefined()
      await api.expand(
        { ...expansionInput, images: [{ mime: "image/png", base64: "reference" }] },
        (acceptedSession) => {
          expect(acceptedSession).toBe("session")
          expect(state.id).toBe(acceptedSession)
          expect(draft).toBe("城市")
          expect(assets).toEqual(["reference"])
          cleared++
          draft = ""
          assets = []
        },
      )
      expect(preserved).toBe(true)
      expect(calls.filter((call) => call.path === "/studio/prompt-expansions").map((call) => call.body)).toEqual([
        expect.objectContaining({
          sessionID: "session",
          guidePartID: "guide",
          prompt: "城市",
          images: [{ path: "/uploaded/reference.png" }],
        }),
      ])
      expect(cleared).toBe(reject ? 0 : 1)
      expect(draft).toBe(reject ? "城市" : "")
      expect(assets).toEqual(reject ? ["reference"] : [])
      expect(state.modes[JSON.stringify([scope, "session"])]).toBe(true)
      expect(api.busy()).toBe(false)
    } finally {
      dispose()
    }
  },
)

test.each(["accepted-with-events", "accepted-without-events", "not-accepted", "new-task-after-recovery"] as const)(
  "stopping a submission with a lost response survives recovery: %s",
  async (scenario) => {
    const scope = crypto.randomUUID()
    const gate = Promise.withResolvers<void>()
    const [mode, setMode] = createStore({ enabled: true, revision: "" })
    let server: typeof guide & { assistantMessageID?: string; submission?: { requestID: string } } = { ...guide }
    let cancels = 0
    let submissions = 0
    let failRead = false
    let dispose = () => {}
    const api = createRoot((cleanup) => {
      dispose = cleanup
      return createPromptRecommendation({
        scope: () => scope,
        sessionID: () => "session",
        revision: () => mode.revision,
        mode: { ready: () => true, enabled: () => mode.enabled, save: (_key, enabled) => setMode("enabled", enabled) },
        request: async (path, body) => {
          if (body === undefined && failRead) {
            failRead = false
            throw new Error("state unavailable")
          }
          if (path === "/studio/prompt-expansions") {
            submissions++
            await gate.promise
            if (scenario !== "not-accepted")
              server = {
                ...server,
                status: "running",
                assistantMessageID: "expansion",
                submission: { requestID: (body as { requestID: string }).requestID },
              }
            if (scenario === "accepted-with-events") {
              setMode("revision", "running")
              await Bun.sleep(0)
            }
            throw new Error("response lost")
          }
          if (scenario === "new-task-after-recovery" && body === undefined && server.submission) {
            const recommendation = path.includes("guidePartID=")
              ? { ...server, status: "completed" }
              : {
                  ...server,
                  guidePartID: "next-guide",
                  assistantMessageID: "next-expansion",
                  status: "running",
                  submission: { requestID: "next-request" },
                }
            return Response.json({ stateToken: "next-token", recommendation })
          }
          if (path.endsWith("/cancel")) {
            cancels++
            server = { ...server, status: "cancelled" }
          }
          if (path.endsWith("/dismiss")) server = { ...server, status: "dismissed" }
          return Response.json(
            body === undefined ? { stateToken: "token", recommendation: server } : { ...server, stateToken: "token" },
          )
        },
        uploadImage: async () => ({ path: "/uploaded" }),
        reload: async () => {},
        navigate: () => {},
        notice: () => {},
      })
    })
    try {
      await Bun.sleep(0)
      const submission = api.expand(expansionInput, () => {})
      await Bun.sleep(0)
      await api.cancel()
      gate.resolve()
      await submission
      await Bun.sleep(0)
      if (scenario === "accepted-without-events") {
        failRead = true
        await expect(api.recover()).rejects.toThrow("state unavailable")
        expect(api.state()?.cancelRequested).toBe(true)
        expect(cancels).toBe(0)
      }
      await api.recover()
      await Bun.sleep(0)
      expect(cancels).toBe(scenario === "not-accepted" || scenario === "new-task-after-recovery" ? 0 : 1)
      expect(submissions).toBe(1)
      expect(api.state()?.cancelRequested).toBe(false)
      expect(api.state()?.state?.recommendation?.status).toBe(
        scenario === "not-accepted" ? "dismissed" : scenario === "new-task-after-recovery" ? "running" : "cancelled",
      )
      expect(mode.enabled).toBe(true)
    } finally {
      gate.resolve()
      dispose()
    }
  },
)

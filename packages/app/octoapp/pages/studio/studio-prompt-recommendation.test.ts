import { expect, test } from "bun:test"
import { createRoot } from "solid-js"
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

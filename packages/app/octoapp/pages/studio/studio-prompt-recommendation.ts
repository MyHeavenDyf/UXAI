import { createEffect, createMemo, onCleanup, on, untrack } from "solid-js"
import { createStore } from "solid-js/store"
import z from "zod"

const summary = z.object({
  sessionID: z.string(),
  guidePartID: z.string(),
  guideMessageID: z.string(),
  guideRevision: z.number(),
  resultRevision: z.number().optional(),
  assistantMessageID: z.string().optional(),
  submission: z.object({ requestID: z.string() }).optional(),
  status: z.enum(["armed", "running", "cancelling", "completed", "failed", "cancelled"]),
})
const stateSchema = z.object({ stateToken: z.string(), recommendation: summary.nullable() })
const responseSchema = summary.extend({ stateToken: z.string() })
const pendingSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("initialize"),
    requestID: z.string(),
    sessionID: z.string().optional(),
    expectedStateToken: z.string().optional(),
  }),
  z.object({ kind: z.literal("submit"), requestID: z.string(), sessionID: z.string(), guidePartID: z.string() }),
])
type Pending = z.infer<typeof pendingSchema>
type Submission = {
  requestID: string
  sessionID: string
  guidePartID: string
  prompt: string
  images: { mime: string; base64: string }[]
  availableModels: { providerID: string; modelID: string }[]
}

type UploadedSubmission = Omit<Submission, "images"> & { images: { path: string }[] }

export function createPromptRecommendation(input: {
  sessionID: () => string | undefined
  scope: () => string
  revision: () => string
  request: (path: string, body?: unknown, timeoutMs?: number) => Promise<Response>
  uploadImage: (sessionID: string, image: Submission["images"][number]) => Promise<{ path: string }>
  reload: (sessionID: string) => Promise<unknown>
  navigate: (sessionID: string) => void
  notice: (message: string) => void
}) {
  const [store, setStore] = createStore<
    Record<string, { ready: boolean; pending: boolean; unknown: boolean; state?: z.infer<typeof stateSchema> }>
  >({})
  const key = () => JSON.stringify([input.scope(), input.sessionID() ?? "blank"])
  const storageKey = () =>
    `studio.prompt-recommendation.pending:${JSON.stringify([input.scope(), input.sessionID() ?? "blank"])}`
  let sequence = 0
  let disposed = false
  let replay: UploadedSubmission | undefined
  const uploads = new Map<string, { path: string }>()
  let clearReplay: (() => void) | undefined
  const current = createMemo(() => store[key()])
  const save = (value?: Pending) =>
    value ? sessionStorage.setItem(storageKey(), JSON.stringify(value)) : sessionStorage.removeItem(storageKey())
  const pending = () => {
    const parsed = pendingSchema.safeParse(JSON.parse(sessionStorage.getItem(storageKey()) ?? "null"))
    return parsed.success ? parsed.data : undefined
  }
  async function json(path: string, body?: unknown) {
    const response = await input.request(path, body, body === undefined ? 5_000 : 35_000)
    const value: unknown = await response.json()
    if (!response.ok) {
      const error = z.object({ data: z.object({ code: z.string() }) }).safeParse(value)
      throw Object.assign(new Error(error.success ? error.data.data.code : "REQUEST_FAILED"), {
        status: response.status,
      })
    }
    return value
  }
  async function refresh() {
    const id = input.sessionID()
    const target = key()
    const token = ++sequence
    if (!id) {
      setStore(target, { ready: true, pending: false, unknown: false })
      return
    }
    try {
      const state = stateSchema.parse(await json(`/studio/sessions/${encodeURIComponent(id)}/prompt-recommendation`))
      if (disposed || token !== sequence || target !== key()) return
      const previous = store[target]?.state?.recommendation
      if (
        previous?.guidePartID === state.recommendation?.guidePartID &&
        ((previous?.guideRevision ?? 0) > (state.recommendation?.guideRevision ?? 0) ||
          (previous?.resultRevision ?? 0) > (state.recommendation?.resultRevision ?? 0))
      )
        return
      setStore(target, "state", state)
      setStore(target, "ready", true)
      await input.reload(id)
    } catch (error) {
      if (disposed || token !== sequence || target !== key()) throw error
      const active = store[target]?.state?.recommendation?.status
      if (
        !pending() &&
        !store[target]?.pending &&
        !store[target]?.unknown &&
        !["armed", "running", "cancelling"].includes(active ?? "")
      ) {
        const ready = store[target]?.ready
        setStore(target, "ready", true)
        if (!ready) input.notice("推荐状态读取失败，已按普通生图模式继续。")
      }
      throw error
    }
  }

  async function initialize(resume?: Extract<Pending, { kind: "initialize" }>) {
    const target = key()
    if (store[target]?.pending) return
    const operationScope = input.scope()
    let submitted = false
    setStore(target, "pending", true)
    try {
      const id = input.sessionID()
      if (!resume && id) await refresh()
      const request = resume ?? {
        kind: "initialize" as const,
        requestID: crypto.randomUUID(),
        ...(id ? { sessionID: id, expectedStateToken: store[target]?.state?.stateToken } : {}),
      }
      save(request)
      submitted = true
      const result = responseSchema.parse(
        await json("/studio/prompt-recommendations", {
          requestID: request.requestID,
          sessionID: request.sessionID,
          expectedStateToken: request.expectedStateToken,
        }),
      )
      if (disposed || operationScope !== input.scope() || target !== key()) return
      save()
      setStore(target, "unknown", false)
      setStore(JSON.stringify([operationScope, result.sessionID]), {
        ready: true, pending: result.sessionID === input.sessionID(), unknown: false,
        state: { stateToken: result.stateToken, recommendation: result },
      })
      input.navigate(result.sessionID)
      await input.reload(result.sessionID).catch(() => input.notice("推荐已开启，消息同步失败，请重新同步会话。"))
      await refresh().catch(() => input.notice("推荐已开启，状态同步失败，请重新同步会话。"))
    } catch (error) {
      if (operationScope !== input.scope() || target !== key()) return
      if (!submitted) {
        if (!pending() && !store[target]?.unknown && !store[target]?.state?.recommendation)
          setStore(target, "ready", true)
        input.notice("暂时无法开启推荐，请稍后重试。")
        return
      }
      if (error instanceof Error && "status" in error) {
        save()
        setStore(target, "unknown", false)
        await refresh().catch(() => {})
        input.notice(
          error.message === "PREPARATION_TIMEOUT"
            ? "推荐初始化准备超时，本次未受理，请重试。"
            : error.message.includes("RECOMMENDATION_")
              ? "推荐状态已更新，已同步当前会话。"
              : "暂时无法开启推荐，请稍后再试。",
        )
      } else {
        setStore(target, "unknown", true)
        input.notice("初始化结果待确认，请点击 AI推荐恢复原请求。")
      }
    } finally {
      setStore(target, "pending", false)
    }
  }
  async function submit(value: Omit<Submission, "requestID" | "sessionID" | "guidePartID">, clear: () => void) {
    const target = key()
    const id = input.sessionID()
    const guide = current()?.state?.recommendation
    if (!id || !guide || store[target]?.pending) return
    const operationScope = input.scope()
    const original = replay?.sessionID === id && replay.guidePartID === guide.guidePartID ? replay : undefined
    const clearAccepted = original ? clearReplay : clear
    setStore(target, "pending", true)
    let submitted = false
    try {
      const request = original ?? {
        ...value,
        requestID: crypto.randomUUID(),
        sessionID: id,
        guidePartID: guide.guidePartID,
        images: await (async () => {
          const images = []
          for (const image of value.images) {
            const cacheKey = JSON.stringify([operationScope, id, image.mime, image.base64])
            const uploaded = uploads.get(cacheKey) ?? (await input.uploadImage(id, image))
            if (disposed || operationScope !== input.scope() || target !== key()) return []
            uploads.set(cacheKey, uploaded)
            images.push(uploaded)
          }
          return images
        })(),
      }
      if (disposed || operationScope !== input.scope() || target !== key()) return
      save({ kind: "submit", requestID: request.requestID, sessionID: id, guidePartID: request.guidePartID })
      replay = request
      clearReplay = clearAccepted
      submitted = true
      const result = responseSchema.parse(await json("/studio/prompt-expansions", request))
      if (disposed || operationScope !== input.scope() || target !== key()) return
      clearAccepted?.()
      uploads.clear()
      clearReplay = undefined
      replay = undefined
      save()
      setStore(target, "unknown", false)
      setStore(target, "state", { stateToken: result.stateToken, recommendation: result })
      await refresh().catch(() => input.notice("扩写已受理，状态同步失败，请重新同步会话。"))
    } catch (error) {
      if (operationScope !== input.scope() || target !== key()) return
      if (!submitted) {
        input.notice("参考图上传或提交准备失败，保留了输入，请重试。")
        return
      }
      if (error instanceof Error && "status" in error) {
        replay = undefined
        if (error.message === "ATTACHMENT_READ_FAILED") uploads.clear()
        save()
        setStore(target, "unknown", false)
        await refresh().catch(() => {})
        const messages: Record<string, string> = {
          NO_ELIGIBLE_MODEL: "当前启用的模型中没有支持本次输入的扩写模型；带参考图时需要支持图片理解的模型。",
          INVALID_INPUT: "扩写未受理：文字或参考图格式不符合要求，请检查输入。",
          SESSION_BUSY: "当前会话正在处理其他任务，请完成或取消后重试。",
          INVALID_RECOMMENDATION_STATE: "当前推荐已使用，请重新点击 AI推荐后提交。",
          RECOMMENDATION_NOT_FOUND: "当前推荐已失效，请重新点击 AI推荐后提交。",
          SESSION_NOT_FOUND: "当前会话不可用，请重新打开会话后重试。",
          IDEMPOTENCY_CONFLICT: "本次重试与原提交内容不一致，请同步推荐状态后重试。",
          PAYLOAD_TOO_LARGE: "参考图请求过大，请减少图片数量或大小后重试。",
          CAPACITY_EXCEEDED: "当前扩写请求较多，请稍后重试。",
          ATTACHMENT_READ_FAILED: "参考图读取失败，请重新上传参考图后重试。",
          PREPARATION_TIMEOUT: "扩写准备超时，本次未受理，请重试。",
          REQUEST_CANCELLED: "扩写请求已取消，本次未受理。",
          MODEL_REQUEST_FAILED: "扩写模型暂时不可用，请检查模型配置后重试。",
        }
        input.notice(messages[error.message] ?? `扩写未受理（${error.status} / ${error.message}），请稍后重试。`)
      } else {
        setStore(target, "unknown", true)
        input.notice("提交结果待确认，保留了本次输入；再次发送将核实原请求。")
      }
    } finally {
      setStore(target, "pending", false)
    }
  }
  async function recover() {
    const target = key()
    const operation = pending()
    if (!operation) return refresh()
    if (operation.kind === "initialize") {
      if (operation.sessionID && operation.sessionID !== input.sessionID()) return refresh()
      return initialize(operation)
    }
    if (operation.sessionID !== input.sessionID()) return refresh()
    const response = stateSchema.parse(
      await json(
        `/studio/sessions/${encodeURIComponent(operation.sessionID)}/prompt-recommendation?guidePartID=${encodeURIComponent(operation.guidePartID)}`,
      ),
    )
    if (disposed || target !== key()) return
    if (response.recommendation?.submission) {
      if (response.recommendation.submission.requestID === operation.requestID) clearReplay?.()
      else input.notice("本次推荐已由其他提交使用，保留了当前输入。")
      save()
      replay = undefined
      clearReplay = undefined
      setStore(target, "unknown", false)
    } else {
      setStore(key(), "unknown", true)
      input.notice("上次提交尚待确认。再次发送将重放原请求；刷新后请重新确认输入再提交。")
    }
    await refresh()
  }
  createEffect(
    on(
      () => [input.scope(), input.sessionID()] as const,
      () => {
        replay = undefined
        clearReplay = undefined
        uploads.clear()
        sequence++
        setStore(key(), { ...store[key()], ready: !input.sessionID(), pending: false, unknown: store[key()]?.unknown ?? false })
        const target = key()
        void untrack(recover).catch(() => {
          if (disposed || target !== key()) return
          if (pending() || store[target]?.unknown) {
            setStore(target, "ready", false)
            setStore(target, "unknown", true)
            input.notice("上次推荐请求仍待确认，请重新同步会话。")
          }
        })
      },
    ),
  )
  createEffect(
    on(
      input.revision,
      () => {
        if (!input.sessionID()) return
        void untrack(refresh).catch(() => {})
      },
      { defer: true },
    ),
  )
  const reconnect = () => void recover().catch(() => {})
  window.addEventListener("online", reconnect)
  window.addEventListener("focus", reconnect)
  onCleanup(() => {
    disposed = true
    sequence++
    window.removeEventListener("online", reconnect)
    window.removeEventListener("focus", reconnect)
  })
  return {
    state: current,
    armed: () => current()?.state?.recommendation?.status === "armed",
    busy: () =>
      Boolean(current()?.pending || ["running", "cancelling"].includes(current()?.state?.recommendation?.status ?? "")),
    ready: () => Boolean(current()?.ready),
    initialize: () => {
      const old = pending()
      return initialize(old?.kind === "initialize" ? old : undefined)
    },
    submit,
    recover,
    cancel: async () => {
      const guide = current()?.state?.recommendation
      if (!guide?.assistantMessageID) return
      await json(
        `/studio/sessions/${encodeURIComponent(guide.sessionID)}/prompt-expansions/${encodeURIComponent(guide.assistantMessageID)}/cancel`,
        {},
      )
      await refresh()
    },
  }
}

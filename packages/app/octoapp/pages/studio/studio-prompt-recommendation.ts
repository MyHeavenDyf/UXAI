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
  status: z.enum(["armed", "running", "cancelling", "completed", "failed", "cancelled", "dismissed"]),
})
const stateSchema = z.object({ stateToken: z.string(), recommendation: summary.nullable() })
const responseSchema = summary.extend({ stateToken: z.string() })
const pendingSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("initialize"),
    requestID: z.string(),
    sessionID: z.string().optional(),
    expectedStateToken: z.string().optional(),
    showGuide: z.boolean().optional(),
  }),
  z.object({ kind: z.literal("dismiss"), sessionID: z.string(), guidePartID: z.string() }),
  z.object({
    kind: z.literal("submit"),
    requestID: z.string(),
    sessionID: z.string(),
    guidePartID: z.string(),
    independent: z.boolean().optional(),
  }),
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
  navigate: (sessionID: string, preserveDraft?: boolean) => void
  notice: (message: string) => void
  mode?: {
    ready: () => boolean
    enabled: (key: string) => boolean | undefined
    save: (key: string, enabled: boolean) => void
  }
}) {
  const [store, setStore] = createStore<
    Record<
      string,
      {
        ready: boolean
        pending: boolean
        unknown: boolean
        preparing?: boolean
        independent?: boolean
        exiting?: boolean
        cancelRequested?: boolean
        cancelGuidePartID?: string
        cancelling?: boolean
        recovering?: boolean
        state?: z.infer<typeof stateSchema>
      }
    >
  >({})
  const key = () => JSON.stringify([input.scope(), input.sessionID() ?? "blank"])
  const storageKey = (target = key()) => `studio.prompt-recommendation.pending:${target}`
  let sequence = 0
  let disposed = false
  let replay: UploadedSubmission | undefined
  const uploads = new Map<string, { path: string }>()
  let clearReplay: ((sessionID?: string) => void) | undefined
  const current = createMemo(() => store[key()])
  const visit = createMemo(() => ({ key: key() }))
  const versions = new Map<string, number>()
  const recoveries = new Map<string, number>()
  const save = (value?: Pending, target = key()) =>
    value
      ? sessionStorage.setItem(storageKey(target), JSON.stringify(value))
      : sessionStorage.removeItem(storageKey(target))
  const pending = (target = key()) => {
    const parsed = pendingSchema.safeParse(JSON.parse(sessionStorage.getItem(storageKey(target)) ?? "null"))
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
      setStore(target, {
        ...store[target],
        ready: true,
        pending: store[target]?.pending ?? false,
        unknown: store[target]?.unknown ?? false,
      })
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
      if (!pending(target)) {
        setStore(target, "unknown", false)
        setStore(target, "exiting", false)
      }
      await input.reload(id)
    } catch (error) {
      if (disposed || token !== sequence || target !== key()) throw error
      const active = store[target]?.state?.recommendation?.status
      if (
        input.mode?.enabled(target) !== true &&
        !pending(target) &&
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

  async function initialize(
    resume?: Extract<Pending, { kind: "initialize" }>,
    showGuide = true,
    continuation?: { target: string; visit: ReturnType<typeof visit>; version: number | undefined; independent: boolean },
  ) {
    const target = key()
    if (store[target]?.pending) return
    const operationScope = input.scope()
    const operationVisit = visit()
    let submitted = false
    setStore(target, "pending", true)
    try {
      const id = input.sessionID()
      if (!resume && id) await refresh()
      if (disposed || operationScope !== input.scope() || operationVisit !== visit()) return
      if (!resume && !continuation?.independent && input.mode?.enabled(target) === false) return
      const request = resume ?? {
        kind: "initialize" as const,
        requestID: crypto.randomUUID(),
        ...(showGuide ? {} : { showGuide: false }),
        ...(id ? { sessionID: id, expectedStateToken: store[target]?.state?.stateToken } : {}),
      }
      save(request, target)
      submitted = true
      const result = responseSchema.parse(
        await json("/studio/prompt-recommendations", {
          requestID: request.requestID,
          sessionID: request.sessionID,
          expectedStateToken: request.expectedStateToken,
          showGuide: request.showGuide,
        }),
      )
      if (disposed || operationScope !== input.scope()) return
      save(undefined, target)
      setStore(target, "unknown", false)
      const destination = JSON.stringify([operationScope, result.sessionID])
      if (input.mode && destination !== target) {
        input.mode.save(destination, input.mode.enabled(target) === true)
        input.mode.save(target, false)
      }
      const continuing = Boolean(
        continuation && continuation.visit === visit() && continuation.version === versions.get(target),
      )
      setStore(destination, {
        ...store[destination],
        preparing: continuing || store[destination]?.preparing,
        independent: continuing ? continuation?.independent : store[destination]?.independent,
        ready: true,
        pending: destination === target,
        unknown: false,
        state: { stateToken: result.stateToken, recommendation: result },
      })
      if (target !== key() || operationVisit !== visit()) return result
      input.navigate(result.sessionID, Boolean(continuation) || request.showGuide === false)
      if (continuation && continuing) {
        continuation.target = destination
        continuation.visit = visit()
        continuation.version = versions.get(destination)
      }
      await input.reload(result.sessionID).catch(() => input.notice("推荐已开启，消息同步失败，请重新同步会话。"))
      await refresh().catch(() => input.notice("推荐已开启，状态同步失败，请重新同步会话。"))
      return result
    } catch (error) {
      if (operationScope !== input.scope() || target !== key()) return
      if (!submitted) {
        if (!pending() && !store[target]?.unknown && !store[target]?.state?.recommendation)
          setStore(target, "ready", true)
        input.notice("暂时无法开启推荐，请稍后重试。")
        return
      }
      if (error instanceof Error && "status" in error) {
        save(undefined, target)
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
        input.notice("初始化结果待确认，请重新同步推荐状态。")
      }
    } finally {
      setStore(target, "pending", false)
    }
  }
  async function submit(
    value: Omit<Submission, "requestID" | "sessionID" | "guidePartID">,
    clear: (sessionID?: string) => void,
    independent = false,
  ) {
    const target = key()
    const id = input.sessionID()
    const guide = current()?.state?.recommendation
    if (!id || !guide || store[target]?.pending) return
    const operationScope = input.scope()
    const operationVisit = visit()
    const version = versions.get(target)
    const original = replay?.sessionID === id && replay.guidePartID === guide.guidePartID ? replay : undefined
    const clearAccepted = original ? clearReplay : clear
    setStore(target, "pending", true)
    let submitted = false
    try {
      const previous = pending(target)
      const request = original ?? {
        ...value,
        requestID:
          previous?.kind === "submit" && previous.guidePartID === guide.guidePartID
            ? previous.requestID
            : crypto.randomUUID(),
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
      if (
        disposed ||
        operationScope !== input.scope() ||
        target !== key() ||
        operationVisit !== visit() ||
        version !== versions.get(target) ||
        (!independent && input.mode?.enabled(target) === false)
      )
        return
      save({
        kind: "submit", requestID: request.requestID, sessionID: id, guidePartID: request.guidePartID,
        ...(independent ? { independent: true } : {}),
      }, target)
      replay = request
      clearReplay = clearAccepted
      submitted = true
      const result = responseSchema.parse(await json("/studio/prompt-expansions", request))
      if (disposed || operationScope !== input.scope() || target !== key()) return
      clearAccepted?.(id)
      uploads.clear()
      clearReplay = undefined
      replay = undefined
      save(undefined, target)
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
        save(undefined, target)
        setStore(target, "unknown", false)
        await refresh().catch(() => {})
        const messages: Record<string, string> = {
          NO_ELIGIBLE_MODEL: "当前启用的模型中没有支持本次输入的扩写模型；带参考图时需要支持图片理解的模型。",
          INVALID_INPUT: "扩写未受理：文字或参考图格式不符合要求，请检查输入。",
          SESSION_BUSY: "当前会话正在处理其他任务，请完成或取消后重试。",
          INVALID_RECOMMENDATION_STATE: "当前推荐已使用，请重试。",
          RECOMMENDATION_NOT_FOUND: "当前推荐已失效，请重试。",
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
    recoveries.set(target, (recoveries.get(target) ?? 0) + 1)
    setStore(target, "recovering", true)
    try {
      const operation = pending()
      if (!operation) return await refresh()
      if (operation.kind === "initialize") {
        if (operation.sessionID && operation.sessionID !== input.sessionID()) return await refresh()
        return await initialize(operation)
      }
      if (operation.sessionID !== input.sessionID()) return await refresh()
      if (operation.kind === "dismiss") return await dismiss(operation)
      const response = stateSchema.parse(
        await json(
          `/studio/sessions/${encodeURIComponent(operation.sessionID)}/prompt-recommendation?guidePartID=${encodeURIComponent(operation.guidePartID)}`,
        ),
      )
      if (disposed || target !== key()) return
      if (response.recommendation?.submission) {
        if (response.recommendation.submission.requestID === operation.requestID) clearReplay?.(operation.sessionID)
        else input.notice("本次推荐已由其他提交使用，保留了当前输入。")
        save(undefined, target)
        replay = undefined
        clearReplay = undefined
        setStore(target, "unknown", false)
      } else if ((!operation.independent && input.mode?.enabled(target) === false) || store[target]?.cancelRequested) {
        save(undefined, target)
        replay = undefined
        clearReplay = undefined
        setStore(target, "unknown", false)
        if (response.recommendation?.status === "armed")
          await dismiss({ kind: "dismiss", sessionID: operation.sessionID, guidePartID: operation.guidePartID })
      } else {
        setStore(key(), "unknown", true)
        input.notice("上次提交尚待确认。再次发送将重放原请求；刷新后请重新确认输入再提交。")
      }
      await refresh()
    } finally {
      const remaining = (recoveries.get(target) ?? 1) - 1
      if (remaining) recoveries.set(target, remaining)
      if (!remaining) recoveries.delete(target)
      setStore(target, "recovering", remaining > 0)
    }
  }
  async function dismiss(operation: Extract<Pending, { kind: "dismiss" }>) {
    const target = key()
    if (store[target]?.pending) return
    setStore(target, "exiting", true)
    setStore(target, "pending", true)
    save(operation, target)
    try {
      const result = responseSchema.parse(
        await json(
          `/studio/sessions/${encodeURIComponent(operation.sessionID)}/prompt-recommendations/${encodeURIComponent(operation.guidePartID)}/dismiss`,
          {},
        ),
      )
      save(undefined, target)
      setStore(target, "unknown", false)
      if (target !== key() || disposed) return
      setStore(target, "state", { stateToken: result.stateToken, recommendation: result })
      setStore(target, "exiting", false)
      await refresh()
    } catch {
      setStore(target, "unknown", true)
      input.notice("退出推荐尚未确认，请点击重新同步后再发送。")
    } finally {
      setStore(target, "pending", false)
    }
  }
  async function expand(
    value: Omit<Submission, "requestID" | "sessionID" | "guidePartID">,
    clear: (sessionID?: string) => void,
    independent = false,
  ) {
    const target = key()
    if (store[target]?.pending || store[target]?.preparing ||
      ["running", "cancelling"].includes(current()?.state?.recommendation?.status ?? "")) return
    // Keep independent guides from enabling recommendation mode through legacy state restoration.
    if (independent && input.mode?.enabled(target) === undefined) input.mode?.save(target, false)
    if (current()?.unknown) {
      await recover()
      if (target !== key()) return
      if (!current()?.unknown || pending()?.kind !== "submit" || current()?.state?.recommendation?.status !== "armed")
        return
    }
    const operation = { target, visit: visit(), version: versions.get(target), independent }
    setStore(target, "independent", independent)
    setStore(target, "preparing", true)
    try {
      const guide = current()?.state?.recommendation
      if (guide?.status !== "armed") {
        const result = await initialize(undefined, false, operation)
        if (!result) return
      }
      if (
        (!independent && input.mode?.enabled(operation.target) === false) ||
        operation.target !== key() ||
        operation.visit !== visit() ||
        operation.version !== versions.get(operation.target)
      )
        return
      await submit(value, clear, independent)
    } finally {
      setStore(target, "preparing", false)
      setStore(target, "independent", false)
      if (operation.target !== target) {
        setStore(operation.target, "preparing", false)
        setStore(operation.target, "independent", false)
      }
    }
  }
  async function applyCancellation() {
    const target = key()
    if (
      !current()?.cancelRequested ||
      current()?.pending ||
      current()?.preparing ||
      current()?.unknown ||
      current()?.cancelling ||
      current()?.recovering ||
      pending()
    )
      return
    const guide = current()?.state?.recommendation
    if (
      !guide ||
      (current()?.cancelGuidePartID && current()?.cancelGuidePartID !== guide.guidePartID) ||
      !["running", "cancelling"].includes(guide.status)
    ) {
      setStore(target, "cancelRequested", false)
      return
    }
    if (!guide.assistantMessageID) return
    setStore(target, "cancelling", true)
    try {
      await json(
        `/studio/sessions/${encodeURIComponent(guide.sessionID)}/prompt-expansions/${encodeURIComponent(guide.assistantMessageID)}/cancel`,
        {},
      )
      setStore(target, "cancelRequested", false)
      if (!disposed && target === key()) await refresh()
    } catch {
      setStore(target, "unknown", true)
      input.notice("取消尚未确认，请重新同步推荐状态。")
    } finally {
      setStore(target, "cancelling", false)
    }
  }
  async function cancel() {
    const target = key()
    versions.set(target, (versions.get(target) ?? 0) + 1)
    const operation = pending()
    setStore(
      target,
      "cancelGuidePartID",
      operation?.kind === "submit" ? operation.guidePartID : current()?.state?.recommendation?.guidePartID,
    )
    setStore(target, "cancelRequested", true)
    if (current()?.pending || current()?.preparing || current()?.recovering) return
    if (current()?.unknown || pending()) await recover()
    if (target === key()) await applyCancellation()
  }
  createEffect(() => {
    if (
      !current()?.cancelRequested ||
      current()?.pending ||
      current()?.preparing ||
      current()?.unknown ||
      current()?.cancelling ||
      current()?.recovering
    )
      return
    queueMicrotask(() => {
      if (!disposed) void applyCancellation()
    })
  })
  async function exit() {
    input.mode?.save(key(), false)
    if (current()?.independent) return
    versions.set(key(), (versions.get(key()) ?? 0) + 1)
    if (current()?.pending || current()?.preparing) return
    if (pending() || current()?.unknown) return recover()
    const guide = current()?.state?.recommendation
    if (guide?.status === "armed")
      await dismiss({ kind: "dismiss", sessionID: guide.sessionID, guidePartID: guide.guidePartID })
  }
  createEffect(() => {
    if (!input.mode?.ready() || !current()?.ready) return
    const target = key()
    const enabled = input.mode.enabled(target)
    const status = current()?.state?.recommendation?.status
    if (enabled === undefined && ["armed", "running", "cancelling"].includes(status ?? "")) {
      input.mode.save(target, true)
      return
    }
    if (enabled === false && status === "armed" && !current()?.pending && !current()?.preparing && !current()?.unknown)
      queueMicrotask(() => {
        if (
          disposed ||
          target !== key() ||
          input.mode?.enabled(target) !== false ||
          current()?.pending ||
          current()?.preparing ||
          current()?.cancelling ||
          current()?.unknown
        )
          return
        if (current()?.state?.recommendation?.status === "armed") void exit()
      })
  })
  createEffect(
    on(
      () => [input.scope(), input.sessionID()] as const,
      () => {
        replay = undefined
        clearReplay = undefined
        uploads.clear()
        sequence++
        setStore(key(), {
          ...store[key()],
          ready: !input.sessionID(),
          pending: store[key()]?.pending ?? false,
          unknown: store[key()]?.unknown ?? false,
        })
        const target = key()
        void untrack(recover).catch(() => {
          if (disposed || target !== key()) return
          if (pending() || store[target]?.unknown || input.mode?.enabled(target)) {
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
      Boolean(
        current()?.pending ||
          current()?.preparing ||
          ["running", "cancelling"].includes(current()?.state?.recommendation?.status ?? ""),
      ),
    ready: () => Boolean(current()?.ready) && (input.mode?.ready() ?? true),
    exiting: () => Boolean(current()?.exiting),
    expand,
    expandShortcut: (value: Omit<Submission, "requestID" | "sessionID" | "guidePartID">) => expand(value, () => {}, true),
    exit,
    initialize: () => {
      versions.set(key(), (versions.get(key()) ?? 0) + 1)
      input.mode?.save(key(), true)
      const old = pending()
      return initialize(old?.kind === "initialize" ? old : undefined)
    },
    submit,
    recover,
    cancel,
  }
}

import { afterAll, afterEach, describe, expect, spyOn, test } from "bun:test"
import type { PixsoAction, UploadZipOptions } from "@/utils/useZipTransport"
import { tracker } from "@/utils/tracker"
import type { ResultTab } from "../components/result-viewer/tab-store"
import { createCanvasEditSession } from "./canvas-edit-session"
import type { CanvasTransport } from "./canvas-transport"

const events: Array<{ name: string; fields: Record<string, unknown> }> = []
const tracking = spyOn(tracker, "interaction").mockImplementation(event => { events.push({ name: event.name, fields: JSON.parse(event.extend ?? "{}") }) })
afterEach(() => { events.length = 0 })

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
function setup(values: Partial<CanvasTransport> = {}) {
  const notices: string[] = []
  const saved: UploadZipOptions[] = []
  const action: PixsoAction = { label: "打开画布", fn: async () => ({ success: true }) }
  const context = {
    key: "s1/html-1",
    tab: { id: "html-1", type: "html", title: "private-name", source: "inline", content: "<h1>private content</h1>", createdAt: new Date() } as ResultTab,
    mode: "preview" as const,
    sessionId: "s1",
    directory: "/private/path",
    loggedIn: true,
    api: {},
    transport: {
      available: true,
      prepare: async (options: UploadZipOptions) => { saved.push(options); return { uploadResult: { webview: null }, actions: [action] } },
      actionId: () => "open" as const,
      ...values,
    },
  }
  let state = { busy: false, open: false, actions: [] as PixsoAction[] }
  const session = createCanvasEditSession({ context: () => context, changed: next => { state = next }, notify: title => { notices.push(title) } })
  return { session, context, notices, saved, action, state: () => state }
}

describe("画布操作生命周期", () => {
  test("未登录或未声明可用性不触发打包和传输", async () => {
    const sample = setup()
    sample.context.loggedIn = false
    await sample.session.prepare()
    expect(sample.notices).toEqual(["请先登录"])
    expect(sample.saved).toHaveLength(0)
    expect(events).toHaveLength(0)
    sample.context.loggedIn = true
    sample.context.transport.available = false
    await sample.session.prepare()
    expect(sample.saved).toHaveLength(0)
  })
  test("外部接口惰性调用实际 getZip；菜单保持返回顺序，执行后清理", async () => {
    const sample = setup()
    await sample.session.prepare()
    expect(sample.state()).toMatchObject({ open: true, busy: false })
    expect(sample.state().actions).toEqual([sample.action])
    expect((await sample.saved[0].getZip()).size).toBeGreaterThan(0)
    await sample.session.run(sample.action)
    expect(sample.state()).toEqual({ open: false, busy: false, actions: [] })
    expect(events.find(event => event.name === "canvas-edit-result" && event.fields.action === "open")?.fields.status).toBe("unconfirmed")
    expect(JSON.stringify(events)).not.toContain("private")
  })
  test("只有真实适配器提供成功证据才统计成功", async () => {
    const sample = setup({ result: () => ({ status: "success", evidence: "canvas-loaded" }) })
    await sample.session.prepare()
    await sample.session.run(sample.action)
    expect(events.at(-1)?.fields).toMatchObject({ status: "success", evidence: "canvas-loaded", action: "open" })
  })
  test("只有 success:true 而没有证据时不得记成功", async () => {
    const sample = setup({ result: () => ({ status: "success" }) })
    await sample.session.prepare()
    await sample.session.run(sample.action)
    expect(events.at(-1)?.fields.status).toBe("unconfirmed")
  })
  test("准备中重复点击不增加请求，切换会话后不回弹菜单", async () => {
    const pending = deferred<{ uploadResult: { webview: null }; actions: PixsoAction[] }>()
    let calls = 0
    const sample = setup({ prepare: async () => { calls++; return pending.promise } })
    const first = sample.session.prepare()
    await Bun.sleep(0)
    await sample.session.prepare()
    expect(calls).toBe(1)
    sample.context.key = "s2/html-2"
    sample.context.sessionId = "s2"
    sample.session.reset()
    pending.resolve({ uploadResult: { webview: null }, actions: [sample.action] })
    await first
    expect(sample.state()).toEqual({ busy: false, open: false, actions: [] })
    expect(events.at(-1)?.fields).toMatchObject({ status: "cancelled", sessionId: "s1", reason: "view-changed" })
  })
  test("切文件但 effect 尚未 reset 时也不能执行旧菜单", async () => {
    let calls = 0
    const sample = setup()
    sample.action.fn = async () => { calls++; return { success: true } }
    await sample.session.prepare()
    sample.context.key = "other"
    await sample.session.run(sample.action)
    expect(calls).toBe(0)
    expect(sample.state().open).toBe(false)
  })
  test("动作执行中不重复执行；卸载后迟到结果不更新 UI", async () => {
    const pending = deferred<{ success: boolean }>()
    let calls = 0
    const sample = setup()
    sample.action.fn = async () => { calls++; return pending.promise }
    await sample.session.prepare()
    const first = sample.session.run(sample.action)
    await sample.session.run(sample.action)
    expect(calls).toBe(1)
    sample.session.reset()
    pending.resolve({ success: true })
    await first
    expect(sample.state()).toEqual({ busy: false, open: false, actions: [] })
  })
  test("空动作和传输异常不展开旧菜单，可重新发起", async () => {
    const sample = setup({ prepare: async () => ({ uploadResult: { webview: null }, actions: [] }) })
    await sample.session.prepare()
    expect(sample.state().open).toBe(false)
    expect(sample.notices).toEqual(["当前没有可用的画布操作"])
    sample.context.transport.prepare = async () => { throw new Error("private transport error") }
    await sample.session.prepare()
    expect(sample.notices).toHaveLength(2)
    expect(sample.state().busy).toBe(false)
  })
  test("明确失败显示错误；用户取消不误报失败", async () => {
    const sample = setup()
    sample.action.fn = async () => ({ success: false })
    await sample.session.prepare()
    await sample.session.run(sample.action)
    expect(sample.notices).toEqual(["无法完成画布操作，请重试"])
    expect(events.at(-1)?.fields.status).toBe("failure")
    sample.action.fn = async () => { throw new DOMException("cancelled", "AbortError") }
    await sample.session.prepare()
    await sample.session.run(sample.action)
    expect(sample.notices).toHaveLength(1)
    expect(events.at(-1)?.fields.status).toBe("cancelled")
  })
})

// 只替换外部统计传输，不替换文件打包或业务实现。
afterAll(() => tracking.mockRestore())

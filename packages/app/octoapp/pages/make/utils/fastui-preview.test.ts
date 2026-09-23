/**
 * fastui 预览面板状态机(SPEC-DES-004 §3.6)。
 *
 * 判据:点卡片只允许两种结局 —— 出页面,或出明确的错误。不允许无限转圈、不允许白屏;
 * 页面已经出来之后的刷新不能让预览闪一下;晚到的旧结果不能覆盖当前目标。
 *
 * 运行: bun test --preload ./happydom.ts ./octoapp/pages/make/utils/fastui-preview.test.ts(在 packages/app 下)
 */
import { describe, expect, test } from "bun:test"

import {
  createFastuiPreviewController,
  type FastuiOpenResult,
  type FastuiPreviewApi,
  type FastuiPreviewState,
} from "./fastui-preview"
import { parseFastuiPreview } from "./fastui-export"

const flush = () => new Promise((r) => setTimeout(r, 0))

function setup(opts: { openTimeoutMs?: number; loadTimeoutMs?: number } = {}) {
  const states: FastuiPreviewState[] = []
  const ctl = createFastuiPreviewController({ onState: (s) => states.push(s), ...opts })
  return { ctl, states, phases: () => states.map((s) => s.phase) }
}

function api(results: Array<FastuiOpenResult | Promise<FastuiOpenResult>>) {
  const calls: Array<{ kind: "open" | "restart"; sessionDir: string; name?: string }> = []
  const next = () => {
    const r = results.shift()
    return r instanceof Promise ? r : Promise.resolve(r ?? { ok: false as const, error: "no more results" })
  }
  const impl: FastuiPreviewApi = {
    fastuiPreviewOpen: (sessionDir, name) => {
      calls.push({ kind: "open", sessionDir, name })
      return next()
    },
    fastuiPreviewRestart: (sessionDir, name) => {
      calls.push({ kind: "restart", sessionDir, name })
      return next()
    },
  }
  return { impl, calls }
}

describe("fastui 预览状态机", () => {
  test("正常路径:编译中 → 挂地址等加载 → 出页面", async () => {
    const { ctl, phases } = setup()
    const a = api([{ ok: true, port: 8083 }])
    ctl.request({ api: a.impl, sessionDir: "/w/.octo/s1", name: "alpha" })
    expect(ctl.state.phase).toBe("resolving")
    await flush()
    expect(ctl.state).toEqual({ phase: "loading", url: "http://127.0.0.1:8083/" })
    ctl.frameLoaded(true)
    expect(phases()).toEqual(["resolving", "loading", "ready"])
    expect(a.calls).toEqual([{ kind: "open", sessionDir: "/w/.octo/s1", name: "alpha" }])
    ctl.dispose()
  })

  test("主进程返回失败:进错误态,带错误信息与日志末尾", async () => {
    const { ctl } = setup()
    const a = api([{ ok: false, error: "预览服务启动失败", logTail: "SyntaxError: x" }])
    ctl.request({ api: a.impl, sessionDir: "/s", name: "alpha" })
    await flush()
    expect(ctl.state).toEqual({ phase: "error", message: "预览服务启动失败", logTail: "SyntaxError: x" })
    ctl.dispose()
  })

  test("取地址一直没有回音:超时进错误态,不无限转圈", async () => {
    const { ctl } = setup({ openTimeoutMs: 50 })
    const a = api([new Promise<FastuiOpenResult>(() => {})])
    ctl.request({ api: a.impl, sessionDir: "/s", name: "alpha" })
    await new Promise((r) => setTimeout(r, 80))
    expect(ctl.state.phase).toBe("error")
    ctl.dispose()
  })

  test("地址挂上后页面一直没加载出来:超时进错误态,不白屏", async () => {
    const { ctl } = setup({ loadTimeoutMs: 50 })
    ctl.request({ api: api([{ ok: true, port: 8081 }]).impl, sessionDir: "/s", name: "alpha" })
    await flush()
    expect(ctl.state.phase).toBe("loading")
    await new Promise((r) => setTimeout(r, 80))
    expect(ctl.state).toEqual({ phase: "error", message: "预览页面加载超时，请重新编译" })
    ctl.dispose()
  })

  test("挂地址之前 iframe 自己加载 about:blank 触发的 load 不算出页面", async () => {
    const { ctl } = setup()
    ctl.request({ api: api([new Promise<FastuiOpenResult>(() => {})]).impl, sessionDir: "/s", name: "alpha" })
    ctl.frameLoaded(false)
    ctl.frameLoaded(true)
    expect(ctl.state.phase).toBe("resolving")
    ctl.dispose()
  })

  test("已出页面后刷新,主进程给的是同一个地址:状态一次都不变(不闪)", async () => {
    const { ctl, phases } = setup()
    const a = api([{ ok: true, port: 8081 }, { ok: true, port: 8081, reused: true }])
    ctl.request({ api: a.impl, sessionDir: "/s", name: "alpha" })
    await flush()
    ctl.frameLoaded(true)
    const before = phases().length
    ctl.request({ api: a.impl, sessionDir: "/s", name: "alpha" })
    await flush()
    expect(phases().length).toBe(before)
    expect(ctl.state).toEqual({ phase: "ready", url: "http://127.0.0.1:8081/" })
    expect(a.calls.length).toBe(2) // 仍然向主进程确认过(服务可能已经没了)
    ctl.dispose()
  })

  test("已出页面后刷新,服务被重起换了端口:直接加载新地址,不经过编译中", async () => {
    const { ctl, phases } = setup()
    const a = api([{ ok: true, port: 8081 }, { ok: true, port: 8090 }])
    ctl.request({ api: a.impl, sessionDir: "/s", name: "alpha" })
    await flush()
    ctl.frameLoaded(true)
    ctl.request({ api: a.impl, sessionDir: "/s", name: "alpha" })
    await flush()
    expect(phases()).toEqual(["resolving", "loading", "ready", "loading"])
    expect(ctl.state).toEqual({ phase: "loading", url: "http://127.0.0.1:8090/" })
    ctl.dispose()
  })

  test("「重新编译」:走 restart 接口,并回到编译中", async () => {
    const { ctl } = setup()
    const a = api([{ ok: true, port: 8081 }, { ok: true, port: 8082 }])
    ctl.request({ api: a.impl, sessionDir: "/s", name: "alpha" })
    await flush()
    ctl.frameLoaded(true)
    ctl.request({ api: a.impl, sessionDir: "/s", name: "alpha", restart: true })
    expect(ctl.state.phase).toBe("resolving")
    await flush()
    expect(a.calls.map((c) => c.kind)).toEqual(["open", "restart"])
    expect(ctl.state).toEqual({ phase: "loading", url: "http://127.0.0.1:8082/" })
    ctl.dispose()
  })

  test("换了目标(另一个会话 / 另一个产物):不沿用旧页面,重新走编译中", async () => {
    const { ctl } = setup()
    const a = api([{ ok: true, port: 8081 }, new Promise<FastuiOpenResult>(() => {})])
    ctl.request({ api: a.impl, sessionDir: "/s1", name: "alpha" })
    await flush()
    ctl.frameLoaded(true)
    ctl.request({ api: a.impl, sessionDir: "/s2", name: "alpha" })
    expect(ctl.state.phase).toBe("resolving")
    ctl.dispose()
  })

  test("晚到的旧结果被丢弃:不会把上一个目标的地址挂到当前预览上", async () => {
    const { ctl } = setup()
    let resolveOld!: (r: FastuiOpenResult) => void
    const old = new Promise<FastuiOpenResult>((r) => (resolveOld = r))
    const a = api([old, { ok: true, port: 9002 }])
    ctl.request({ api: a.impl, sessionDir: "/s1", name: "alpha" })
    ctl.request({ api: a.impl, sessionDir: "/s2", name: "beta" })
    await flush()
    resolveOld({ ok: true, port: 9001 })
    await flush()
    expect(ctl.state).toEqual({ phase: "loading", url: "http://127.0.0.1:9002/" })
    ctl.dispose()
  })

  test("非 Electron 环境或拿不到会话目录:明确报错", () => {
    const { ctl } = setup()
    ctl.request({ api: undefined, sessionDir: "/s", name: "alpha" })
    expect(ctl.state).toEqual({ phase: "error", message: "当前环境不支持本地预览" })
    ctl.request({ api: api([]).impl, sessionDir: null, name: "alpha" })
    expect(ctl.state.phase).toBe("error")
    ctl.dispose()
  })

  test("旧版卡片(产物未知)以不带产物名的方式请求,交给主进程判定", async () => {
    const { ctl } = setup()
    const a = api([{ ok: false, error: "该预览卡片由旧版本生成，当前对话包含多个产物工程，无法确定对应哪一个。请让助手重新生成预览" }])
    ctl.request({ api: a.impl, sessionDir: "/s", name: "" })
    await flush()
    expect(a.calls[0].name).toBeUndefined()
    expect(ctl.state.phase).toBe("error")
    ctl.dispose()
  })
})

describe("parseFastuiPreview", () => {
  test("识别产物名", () => {
    expect(parseFastuiPreview("fastui://user-profile-page")).toBe("user-profile-page")
    expect(parseFastuiPreview("  fastui://page/  ")).toBe("page")
    expect(parseFastuiPreview("fastui://%E7%94%A8%E6%88%B7%E9%A1%B5")).toBe("用户页")
    expect(parseFastuiPreview("fastui://")).toBe("")
  })
  test("不是 fastui 卡片或产物名不合法时返回 null", () => {
    expect(parseFastuiPreview("http://127.0.0.1:8081")).toBeNull()
    expect(parseFastuiPreview("fastui://a/b")).toBeNull()
    expect(parseFastuiPreview("fastui://a?x=1")).toBeNull()
    expect(parseFastuiPreview("D:\\dir\\a.html")).toBeNull()
    expect(parseFastuiPreview(undefined)).toBeNull()
  })
})

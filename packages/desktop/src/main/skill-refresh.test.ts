/**
 * skill-refresh.ts —— 主进程侧「写完即失效 sidecar skill 缓存」的收口。
 *
 * 用真起 HTTP server 扮演 sidecar,直接判定 POST /skill/refresh 的方法/路径/
 * Basic 头是否正确发出。失败降级(server 未就绪、连接拒绝、非 2xx)一律不
 * throw —— fire-and-forget 语义,调用方(`void SkillRefresh...`)不 await。
 *
 * 超时不单测:REFRESH_TIMEOUT_MS 为 5s,真等一轮会拖垮套件;连接拒绝走的是
 * 同一个 catch 分支,降级语义已覆盖。
 */
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"

// skill-refresh.ts 经 electron-log 链 electron;bun 的 ESM 加载器对 CJS 字符串导出
// 做具名链接会失败,必须 mock。`default` 不能省(与 fastui-export.test.ts 同款)。
// 注册必须先于下面的动态 import。
const electronMock = { app: {}, dialog: {} }
mock.module("electron", () => ({ ...electronMock, default: electronMock }))

const SkillRefresh = await import("./skill-refresh")

type Captured = { method: string; path: string; authorization: string | null }

/** 扮演 sidecar;requireAuth 用于断言「不带 auth 会被拒」的现场形态 */
function fakeServer(opts?: { requireAuth?: string; status?: number }) {
  const captured: Captured[] = []
  const server = Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url)
      const authorization = req.headers.get("authorization")
      captured.push({ method: req.method, path: url.pathname, authorization })
      if (opts?.requireAuth && authorization !== opts.requireAuth) {
        return new Response("unauthorized", { status: 401 })
      }
      return new Response(JSON.stringify({ success: true }), { status: opts?.status ?? 200 })
    },
  })
  return { url: `http://127.0.0.1:${server.port}`, captured, stop: () => server.stop(true) }
}

let stopServer: (() => void) | null = null

beforeEach(() => {
  SkillRefresh.setSkillRefreshServerInfo(null)
})

afterEach(() => {
  stopServer?.()
  stopServer = null
})

describe("refreshSidecarSkills", () => {
  test("向 sidecar 发 POST /skill/refresh,带 Basic auth", async () => {
    const expected = `Basic ${Buffer.from("opencode:pw").toString("base64")}`
    const server = fakeServer({ requireAuth: expected })
    stopServer = server.stop
    SkillRefresh.setSkillRefreshServerInfo({ url: server.url, username: "opencode", password: "pw" })

    await SkillRefresh.refreshSidecarSkills()

    expect(server.captured).toHaveLength(1)
    expect(server.captured[0]).toEqual({ method: "POST", path: "/skill/refresh", authorization: expected })
  })

  test("serverInfo 未注入时直接跳过,不发请求", async () => {
    const server = fakeServer()
    stopServer = server.stop

    await SkillRefresh.refreshSidecarSkills()

    expect(server.captured).toHaveLength(0)
  })

  test("非 2xx 响应不 throw(降级只 log)", async () => {
    const server = fakeServer({ status: 500 })
    stopServer = server.stop
    SkillRefresh.setSkillRefreshServerInfo({ url: server.url, username: null, password: null })

    await expect(SkillRefresh.refreshSidecarSkills()).resolves.toBeUndefined()
    expect(server.captured).toHaveLength(1)
  })

  test("连接拒绝走 catch 分支,不 throw(与超时同一降级路径)", async () => {
    // 起一个 server 拿端口后立刻停掉:对已关闭端口的连接被拒绝,fetch reject 进 catch
    const server = fakeServer()
    const url = server.url
    server.stop(true)
    SkillRefresh.setSkillRefreshServerInfo({ url, username: "opencode", password: "pw" })

    await expect(SkillRefresh.refreshSidecarSkills()).resolves.toBeUndefined()
  })
})

import { afterAll, describe, expect, test } from "bun:test"
import { fetchWithRetry, isTransientFetchError } from "./retryable-fetch"

const NativeResponse = ((await Bun.fetch("data:,")) as unknown as { constructor: typeof Response }).constructor

const servers: ReturnType<typeof Bun.serve>[] = []

afterAll(() => {
  for (const server of servers) server.stop(true)
})

const unusedPort = (offset: number) => 50000 + ((Math.random() * 4000 | 0) * 2 + offset)

describe("isTransientFetchError", () => {
  test("网络级错误判定为瞬时", () => {
    expect(isTransientFetchError(new TypeError("Failed to fetch"))).toBe(true)
    expect(isTransientFetchError(new Error("Unable to connect. Is the computer able to access the url?"))).toBe(true)
  })

  test("Abort/业务错误不判定为瞬时", () => {
    expect(isTransientFetchError(new DOMException("Aborted", "AbortError"))).toBe(false)
    expect(isTransientFetchError(new Error("Failed to list artifacts: Unauthorized"))).toBe(false)
    expect(isTransientFetchError("boom")).toBe(false)
  })
})

describe("fetchWithRetry", () => {
  test("连接失败自动重试,服务恢复后成功", async () => {
    const port = unusedPort(0)
    const pending = fetchWithRetry(`http://127.0.0.1:${port}`, undefined, {
      fetch: Bun.fetch,
      delaysMs: [100, 300, 1000],
    })
    setTimeout(() => {
      servers.push(Bun.serve({ port, fetch: () => NativeResponse.json({ files: [] }) }))
    }, 10)

    const response = await pending
    expect(response.ok).toBe(true)
    expect(await response.json()).toEqual({ files: [] })
  })

  test("HTTP 状态错误不重试,原样返回响应", async () => {
    let hits = 0
    const server = Bun.serve({
      port: 0,
      fetch: () => {
        hits++
        return new NativeResponse("nope", { status: 404 })
      },
    })
    servers.push(server)

    const response = await fetchWithRetry(`http://127.0.0.1:${server.port}`, undefined, {
      fetch: Bun.fetch,
      delaysMs: [1, 1, 1],
    })
    expect(response.status).toBe(404)
    expect(hits).toBe(1)
  })

  test("重试耗尽后抛出最后一次网络错误", async () => {
    await expect(
      fetchWithRetry(`http://127.0.0.1:${unusedPort(1)}`, undefined, { fetch: Bun.fetch, delaysMs: [1, 1] }),
    ).rejects.toThrow()
  })
})

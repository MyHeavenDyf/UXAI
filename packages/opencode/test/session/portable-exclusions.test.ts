import { expect, test } from "bun:test"
import { createPortableBlacklistLoader, isExcludedPortableFile } from "@/session/portable-exclusions"

test("fetches a single configuration for concurrent exports and caches valid results", async () => {
  const calls = { count: 0 }
  const server = Bun.serve({ port: 0, fetch() {
    calls.count++
    return Response.json({ version: 1, excludedExtensions: [".ASAR", ".asar", ".exe"] })
  } })
  try {
    const load = createPortableBlacklistLoader()
    const url = `http://127.0.0.1:${server.port}/blacklist.json`
    expect(await Promise.all(Array.from({ length: 10 }, () => load(url)))).toEqual(Array.from({ length: 10 }, () => [".asar", ".exe"]))
    expect(await load(url)).toEqual([".asar", ".exe"])
    expect(calls.count).toBe(1)
  } finally {
    server.stop(true)
  }
})

test("refreshes expired settings and retains the last valid configuration on failure", async () => {
  const state = { version: 0 }
  const server = Bun.serve({ port: 0, fetch: () => state.version === 2
    ? new Response(null, { status: 503 })
    : Response.json({ version: 1, excludedExtensions: state.version ? [] : [".asar"] }) })
  try {
    const load = createPortableBlacklistLoader({ ttlMs: 0 })
    const url = `http://127.0.0.1:${server.port}/blacklist.json`
    expect(await load(url)).toEqual([".asar"])
    state.version = 2
    expect(await load(url)).toEqual([".asar"])
    state.version = 1
    expect(await load(url)).toEqual([])
    state.version = 2
    expect(await load(url)).toEqual([])
  } finally {
    server.stop(true)
  }
})

test.each([
  [503, "service unavailable"], [200, "invalid json"],
  [200, JSON.stringify({ version: 2, excludedExtensions: [".asar"] })],
  [200, JSON.stringify({ version: 1, excludedExtensions: ["../file"] })],
  [200, JSON.stringify({ version: 1, excludedExtensions: ["*.asar"] })],
  [200, "x".repeat(64 * 1024 + 1)],
] as const)("falls back to an empty blacklist without a valid cache (%s)", async (status, body) => {
  const server = Bun.serve({ port: 0, fetch: () => new Response(body, { status }) })
  try {
    const extensions = await createPortableBlacklistLoader()(`http://127.0.0.1:${server.port}/blacklist.json`)
    expect(extensions).toEqual([])
    expect(isExcludedPortableFile("app.asar", extensions)).toBe(false)
  } finally {
    server.stop(true)
  }
})

test("missing or invalid URLs exclude nothing without fetching", async () => {
  const load = createPortableBlacklistLoader()
  for (const url of ["", "file:///etc/passwd", "invalid-url"]) expect(await load(url)).toEqual([])
})

test("timeouts fall back to an empty blacklist", async () => {
  const server = Bun.serve({ port: 0, fetch: () => new Promise<Response>(() => {}) })
  try {
    expect(await createPortableBlacklistLoader({ timeoutMs: 20 })(`http://127.0.0.1:${server.port}/blacklist.json`)).toEqual([])
  } finally {
    server.stop(true)
  }
})

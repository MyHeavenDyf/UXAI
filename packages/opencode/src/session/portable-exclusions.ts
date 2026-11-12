import { Effect, Schema } from "effect"

const Config = Schema.Struct({ version: Schema.Literal(1), excludedExtensions: Schema.Array(Schema.String) })

export function createPortableBlacklistLoader(options: { ttlMs?: number; timeoutMs?: number } = {}) {
  const cache = new Map<string, Effect.Effect<readonly string[]>>()
  const last = new Map<string, readonly string[]>()
  return async (address = process.env.OCTO_PORTABLE_BLACKLIST_URL?.trim()): Promise<readonly string[]> => {
    if (!address) return []
    if (!URL.canParse(address) || !["http:", "https:"].includes(new URL(address).protocol)) {
      console.warn("[octo:portable-blacklist] fallback", { source: "empty", reason: "配置地址必须是 HTTP(S) URL" })
      return []
    }
    const existing = cache.get(address)
    if (existing) return Effect.runPromise(existing)
    // Bound cache growth if environment configuration changes repeatedly within one process.
    if (cache.size >= 8) {
      const oldest = cache.keys().next().value!
      cache.delete(oldest)
      last.delete(oldest)
    }
    const refresh = Effect.tryPromise({
      try: async () => {
        const response = await fetch(address, { signal: AbortSignal.timeout(options.timeoutMs ?? 3000), redirect: "error" })
        if (!response.ok) {
          await response.body?.cancel()
          throw new Error(`HTTP ${response.status}`)
        }
        const reader = response.body?.getReader()
        if (!reader) throw new Error("配置响应为空")
        const chunks: Uint8Array[] = []
        const state = { size: 0 }
        while (true) {
          const chunk = await reader.read()
          if (chunk.done) break
          state.size += chunk.value.byteLength
          if (state.size > 64 * 1024) {
            await reader.cancel()
            throw new Error("黑名单 JSON 超过 64KiB")
          }
          chunks.push(chunk.value)
        }
        const config = Schema.decodeUnknownSync(Config)(JSON.parse(Buffer.concat(chunks).toString("utf8")))
        if (config.excludedExtensions.length > 128 || !config.excludedExtensions.every((extension) => /^\.[a-z0-9][a-z0-9._-]{0,31}$/i.test(extension))) {
          throw new Error("黑名单只允许最多 128 个扩展名，不支持路径、通配符或脚本")
        }
        const extensions = [...new Set(config.excludedExtensions.map((extension) => extension.toLowerCase()))]
        last.set(address, extensions)
        console.info("[octo:portable-blacklist] loaded", { source: "remote", version: config.version, excludedExtensions: extensions })
        return extensions
      },
      // Do not include response contents, URLs or authentication data in diagnostic logs.
      catch: (error) => error instanceof Error ? error.name : "UnknownError",
    }).pipe(Effect.catch((reason) => Effect.sync(() => {
      const extensions = last.get(address) ?? []
      console.warn("[octo:portable-blacklist] fallback", { source: last.has(address) ? "cache" : "empty", reason, excludedExtensions: extensions })
      return extensions
    })))
    const cached = Effect.runSync(Effect.cachedWithTTL(refresh, options.ttlMs ?? 5 * 60_000))
    cache.set(address, cached)
    return Effect.runPromise(cached)
  }
}

export const loadPortableFileBlacklist = createPortableBlacklistLoader()

// Match archive boundaries too, preventing Electron from traversing an excluded ASAR.
export function isExcludedPortableFile(file: string, blacklist: readonly string[] = []) {
  return file.replaceAll("\\", "/").split("/").some((part) =>
    blacklist.some((extension) => part.toLowerCase().endsWith(extension)),
  )
}

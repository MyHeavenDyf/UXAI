const RETRY_DELAYS_MS = [300, 800, 1500, 3000]

export type FetchWithRetryOptions = {
  fetch?: typeof globalThis.fetch
  delaysMs?: number[]
}

export function isTransientFetchError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  if (error.name === "AbortError" || error.name === "TimeoutError") return false
  if (error.name === "NetworkError") return true
  if (error instanceof TypeError) return true
  return /network|failed to fetch|unable to connect|econnreset|econnrefused|enotfound|timedout/i.test(error.message)
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export async function fetchWithRetry(url: string, init?: RequestInit, opts?: FetchWithRetryOptions): Promise<Response> {
  const fetcher = opts?.fetch ?? globalThis.fetch
  const delays = opts?.delaysMs ?? RETRY_DELAYS_MS
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetcher(url, init)
    } catch (error) {
      if (attempt >= delays.length || !isTransientFetchError(error)) throw error
      await wait(delays[attempt])
    }
  }
}

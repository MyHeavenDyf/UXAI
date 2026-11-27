export type RefreshQueueOpts = {
  /** SSE 重连后的补拉:bootstrap 时 session_status 信任服务端快照 */
  trustStatusSnapshot?: boolean
}

type QueueInput = {
  paused: () => boolean
  bootstrap: () => Promise<void>
  bootstrapInstance: (directory: string, opts?: RefreshQueueOpts) => Promise<void> | void
  key?: (directory: string) => string
}

export function createRefreshQueue(input: QueueInput) {
  const queued = new Map<string, { directory: string; opts?: RefreshQueueOpts }>()
  let root = false
  let running = false
  let timer: ReturnType<typeof setTimeout> | undefined

  const key = input.key ?? ((directory: string) => directory)

  const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

  const take = (count: number) => {
    if (queued.size === 0) return [] as { directory: string; opts?: RefreshQueueOpts }[]
    const items: { directory: string; opts?: RefreshQueueOpts }[] = []
    for (const [id, entry] of queued) {
      queued.delete(id)
      items.push(entry)
      if (items.length >= count) break
    }
    return items
  }

  const schedule = () => {
    if (timer) return
    timer = setTimeout(() => {
      timer = undefined
      void drain()
    }, 0)
  }

  const push = (directory: string, opts?: RefreshQueueOpts) => {
    if (!directory) return
    queued.set(key(directory), { directory, opts })
    if (input.paused()) return
    schedule()
  }

  const refresh = () => {
    root = true
    if (input.paused()) return
    schedule()
  }

  async function drain() {
    if (running) return
    running = true
    try {
      while (true) {
        if (input.paused()) return
        if (root) {
          root = false
          await input.bootstrap()
          await tick()
          continue
        }
        const dirs = take(2)
        if (dirs.length === 0) return
        await Promise.all(dirs.map((item) => input.bootstrapInstance(item.directory, item.opts)))
        await tick()
      }
    } finally {
      running = false
      // oxlint-disable-next-line no-unsafe-finally -- intentional: early return skips schedule() when paused
      if (input.paused()) return
      if (root || queued.size) schedule()
    }
  }

  return {
    push,
    refresh,
    clear(directory: string) {
      queued.delete(key(directory))
    },
    dispose() {
      if (!timer) return
      clearTimeout(timer)
      timer = undefined
    },
  }
}

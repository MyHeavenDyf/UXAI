import { describe, expect, test } from "bun:test"
import { createRefreshQueue } from "./queue"
import { directoryKey } from "./utils"

const tick = () => new Promise((resolve) => setTimeout(resolve, 10))

describe("createRefreshQueue", () => {
  test("clears queued directories by normalized key", async () => {
    const calls: string[] = []
    const queue = createRefreshQueue({
      paused: () => false,
      key: directoryKey,
      bootstrap: async () => {},
      bootstrapInstance: (directory) => {
        calls.push(directory)
      },
    })

    queue.push("C:\\tmp\\demo")
    queue.clear("C:/tmp/demo")

    await tick()

    expect(calls).toEqual([])
    queue.dispose()
  })

  test("passes the original directory to bootstrapInstance", async () => {
    const calls: string[] = []
    const queue = createRefreshQueue({
      paused: () => false,
      key: directoryKey,
      bootstrap: async () => {},
      bootstrapInstance: (directory) => {
        calls.push(directory)
      },
    })

    queue.push("C:\\tmp\\demo")

    await tick()

    expect(calls).toEqual(["C:\\tmp\\demo"])
    queue.dispose()
  })

  test("forwards opts to bootstrapInstance (SSE 重连补拉标记)", async () => {
    const calls: Array<{ directory: string; opts?: { trustStatusSnapshot?: boolean } }> = []
    const queue = createRefreshQueue({
      paused: () => false,
      key: directoryKey,
      bootstrap: async () => {},
      bootstrapInstance: (directory, opts) => {
        calls.push({ directory, opts })
      },
    })

    queue.push("C:\\tmp\\demo", { trustStatusSnapshot: true })
    queue.push("C:\\tmp\\other")

    await tick()

    expect(calls).toEqual([
      { directory: "C:\\tmp\\demo", opts: { trustStatusSnapshot: true } },
      { directory: "C:\\tmp\\other", opts: undefined },
    ])
    queue.dispose()
  })
})

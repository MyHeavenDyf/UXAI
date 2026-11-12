import { describe, expect, test } from "bun:test"
import { createSharedSessionCache } from "./shared-session-cache"

function fixture() {
  const sessions = new Map<string, { id: string; directory: string; agent: string; title: string }>()
  const deleted = new Set<string>()
  const reads: string[] = []
  let imports = 0
  let failure = false
  const cache = createSharedSessionCache({
    async importSession(_uniqueId, directory) {
      const session = { id: `session-${++imports}`, directory, agent: "octo_make", title: "生成登录HTML" }
      sessions.set(session.id, session)
      return { sessionID: session.id, directory }
    },
    async readSession(result) {
      reads.push(result.sessionID)
      if (failure) throw new Error("server unavailable")
      return sessions.get(result.sessionID)
    },
    isDeleted: (result) => deleted.has(result.sessionID),
  })
  return {
    cache,
    sessions,
    deleted,
    reads,
    imports: () => imports,
    fail: (value: boolean) => {
      failure = value
    },
  }
}

describe("shared session cache", () => {
  test("does not reuse an import from another module in the same server and directory", async () => {
    const state = fixture()
    const design = await state.cache.open("local", "share-code", "/workspace", "design")
    const insight = await state.cache.open("local", "share-code", "/workspace", "insight")
    expect(insight?.sessionID).not.toBe(design?.sessionID)
    expect((await state.cache.open("local", "share-code", "/workspace", "design"))?.sessionID).toBe(design?.sessionID)
    expect(state.imports()).toBe(2)
  })
  test("imports a fresh session after deletion instead of reopening the old ID", async () => {
    const state = fixture()
    const first = await state.cache.open("local", "share-code", "D:\\code\\UX_INSIDE\\.opencode")
    expect(first?.session.title).toBe("生成登录HTML")
    state.sessions.delete(first!.sessionID)
    state.cache.invalidate(first!.directory, first!.sessionID)
    const second = await state.cache.open("local", "share-code", first!.directory)
    expect(second?.sessionID).not.toBe(first?.sessionID)
    expect(second?.session.title).toBe("生成登录HTML")
    expect(second?.agent).toBe("octo_make")
    expect(state.imports()).toBe(2)
    // No GET for the deleted session, even before the deletion tombstone arrives.
    expect(state.reads).toEqual(["session-1", "session-2"])
    expect([...state.sessions.keys()]).toEqual([second!.sessionID])
  })

  test("honors local deletion tombstones before the deletion event is delivered", async () => {
    const state = fixture()
    const first = await state.cache.open("local", "share-code", "/workspace")
    state.sessions.delete(first!.sessionID)
    state.deleted.add(first!.sessionID)
    const second = await state.cache.open("local", "share-code", "/workspace")
    expect(second?.sessionID).toBe("session-2")
    expect(state.reads).toEqual(["session-1", "session-2"])
  })

  test("reimports a remotely deleted session even when its event was missed", async () => {
    const state = fixture()
    const first = await state.cache.open("local", "share-code", "/workspace")
    state.sessions.delete(first!.sessionID)
    const second = await state.cache.open("local", "share-code", "/workspace")
    expect(second?.sessionID).toBe("session-2")
    expect(state.imports()).toBe(2)
  })

  test("reuses existing sessions with fresh metadata and isolates servers and directories", async () => {
    const state = fixture()
    const first = await state.cache.open("local", "share-code", "/workspace")
    state.sessions.get(first!.sessionID)!.title = "已重命名"
    const reopened = await state.cache.open("local", "share-code", "/workspace")
    expect(reopened?.sessionID).toBe(first?.sessionID)
    expect(reopened?.session.title).toBe("已重命名")
    expect(state.imports()).toBe(1)
    expect((await state.cache.open("other-server", "share-code", "/workspace"))?.sessionID).toBe("session-2")
    expect((await state.cache.open("local", "share-code", "/other"))?.sessionID).toBe("session-3")
  })

  test("does not duplicate imports on authentication or network errors", async () => {
    const state = fixture()
    const first = await state.cache.open("local", "share-code", "/workspace")
    state.fail(true)
    await expect(state.cache.open("local", "share-code", "/workspace")).rejects.toThrow("server unavailable")
    expect(state.imports()).toBe(1)
    state.fail(false)
    expect((await state.cache.open("local", "share-code", "/workspace"))?.sessionID).toBe(first?.sessionID)
  })
})

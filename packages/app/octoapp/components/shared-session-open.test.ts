import { expect, test } from "bun:test"
import { openPreparedSharedSession } from "./shared-session-open"

test.each(["design", "insight"] as const)(
  "switches to %s and waits for its directory before importing",
  async (module) => {
    const events: string[] = []
    const directory = `/${module}-selected-directory`
    const ready = Promise.withResolvers<string>()
    const waiting = Promise.withResolvers<void>()
    const task = openPreparedSharedSession({
      prepare: async () => {
        events.push("prepare")
        return { token: "prepared-zip", module }
      },
      select: (target) => {
        events.push(`select:${target}`)
      },
      ready: async (target) => {
        events.push(`wait:${target}`)
        waiting.resolve()
        return ready.promise
      },
      importSession: async (archive, target) => {
        expect(archive.token).toBe("prepared-zip")
        expect(target).toBe(directory)
        events.push("import")
        return { sessionID: "new-session" }
      },
      open: (result, target) => {
        expect(result.sessionID).toBe("new-session")
        events.push(`open:${target}`)
      },
      release: async (token) => {
        expect(token).toBe("prepared-zip")
        events.push("release")
      },
    })
    await waiting.promise
    expect(events).toEqual(["prepare", `select:${module}`, `wait:${module}`])
    ready.resolve(directory)
    await task
    expect(events).toEqual(["prepare", `select:${module}`, `wait:${module}`, "import", `open:${module}`, "release"])
  },
)

test("does not import before onboarding/context readiness and releases the ZIP on cancellation", async () => {
  const events: string[] = []
  await expect(
    openPreparedSharedSession({
      prepare: async () => ({ token: "prepared-zip", module: "design" }),
      select: () => {
        events.push("select")
      },
      ready: async () => {
        throw new Error("context cancelled")
      },
      importSession: async () => {
        events.push("import")
        return { sessionID: "unexpected" }
      },
      open: () => {
        events.push("open")
      },
      release: async () => {
        events.push("release")
      },
    }),
  ).rejects.toThrow("context cancelled")
  expect(events).toEqual(["select", "release"])
})

test("releases a prepared ZIP after an import failure without opening another module", async () => {
  const events: string[] = []
  await expect(
    openPreparedSharedSession({
      prepare: async () => ({ token: "prepared-zip", module: "insight" }),
      select: () => {},
      ready: async () => "/target",
      importSession: async () => {
        throw new Error("import failed")
      },
      open: () => {
        events.push("open")
      },
      release: async () => {
        events.push("release")
      },
    }),
  ).rejects.toThrow("import failed")
  expect(events).toEqual(["release"])
})

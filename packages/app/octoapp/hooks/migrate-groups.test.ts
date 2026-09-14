import { describe, expect, test } from "bun:test"
import type { OpencodeClient } from "@opencode-ai/sdk/v2/client"
import { migrateLocalGroupsToDB } from "./migrate-groups"

type FakeGroup = { id: string; name: string; time_created: number }
type FakeMapping = Record<string, { groupId: string; position: number }>

type Db = { groups: FakeGroup[]; mapping: FakeMapping; counter: number }

function makeClient(db: Db, behavior: { failOnCreateNum?: number } = {}): OpencodeClient {
  let createCalls = 0
  return {
    sessionGroup: {
      list: async () => ({ data: { groups: [...db.groups], mapping: { ...db.mapping } } }),
      create: async ({ name }: { namespace: "make" | "insight"; name: string }) => {
        createCalls += 1
        if (behavior.failOnCreateNum && createCalls === behavior.failOnCreateNum) {
          throw new Error("create failed")
        }
        const g: FakeGroup = { id: `g${++db.counter}`, name, time_created: Date.now() }
        db.groups.push(g)
        return { data: g }
      },
      mapSession: async ({ sessionId, groupId }: { sessionId: string; groupId: string }) => {
        db.mapping[sessionId] = { groupId, position: 0 }
        return { data: undefined }
      },
    },
  } as unknown as OpencodeClient
}

const gKey = (dir: string, ns: string) => `octo:${ns}-groups:${dir}`
const mKey = (dir: string, ns: string) => `octo:${ns}-session-groups:${dir}`

function seed(dir: string, ns = "make") {
  localStorage.setItem(gKey(dir, ns), JSON.stringify([{ id: "l1", name: "A" }, { id: "l2", name: "B" }]))
  localStorage.setItem(mKey(dir, ns), JSON.stringify({ "s1": "l1", "s2": "l2" }))
}

describe("migrateLocalGroupsToDB", () => {
  test("full success clears localStorage and creates all groups", async () => {
    const dir = "dir-ok"
    seed(dir)
    const db: Db = { groups: [], mapping: {}, counter: 0 }
    await migrateLocalGroupsToDB({ dir, namespace: "make", client: makeClient(db) })

    expect(localStorage.getItem(gKey(dir, "make"))).toBeNull()
    expect(localStorage.getItem(mKey(dir, "make"))).toBeNull()
    expect(db.groups.map((g) => g.name).sort()).toEqual(["A", "B"])
    expect(db.mapping["s1"]?.groupId).toBeDefined()
    expect(db.mapping["s2"]?.groupId).toBeDefined()
  })

  test("partial failure keeps localStorage and retries on next call (idempotent name-match)", async () => {
    const dir = "dir-partial"
    seed(dir)
    const db: Db = { groups: [], mapping: {}, counter: 0 }

    // first call: 2nd create throws → swallowed, not marked migrated, localStorage retained
    await migrateLocalGroupsToDB({ dir, namespace: "make", client: makeClient(db, { failOnCreateNum: 2 }) })
    expect(localStorage.getItem(gKey(dir, "make"))).not.toBeNull()
    expect(db.groups.map((g) => g.name)).toEqual(["A"])

    // second call: succeeding client, shared db already has A (name-match reuse), creates B
    await migrateLocalGroupsToDB({ dir, namespace: "make", client: makeClient(db) })
    expect(localStorage.getItem(gKey(dir, "make"))).toBeNull()
    expect(localStorage.getItem(mKey(dir, "make"))).toBeNull()
    expect(db.groups.map((g) => g.name).sort()).toEqual(["A", "B"])
    expect(db.mapping["s1"]?.groupId).toBeDefined()
    expect(db.mapping["s2"]?.groupId).toBeDefined()
  })

  test("idempotent when DB already has same-name group", async () => {
    const dir = "dir-idem"
    seed(dir)
    const existing: FakeGroup = { id: "gX", name: "A", time_created: 1 }
    const db: Db = { groups: [existing], mapping: {}, counter: 100 }
    await migrateLocalGroupsToDB({ dir, namespace: "make", client: makeClient(db) })

    // A reused (no duplicate), B created
    expect(db.groups.filter((g) => g.name === "A")).toHaveLength(1)
    expect(db.groups.find((g) => g.name === "A")?.id).toBe("gX")
    expect(db.groups.map((g) => g.name).sort()).toEqual(["A", "B"])
    expect(localStorage.getItem(gKey(dir, "make"))).toBeNull()
  })
})

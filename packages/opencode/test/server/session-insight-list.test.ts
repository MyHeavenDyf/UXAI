import { afterEach, describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { WithInstance } from "../../src/project/with-instance"
import { Session as SessionNs } from "@/session/session"
import { listInsightSessions } from "@/session/session-insight-query"
import * as Log from "@opencode-ai/core/util/log"
import { disposeAllInstances, tmpdir } from "../fixture/fixture"
import { Database } from "@/storage/db"
import { SessionTable } from "@/session/session.sql"
import type { SessionID } from "@/session/schema"
import { eq } from "drizzle-orm"
import { mkdir } from "fs/promises"
import path from "path"

void Log.init({ print: false })

function run<A, E>(fx: Effect.Effect<A, E, SessionNs.Service>) {
  return Effect.runPromise(fx.pipe(Effect.provide(SessionNs.defaultLayer)))
}

const svc = {
  create(input?: SessionNs.CreateInput) {
    return run(SessionNs.Service.use((s) => s.create(input)))
  },
  setSortOrder(input: { sessionID: SessionID; sortOrder: number }) {
    return run(SessionNs.Service.use((s) => s.setSortOrder(input)))
  },
}

function projectIDOf(sessionID: SessionID) {
  return Database.use((db) => db.select().from(SessionTable).where(eq(SessionTable.id, sessionID)).get())!.project_id
}

afterEach(async () => {
  await disposeAllInstances()
})

describe("insight.sessions.list (listInsightSessions)", () => {
  test("filters by agent=octo_insight server-side, excludes other agents and agent-less", async () => {
    await using tmp = await tmpdir({ git: true })
    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const a = await svc.create({ title: "insight-1", agent: "octo_insight" })
        const b = await svc.create({ title: "insight-2", agent: "octo_insight" })
        const make = await svc.create({ title: "make-1", agent: "octo_make" })
        const bare = await svc.create({ title: "no-agent" })

        const page = listInsightSessions({ projectID: projectIDOf(a.id), directory: tmp.path, limit: 100, offset: 0 })
        const ids = page.items.map((s) => s.id)

        expect(page.total).toBe(2)
        expect(ids).toContain(a.id)
        expect(ids).toContain(b.id)
        expect(ids).not.toContain(make.id)
        expect(ids).not.toContain(bare.id)
        expect(page.items.every((s) => s.agent === "octo_insight")).toBe(true)
      },
    })
  })

  test("paginates via limit/offset while total stays the full agent count", async () => {
    await using tmp = await tmpdir({ git: true })
    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const a = await svc.create({ title: "insight-1", agent: "octo_insight" })
        await svc.create({ title: "insight-2", agent: "octo_insight" })
        await svc.create({ title: "insight-3", agent: "octo_insight" })
        const projectID = projectIDOf(a.id)

        const first = listInsightSessions({ projectID, directory: tmp.path, limit: 2, offset: 0 })
        expect(first.items.length).toBe(2)
        expect(first.total).toBe(3)

        const second = listInsightSessions({ projectID, directory: tmp.path, limit: 2, offset: 2 })
        expect(second.items.length).toBe(1)
        expect(second.total).toBe(3)

        // 两页不重叠
        const overlap = first.items.map((s) => s.id).filter((id) => second.items.some((s) => s.id === id))
        expect(overlap.length).toBe(0)
      },
    })
  })

  test("scopes to the given directory, not sibling directories in the same project", async () => {
    await using tmp = await tmpdir({ git: true })
    await mkdir(path.join(tmp.path, "sub"), { recursive: true })
    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const here = await svc.create({ title: "here", agent: "octo_insight" })
        const sibling = await WithInstance.provide({
          directory: path.join(tmp.path, "sub"),
          fn: async () => svc.create({ title: "sibling", agent: "octo_insight" }),
        })

        const page = listInsightSessions({ projectID: projectIDOf(here.id), directory: tmp.path, limit: 100, offset: 0 })
        const ids = page.items.map((s) => s.id)
        expect(ids).toContain(here.id)
        expect(ids).not.toContain(sibling.id)
      },
    })
  })

  // 回归防线:排序必须与侧栏「最近」显示顺序一致(sort_order asc、time desc)。
  // 此前按 time desc 分页、客户端 recentSessions 按 sort_order 显示,后续页含
  // sort_order 更小的会话时会被重排到已显示条目之上,把列表第一条顶下去。
  test("pages in the sidebar display order (sort_order first, then time) so paging never displaces the first row", async () => {
    await using tmp = await tmpdir({ git: true })
    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const a = await svc.create({ title: "stale-1", agent: "octo_insight" })
        await new Promise((resolve) => setTimeout(resolve, 5))
        const b = await svc.create({ title: "stale-2", agent: "octo_insight" })
        await new Promise((resolve) => setTimeout(resolve, 5))
        const c = await svc.create({ title: "stale-3", agent: "octo_insight" })
        await new Promise((resolve) => setTimeout(resolve, 5))
        // Newest by time but holding a manual sort_order of 7 — the mix that
        // made time-desc paging reshuffle the sidebar list on load-more.
        const d = await svc.create({ title: "newest-but-reordered", agent: "octo_insight" })
        await svc.setSortOrder({ sessionID: d.id, sortOrder: 7 })
        const projectID = projectIDOf(a.id)

        const full = listInsightSessions({ projectID, directory: tmp.path, limit: 100, offset: 0 })
        expect(full.items.map((s) => s.id)).toEqual([c.id, b.id, a.id, d.id])

        const page1 = listInsightSessions({ projectID, directory: tmp.path, limit: 2, offset: 0 })
        const page2 = listInsightSessions({ projectID, directory: tmp.path, limit: 2, offset: 2 })
        expect(page1.items.map((s) => s.id)).toEqual([c.id, b.id])
        expect(page2.items.map((s) => s.id)).toEqual([a.id, d.id])
        // 分页前后列表第一条不变
        expect(page1.items[0]!.id).toBe(full.items[0]!.id)
      },
    })
  })
})

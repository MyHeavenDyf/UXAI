import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import z from "zod"
import { Instance } from "../../src/project/instance"
import { WithInstance } from "../../src/project/with-instance"
import { Project } from "@/project/project"
import { Session as SessionNs } from "@/session/session"
import * as Log from "@opencode-ai/core/util/log"
import { tmpdir } from "../fixture/fixture"
import type { SessionID } from "@/session/schema"

void Log.init({ print: false })

function run<A, E>(fx: Effect.Effect<A, E, SessionNs.Service>) {
  return Effect.runPromise(fx.pipe(Effect.provide(SessionNs.defaultLayer)))
}

const svc = {
  ...SessionNs,
  create(input?: SessionNs.CreateInput) {
    return run(SessionNs.Service.use((svc) => svc.create(input)))
  },
  setArchived(input: z.output<typeof SessionNs.SetArchivedInput.zod>) {
    return run(SessionNs.Service.use((svc) => svc.setArchived(input)))
  },
  setSortOrder(input: { sessionID: SessionID; sortOrder: number }) {
    return run(SessionNs.Service.use((svc) => svc.setSortOrder(input)))
  },
}

describe("session.listGlobal", () => {
  test("lists sessions across projects with project metadata", async () => {
    await using first = await tmpdir({ git: true })
    await using second = await tmpdir({ git: true })

    const firstSession = await WithInstance.provide({
      directory: first.path,
      fn: async () => svc.create({ title: "first-session" }),
    })
    const secondSession = await WithInstance.provide({
      directory: second.path,
      fn: async () => svc.create({ title: "second-session" }),
    })

    const sessions = [...svc.listGlobal({ limit: 200 })]
    const ids = sessions.map((session) => session.id)

    expect(ids).toContain(firstSession.id)
    expect(ids).toContain(secondSession.id)

    const firstProject = Project.get(firstSession.projectID)
    const secondProject = Project.get(secondSession.projectID)

    const firstItem = sessions.find((session) => session.id === firstSession.id)
    const secondItem = sessions.find((session) => session.id === secondSession.id)

    expect(firstItem?.project?.id).toBe(firstProject?.id)
    expect(firstItem?.project?.worktree).toBe(firstProject?.worktree)
    expect(secondItem?.project?.id).toBe(secondProject?.id)
    expect(secondItem?.project?.worktree).toBe(secondProject?.worktree)
  })

  test("excludes archived sessions by default", async () => {
    await using tmp = await tmpdir({ git: true })

    const archived = await WithInstance.provide({
      directory: tmp.path,
      fn: async () => svc.create({ title: "archived-session" }),
    })

    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => svc.setArchived({ sessionID: archived.id, time: Date.now() }),
    })

    const sessions = [...svc.listGlobal({ limit: 200 })]
    const ids = sessions.map((session) => session.id)

    expect(ids).not.toContain(archived.id)

    const allSessions = [...svc.listGlobal({ limit: 200, archived: true })]
    const allIds = allSessions.map((session) => session.id)

    expect(allIds).toContain(archived.id)
  })

  test("supports cursor pagination", async () => {
    await using tmp = await tmpdir({ git: true })

    const first = await WithInstance.provide({
      directory: tmp.path,
      fn: async () => svc.create({ title: "page-one" }),
    })
    await new Promise((resolve) => setTimeout(resolve, 5))
    const second = await WithInstance.provide({
      directory: tmp.path,
      fn: async () => svc.create({ title: "page-two" }),
    })

    const page = [...svc.listGlobal({ directory: tmp.path, limit: 1 })]
    expect(page.length).toBe(1)
    expect(page[0].id).toBe(second.id)

    const next = [...svc.listGlobal({ directory: tmp.path, limit: 10, cursor: page[0].time.updated })]
    const ids = next.map((session) => session.id)

    expect(ids).toContain(first.id)
    expect(ids).not.toContain(second.id)
  })

  // 回归防线:order=sort_order 让分页顺序与侧栏「最近」显示顺序一致
  // (sort_order asc、time desc、id desc)。此前按 time desc 分页、客户端按
  // sort_order 显示:只要目录里有非 0 sort_order(拖拽重排/取消置顶会给已加载
  // 会话写 0..N,未加载与新会话保持 0),后续页就会含 sort_order 更小的会话,
  // 追加后被客户端重排到已显示条目之上,把列表第一条顶下去。
  test("order=sort_order pages in sidebar display order so later pages never displace the first row", async () => {
    await using tmp = await tmpdir({ git: true })

    const create = (title: string) => WithInstance.provide({ directory: tmp.path, fn: () => svc.create({ title }) })
    const s1 = await create("stale-1")
    await new Promise((resolve) => setTimeout(resolve, 5))
    const s2 = await create("stale-2")
    await new Promise((resolve) => setTimeout(resolve, 5))
    const s3 = await create("stale-3")
    await new Promise((resolve) => setTimeout(resolve, 5))
    const s4 = await create("stale-4")
    await new Promise((resolve) => setTimeout(resolve, 5))
    // Newest by time but holding a manual sort_order of 7 — the real-world mix
    // after a drag-reorder: loaded sessions got 0..N, unloaded/new ones keep 0.
    const s5 = await create("newest-but-reordered")
    await WithInstance.provide({ directory: tmp.path, fn: () => svc.setSortOrder({ sessionID: s5.id, sortOrder: 7 }) })

    // Default paging is unchanged: newest by time first.
    expect([...svc.listGlobal({ directory: tmp.path, limit: 1 })].map((s) => s.id)).toEqual([s5.id])

    // sort_order paging returns the sidebar display order: the sort-0 cohort by
    // recency first, the reordered session last — stable from page one on.
    const page1 = [...svc.listGlobal({ directory: tmp.path, limit: 1, order: "sort_order" })]
    expect(page1.map((s) => s.id)).toEqual([s4.id])

    // Composite cursor resumes strictly below page 1; nothing jumps above it.
    const cursor = `${page1[0].sort_order}:${page1[0].time.updated}:${page1[0].id}`
    const page2 = [...svc.listGlobal({ directory: tmp.path, limit: 10, order: "sort_order", cursor })]
    expect(page2.map((s) => s.id)).toEqual([s3.id, s2.id, s1.id, s5.id])
  })
})

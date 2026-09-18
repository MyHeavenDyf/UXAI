import { afterEach, describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Instance } from "../../src/project/instance"
import { WithInstance } from "../../src/project/with-instance"
import { Server } from "../../src/server/server"
import { ExperimentalPaths } from "../../src/server/routes/instance/httpapi/groups/experimental"
import { Session } from "@/session/session"
import { SessionGroup } from "@/session/session-group"
import { SessionTable } from "@/session/session.sql"
import { Database } from "@/storage/db"
import { eq } from "drizzle-orm"
import * as Log from "@opencode-ai/core/util/log"
import { Worktree } from "../../src/worktree"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, tmpdir } from "../fixture/fixture"
import { waitGlobalBusEventPromise } from "./global-bus"

void Log.init({ print: false })

const original = Flag.OPENCODE_EXPERIMENTAL_HTTPAPI
const testWorktreeMutations = process.platform === "win32" ? test.skip : test

function app() {
  Flag.OPENCODE_EXPERIMENTAL_HTTPAPI = true
  return Server.Default().app
}

function runSession<A, E>(fx: Effect.Effect<A, E, Session.Service>) {
  return Effect.runPromise(fx.pipe(Effect.provide(Session.defaultLayer)))
}

const sessionGroupLayer = Layer.mergeAll(Session.defaultLayer, SessionGroup.defaultLayer)
function runWithGroup<A, E>(fx: Effect.Effect<A, E, Session.Service | SessionGroup.Service>) {
  return Effect.runPromise(fx.pipe(Effect.provide(sessionGroupLayer)))
}

function createSession(input?: Session.CreateInput) {
  return runSession(Session.Service.use((svc) => svc.create(input)))
}

async function waitReady(directory: string) {
  await waitGlobalBusEventPromise({
    message: "timed out waiting for worktree.ready",
    predicate: (event) => event.payload.type === Worktree.Event.Ready.type && event.directory === directory,
  })
}

afterEach(async () => {
  Flag.OPENCODE_EXPERIMENTAL_HTTPAPI = original
  await disposeAllInstances()
  await resetDatabase()
})

describe("experimental HttpApi", () => {
  test("serves read-only experimental endpoints through Hono bridge", async () => {
    await using tmp = await tmpdir({
      config: {
        formatter: false,
        lsp: false,
        mcp: {
          demo: {
            type: "local",
            command: ["echo", "demo"],
            enabled: false,
          },
        },
      },
    })

    const headers = { "x-opencode-directory": tmp.path }
    const [consoleState, consoleOrgs, toolList, toolIDs, worktrees, resources] = await Promise.all([
      app().request(ExperimentalPaths.console, { headers }),
      app().request(ExperimentalPaths.consoleOrgs, { headers }),
      app().request(`${ExperimentalPaths.tool}?provider=opencode&model=gpt-5`, { headers }),
      app().request(ExperimentalPaths.toolIDs, { headers }),
      app().request(ExperimentalPaths.worktree, { headers }),
      app().request(ExperimentalPaths.resource, { headers }),
    ])

    expect(consoleState.status).toBe(200)
    expect(await consoleState.json()).toEqual({
      consoleManagedProviders: [],
      switchableOrgCount: 0,
    })

    expect(consoleOrgs.status).toBe(200)
    expect(await consoleOrgs.json()).toEqual({ orgs: [] })

    expect(toolList.status).toBe(200)
    expect(await toolList.json()).toContainEqual(
      expect.objectContaining({
        id: "bash",
        description: expect.any(String),
        parameters: expect.any(Object),
      }),
    )

    expect(toolIDs.status).toBe(200)
    expect(await toolIDs.json()).toContain("bash")

    expect(worktrees.status).toBe(200)
    expect(await worktrees.json()).toEqual([])

    expect(resources.status).toBe(200)
    expect(await resources.json()).toEqual({})
  })

  test("serves Console org switch through Hono bridge", async () => {
    await using tmp = await tmpdir({ config: { formatter: false, lsp: false } })
    Database.Client()
      .$client.prepare(
        "INSERT INTO account (id, email, url, access_token, refresh_token, time_created, time_updated) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        "account-test",
        "test@example.com",
        "https://console.example.com",
        "access",
        "refresh",
        Date.now(),
        Date.now(),
      )

    const switched = await app().request(ExperimentalPaths.consoleSwitch, {
      method: "POST",
      headers: { "x-opencode-directory": tmp.path, "content-type": "application/json" },
      body: JSON.stringify({ accountID: "account-test", orgID: "org-test" }),
    })

    expect(switched.status).toBe(200)
    expect(await switched.json()).toBe(true)
  })

  test("serves global session list through Hono bridge", async () => {
    await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })

    const first = await WithInstance.provide({
      directory: tmp.path,
      fn: async () => createSession({ title: "page-one" }),
    })
    await new Promise((resolve) => setTimeout(resolve, 5))
    const second = await WithInstance.provide({
      directory: tmp.path,
      fn: async () => createSession({ title: "page-two" }),
    })

    const headers = { "x-opencode-directory": tmp.path }
    const page = await app().request(
      `${ExperimentalPaths.session}?${new URLSearchParams({ directory: tmp.path, limit: "1" })}`,
      { headers },
    )
    expect(page.status).toBe(200)
    expect(page.headers.get("x-next-cursor")).toBeTruthy()

    const body = (await page.json()) as Session.GlobalInfo[]
    expect(body.map((session) => session.id)).toEqual([second.id])
    expect(body[0].project?.id).toBe(second.projectID)

    const next = await app().request(
      `${ExperimentalPaths.session}?${new URLSearchParams({
        directory: tmp.path,
        limit: "10",
        cursor: `${body[0].time.updated}:${body[0].id}`,
      })}`,
      { headers },
    )
    expect(next.status).toBe(200)
    expect(((await next.json()) as Session.GlobalInfo[]).map((session) => session.id)).toContain(first.id)
  })

  test("paginates with composite cursor when sessions share the same timestamp", async () => {
    await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })

    const sessions: Session.Info[] = []
    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const created: Session.Info[] = []
        for (let i = 0; i < 3; i++) {
          created.push(await createSession({ title: `same-time-${i}` }))
        }
        // Force identical timestamps to verify composite cursor disambiguation.
        const now = Date.now()
        Database.use((db) => {
          for (const s of created) {
            db.update(SessionTable).set({ time_updated: now }).where(eq(SessionTable.id, s.id)).run()
          }
        })
        sessions.push(...created)
      },
    })

    const headers = { "x-opencode-directory": tmp.path }
    const first = await app().request(
      `${ExperimentalPaths.session}?${new URLSearchParams({ directory: tmp.path, limit: "1" })}`,
      { headers },
    )
    expect(first.status).toBe(200)
    const firstBody = (await first.json()) as Session.GlobalInfo[]
    expect(firstBody.length).toBe(1)
    const nextCursor = first.headers.get("x-next-cursor")
    expect(nextCursor).toBeTruthy()

    const second = await app().request(
      `${ExperimentalPaths.session}?${new URLSearchParams({
        directory: tmp.path,
        limit: "10",
        cursor: nextCursor!,
      })}`,
      { headers },
    )
    expect(second.status).toBe(200)
    const secondBody = (await second.json()) as Session.GlobalInfo[]
    const firstIds = firstBody.map((s) => s.id)
    const secondIds = secondBody.map((s) => s.id)
    expect(secondIds.some((id) => firstIds.includes(id))).toBe(false)
    for (const s of sessions) {
      expect([...firstIds, ...secondIds]).toContain(s.id)
    }
  })

  test("filters global session list by agent", async () => {
    await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })

    const make = await WithInstance.provide({
      directory: tmp.path,
      fn: async () => createSession({ title: "make-one", agent: "octo_make" }),
    })
    await new Promise((resolve) => setTimeout(resolve, 5))
    const insight = await WithInstance.provide({
      directory: tmp.path,
      fn: async () => createSession({ title: "insight-one", agent: "octo_insight" }),
    })

    const headers = { "x-opencode-directory": tmp.path }
    const filtered = await app().request(
      `${ExperimentalPaths.session}?${new URLSearchParams({ directory: tmp.path, agent: "octo_make" })}`,
      { headers },
    )
    expect(filtered.status).toBe(200)
    const filteredBody = (await filtered.json()) as Session.GlobalInfo[]
    expect(filteredBody.map((session) => session.id)).toEqual([make.id])
    expect(filteredBody.every((session) => session.agent === "octo_make")).toBe(true)

    const all = await app().request(
      `${ExperimentalPaths.session}?${new URLSearchParams({ directory: tmp.path })}`,
      { headers },
    )
    const allBody = (await all.json()) as Session.GlobalInfo[]
    expect(allBody.map((session) => session.id)).toContain(make.id)
    expect(allBody.map((session) => session.id)).toContain(insight.id)
  })

  test("filters global session list by grouped flag", async () => {
    await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })

    const grouped = await WithInstance.provide({
      directory: tmp.path,
      fn: async () => createSession({ title: "grouped-session", agent: "octo_make" }),
    })
    await new Promise((resolve) => setTimeout(resolve, 5))
    const ungrouped = await WithInstance.provide({
      directory: tmp.path,
      fn: async () => createSession({ title: "ungrouped-session", agent: "octo_make" }),
    })

    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const group = await runWithGroup(
          SessionGroup.Service.use((svc) =>
            svc.create({ projectID: grouped.projectID, directory: tmp.path, namespace: "make", name: "Test Group" }),
          ),
        )
        await runWithGroup(
          SessionGroup.Service.use((svc) => svc.mapSession(grouped.id, group.id)),
        )
      },
    })

    const headers = { "x-opencode-directory": tmp.path }
    const filtered = await app().request(
      `${ExperimentalPaths.session}?${new URLSearchParams({ directory: tmp.path, grouped: "true", agent: "octo_make" })}`,
      { headers },
    )
    expect(filtered.status).toBe(200)
    const filteredBody = (await filtered.json()) as Session.GlobalInfo[]
    expect(filteredBody.map((s) => s.id)).toEqual([grouped.id])

    const all = await app().request(
      `${ExperimentalPaths.session}?${new URLSearchParams({ directory: tmp.path, agent: "octo_make" })}`,
      { headers },
    )
    const allBody = (await all.json()) as Session.GlobalInfo[]
    expect(allBody.map((s) => s.id)).toContain(grouped.id)
    expect(allBody.map((s) => s.id)).toContain(ungrouped.id)
  })

  testWorktreeMutations("serves worktree mutations through Hono bridge", async () => {
    await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })

    const headers = { "x-opencode-directory": tmp.path, "content-type": "application/json" }
    const created = await app().request(ExperimentalPaths.worktree, {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "api-test" }),
    })

    expect(created.status).toBe(200)
    const info = (await created.json()) as Worktree.Info
    expect(info).toMatchObject({ name: "api-test", branch: "opencode/api-test" })
    await waitReady(info.directory)

    const listed = await app().request(ExperimentalPaths.worktree, { headers })
    expect(listed.status).toBe(200)
    expect(await listed.json()).toContain(info.directory)

    if (process.platform !== "win32") {
      const reset = await app().request(ExperimentalPaths.worktreeReset, {
        method: "POST",
        headers,
        body: JSON.stringify({ directory: info.directory }),
      })

      expect(reset.status).toBe(200)
      expect(await reset.json()).toBe(true)
    }

    const removed = await app().request(ExperimentalPaths.worktree, {
      method: "DELETE",
      headers,
      body: JSON.stringify({ directory: info.directory }),
    })

    expect(removed.status).toBe(200)
    expect(await removed.json()).toBe(true)

    const afterRemove = await app().request(ExperimentalPaths.worktree, { headers })
    expect(afterRemove.status).toBe(200)
    expect(await afterRemove.json()).toEqual([])
  })
})

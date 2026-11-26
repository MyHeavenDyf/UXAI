import { expect, test } from "bun:test"
import { AppRuntime } from "@/effect/app-runtime"
import { Session } from "@/session/session"
import { SessionStatus } from "@/session/status"
import { MessageID, PartID } from "@/session/schema"
import { Database, eq } from "@/storage/db"
import { StudioGenerationTable } from "@/studio/studio-generation.sql"
import { withStudioSubmission } from "@/studio/prompt-recommendation-state"
import { getUpdateReadiness } from "@/update/readiness"
import { GlobalRoutes } from "@/server/routes/global"
import { ExperimentalHttpApiServer } from "@/server/routes/instance/httpapi/server"
import { provideTestInstance, tmpdir } from "../fixture/fixture"

test("update readiness includes busy and retrying sessions from other workspaces and clears on disposal", async () => {
  await using first = await tmpdir({ git: true })
  await using second = await tmpdir({ git: true })
  await provideTestInstance({ directory: first.path, fn: async () => {
    const session = await AppRuntime.runPromise(Session.Service.use((service) => service.create({ title: "running" })))
    await AppRuntime.runPromise(SessionStatus.Service.use((service) => service.set(session.id, { type: "busy" })))
    await provideTestInstance({ directory: second.path, fn: async () => {
      expect((await AppRuntime.runPromise(getUpdateReadiness)).ready).toBe(false)
      const response = await GlobalRoutes().request("/update-readiness")
      expect(await response.json()).toMatchObject({ ready: false })
      const httpapi = await ExperimentalHttpApiServer.webHandler().handler(
        new Request("http://localhost/global/update-readiness"), ExperimentalHttpApiServer.context,
      )
      expect(httpapi.status).toBe(200)
      expect(await httpapi.json()).toMatchObject({ ready: false })
    } })
    await AppRuntime.runPromise(SessionStatus.Service.use((service) => service.set(session.id, {
      type: "retry", attempt: 1, message: "retrying", next: Date.now() + 1000,
    })))
    expect((await AppRuntime.runPromise(getUpdateReadiness)).ready).toBe(false)
    await AppRuntime.runPromise(SessionStatus.Service.use((service) => service.set(session.id, { type: "idle" })))
    expect((await AppRuntime.runPromise(getUpdateReadiness)).ready).toBe(true)
    await AppRuntime.runPromise(SessionStatus.Service.use((service) => service.set(session.id, { type: "busy" })))
  } })
  expect((await AppRuntime.runPromise(getUpdateReadiness)).ready).toBe(true)
})

test("update readiness blocks queued, creating and running Studio generations", async () => {
  await using source = await tmpdir({ git: true })
  await provideTestInstance({ directory: source.path, fn: async () => {
    const session = await AppRuntime.runPromise(Session.Service.use((service) => service.create({ title: "Studio" })))
    Database.use((db) => db.insert(StudioGenerationTable).values({
      id: "update-test-generation", session_id: session.id, directory: source.path,
      assistant_message_id: MessageID.make("test-message"), tool_part_id: PartID.make("test-part"), provider: "jimeng",
      capability: "image.generate", status: "creating", request: {}, next_poll_at: 0,
    }).run())
    try {
      for (const status of ["creating", "queued", "running"] as const) {
        Database.use((db) => db.update(StudioGenerationTable).set({ status })
          .where(eq(StudioGenerationTable.id, "update-test-generation")).run())
        expect((await AppRuntime.runPromise(getUpdateReadiness)).ready).toBe(false)
      }
      Database.use((db) => db.update(StudioGenerationTable).set({ status: "succeeded" })
        .where(eq(StudioGenerationTable.id, "update-test-generation")).run())
      expect((await AppRuntime.runPromise(getUpdateReadiness)).ready).toBe(true)
    } finally {
      Database.use((db) => db.delete(StudioGenerationTable).where(eq(StudioGenerationTable.id, "update-test-generation")).run())
    }
  } })
})

test("update readiness blocks Studio submissions before a generation record exists", async () => {
  await using source = await tmpdir({ git: true })
  await provideTestInstance({ directory: source.path, fn: async () => {
    await withStudioSubmission("pending-studio-request", async () => {
      expect((await AppRuntime.runPromise(getUpdateReadiness)).ready).toBe(false)
    })
    expect((await AppRuntime.runPromise(getUpdateReadiness)).ready).toBe(true)
  } })
})

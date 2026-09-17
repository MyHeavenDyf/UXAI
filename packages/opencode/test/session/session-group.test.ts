import { afterEach, describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { WithInstance } from "@/project/with-instance"
import { Session as SessionNs } from "@/session/session"
import { SessionGroup } from "@/session/session-group"
import { tmpdir, disposeAllInstances } from "../fixture/fixture"
import * as Log from "@opencode-ai/core/util/log"

void Log.init({ print: false })

const layer = Layer.mergeAll(SessionNs.defaultLayer, SessionGroup.defaultLayer)

function run<A, E>(fx: Effect.Effect<A, E, SessionNs.Service | SessionGroup.Service>) {
  return Effect.runPromise(fx.pipe(Effect.provide(layer)))
}

afterEach(async () => {
  await disposeAllInstances()
})

describe("SessionGroup.reorderSessions group_id scoping", () => {
  test("reorderSessions does not touch mappings outside the target group", async () => {
    await using tmp = await tmpdir({ git: true })
    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await run(
          Effect.gen(function* () {
            const svc = yield* SessionNs.Service
            return yield* svc.create({ title: "s1" })
          }),
        )

        const dir = tmp.path
        const groupA = await run(
          Effect.gen(function* () {
            const svc = yield* SessionGroup.Service
            return yield* svc.create({ projectID: session.projectID, directory: dir, namespace: "make", name: "A" })
          }),
        )
        const groupB = await run(
          Effect.gen(function* () {
            const svc = yield* SessionGroup.Service
            return yield* svc.create({ projectID: session.projectID, directory: dir, namespace: "make", name: "B" })
          }),
        )

        await run(
          Effect.gen(function* () {
            const svc = yield* SessionGroup.Service
            yield* svc.mapSession(session.id, groupA.id)
          }),
        )

        // reorder on B while s1 is still in A: group_id guard must make this a no-op
        await run(
          Effect.gen(function* () {
            const svc = yield* SessionGroup.Service
            yield* svc.reorderSessions(groupB.id, [session.id])
          }),
        )
        const afterB = await run(
          Effect.gen(function* () {
            const svc = yield* SessionGroup.Service
            return yield* svc.list(dir, "make")
          }),
        )
        expect(afterB.mapping[session.id]?.groupId).toBe(groupA.id)

        // reorder on A (the group s1 actually belongs to): position updates
        await run(
          Effect.gen(function* () {
            const svc = yield* SessionGroup.Service
            yield* svc.reorderSessions(groupA.id, [session.id])
          }),
        )
        const afterA = await run(
          Effect.gen(function* () {
            const svc = yield* SessionGroup.Service
            return yield* svc.list(dir, "make")
          }),
        )
        expect(afterA.mapping[session.id]?.groupId).toBe(groupA.id)
        expect(afterA.mapping[session.id]?.position).toBe(0)
      },
    })
  })
})

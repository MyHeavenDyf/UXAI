import { afterEach, beforeEach, test, expect } from "bun:test"
import { Effect, Fiber, Layer } from "effect"
import { Bus } from "../../src/bus"
import { GlobalBus, type GlobalEvent } from "../../src/bus/global"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Permission } from "../../src/permission"
import { PermissionID } from "../../src/permission/schema"
import {
  clearPendingAsks,
  emitPendingAsks,
  pendingAskCount,
  trackPendingAsk,
  untrackPendingAsk,
} from "../../src/permission/pending-registry"
import { Instance } from "../../src/project/instance"
import { InstanceRuntime } from "../../src/project/instance-runtime"
import { WithInstance } from "../../src/project/with-instance"
import { disposeAllInstances, provideInstance, provideTmpdirInstance, tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { SessionID } from "../../src/session/schema"

const bus = Bus.layer
const env = Layer.mergeAll(Permission.layer.pipe(Layer.provide(bus)), bus, CrossSpawnSpawner.defaultLayer)
const it = testEffect(env)

beforeEach(() => {
  clearPendingAsks()
})

afterEach(async () => {
  await disposeAllInstances()
  clearPendingAsks()
})

const ask = (input: Parameters<Permission.Interface["ask"]>[0]) =>
  Effect.gen(function* () {
    const permission = yield* Permission.Service
    return yield* permission.ask(input)
  })

const reply = (input: Parameters<Permission.Interface["reply"]>[0]) =>
  Effect.gen(function* () {
    const permission = yield* Permission.Service
    return yield* permission.reply(input)
  })

const waitForPending = (count: number) =>
  Effect.gen(function* () {
    const permission = yield* Permission.Service
    for (let i = 0; i < 100; i++) {
      const list = yield* permission.list()
      if (list.length === count) return list
      yield* Effect.sleep("10 millis")
    }
    return yield* Effect.fail(new Error(`timed out waiting for ${count} pending permission request(s)`))
  })

const sampleRequest = () =>
  new Permission.Request({
    id: PermissionID.make("per_replay_unit"),
    sessionID: SessionID.make("session_replay"),
    permission: "edit",
    patterns: ["foo.ts"],
    metadata: {},
    always: [],
  })

// ── registry 单元:emitPendingAsks 走 GlobalBus,与 Bus.publish 同构的 envelope ──

test("emitPendingAsks re-emits tracked asks on the global bus with bus-compatible envelope", () => {
  const seen: GlobalEvent[] = []
  const listener = (event: GlobalEvent) => {
    seen.push(event)
  }
  GlobalBus.on("event", listener)
  try {
    const info = sampleRequest()
    trackPendingAsk(info.id, { directory: "/tmp/replay-test", project: "proj_replay", workspace: "ws", info })
    expect(pendingAskCount()).toBe(1)

    emitPendingAsks()

    expect(seen).toHaveLength(1)
    expect(seen[0].directory).toBe("/tmp/replay-test")
    expect(seen[0].project).toBe("proj_replay")
    expect(seen[0].workspace).toBe("ws")
    expect(seen[0].payload.type).toBe("permission.asked")
    expect(seen[0].payload.id).toBeDefined()
    expect(seen[0].payload.properties).toMatchObject({
      id: info.id,
      sessionID: info.sessionID,
      permission: "edit",
      patterns: ["foo.ts"],
    })
  } finally {
    GlobalBus.off("event", listener)
    untrackPendingAsk(PermissionID.make("per_replay_unit"))
  }
  expect(pendingAskCount()).toBe(0)
})

test("emitPendingAsks is a no-op when nothing is pending", () => {
  const seen: GlobalEvent[] = []
  const listener = (event: GlobalEvent) => {
    seen.push(event)
  }
  GlobalBus.on("event", listener)
  try {
    emitPendingAsks()
    expect(seen).toHaveLength(0)
  } finally {
    GlobalBus.off("event", listener)
  }
})

// ── ask/reply 集成:registry 随 pending 生命周期登记与移除 ──

it.live("ask - tracks pending ask in the global registry until replied", () =>
  provideTmpdirInstance(() =>
    Effect.gen(function* () {
      const fiber = yield* ask({
        id: PermissionID.make("per_track1"),
        sessionID: SessionID.make("session_track"),
        permission: "bash",
        patterns: ["ls"],
        metadata: {},
        always: [],
        ruleset: [],
      }).pipe(Effect.forkScoped)

      expect(yield* waitForPending(1)).toHaveLength(1)
      expect(pendingAskCount()).toBe(1)

      yield* reply({ requestID: PermissionID.make("per_track1"), reply: "once" })
      yield* Fiber.join(fiber)
      expect(pendingAskCount()).toBe(0)
    }),
  ),
)

it.live("reply - reject removes the tracked ask", () =>
  provideTmpdirInstance(() =>
    Effect.gen(function* () {
      const fiber = yield* ask({
        id: PermissionID.make("per_track2"),
        sessionID: SessionID.make("session_track"),
        permission: "bash",
        patterns: ["ls"],
        metadata: {},
        always: [],
        ruleset: [],
      }).pipe(Effect.forkScoped)

      yield* waitForPending(1)
      expect(pendingAskCount()).toBe(1)

      yield* reply({ requestID: PermissionID.make("per_track2"), reply: "reject" })
      yield* Fiber.await(fiber)
      expect(pendingAskCount()).toBe(0)
    }),
  ),
)

it.live("instance dispose clears the registry", () =>
  Effect.gen(function* () {
    const dir = yield* tmpdirScoped()
    const run = provideInstance(dir)
    const fiber = yield* ask({
      id: PermissionID.make("per_track3"),
      sessionID: SessionID.make("session_track"),
      permission: "bash",
      patterns: ["ls"],
      metadata: {},
      always: [],
      ruleset: [],
    }).pipe(run, Effect.forkScoped)

    expect(yield* waitForPending(1).pipe(run)).toHaveLength(1)
    expect(pendingAskCount()).toBe(1)

    yield* Effect.promise(() =>
      WithInstance.provide({ directory: dir, fn: () => void InstanceRuntime.disposeInstance(Instance.current) }),
    )
    yield* Fiber.await(fiber)
    expect(pendingAskCount()).toBe(0)
  }),
)

it.live("emitPendingAsks delivers a real pending ask with its instance directory", () =>
  provideTmpdirInstance(
    (dir) =>
      Effect.gen(function* () {
        const fiber = yield* ask({
          id: PermissionID.make("per_track4"),
          sessionID: SessionID.make("session_track"),
          permission: "bash",
          patterns: ["ls"],
          metadata: {},
          always: [],
          ruleset: [],
        }).pipe(Effect.forkScoped)

        expect(yield* waitForPending(1)).toHaveLength(1)

        const seen: GlobalEvent[] = []
        const listener = (event: GlobalEvent) => {
          seen.push(event)
        }
        GlobalBus.on("event", listener)
        try {
          emitPendingAsks()
          const replay = seen.find((event) => event.payload?.type === "permission.asked")
          expect(replay).toBeDefined()
          expect(replay!.directory).toBe(dir)
          expect(replay!.payload.properties).toMatchObject({ id: PermissionID.make("per_track4") })
        } finally {
          GlobalBus.off("event", listener)
        }

        yield* reply({ requestID: PermissionID.make("per_track4"), reply: "once" })
        yield* Fiber.join(fiber)
      }),
    { git: true },
  ),
)

import { afterEach, beforeEach, test, expect } from "bun:test"
import { Effect, Fiber, Layer } from "effect"
import { GlobalBus, type GlobalEvent } from "../../src/bus/global"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Question } from "../../src/question"
import { QuestionID } from "../../src/question/schema"
import {
  clearPendingAsks,
  emitPendingAsks,
  pendingAskCount,
  trackPendingAsk,
  untrackPendingAsk,
} from "../../src/question/pending-registry"
import { Instance } from "../../src/project/instance"
import { InstanceRuntime } from "../../src/project/instance-runtime"
import { WithInstance } from "../../src/project/with-instance"
import { disposeAllInstances, provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { SessionID } from "../../src/session/schema"

const env = Layer.mergeAll(Question.defaultLayer, CrossSpawnSpawner.defaultLayer)
const it = testEffect(env)

beforeEach(() => {
  clearPendingAsks()
})

afterEach(async () => {
  await disposeAllInstances()
  clearPendingAsks()
})

const ask = (input: { sessionID: SessionID; questions: ReadonlyArray<Question.Info> }) =>
  Effect.gen(function* () {
    const question = yield* Question.Service
    return yield* question.ask(input)
  })

const reply = (input: { requestID: QuestionID; answers: ReadonlyArray<Question.Answer> }) =>
  Effect.gen(function* () {
    const question = yield* Question.Service
    yield* question.reply(input)
  })

const reject = (requestID: QuestionID) =>
  Effect.gen(function* () {
    const question = yield* Question.Service
    yield* question.reject(requestID)
  })

const waitForPending = (count: number) =>
  Effect.gen(function* () {
    const question = yield* Question.Service
    for (let i = 0; i < 100; i++) {
      const list = yield* question.list()
      if (list.length === count) return list
      yield* Effect.sleep("10 millis")
    }
    return yield* Effect.fail(new Error(`timed out waiting for ${count} pending question request(s)`))
  })

const sampleRequest = () =>
  new Question.Request({
    id: QuestionID.make("que_replay_unit"),
    sessionID: SessionID.make("session_replay"),
    questions: [
      {
        question: "Use the existing project?",
        header: "Source",
        options: [
          { label: "Existing", description: "Reuse the current workspace" },
          { label: "New", description: "Create from scratch" },
        ],
      },
    ],
  })

const sampleQuestions = (): ReadonlyArray<Question.Info> => [
  {
    question: "Use the existing project?",
    header: "Source",
    options: [
      { label: "Existing", description: "Reuse the current workspace" },
      { label: "New", description: "Create from scratch" },
    ],
  },
]

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
    expect(seen[0].payload.type).toBe("question.asked")
    expect(seen[0].payload.id).toBeDefined()
    expect(seen[0].payload.properties).toMatchObject({
      id: info.id,
      sessionID: info.sessionID,
    })
  } finally {
    GlobalBus.off("event", listener)
    untrackPendingAsk(QuestionID.make("que_replay_unit"))
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

// ── ask/reply/reject 集成:registry 随 pending 生命周期登记与移除 ──

it.live("ask - tracks pending ask in the global registry until replied", () =>
  provideTmpdirInstance(
    () =>
      Effect.gen(function* () {
        const fiber = yield* ask({
          sessionID: SessionID.make("session_track"),
          questions: sampleQuestions(),
        }).pipe(Effect.forkScoped)

        const pending = yield* waitForPending(1)
        expect(pending).toHaveLength(1)
        expect(pendingAskCount()).toBe(1)

        yield* reply({ requestID: pending[0].id, answers: [["Existing"]] })
        yield* Fiber.join(fiber)
        expect(pendingAskCount()).toBe(0)
      }),
    { git: true },
  ),
)

it.live("reject - removes the tracked ask", () =>
  provideTmpdirInstance(
    () =>
      Effect.gen(function* () {
        const fiber = yield* ask({
          sessionID: SessionID.make("session_track"),
          questions: sampleQuestions(),
        }).pipe(Effect.forkScoped)

        const pending = yield* waitForPending(1)
        expect(pendingAskCount()).toBe(1)

        yield* reject(pending[0].id)
        yield* Fiber.await(fiber)
        expect(pendingAskCount()).toBe(0)
      }),
    { git: true },
  ),
)

it.live("instance dispose clears the registry", () =>
  provideTmpdirInstance(
    (dir) =>
      Effect.gen(function* () {
        const fiber = yield* ask({
          sessionID: SessionID.make("session_track"),
          questions: sampleQuestions(),
        }).pipe(Effect.forkScoped)

        expect(yield* waitForPending(1)).toHaveLength(1)
        expect(pendingAskCount()).toBe(1)

        yield* Effect.promise(() =>
          WithInstance.provide({ directory: dir, fn: () => InstanceRuntime.disposeInstance(Instance.current) }),
        )
        yield* Fiber.await(fiber)
        expect(pendingAskCount()).toBe(0)
      }),
    { git: true },
  ),
)

it.live("emitPendingAsks delivers a real pending ask with its instance directory", () =>
  provideTmpdirInstance(
    (dir) =>
      Effect.gen(function* () {
        const fiber = yield* ask({
          sessionID: SessionID.make("session_track"),
          questions: sampleQuestions(),
        }).pipe(Effect.forkScoped)

        const pending = yield* waitForPending(1)
        expect(pending).toHaveLength(1)

        const seen: GlobalEvent[] = []
        const listener = (event: GlobalEvent) => {
          seen.push(event)
        }
        GlobalBus.on("event", listener)
        try {
          emitPendingAsks()
          const replay = seen.find((event) => event.payload?.type === "question.asked")
          expect(replay).toBeDefined()
          expect(replay!.directory).toBe(dir)
          expect(replay!.payload.properties).toMatchObject({ id: pending[0].id })
        } finally {
          GlobalBus.off("event", listener)
        }

        yield* reply({ requestID: pending[0].id, answers: [["Existing"]] })
        yield* Fiber.join(fiber)
      }),
    { git: true },
  ),
)

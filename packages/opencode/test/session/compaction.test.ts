import { afterEach, describe, expect, mock, test } from "bun:test"
import { APICallError } from "ai"
import { Cause, Effect, Exit, Layer, ManagedRuntime } from "effect"
import * as Stream from "effect/Stream"
import z from "zod"
import { Bus } from "../../src/bus"
import { Config } from "@/config/config"
import { Agent } from "../../src/agent/agent"
import { LLM } from "../../src/session/llm"
import { SessionCompaction } from "../../src/session/compaction"
import { exceedsContext, preflight } from "../../src/session/overflow"
import { Token } from "@/util/token"
import { Instance } from "../../src/project/instance"
import { WithInstance } from "../../src/project/with-instance"
import * as Log from "@opencode-ai/core/util/log"
import { Permission } from "../../src/permission"
import { Plugin } from "../../src/plugin"
import { provideTmpdirInstance, tmpdir } from "../fixture/fixture"
import { Session as SessionNs } from "@/session/session"
import { MessageV2 } from "../../src/session/message-v2"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { SessionStatus } from "../../src/session/status"
import { SessionSummary } from "../../src/session/summary"
import { SessionV2 } from "../../src/v2/session"
import { ModelID, ProviderID } from "../../src/provider/schema"
import type { Provider } from "@/provider/provider"
import * as SessionProcessorModule from "../../src/session/processor"
import { Snapshot } from "../../src/snapshot"
import { ProviderTest } from "../fake/provider"
import { testEffect } from "../lib/effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { TestConfig } from "../fixture/config"

void Log.init({ print: false })

function run<A, E>(fx: Effect.Effect<A, E, SessionNs.Service>) {
  return Effect.runPromise(fx.pipe(Effect.provide(SessionNs.defaultLayer)))
}

const svc = {
  ...SessionNs,
  create(input?: SessionNs.CreateInput) {
    return run(SessionNs.Service.use((svc) => svc.create(input)))
  },
  messages(input: z.output<typeof SessionNs.MessagesInput.zod>) {
    return run(SessionNs.Service.use((svc) => svc.messages(input)))
  },
  updateMessage<T extends MessageV2.Info>(msg: T) {
    return run(SessionNs.Service.use((svc) => svc.updateMessage(msg)))
  },
  updatePart<T extends MessageV2.Part>(part: T) {
    return run(SessionNs.Service.use((svc) => svc.updatePart(part)))
  },
}

const summary = Layer.succeed(
  SessionSummary.Service,
  SessionSummary.Service.of({
    summarize: () => Effect.void,
    diff: () => Effect.succeed([]),
    computeDiff: () => Effect.succeed([]),
  }),
)

const ref = {
  providerID: ProviderID.make("test"),
  modelID: ModelID.make("test-model"),
}

afterEach(() => {
  mock.restore()
})

function createModel(opts: {
  context: number
  output: number
  input?: number
  cost?: Provider.Model["cost"]
  npm?: string
}): Provider.Model {
  return {
    id: "test-model",
    providerID: "test",
    name: "Test",
    limit: {
      context: opts.context,
      input: opts.input,
      output: opts.output,
    },
    cost: opts.cost ?? { input: 0, output: 0, cache: { read: 0, write: 0 } },
    capabilities: {
      toolcall: true,
      attachment: false,
      reasoning: false,
      temperature: true,
      input: { text: true, image: false, audio: false, video: false },
      output: { text: true, image: false, audio: false, video: false },
    },
    api: { npm: opts.npm ?? "@ai-sdk/anthropic" },
    options: {},
  } as Provider.Model
}

const wide = () => ProviderTest.fake({ model: createModel({ context: 100_000, output: 32_000 }) })

async function user(sessionID: SessionID, text: string) {
  const msg = await svc.updateMessage({
    id: MessageID.ascending(),
    role: "user",
    sessionID,
    agent: "build",
    model: ref,
    time: { created: Date.now() },
  })
  await svc.updatePart({
    id: PartID.ascending(),
    messageID: msg.id,
    sessionID,
    type: "text",
    text,
  })
  return msg
}

async function assistant(sessionID: SessionID, parentID: MessageID, root: string) {
  const msg: MessageV2.Assistant = {
    id: MessageID.ascending(),
    role: "assistant",
    sessionID,
    mode: "build",
    agent: "build",
    path: { cwd: root, root },
    cost: 0,
    tokens: {
      output: 0,
      input: 0,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    },
    modelID: ref.modelID,
    providerID: ref.providerID,
    parentID,
    time: { created: Date.now() },
    finish: "end_turn",
  }
  await svc.updateMessage(msg)
  return msg
}

async function summaryAssistant(sessionID: SessionID, parentID: MessageID, root: string, text: string) {
  const msg: MessageV2.Assistant = {
    id: MessageID.ascending(),
    role: "assistant",
    sessionID,
    mode: "compaction",
    agent: "compaction",
    path: { cwd: root, root },
    cost: 0,
    tokens: {
      output: 0,
      input: 0,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    },
    modelID: ref.modelID,
    providerID: ref.providerID,
    parentID,
    summary: true,
    time: { created: Date.now() },
    finish: "end_turn",
  }
  await svc.updateMessage(msg)
  await svc.updatePart({
    id: PartID.ascending(),
    messageID: msg.id,
    sessionID,
    type: "text",
    text,
  })
  return msg
}

async function lastCompactionPart(sessionID: SessionID) {
  return (await svc.messages({ sessionID }))
    .at(-2)
    ?.parts.find((item): item is MessageV2.CompactionPart => item.type === "compaction")
}

function fake(
  input: Parameters<SessionProcessorModule.SessionProcessor.Interface["create"]>[0],
  result: "continue" | "compact",
) {
  const msg = input.assistantMessage
  return {
    get message() {
      return msg
    },
    updateToolCall: Effect.fn("TestSessionProcessor.updateToolCall")(() => Effect.succeed(undefined)),
    completeToolCall: Effect.fn("TestSessionProcessor.completeToolCall")(() => Effect.void),
    process: Effect.fn("TestSessionProcessor.process")(() => Effect.succeed(result)),
  } satisfies SessionProcessorModule.SessionProcessor.Handle
}

function layer(result: "continue" | "compact") {
  return Layer.succeed(
    SessionProcessorModule.SessionProcessor.Service,
    SessionProcessorModule.SessionProcessor.Service.of({
      create: Effect.fn("TestSessionProcessor.create")((input) => Effect.succeed(fake(input, result))),
    }),
  )
}

function cfg(compaction?: Config.Info["compaction"]) {
  const base = Config.Info.zod.parse({})
  return TestConfig.layer({
    get: () => Effect.succeed({ ...base, compaction }),
  })
}

function runtime(
  result: "continue" | "compact",
  plugin = Plugin.defaultLayer,
  provider = ProviderTest.fake(),
  config = Config.defaultLayer,
) {
  const bus = Bus.layer
  return ManagedRuntime.make(
    Layer.mergeAll(SessionCompaction.layer, bus).pipe(
      Layer.provide(provider.layer),
      Layer.provide(SessionNs.defaultLayer),
      Layer.provide(layer(result)),
      Layer.provide(Agent.defaultLayer),
      Layer.provide(plugin),
      Layer.provide(bus),
      Layer.provide(config),
    ),
  )
}

const deps = Layer.mergeAll(
  ProviderTest.fake().layer,
  layer("continue"),
  Agent.defaultLayer,
  Plugin.defaultLayer,
  Bus.layer,
  Config.defaultLayer,
)

const env = Layer.mergeAll(
  SessionNs.defaultLayer,
  CrossSpawnSpawner.defaultLayer,
  SessionCompaction.layer.pipe(Layer.provide(SessionNs.defaultLayer), Layer.provideMerge(deps)),
)

const it = testEffect(env)

function llm() {
  const queue: Array<
    Stream.Stream<LLM.Event, unknown> | ((input: LLM.StreamInput) => Stream.Stream<LLM.Event, unknown>)
  > = []

  return {
    push(stream: Stream.Stream<LLM.Event, unknown> | ((input: LLM.StreamInput) => Stream.Stream<LLM.Event, unknown>)) {
      queue.push(stream)
    },
    layer: Layer.succeed(
      LLM.Service,
      LLM.Service.of({
        stream: (input) => {
          const item = queue.shift() ?? Stream.empty
          const stream = typeof item === "function" ? item(input) : item
          return stream.pipe(Stream.mapEffect((event) => Effect.succeed(event)))
        },
      }),
    ),
  }
}

function liveRuntime(layer: Layer.Layer<LLM.Service>, provider = ProviderTest.fake(), config = Config.defaultLayer) {
  const bus = Bus.layer
  const status = SessionStatus.layer.pipe(Layer.provide(bus))
  const processor = SessionProcessorModule.SessionProcessor.layer.pipe(Layer.provide(summary))
  return ManagedRuntime.make(
    Layer.mergeAll(SessionCompaction.layer.pipe(Layer.provide(processor)), processor, bus, status).pipe(
      Layer.provide(provider.layer),
      Layer.provide(SessionNs.defaultLayer),
      Layer.provide(Snapshot.defaultLayer),
      Layer.provide(layer),
      Layer.provide(Permission.defaultLayer),
      Layer.provide(Agent.defaultLayer),
      Layer.provide(Plugin.defaultLayer),
      Layer.provide(status),
      Layer.provide(bus),
      Layer.provide(config),
    ),
  )
}

function reply(
  text: string,
  capture?: (input: LLM.StreamInput) => void,
): (input: LLM.StreamInput) => Stream.Stream<LLM.Event, unknown> {
  return (input) => {
    capture?.(input)
    const summary = `## Goal
- ${text}

## Constraints & Preferences
- (none)

## Progress
### Done
- ${text}

### In Progress
- (none)

### Blocked
- (none)

## Key Decisions
- (none)

## Next Steps
- (none)

## Critical Context
- (none)

## Relevant Files
- (none)`
    return Stream.make(
      { type: "start" } satisfies LLM.Event,
      { type: "text-start", id: "txt-0" } satisfies LLM.Event,
      { type: "text-delta", id: "txt-0", delta: summary, text: summary } as LLM.Event,
      { type: "text-end", id: "txt-0" } satisfies LLM.Event,
      {
        type: "finish-step",
        finishReason: "stop",
        rawFinishReason: "stop",
        response: { id: "res", modelId: "test-model", timestamp: new Date() },
        providerMetadata: undefined,
        usage: {
          inputTokens: 1,
          outputTokens: 1,
          totalTokens: 2,
          inputTokenDetails: {
            noCacheTokens: undefined,
            cacheReadTokens: undefined,
            cacheWriteTokens: undefined,
          },
          outputTokenDetails: {
            textTokens: undefined,
            reasoningTokens: undefined,
          },
        },
      } satisfies LLM.Event,
      {
        type: "finish",
        finishReason: "stop",
        rawFinishReason: "stop",
        totalUsage: {
          inputTokens: 1,
          outputTokens: 1,
          totalTokens: 2,
          inputTokenDetails: {
            noCacheTokens: undefined,
            cacheReadTokens: undefined,
            cacheWriteTokens: undefined,
          },
          outputTokenDetails: {
            textTokens: undefined,
            reasoningTokens: undefined,
          },
        },
      } satisfies LLM.Event,
    )
  }
}

function wait(ms = 50) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function defer() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function plugin(ready: ReturnType<typeof defer>) {
  return Layer.mock(Plugin.Service)({
    trigger: <Name extends string, Input, Output>(name: Name, _input: Input, output: Output) => {
      if (name !== "experimental.session.compacting") return Effect.succeed(output)
      return Effect.sync(() => ready.resolve()).pipe(Effect.andThen(Effect.never), Effect.as(output))
    },
    list: () => Effect.succeed([]),
    init: () => Effect.void,
  })
}

function autocontinue(enabled: boolean) {
  return Layer.mock(Plugin.Service)({
    trigger: <Name extends string, Input, Output>(name: Name, _input: Input, output: Output) => {
      if (name !== "experimental.compaction.autocontinue") return Effect.succeed(output)
      return Effect.sync(() => {
        ;(output as { enabled: boolean }).enabled = enabled
        return output
      })
    },
    list: () => Effect.succeed([]),
    init: () => Effect.void,
  })
}

describe("session.compaction.isOverflow", () => {
  it.live(
    "returns true when input context reaches 85% of context",
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const compact = yield* SessionCompaction.Service
        const model = createModel({ context: 100_000, output: 32_000 })
        const tokens = { input: 85_000, output: 5_000, reasoning: 0, cache: { read: 0, write: 0 } }
        expect(yield* compact.isOverflow({ tokens, model })).toBe(true)
      }),
    ),
  )

  it.live(
    "ignores completion tokens when input context is below 85%",
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const compact = yield* SessionCompaction.Service
        const model = createModel({ context: 100_000, output: 32_000 })
        const tokens = { input: 80_000, output: 20_000, reasoning: 5_000, cache: { read: 0, write: 0 } }
        expect(yield* compact.isOverflow({ tokens, model })).toBe(false)
      }),
    ),
  )

  it.live(
    "returns false when token count is below 85% of context",
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const compact = yield* SessionCompaction.Service
        const model = createModel({ context: 200_000, output: 32_000 })
        const tokens = { input: 100_000, output: 10_000, reasoning: 0, cache: { read: 0, write: 0 } }
        expect(yield* compact.isOverflow({ tokens, model })).toBe(false)
      }),
    ),
  )

  it.live(
    "triggers from locally estimated usage when provider usage is missing",
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const compact = yield* SessionCompaction.Service
        const model = createModel({ context: 100_000, output: 32_000 })
        const usage = SessionNs.getUsage({
          model,
          usage: {
            inputTokens: undefined,
            outputTokens: undefined,
            totalTokens: undefined,
            inputTokenDetails: {
              noCacheTokens: undefined,
              cacheReadTokens: undefined,
              cacheWriteTokens: undefined,
            },
            outputTokenDetails: { textTokens: undefined, reasoningTokens: undefined },
          },
          estimated: { input: 85_000, output: 5_000 },
        })
        expect(yield* compact.isOverflow({ tokens: usage.tokens, model })).toBe(true)
      }),
    ),
  )

  it.live(
    "includes cache.read in token count",
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const compact = yield* SessionCompaction.Service
        const model = createModel({ context: 100_000, output: 32_000 })
        const tokens = { input: 75_000, output: 10_000, reasoning: 0, cache: { read: 10_000, write: 0 } }
        expect(yield* compact.isOverflow({ tokens, model })).toBe(true)
      }),
    ),
  )

  it.live(
    "respects input limit for input caps",
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const compact = yield* SessionCompaction.Service
        const model = createModel({ context: 400_000, input: 272_000, output: 128_000 })
        const tokens = { input: 271_000, output: 1_000, reasoning: 0, cache: { read: 2_000, write: 0 } }
        expect(yield* compact.isOverflow({ tokens, model })).toBe(true)
      }),
    ),
  )

  it.live(
    "returns false when input/output are within input caps",
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const compact = yield* SessionCompaction.Service
        const model = createModel({ context: 400_000, input: 272_000, output: 128_000 })
        const tokens = { input: 200_000, output: 20_000, reasoning: 0, cache: { read: 10_000, write: 0 } }
        expect(yield* compact.isOverflow({ tokens, model })).toBe(false)
      }),
    ),
  )

  it.live(
    "returns false when output within limit with input caps",
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const compact = yield* SessionCompaction.Service
        const model = createModel({ context: 200_000, input: 120_000, output: 10_000 })
        const tokens = { input: 50_000, output: 9_999, reasoning: 0, cache: { read: 0, write: 0 } }
        expect(yield* compact.isOverflow({ tokens, model })).toBe(false)
      }),
    ),
  )

  it.live(
    "uses 85% of limit.input when an input cap is present",
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const compact = yield* SessionCompaction.Service
        const model = createModel({ context: 200_000, input: 200_000, output: 32_000 })
        const tokens = { input: 170_000, output: 10_000, reasoning: 0, cache: { read: 0, write: 0 } }
        expect(yield* compact.isOverflow({ tokens, model })).toBe(true)
      }),
    ),
  )

  it.live(
    "uses 85% of context when no input cap is present",
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const compact = yield* SessionCompaction.Service
        const model = createModel({ context: 200_000, output: 32_000 })
        const tokens = { input: 170_000, output: 10_000, reasoning: 0, cache: { read: 0, write: 0 } }
        expect(yield* compact.isOverflow({ tokens, model })).toBe(true)
      }),
    ),
  )

  it.live(
    "uses the input cap instead of context as the percentage base",
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const compact = yield* SessionCompaction.Service
        const withInputLimit = createModel({ context: 400_000, input: 200_000, output: 32_000 })
        const withoutInputLimit = createModel({ context: 400_000, output: 32_000 })
        const tokens = { input: 170_000, output: 10_000, reasoning: 0, cache: { read: 0, write: 0 } }

        const withLimit = yield* compact.isOverflow({ tokens, model: withInputLimit })
        const withoutLimit = yield* compact.isOverflow({ tokens, model: withoutInputLimit })

        expect(withLimit).toBe(true)
        expect(withoutLimit).toBe(false)
      }),
    ),
  )

  it.live(
    "returns false when model context limit is 0",
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const compact = yield* SessionCompaction.Service
        const model = createModel({ context: 0, output: 32_000 })
        const tokens = { input: 100_000, output: 10_000, reasoning: 0, cache: { read: 0, write: 0 } }
        expect(yield* compact.isOverflow({ tokens, model })).toBe(false)
      }),
    ),
  )

  it.live(
    "returns false when compaction.auto is disabled",
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const compact = yield* SessionCompaction.Service
          const model = createModel({ context: 100_000, output: 32_000 })
          const tokens = { input: 75_000, output: 5_000, reasoning: 0, cache: { read: 0, write: 0 } }
          expect(yield* compact.isOverflow({ tokens, model })).toBe(false)
        }),
      {
        config: {
          compaction: { auto: false },
        },
      },
    ),
  )
})

describe("session.overflow.preflight", () => {
  const config = Config.Info.zod.parse({})
  const model = createModel({ context: 100, output: 20 })

  test("sends requests that fit the context budget", () => {
    expect(preflight({ cfg: config, model, estimatedInput: 70, unavoidableInput: 20 })).toBe("send")
  })

  test("compacts when removable history causes overflow", () => {
    expect(preflight({ cfg: config, model, estimatedInput: 90, unavoidableInput: 20 })).toBe("compact")
  })

  test("rejects requests whose unavoidable input is too large", () => {
    expect(preflight({ cfg: config, model, estimatedInput: 90, unavoidableInput: 85 })).toBe("reject")
  })

  test("compacts after earlier attempts and rejects only at the three-attempt limit", () => {
    // 一次压缩契约放宽为 3 次:续跑轮回灌巨型 skill 输出(未标记超配额工具输出)的
    // clip 必救场景可再压;三次用尽仍超限说明压力落在不可压部分,诚实拒绝。
    expect(
      preflight({ cfg: config, model, estimatedInput: 90, unavoidableInput: 20, compactionAttempted: 1 }),
    ).toBe("compact")
    expect(
      preflight({ cfg: config, model, estimatedInput: 90, unavoidableInput: 20, compactionAttempted: 2 }),
    ).toBe("compact")
    expect(
      preflight({ cfg: config, model, estimatedInput: 90, unavoidableInput: 20, compactionAttempted: 3 }),
    ).toBe("reject")
  })
})

describe("session.overflow.exceedsContext", () => {
  test("detects the hard context limit without using the 85% compaction threshold", () => {
    const model = createModel({ context: 100, output: 20 })

    expect(exceedsContext({ model, input: 99 })).toBe(false)
    expect(exceedsContext({ model, input: 100 })).toBe(true)
  })

  test("uses the model input limit when present", () => {
    const model = createModel({ context: 200, input: 100, output: 20 })

    expect(exceedsContext({ model, input: 100 })).toBe(true)
  })

  test("allows Design agents to continue past the context limit", () => {
    const model = createModel({ context: 100, output: 20 })

    expect(exceedsContext({ model, input: 100, agent: "octo_insight" })).toBe(false)
    expect(exceedsContext({ model, input: 150, agent: "octo_insight" })).toBe(false)
    expect(exceedsContext({ model, input: 150, agent: "build" })).toBe(true)
    expect(exceedsContext({ model, input: 100, agent: "octo_make" })).toBe(false)
    expect(exceedsContext({ model, input: 100, agent: "octo_make_plan" })).toBe(false)
    expect(exceedsContext({ model, input: 100, agent: "ict_pattern" })).toBe(false)
    expect(exceedsContext({ model, input: 100, agent: "proto_replanner", parentAgent: "octo_make" })).toBe(false)
    expect(exceedsContext({ model, input: 100, agent: "proto_replanner", parentAgent: "proto_triage" })).toBe(true)
  })
})

describe("session.compaction.targetBudget", () => {
  const baseCfg = Config.Info.zod.parse({}) as Config.Info
  const wideModel = createModel({ context: 100_000, output: 32_000 })

  test("keeps default budgets when fixed costs are small", () => {
    const budget = SessionCompaction.targetBudget({
      cfg: baseCfg,
      model: wideModel,
      contextTokens: { system: 4_000, tools: 6_000, usable: 85_000 },
    })
    expect(budget.target).toBe(55_250)
    expect(budget.fixed).toBe(10_000)
    expect(budget.available).toBe(45_250)
    expect(budget.tailBudget).toBe(SessionCompaction.preserveRecentBudget({ cfg: baseCfg, model: wideModel }))
    expect(budget.summaryBudget).toBe(6_000)
    expect(budget.fallback).toBe(false)
  })

  test("shrinks the tail budget when fixed costs eat the target", () => {
    const smallModel = createModel({ context: 30_000, output: 4_000 })
    // usable 25.5k → 目标 16.575k;fixed 12k → 可动 4.575k → 保尾 ≤ floor(4.575k×0.75)=3431
    const budget = SessionCompaction.targetBudget({
      cfg: baseCfg,
      model: smallModel,
      contextTokens: { system: 12_000, tools: 0, usable: 25_500 },
    })
    expect(budget.target).toBe(16_575)
    expect(budget.available).toBe(4_575)
    expect(budget.tailBudget).toBe(3_431)
    expect(budget.summaryBudget).toBe(2_000)
    expect(budget.fallback).toBe(false)
  })

  test("falls back to minimum budgets on small-context models", () => {
    const smallModel = createModel({ context: 20_000, output: 4_000 })
    // usable 17k → 目标 11.05k;fixed 10k → 可动 1.05k < 4k(保尾 2k + 摘要 2k)
    const budget = SessionCompaction.targetBudget({
      cfg: baseCfg,
      model: smallModel,
      contextTokens: { system: 6_000, tools: 4_000, usable: 17_000 },
    })
    expect(budget.available).toBe(1_050)
    expect(budget.tailBudget).toBe(2_000)
    expect(budget.summaryBudget).toBe(2_000)
    expect(budget.fallback).toBe(true)
  })

  test("treats fixed costs as zero without contextTokens", () => {
    const budget = SessionCompaction.targetBudget({ cfg: baseCfg, model: wideModel })
    expect(budget.fixed).toBe(0)
    expect(budget.target).toBe(55_250)
    expect(budget.tailBudget).toBe(15_000)
    expect(budget.summaryBudget).toBe(6_000)
  })

  test("honors an explicit preserve_recent_tokens config", () => {
    const cfg100 = { ...baseCfg, compaction: { preserve_recent_tokens: 100 } } as Config.Info
    const budget = SessionCompaction.targetBudget({
      cfg: cfg100,
      model: wideModel,
      contextTokens: { system: 40_000, tools: 0, usable: 85_000 },
    })
    expect(budget.tailBudget).toBe(100)
    expect(budget.summaryBudget).toBe(6_000)
  })
})

describe("session.compaction.create", () => {
  it.live(
    "creates a compaction user message and part",
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const compact = yield* SessionCompaction.Service
        const ssn = yield* SessionNs.Service

        const info = yield* ssn.create({})

        yield* compact.create({
          sessionID: info.id,
          agent: "build",
          model: ref,
          auto: true,
          overflow: true,
        })

        const msgs = yield* ssn.messages({ sessionID: info.id })
        expect(msgs).toHaveLength(1)
        expect(msgs[0].info.role).toBe("user")
        expect(msgs[0].parts).toHaveLength(1)
        expect(msgs[0].parts[0]).toMatchObject({
          type: "compaction",
          auto: true,
          overflow: true,
        })

        const v2 = yield* SessionV2.Service.use((svc) => svc.messages({ sessionID: info.id })).pipe(
          Effect.provide(SessionV2.defaultLayer),
        )
        expect(v2.at(-1)).toMatchObject({
          type: "compaction",
          reason: "auto",
          summary: "",
        })
      }),
    ),
  )
})

describe("session.compaction.prune", () => {
  it.live(
    "compacts old completed tool output",
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          const compact = yield* SessionCompaction.Service
          const ssn = yield* SessionNs.Service
          const info = yield* ssn.create({})
          const a = yield* ssn.updateMessage({
            id: MessageID.ascending(),
            role: "user",
            sessionID: info.id,
            agent: "build",
            model: ref,
            time: { created: Date.now() },
          })
          yield* ssn.updatePart({
            id: PartID.ascending(),
            messageID: a.id,
            sessionID: info.id,
            type: "text",
            text: "first",
          })
          const b: MessageV2.Assistant = {
            id: MessageID.ascending(),
            role: "assistant",
            sessionID: info.id,
            mode: "build",
            agent: "build",
            path: { cwd: dir, root: dir },
            cost: 0,
            tokens: {
              output: 0,
              input: 0,
              reasoning: 0,
              cache: { read: 0, write: 0 },
            },
            modelID: ref.modelID,
            providerID: ref.providerID,
            parentID: a.id,
            time: { created: Date.now() },
            finish: "end_turn",
          }
          yield* ssn.updateMessage(b)
          yield* ssn.updatePart({
            id: PartID.ascending(),
            messageID: b.id,
            sessionID: info.id,
            type: "tool",
            callID: crypto.randomUUID(),
            tool: "bash",
            state: {
              status: "completed",
              input: {},
              output: "x".repeat(200_000),
              title: "done",
              metadata: {},
              time: { start: Date.now(), end: Date.now() },
            },
          })
          for (const text of ["second", "third"]) {
            const msg = yield* ssn.updateMessage({
              id: MessageID.ascending(),
              role: "user",
              sessionID: info.id,
              agent: "build",
              model: ref,
              time: { created: Date.now() },
            })
            yield* ssn.updatePart({
              id: PartID.ascending(),
              messageID: msg.id,
              sessionID: info.id,
              type: "text",
              text,
            })
          }

          yield* compact.prune({ sessionID: info.id })

          const msgs = yield* ssn.messages({ sessionID: info.id })
          const part = msgs.flatMap((msg) => msg.parts).find((part) => part.type === "tool")
          expect(part?.type).toBe("tool")
          expect(part?.state.status).toBe("completed")
          if (part?.type === "tool" && part.state.status === "completed") {
            expect(part.state.time.compacted).toBeNumber()
          }
        }),

      {
        config: {
          compaction: { prune: true },
        },
      },
    ),
  )

  it.live(
    "skips protected skill tool output",
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const compact = yield* SessionCompaction.Service
        const ssn = yield* SessionNs.Service
        const info = yield* ssn.create({})
        const a = yield* ssn.updateMessage({
          id: MessageID.ascending(),
          role: "user",
          sessionID: info.id,
          agent: "build",
          model: ref,
          time: { created: Date.now() },
        })
        yield* ssn.updatePart({
          id: PartID.ascending(),
          messageID: a.id,
          sessionID: info.id,
          type: "text",
          text: "first",
        })
        const b: MessageV2.Assistant = {
          id: MessageID.ascending(),
          role: "assistant",
          sessionID: info.id,
          mode: "build",
          agent: "build",
          path: { cwd: dir, root: dir },
          cost: 0,
          tokens: {
            output: 0,
            input: 0,
            reasoning: 0,
            cache: { read: 0, write: 0 },
          },
          modelID: ref.modelID,
          providerID: ref.providerID,
          parentID: a.id,
          time: { created: Date.now() },
          finish: "end_turn",
        }
        yield* ssn.updateMessage(b)
        yield* ssn.updatePart({
          id: PartID.ascending(),
          messageID: b.id,
          sessionID: info.id,
          type: "tool",
          callID: crypto.randomUUID(),
          tool: "skill",
          state: {
            status: "completed",
            input: {},
            output: "x".repeat(200_000),
            title: "done",
            metadata: {},
            time: { start: Date.now(), end: Date.now() },
          },
        })
        for (const text of ["second", "third"]) {
          const msg = yield* ssn.updateMessage({
            id: MessageID.ascending(),
            role: "user",
            sessionID: info.id,
            agent: "build",
            model: ref,
            time: { created: Date.now() },
          })
          yield* ssn.updatePart({
            id: PartID.ascending(),
            messageID: msg.id,
            sessionID: info.id,
            type: "text",
            text,
          })
        }

        yield* compact.prune({ sessionID: info.id })

        const msgs = yield* ssn.messages({ sessionID: info.id })
        const part = msgs.flatMap((msg) => msg.parts).find((part) => part.type === "tool")
        expect(part?.type).toBe("tool")
        if (part?.type === "tool" && part.state.status === "completed") {
          expect(part.state.time.compacted).toBeUndefined()
        }
      }),
    ),
  )
})

describe("session.compaction.process", () => {
  test("throws when parent is not a user message", async () => {
    await using tmp = await tmpdir()
    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await svc.create({})
        const msg = await user(session.id, "hello")
        const reply = await assistant(session.id, msg.id, tmp.path)
        const rt = runtime("continue")
        try {
          const msgs = await svc.messages({ sessionID: session.id })
          await expect(
            rt.runPromise(
              SessionCompaction.Service.use((svc) =>
                svc.process({
                  parentID: reply.id,
                  messages: msgs,
                  sessionID: session.id,
                  auto: false,
                }),
              ),
            ),
          ).rejects.toThrow(`Compaction parent must be a user message: ${reply.id}`)
        } finally {
          await rt.dispose()
        }
      },
    })
  })

  test("publishes compacted event on continue", async () => {
    await using tmp = await tmpdir()
    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await svc.create({})
        await user(session.id, `old ${"x".repeat(80_000)}`)
        const msg = await user(session.id, "hello")
        const msgs = await svc.messages({ sessionID: session.id })
        const done = defer()
        let seen = false
        const rt = runtime("continue", Plugin.defaultLayer, wide())
        let unsub: (() => void) | undefined
        try {
          unsub = await rt.runPromise(
            Bus.Service.use((svc) =>
              svc.subscribeCallback(SessionCompaction.Event.Compacted, (evt) => {
                if (evt.properties.sessionID !== session.id) return
                seen = true
                done.resolve()
              }),
            ),
          )

          const result = await rt.runPromise(
            SessionCompaction.Service.use((svc) =>
              svc.process({
                parentID: msg.id,
                messages: msgs,
                sessionID: session.id,
                auto: false,
              }),
            ),
          )

          await Promise.race([
            done.promise,
            wait(500).then(() => {
              throw new Error("timed out waiting for compacted event")
            }),
          ])
          expect(result).toBe("continue")
          expect(seen).toBe(true)
        } finally {
          unsub?.()
          await rt.dispose()
        }
      },
    })
  })

  test("marks summary message as errored on compact result", async () => {
    await using tmp = await tmpdir()
    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await svc.create({})
        await user(session.id, `old ${"x".repeat(80_000)}`)
        const msg = await user(session.id, "hello")
        const rt = runtime("compact", Plugin.defaultLayer, wide())
        try {
          const msgs = await svc.messages({ sessionID: session.id })
          const result = await rt.runPromise(
            SessionCompaction.Service.use((svc) =>
              svc.process({
                parentID: msg.id,
                messages: msgs,
                sessionID: session.id,
                auto: false,
              }),
            ),
          )

          const summary = (await svc.messages({ sessionID: session.id })).find(
            (msg) => msg.info.role === "assistant" && msg.info.summary,
          )

          expect(result).toBe("stop")
          expect(summary?.info.role).toBe("assistant")
          if (summary?.info.role === "assistant") {
            expect(summary.info.finish).toBe("error")
            expect(JSON.stringify(summary.info.error)).toContain("Session too large to compact")
          }
        } finally {
          await rt.dispose()
        }
      },
    })
  })

  for (const item of [
    { name: "empty", text: undefined },
    { name: "incomplete", text: "short summary" },
  ]) {
    test(`rejects ${item.name} compaction summaries`, () => {
      expect(SessionCompaction.validateSummary(item.text).valid).toBe(false)
    })
  }

  test("accepts compaction summaries with every required section", () => {
    expect(
      SessionCompaction.validateSummary(
        [
          "## Goal",
          "## Constraints & Preferences",
          "## Progress",
          "## Key Decisions",
          "## Next Steps",
          "## Critical Context",
          "## Relevant Files",
        ].join("\n"),
      ).valid,
    ).toBe(true)
  })

  test("adds synthetic continue prompt when auto is enabled", async () => {
    await using tmp = await tmpdir()
    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await svc.create({})
        await user(session.id, `old ${"x".repeat(80_000)}`)
        const msg = await user(session.id, "hello")
        const rt = runtime("continue", Plugin.defaultLayer, wide())
        try {
          const msgs = await svc.messages({ sessionID: session.id })
          const result = await rt.runPromise(
            SessionCompaction.Service.use((svc) =>
              svc.process({
                parentID: msg.id,
                messages: msgs,
                sessionID: session.id,
                auto: true,
              }),
            ),
          )

          const all = await svc.messages({ sessionID: session.id })
          const last = all.at(-1)

          expect(result).toBe("continue")
          expect(last?.info.role).toBe("user")
          expect(last?.parts[0]).toMatchObject({
            type: "text",
            synthetic: true,
            metadata: { compaction_continue: true },
          })
          if (last?.parts[0]?.type === "text") {
            expect(last.parts[0].text).toContain("Continue if you have next steps")
          }
        } finally {
          await rt.dispose()
        }
      },
    })
  })

  test("persists tail_start_id for retained recent turns", async () => {
    await using tmp = await tmpdir()
    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await svc.create({})
        await user(session.id, "first")
        await user(session.id, `second ${"x".repeat(80_000)}`)
        const keep = await user(session.id, "third")
        await SessionCompaction.create({
          sessionID: session.id,
          agent: "build",
          model: ref,
          auto: false,
        })

        const rt = runtime("continue", Plugin.defaultLayer, wide(), cfg())
        try {
          const msgs = await svc.messages({ sessionID: session.id })
          const parent = msgs.at(-1)?.info.id
          const sourcePart = msgs.at(-1)?.parts.find(
            (part): part is MessageV2.CompactionPart => part.type === "compaction",
          )
          expect(parent).toBeTruthy()
          await rt.runPromise(
            SessionCompaction.Service.use((svc) =>
              svc.process({
                parentID: parent!,
                messages: msgs,
                sessionID: session.id,
                auto: false,
              }),
            ),
          )

          const part = await lastCompactionPart(session.id)
          expect(part?.type).toBe("compaction")
          expect(part?.tail_start_id).toBe(keep.id)
          expect(sourcePart?.tail_start_id).toBe(keep.id)
        } finally {
          await rt.dispose()
        }
      },
    })
  })

  test("preserves recent turns within the token budget", async () => {
    const stub = llm()
    let captured = ""
    stub.push(
      reply("summary", (input) => {
        captured = JSON.stringify(input.messages)
      }),
    )
    await using tmp = await tmpdir({ git: true })
    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await svc.create({})
        const users: MessageV2.User[] = []
        for (let i = 0; i < 10; i++) users.push(await user(session.id, `turn-${i} ${"x".repeat(24_000)}`))
        await SessionCompaction.create({
          sessionID: session.id,
          agent: "build",
          model: ref,
          auto: false,
        })

        const rt = liveRuntime(stub.layer, wide())
        try {
          const msgs = await svc.messages({ sessionID: session.id })
          const parent = msgs.at(-1)?.info.id
          expect(parent).toBeTruthy()
          await rt.runPromise(
            SessionCompaction.Service.use((svc) =>
              svc.process({
                parentID: parent!,
                messages: msgs,
                sessionID: session.id,
                auto: false,
              }),
            ),
          )

          const part = await lastCompactionPart(session.id)
          expect(part?.type).toBe("compaction")
          expect(part?.tail_start_id).toBe(users[8]?.id)
          for (const [index, message] of users.entries()) {
            if (index < 8) expect(captured).toContain(`turn-${index}`)
            else expect(captured).not.toContain(`turn-${index}`)
            if (index >= 8) expect(MessageV2.filterCompacted(MessageV2.stream(session.id))).toContainEqual(
              expect.objectContaining({ info: expect.objectContaining({ id: message.id }) }),
            )
          }
        } finally {
          await rt.dispose()
        }
      },
    })
  })

  test("limits the retained tail to the configured token budget", async () => {
    await using tmp = await tmpdir()
    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await svc.create({})
        await user(session.id, "first")
        await user(session.id, "x".repeat(2_000))
        const keep = await user(session.id, "tiny")
        await SessionCompaction.create({
          sessionID: session.id,
          agent: "build",
          model: ref,
          auto: false,
        })

        const rt = runtime("continue", Plugin.defaultLayer, wide(), cfg({ preserve_recent_tokens: 100 }))
        try {
          const msgs = await svc.messages({ sessionID: session.id })
          const parent = msgs.at(-1)?.info.id
          expect(parent).toBeTruthy()
          await rt.runPromise(
            SessionCompaction.Service.use((svc) =>
              svc.process({
                parentID: parent!,
                messages: msgs,
                sessionID: session.id,
                auto: false,
              }),
            ),
          )

          const part = await lastCompactionPart(session.id)
          expect(part?.type).toBe("compaction")
          expect(part?.tail_start_id).toBe(keep.id)
        } finally {
          await rt.dispose()
        }
      },
    })
  })

  test("caps the retained tail to the compaction target when fixed costs are large", async () => {
    const stub = llm()
    stub.push(reply("summary-a"))
    stub.push(reply("summary-b"))
    await using tmp = await tmpdir({ git: true })
    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        // 小模型:usable 25.5k,目标线 16.575k;fixed 12k → 保尾预算从默认 6.375k 收紧到 3.431k
        const narrow = ProviderTest.fake({ model: createModel({ context: 30_000, output: 4_000 }) })
        const capped = await svc.create({})
        const users: MessageV2.User[] = []
        for (let i = 0; i < 8; i++) users.push(await user(capped.id, `turn-${i} ${"x".repeat(9_000)}`))
        await SessionCompaction.create({ sessionID: capped.id, agent: "build", model: ref, auto: false })

        const plain = await svc.create({})
        const plainUsers: MessageV2.User[] = []
        for (let i = 0; i < 8; i++) plainUsers.push(await user(plain.id, `turn-${i} ${"x".repeat(9_000)}`))
        await SessionCompaction.create({ sessionID: plain.id, agent: "build", model: ref, auto: false })

        const rt = liveRuntime(stub.layer, narrow)
        try {
          const cappedMsgs = await svc.messages({ sessionID: capped.id })
          await rt.runPromise(
            SessionCompaction.Service.use((svc) =>
              svc.process({
                parentID: cappedMsgs.at(-1)!.info.id,
                messages: cappedMsgs,
                sessionID: capped.id,
                auto: false,
                contextTokens: { system: 12_000, tools: 0, usable: 25_500 },
              }),
            ),
          )
          const plainMsgs = await svc.messages({ sessionID: plain.id })
          await rt.runPromise(
            SessionCompaction.Service.use((svc) =>
              svc.process({
                parentID: plainMsgs.at(-1)!.info.id,
                messages: plainMsgs,
                sessionID: plain.id,
                auto: false,
              }),
            ),
          )

          // 目标线下保尾只留最新 1 轮;无 fixed 信息(既有行为)保尾 2 轮 —— 证明目标线收紧了保尾
          const cappedPart = await lastCompactionPart(capped.id)
          expect(cappedPart?.type).toBe("compaction")
          expect(cappedPart?.tail_start_id).toBe(users[7]?.id)
          const plainPart = await lastCompactionPart(plain.id)
          expect(plainPart?.type).toBe("compaction")
          expect(plainPart?.tail_start_id).toBe(plainUsers[6]?.id)
        } finally {
          await rt.dispose()
        }
      },
    })
  })

  test("retries an over-budget summary and stores the shortened one", async () => {
    const stub = llm()
    const prompts: string[] = []
    stub.push(reply("z".repeat(36_000), (input) => prompts.push(JSON.stringify(input.messages))))
    stub.push(reply("concise summary", (input) => prompts.push(JSON.stringify(input.messages))))
    await using tmp = await tmpdir({ git: true })
    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await svc.create({})
        for (let i = 0; i < 16; i++) await user(session.id, `turn-${i} ${"y".repeat(6_000)}`)
        await SessionCompaction.create({ sessionID: session.id, agent: "build", model: ref, auto: false })

        const rt = liveRuntime(stub.layer, wide())
        try {
          const msgs = await svc.messages({ sessionID: session.id })
          await rt.runPromise(
            SessionCompaction.Service.use((svc) =>
              svc.process({
                parentID: msgs.at(-1)!.info.id,
                messages: msgs,
                sessionID: session.id,
                auto: false,
              }),
            ),
          )

          // 首次摘要带预算指令、超预算(~18k tokens > 6k×1.25)后触发一次收紧重试
          expect(prompts).toHaveLength(2)
          expect(prompts[0]).toContain("under ~6000 tokens")
          expect(prompts[1]).toContain("over the ~6000-token budget")
          const stored = (await svc.messages({ sessionID: session.id })).find(
            (msg) => msg.info.role === "assistant" && msg.info.summary,
          )
          expect(stored?.parts.some((part) => part.type === "text" && part.text.includes("concise summary"))).toBe(true)
        } finally {
          await rt.dispose()
        }
      },
    })
  })

  test("keeps the latest turn out of the summary even when it is large", async () => {
    await using tmp = await tmpdir({ git: true })
    const stub = llm()
    let captured = ""
    stub.push(
      reply("summary", (input) => {
        captured = JSON.stringify(input.messages)
      }),
    )
    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await svc.create({})
        await user(session.id, `first ${"x".repeat(80_000)}`)
        const keep = await user(session.id, "y".repeat(2_000))
        await SessionCompaction.create({
          sessionID: session.id,
          agent: "build",
          model: ref,
          auto: false,
        })

        const rt = liveRuntime(stub.layer, wide(), cfg())
        try {
          const msgs = await svc.messages({ sessionID: session.id })
          const parent = msgs.at(-1)?.info.id
          expect(parent).toBeTruthy()
          await rt.runPromise(
            SessionCompaction.Service.use((svc) =>
              svc.process({
                parentID: parent!,
                messages: msgs,
                sessionID: session.id,
                auto: false,
              }),
            ),
          )

          const part = await lastCompactionPart(session.id)
          expect(part?.type).toBe("compaction")
          expect(part?.tail_start_id).toBe(keep.id)
          expect(captured).not.toContain("yyyy")
        } finally {
          await rt.dispose()
        }
      },
    })
  })

  test("keeps the latest media turn out of the summary", async () => {
    await using tmp = await tmpdir({ git: true })
    const stub = llm()
    let captured = ""
    stub.push(
      reply("summary", (input) => {
        captured = JSON.stringify(input.messages)
      }),
    )
    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await svc.create({})
        await user(session.id, `older ${"x".repeat(80_000)}`)
        const recent = await user(session.id, "recent image turn")
        await svc.updatePart({
          id: PartID.ascending(),
          messageID: recent.id,
          sessionID: session.id,
          type: "file",
          mime: "image/png",
          filename: "big.png",
          url: `data:image/png;base64,${"a".repeat(4_000)}`,
        })
        await SessionCompaction.create({
          sessionID: session.id,
          agent: "build",
          model: ref,
          auto: false,
        })

        const rt = liveRuntime(stub.layer, wide(), cfg())
        try {
          const msgs = await svc.messages({ sessionID: session.id })
          const parent = msgs.at(-1)?.info.id
          expect(parent).toBeTruthy()
          await rt.runPromise(
            SessionCompaction.Service.use((svc) =>
              svc.process({
                parentID: parent!,
                messages: msgs,
                sessionID: session.id,
                auto: false,
              }),
            ),
          )

          const part = await lastCompactionPart(session.id)
          expect(part?.type).toBe("compaction")
          expect(part?.tail_start_id).toBe(recent.id)
          expect(captured).not.toContain("recent image turn")
          expect(captured).not.toContain("Attached image/png: big.png")
        } finally {
          await rt.dispose()
        }
      },
    })
  })

  test("retains the complete latest turn", async () => {
    await using tmp = await tmpdir({ git: true })
    const stub = llm()
    let captured = ""
    stub.push(
      reply("summary", (input) => {
        captured = JSON.stringify(input.messages)
      }),
    )
    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await svc.create({})
        await user(session.id, `older ${"x".repeat(80_000)}`)
        const recent = await user(session.id, "recent turn")
        const large = await assistant(session.id, recent.id, tmp.path)
        await svc.updatePart({
          id: PartID.ascending(),
          messageID: large.id,
          sessionID: session.id,
          type: "text",
          text: "z".repeat(2_000),
        })
        const keep = await assistant(session.id, recent.id, tmp.path)
        await svc.updatePart({
          id: PartID.ascending(),
          messageID: keep.id,
          sessionID: session.id,
          type: "text",
          text: "keep tail",
        })
        await SessionCompaction.create({
          sessionID: session.id,
          agent: "build",
          model: ref,
          auto: false,
        })

        const rt = liveRuntime(stub.layer, wide(), cfg())
        try {
          const msgs = await svc.messages({ sessionID: session.id })
          const parent = msgs.at(-1)?.info.id
          expect(parent).toBeTruthy()
          await rt.runPromise(
            SessionCompaction.Service.use((svc) =>
              svc.process({
                parentID: parent!,
                messages: msgs,
                sessionID: session.id,
                auto: false,
              }),
            ),
          )

          const part = await lastCompactionPart(session.id)
          expect(part?.type).toBe("compaction")
          expect(part?.tail_start_id).toBe(recent.id)
          expect(captured).not.toContain("zzzz")
          expect(captured).not.toContain("keep tail")

          const filtered = MessageV2.filterCompacted(MessageV2.stream(session.id))
          expect(filtered.map((msg) => msg.info.id).slice(0, 3)).toEqual([parent!, expect.any(String), recent.id])
          expect(filtered[1]?.info.role).toBe("assistant")
          expect(filtered[1]?.info.role === "assistant" ? filtered[1].info.summary : false).toBe(true)
          expect(filtered.map((msg) => msg.info.id)).toContain(large.id)
        } finally {
          await rt.dispose()
        }
      },
    })
  })

  test("retains a giant tool output turn with a model-scaled clip quota instead of failing", async () => {
    await using tmp = await tmpdir()
    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await svc.create({})
        await user(session.id, `old ${"x".repeat(80_000)}`)
        const keep = await user(session.id, "evaluate the design")
        const asst = await assistant(session.id, keep.id, tmp.path)
        await svc.updatePart({
          id: PartID.ascending(),
          messageID: asst.id,
          sessionID: session.id,
          type: "tool",
          callID: `call-${asst.id}`,
          tool: "skill",
          state: {
            status: "completed",
            input: { name: "design" },
            output: "y".repeat(300_000),
            title: "Loaded skill: design",
            metadata: {},
            time: { start: Date.now(), end: Date.now() },
          },
        })
        await SessionCompaction.create({ sessionID: session.id, agent: "build", model: ref, auto: false })

        const rt = runtime("continue", Plugin.defaultLayer, wide())
        try {
          const msgs = await svc.messages({ sessionID: session.id })
          const parent = msgs.at(-1)?.info.id
          const result = await rt.runPromise(
            SessionCompaction.Service.use((svc) =>
              svc.process({ parentID: parent!, messages: msgs, sessionID: session.id, auto: false }),
            ),
          )

          const all = await svc.messages({ sessionID: session.id })
          const part = all
            .find((item) => item.info.id === parent)
            ?.parts.find((item): item is MessageV2.CompactionPart => item.type === "compaction")
          const toolPart = all
            .find((item) => item.info.id === asst.id)
            ?.parts.find((item): item is MessageV2.ToolPart => item.type === "tool")

          // 巨型工具输出(75k tokens)超过模型缩放阈值(usable 85k × 0.05 ≈ 4.25k tokens):
          // 锚点落在其轮次,输出按既有 time.compacted 契约从模型上下文清除;
          // skill 输出额外落一条"分段重读"提示(消息列表因此多一条合成 user 消息)
          expect(result).toBe("continue")
          expect(part?.type).toBe("compaction")
          expect(part?.tail_start_id).toBe(keep.id)
          expect(
            toolPart?.state.status === "completed" ? toolPart.state.time.compacted : undefined,
          ).toBeGreaterThan(0)

          // 渲染层按既有契约输出占位符:原文不再进入模型上下文
          const filtered = MessageV2.filterCompacted(MessageV2.stream(session.id))
          const rendered = JSON.stringify(
            await MessageV2.toModelMessages(filtered, createModel({ context: 100_000, output: 32_000 })),
          )
          expect(rendered).toContain("[Old tool result content cleared]")
          expect(rendered).not.toContain("y".repeat(50))

          // 二次压缩:已标记(time.compacted)的输出必须按占位符体积估算,
          // 锚点仍落在其轮次,而不是被按全文误判为超预算
          await user(session.id, "next question")
          await SessionCompaction.create({ sessionID: session.id, agent: "build", model: ref, auto: false })
          const msgs2 = await svc.messages({ sessionID: session.id })
          const parent2 = msgs2.at(-1)?.info.id
          const result2 = await rt.runPromise(
            SessionCompaction.Service.use((svc) =>
              svc.process({ parentID: parent2!, messages: msgs2, sessionID: session.id, auto: false }),
            ),
          )
          expect(result2).toBe("continue")
          const part2 = (await svc.messages({ sessionID: session.id }))
            .find((item) => item.info.id === parent2)
            ?.parts.find((item): item is MessageV2.CompactionPart => item.type === "compaction")
          expect(part2).toMatchObject({
            type: "compaction",
            tail_start_id: keep.id,
          })
        } finally {
          await rt.dispose()
        }
      },
    })
  })

  test("resolves a fits-budget no-op by clearing oversized tool outputs instead of stopping", async () => {
    await using tmp = await tmpdir()
    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await svc.create({})
        const ask = await user(session.id, "evaluate the design")
        const asst = await assistant(session.id, ask.id, tmp.path)
        await svc.updatePart({
          id: PartID.ascending(),
          messageID: asst.id,
          sessionID: session.id,
          type: "tool",
          callID: `call-${asst.id}`,
          tool: "skill",
          state: {
            status: "completed",
            input: { name: "design" },
            output: "y".repeat(300_000),
            title: "Loaded skill: design",
            metadata: { name: "design", dir: "/skills/design" },
            time: { start: Date.now(), end: Date.now() },
          },
        })
        await SessionCompaction.create({ sessionID: session.id, agent: "build", model: ref, auto: true, overflow: true })

        const rt = runtime("continue", Plugin.defaultLayer, wide())
        try {
          const msgs = await svc.messages({ sessionID: session.id })
          const parent = msgs.at(-1)?.info.id
          const result = await rt.runPromise(
            SessionCompaction.Service.use((svc) =>
              svc.process({ parentID: parent!, messages: msgs, sessionID: session.id, auto: true, overflow: true }),
            ),
          )

          const all = await svc.messages({ sessionID: session.id })
          const part = all
            .find((item) => item.info.id === parent)
            ?.parts.find((item): item is MessageV2.CompactionPart => item.type === "compaction")
          const toolPart = all
            .find((item) => item.info.id === asst.id)
            ?.parts.find((item): item is MessageV2.ToolPart => item.type === "tool")
          const summary = all.find((item) => item.info.role === "assistant" && item.info.summary)

          // fits-budget no-op 不再终止:巨型 skill 输出直接清除,锚点指向历史首条(全量保留)
          expect(result).toBe("continue")
          expect(part?.type).toBe("compaction")
          expect(part?.tail_start_id).toBe(ask.id)
          expect(
            toolPart?.state.status === "completed" ? toolPart.state.time.compacted : undefined,
          ).toBeGreaterThan(0)

          // 合成摘要落盘(无 LLM 摘要请求),不报错
          expect(summary?.info.role).toBe("assistant")
          if (summary?.info.role === "assistant") {
            expect(summary.info.error).toBeUndefined()
            expect(summary.info.finish).toBe("stop")
          }
          expect(
            summary?.parts.some((p) => p.type === "text" && p.text.includes("Cleared 1 oversized tool output")),
          ).toBe(true)

          // skill 分段重读提示携带 name/dir;pending 原件保留不 replay;自动续跑消息存在
          expect(
            all.some(
              (item) =>
                item.info.role === "user" &&
                item.parts.some(
                  (p) =>
                    p.type === "text" &&
                    p.metadata?.["compaction_skill_cleared"] === true &&
                    p.text.includes("directory: /skills/design"),
                ),
            ),
          ).toBe(true)
          expect(
            all.some(
              (item) =>
                item.info.role === "user" &&
                item.parts.some((p) => p.type === "text" && p.metadata?.["compaction_replay"] === true),
            ),
          ).toBe(false)
          expect(all.at(-1)?.parts.some((p) => p.type === "text" && p.metadata?.["compaction_continue"] === true)).toBe(
            true,
          )

          // 渲染:占位符生效,原始用户消息保留在上下文
          const filtered = MessageV2.filterCompacted(MessageV2.stream(session.id))
          expect(filtered.map((m) => m.info.id)).toContain(ask.id)
          const rendered = JSON.stringify(
            await MessageV2.toModelMessages(filtered, createModel({ context: 100_000, output: 32_000 })),
          )
          expect(rendered).toContain("[Old tool result content cleared]")
          expect(rendered).not.toContain("y".repeat(50))
        } finally {
          await rt.dispose()
        }
      },
    })
  })

  test("keeps the honest no-op rejection when fixed costs exceed usable even after clearing", async () => {
    await using tmp = await tmpdir()
    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await svc.create({})
        const ask = await user(session.id, "evaluate the design")
        const asst = await assistant(session.id, ask.id, tmp.path)
        await svc.updatePart({
          id: PartID.ascending(),
          messageID: asst.id,
          sessionID: session.id,
          type: "tool",
          callID: `call-${asst.id}`,
          tool: "bash",
          state: {
            status: "completed",
            input: {},
            output: "y".repeat(300_000),
            title: "done",
            metadata: {},
            time: { start: Date.now(), end: Date.now() },
          },
        })
        await SessionCompaction.create({ sessionID: session.id, agent: "build", model: ref, auto: false })

        const rt = runtime("continue", Plugin.defaultLayer, wide())
        try {
          const msgs = await svc.messages({ sessionID: session.id })
          const parent = msgs.at(-1)?.info.id
          const result = await rt.runPromise(
            SessionCompaction.Service.use((svc) =>
              svc.process({
                parentID: parent!,
                messages: msgs,
                sessionID: session.id,
                auto: false,
                contextTokens: { system: 82_000, tools: 3_000, usable: 85_000 },
              }),
            ),
          )

          // 清除后投影仍放不下(固定成本 ≥ usable):真硬顶,保留诚实拒绝
          expect(result).toBe("stop")
          const summary = (await svc.messages({ sessionID: session.id })).find(
            (msg) => msg.info.role === "assistant" && msg.info.summary,
          )
          expect(summary?.info.role).toBe("assistant")
          if (summary?.info.role === "assistant") {
            expect(JSON.stringify(summary.info.error)).toContain("fits entirely within the preserved-recent budget")
          }
        } finally {
          await rt.dispose()
        }
      },
    })
  })

  test("recalculates a fits-budget no-op as noise and continues when the full account fits", async () => {
    await using tmp = await tmpdir()
    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await svc.create({})
        const ask = await user(session.id, "hello")
        await SessionCompaction.create({ sessionID: session.id, agent: "build", model: ref, auto: true })

        const rt = runtime("continue", Plugin.defaultLayer, wide())
        try {
          const msgs = await svc.messages({ sessionID: session.id })
          const parent = msgs.at(-1)?.info.id
          const result = await rt.runPromise(
            SessionCompaction.Service.use((svc) =>
              svc.process({
                parentID: parent!,
                messages: msgs,
                sessionID: session.id,
                auto: true,
                // 全账(fixed 22k + history ~0 + margin)低于 usable:触发信号按估算/cache
                // 口径失真处理,写中性通知并继续,不再以 "Nothing to compact" 终止会话
                contextTokens: { system: 10_000, tools: 12_000, usable: 25_500 },
              }),
            ),
          )

          expect(result).toBe("continue")
          const all = await svc.messages({ sessionID: session.id })
          const part = all
            .find((item) => item.info.id === parent)
            ?.parts.find((item): item is MessageV2.CompactionPart => item.type === "compaction")
          // 不设锚点:历史原样保留,中性通知不进锚定链
          expect(part?.tail_start_id).toBeUndefined()
          expect(all.find((item) => item.info.role === "assistant" && item.info.summary)).toBeUndefined()
          const notice = all.find(
            (item) =>
              item.info.role === "assistant" &&
              item.parts.some((p) => p.type === "text" && p.text.includes("No compaction was needed")),
          )
          if (notice?.info.role === "assistant") {
            expect(notice.info.finish).toBe("stop")
            expect(notice.info.summary).toBeUndefined()
            expect(notice.info.error).toBeUndefined()
          }
          // 自动续跑消息带 compaction_noop 标记,prompt 侧据此跳过重复压缩触发
          expect(
            all.at(-1)?.parts.some(
              (p) =>
                p.type === "text" &&
                p.metadata?.["compaction_noop"] === true &&
                p.metadata?.["compaction_continue"] === true,
            ),
          ).toBe(true)
          const filtered = MessageV2.filterCompacted(MessageV2.stream(session.id))
          expect(filtered.map((m) => m.info.id)).toContain(ask.id)
          expect(filtered.map((m) => m.info.id)).toContain(notice!.info.id)
        } finally {
          await rt.dispose()
        }
      },
    })
  })

  test("re-condenses an oversized previous summary through the refinement exit", async () => {
    const stub = llm()
    let captured = ""
    stub.push(
      reply("refined summary", (input) => {
        captured = JSON.stringify(input.messages)
      }),
    )
    await using tmp = await tmpdir()
    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await svc.create({})
        const keep = await user(session.id, "keep this turn")
        const keepReply = await assistant(session.id, keep.id, tmp.path)
        // 前一轮压缩留下的巨型摘要(~80k tokens,远超 summaryBudget)与指向 keep 的锚点
        await SessionCompaction.create({ sessionID: session.id, agent: "build", model: ref, auto: false })
        const marker = (await svc.messages({ sessionID: session.id })).at(-1)
        const markerPart = marker?.parts.find((item): item is MessageV2.CompactionPart => item.type === "compaction")
        await svc.updatePart({ ...markerPart!, tail_start_id: keep.id })
        const oldSummary = await summaryAssistant(
          session.id,
          marker!.info.id,
          tmp.path,
          `huge summary ${"s".repeat(320_000)}`,
        )
        await SessionCompaction.create({ sessionID: session.id, agent: "build", model: ref, auto: true })

        const rt = liveRuntime(stub.layer, wide())
        try {
          const msgs = MessageV2.filterCompacted(MessageV2.stream(session.id))
          const parent = msgs.at(-1)?.info.id
          const result = await rt.runPromise(
            SessionCompaction.Service.use((svc) =>
              svc.process({
                parentID: parent!,
                messages: msgs,
                sessionID: session.id,
                auto: true,
                // 摘要 80k 主导全账压力:fullAccount ~88k ≥ usable,提纯后 ~3k 放得下
                contextTokens: { system: 1_000, tools: 1_000, usable: 30_000 },
              }),
            ),
          )

          expect(result).toBe("continue")
          // 提纯提示词:锚定改写(无新对话段),前次摘要原文进 <previous-summary>
          expect(captured).toContain("Rewrite the anchored summary below denser")
          expect(captured).toContain("<previous-summary>")
          expect(captured).toContain("huge summary")
          const all = await svc.messages({ sessionID: session.id })
          const part = all
            .find((item) => item.info.id === parent)
            ?.parts.find((item): item is MessageV2.CompactionPart => item.type === "compaction")
          // 原地重写:不动锚点(标记保持惰性),不新建消息
          expect(part?.tail_start_id).toBeUndefined()
          const storedOld = all.find((item) => item.info.id === oldSummary.id)
          const oldText = storedOld?.parts.find((item): item is MessageV2.TextPart => item.type === "text")
          expect(oldText?.text).toContain("refined summary")
          expect(oldText?.text).not.toContain("s".repeat(50))
          // 旧摘要消息保留在上下文中(文本已提纯),保尾全量保留
          const filtered = MessageV2.filterCompacted(MessageV2.stream(session.id))
          expect(filtered.map((m) => m.info.id)).toContain(oldSummary.id)
          expect(filtered.map((m) => m.info.id)).toContain(keep.id)
          expect(filtered.map((m) => m.info.id)).toContain(keepReply.id)
          const rendered = JSON.stringify(
            await MessageV2.toModelMessages(filtered, createModel({ context: 100_000, output: 32_000 })),
          )
          expect(rendered).toContain("refined summary")
          expect(rendered).not.toContain("s".repeat(50))
          // 提纯成功后照常自动续跑
          expect(
            all.at(-1)?.parts.some(
              (p) => p.type === "text" && p.metadata?.["compaction_continue"] === true,
            ),
          ).toBe(true)
        } finally {
          await rt.dispose()
        }
      },
    })
  })

  test("stops honestly after refinement when the re-condensed summary still cannot fit", async () => {
    const stub = llm()
    stub.push(reply("refined summary"))
    await using tmp = await tmpdir()
    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await svc.create({})
        const keep = await user(session.id, "keep this turn")
        await assistant(session.id, keep.id, tmp.path)
        await SessionCompaction.create({ sessionID: session.id, agent: "build", model: ref, auto: false })
        const marker = (await svc.messages({ sessionID: session.id })).at(-1)
        const markerPart = marker?.parts.find((item): item is MessageV2.CompactionPart => item.type === "compaction")
        await svc.updatePart({ ...markerPart!, tail_start_id: keep.id })
        await summaryAssistant(session.id, marker!.info.id, tmp.path, `huge summary ${"s".repeat(320_000)}`)
        await SessionCompaction.create({ sessionID: session.id, agent: "build", model: ref, auto: true })

        const rt = liveRuntime(stub.layer, wide())
        try {
          const msgs = MessageV2.filterCompacted(MessageV2.stream(session.id))
          const parent = msgs.at(-1)?.info.id
          const result = await rt.runPromise(
            SessionCompaction.Service.use((svc) =>
              svc.process({
                parentID: parent!,
                messages: msgs,
                sessionID: session.id,
                auto: true,
                // usable 2.3k:即使提纯到 ~150 tokens,固定成本 2k + margin 也放不下
                contextTokens: { system: 1_000, tools: 1_000, usable: 2_300 },
              }),
            ),
          )

          // 提纯产物原地保留在旧摘要消息(渐进收敛,下轮继续压),但当轮诚实拒绝且话术点名摘要
          expect(result).toBe("stop")
          const all = await svc.messages({ sessionID: session.id })
          const fail = all.findLast((item) => item.info.role === "assistant" && item.info.summary && item.info.error)
          if (fail?.info.role === "assistant") {
            expect(JSON.stringify(fail.info.error)).toContain("re-condensed previous summary")
            expect(JSON.stringify(fail.info.error)).toContain("2300-token usable limit")
          }
          expect(
            all.some(
              (item) =>
                item.info.role === "assistant" &&
                item.info.summary &&
                !item.info.error &&
                item.parts.some((p) => p.type === "text" && p.text.includes("refined summary")),
            ),
          ).toBe(true)
          const part = all
            .find((item) => item.info.id === parent)
            ?.parts.find((item): item is MessageV2.CompactionPart => item.type === "compaction")
          expect(part?.tail_start_id).toBeUndefined()
        } finally {
          await rt.dispose()
        }
      },
    })
  })

  test("stops burning refinement requests after two consecutive over-budget refinements", async () => {
    const stub = llm()
    // 每轮提纯:首次 ~20k tokens 超预算 → 收紧重试仍 ~20k → 接受落盘但计数累加
    for (let i = 0; i < 4; i++) stub.push(reply("z".repeat(40_000)))
    await using tmp = await tmpdir()
    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await svc.create({})
        const keep = await user(session.id, "keep this turn")
        await assistant(session.id, keep.id, tmp.path)
        await SessionCompaction.create({ sessionID: session.id, agent: "build", model: ref, auto: false })
        const marker = (await svc.messages({ sessionID: session.id })).at(-1)
        const markerPart = marker?.parts.find((item): item is MessageV2.CompactionPart => item.type === "compaction")
        await svc.updatePart({ ...markerPart!, tail_start_id: keep.id })
        await summaryAssistant(session.id, marker!.info.id, tmp.path, `huge summary ${"s".repeat(320_000)}`)

        const rt = liveRuntime(stub.layer, wide())
        try {
          const run = async () => {
            await SessionCompaction.create({ sessionID: session.id, agent: "build", model: ref, auto: true })
            const msgs = MessageV2.filterCompacted(MessageV2.stream(session.id))
            return rt.runPromise(
              SessionCompaction.Service.use((svc) =>
                svc.process({
                  parentID: msgs.at(-1)!.info.id,
                  messages: msgs,
                  sessionID: session.id,
                  auto: true,
                  contextTokens: { system: 1_000, tools: 1_000, usable: 2_300 },
                }),
              ),
            )
          }
          expect(await run()).toBe("stop")
          expect(await run()).toBe("stop")
          // 第三轮:连续两次未压回预算 → 不再发起摘要请求,直接诚实拒绝并点名摘要主导
          expect(await run()).toBe("stop")
          const fail = (await svc.messages({ sessionID: session.id })).findLast(
            (item) => item.info.role === "assistant" && item.info.summary && item.info.error,
          )
          if (fail?.info.role === "assistant") {
            const error = JSON.stringify(fail.info.error)
            expect(error).toContain("previous summary dominates")
            expect(error).not.toContain("re-condensed previous summary")
          }
        } finally {
          await rt.dispose()
        }
      },
    })
  })

  test("clips an oversized pending message on overflow replay to the replay budget", async () => {
    const stub = llm()
    stub.push(reply("summary"))
    await using tmp = await tmpdir()
    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await svc.create({})
        await user(session.id, `huge ${"x".repeat(400_000)}`)
        await SessionCompaction.create({ sessionID: session.id, agent: "build", model: ref, auto: true, overflow: true })

        const rt = liveRuntime(stub.layer, wide())
        try {
          const msgs = await svc.messages({ sessionID: session.id })
          const parent = msgs.at(-1)?.info.id
          const result = await rt.runPromise(
            SessionCompaction.Service.use((svc) =>
              svc.process({ parentID: parent!, messages: msgs, sessionID: session.id, auto: true, overflow: true }),
            ),
          )

          expect(result).toBe("continue")
          const replayText = (await svc.messages({ sessionID: session.id }))
            .find(
              (item) =>
                item.info.role === "user" &&
                item.parts.some((p) => p.type === "text" && p.metadata?.["compaction_replay"] === true),
            )
            ?.parts.find((p): p is MessageV2.TextPart => p.type === "text")
          // 回填保真任务意图(保留首尾),但不再 verbatim 搬回巨型正文
          expect(replayText?.text.startsWith("huge ")).toBe(true)
          expect(replayText?.text).toContain("clipped by compaction replay")
          expect(replayText?.text).toContain("characters omitted")
          expect(replayText?.text.length).toBeLessThan(120_000)
          expect(Token.estimate(replayText?.text ?? "")).toBeLessThan(26_000)
        } finally {
          await rt.dispose()
        }
      },
    })
  })

  test("replaces a skill doc pending message with a reread reference on replay", async () => {
    const stub = llm()
    stub.push(reply("summary"))
    await using tmp = await tmpdir()
    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await svc.create({})
        const doc = ["# Skill: my-skill", "", "Skill directory (absolute path): /skills/my-skill", "", "d".repeat(80_000)].join(
          "\n",
        )
        await user(session.id, doc)
        await SessionCompaction.create({ sessionID: session.id, agent: "build", model: ref, auto: true, overflow: true })

        const rt = liveRuntime(stub.layer, wide())
        try {
          const msgs = await svc.messages({ sessionID: session.id })
          const parent = msgs.at(-1)?.info.id
          const result = await rt.runPromise(
            SessionCompaction.Service.use((svc) =>
              svc.process({ parentID: parent!, messages: msgs, sessionID: session.id, auto: true, overflow: true }),
            ),
          )

          expect(result).toBe("continue")
          const replayText = (await svc.messages({ sessionID: session.id }))
            .find(
              (item) =>
                item.info.role === "user" &&
                item.parts.some((p) => p.type === "text" && p.metadata?.["compaction_replay"] === true),
            )
            ?.parts.find((p): p is MessageV2.TextPart => p.type === "text")
          // skill 文档整篇替换为分段重读引用,绝不 verbatim 回填
          expect(replayText?.text).toContain("Skill my-skill document omitted from replay")
          expect(replayText?.text).toContain("directory: /skills/my-skill")
          expect(replayText?.text).not.toContain("d".repeat(1_000))
        } finally {
          await rt.dispose()
        }
      },
    })
  })

  test("falls back to clearing oversized tool outputs when the summary request keeps overflowing", async () => {
    await using tmp = await tmpdir()
    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await svc.create({})
        const old = await user(session.id, `old ${"x".repeat(80_000)}`)
        const keep = await user(session.id, "evaluate")
        const asst = await assistant(session.id, keep.id, tmp.path)
        await svc.updatePart({
          id: PartID.ascending(),
          messageID: asst.id,
          sessionID: session.id,
          type: "tool",
          callID: `call-${asst.id}`,
          tool: "bash",
          state: {
            status: "completed",
            input: {},
            output: "y".repeat(300_000),
            title: "done",
            metadata: {},
            time: { start: Date.now(), end: Date.now() },
          },
        })
        await SessionCompaction.create({ sessionID: session.id, agent: "build", model: ref, auto: false })

        // 摘要请求恒被拒(shrink 梯子耗尽)→ 最后手段:纯裁剪出口而非终止
        const rt = runtime("compact", Plugin.defaultLayer, wide())
        try {
          const msgs = await svc.messages({ sessionID: session.id })
          const parent = msgs.at(-1)?.info.id
          const result = await rt.runPromise(
            SessionCompaction.Service.use((svc) =>
              svc.process({ parentID: parent!, messages: msgs, sessionID: session.id, auto: false }),
            ),
          )

          const all = await svc.messages({ sessionID: session.id })
          const part = all
            .find((item) => item.info.id === parent)
            ?.parts.find((item): item is MessageV2.CompactionPart => item.type === "compaction")
          const toolPart = all
            .find((item) => item.info.id === asst.id)
            ?.parts.find((item): item is MessageV2.ToolPart => item.type === "tool")
          const summary = all.find((item) => item.info.role === "assistant" && item.info.summary)

          expect(result).toBe("continue")
          expect(part?.type).toBe("compaction")
          expect(part?.tail_start_id).toBe(old.id)
          expect(
            toolPart?.state.status === "completed" ? toolPart.state.time.compacted : undefined,
          ).toBeGreaterThan(0)
          expect(summary?.info.role).toBe("assistant")
          if (summary?.info.role === "assistant") expect(summary.info.error).toBeUndefined()
          expect(
            summary?.parts.some((p) => p.type === "text" && p.text.includes("Cleared 1 oversized tool output")),
          ).toBe(true)
        } finally {
          await rt.dispose()
        }
      },
    })
  })

  test("allows plugins to disable synthetic continue prompt", async () => {
    await using tmp = await tmpdir()
    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await svc.create({})
        await user(session.id, `old ${"x".repeat(80_000)}`)
        const msg = await user(session.id, "hello")
        const rt = runtime("continue", autocontinue(false), wide())
        try {
          const msgs = await svc.messages({ sessionID: session.id })
          const result = await rt.runPromise(
            SessionCompaction.Service.use((svc) =>
              svc.process({
                parentID: msg.id,
                messages: msgs,
                sessionID: session.id,
                auto: true,
              }),
            ),
          )

          const all = await svc.messages({ sessionID: session.id })
          const last = all.at(-1)

          expect(result).toBe("continue")
          expect(last?.info.role).toBe("assistant")
          expect(
            all.some(
              (msg) =>
                msg.info.role === "user" &&
                msg.parts.some(
                  (part) =>
                    part.type === "text" && part.synthetic && part.text.includes("Continue if you have next steps"),
                ),
            ),
          ).toBe(false)
        } finally {
          await rt.dispose()
        }
      },
    })
  })

  test("keeps the pending user turn in the tail on overflow instead of replaying when it fits", async () => {
    await using tmp = await tmpdir()
    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await svc.create({})
        const root = await user(session.id, `root ${"x".repeat(80_000)}`)
        await assistant(session.id, root.id, tmp.path)
        const image = await user(session.id, "image")
        await svc.updatePart({
          id: PartID.ascending(),
          messageID: image.id,
          sessionID: session.id,
          type: "file",
          mime: "image/png",
          filename: "cat.png",
          url: "https://example.com/cat.png",
        })
        const msg = await user(session.id, "current")
        const rt = runtime("continue", Plugin.defaultLayer, wide())
        try {
          const msgs = await svc.messages({ sessionID: session.id })
          const result = await rt.runPromise(
            SessionCompaction.Service.use((svc) =>
              svc.process({
                parentID: msg.id,
                messages: msgs,
                sessionID: session.id,
                auto: true,
                overflow: true,
              }),
            ),
          )

          const all = await svc.messages({ sessionID: session.id })
          const last = all.at(-1)

          expect(result).toBe("continue")
          // pending turn 装得下保尾:原件保留在尾部,不再复制一份 replay
          expect(
            all.some(
              (item) =>
                item.info.role === "user" &&
                item.parts.some((part) => part.type === "text" && part.metadata?.compaction_replay === true),
            ),
          ).toBe(false)
          expect(
            last?.parts.some((part) => part.type === "text" && part.metadata?.compaction_continue === true),
          ).toBe(true)
          // 原始 image 消息保留在尾部,文件 part 不被剥离
          const original = all.find((item) => item.info.id === image.id)
          expect(original?.parts.some((part) => part.type === "file")).toBe(true)
        } finally {
          await rt.dispose()
        }
      },
    })
  })

  test("folds the unsplittable pending turn into the summary and replays its text on overflow", async () => {
    const stub = llm()
    stub.push(reply("summary"))
    await using tmp = await tmpdir()
    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await svc.create({})
        const huge = await user(session.id, `huge ${"x".repeat(80_000)}`)
        await SessionCompaction.create({ sessionID: session.id, agent: "build", model: ref, auto: true, overflow: true })

        const rt = liveRuntime(stub.layer, wide())
        try {
          const msgs = await svc.messages({ sessionID: session.id })
          const parent = msgs.at(-1)?.info.id
          expect(parent).toBeTruthy()
          const result = await rt.runPromise(
            SessionCompaction.Service.use((svc) =>
              svc.process({ parentID: parent!, messages: msgs, sessionID: session.id, auto: true, overflow: true }),
            ),
          )

          const all = await svc.messages({ sessionID: session.id })
          const summary = all.find((item) => item.info.role === "assistant" && item.info.summary)
          const replayMsg = all.find(
            (item) =>
              item.info.role === "user" &&
              item.parts.some((part) => part.type === "text" && part.metadata?.compaction_replay === true),
          )
          const part = all
            .find((item) => item.info.id === parent)
            ?.parts.find((item): item is MessageV2.CompactionPart => item.type === "compaction")

          // 空尾兜底:巨型 pending turn 折叠进摘要,锚点 = 压缩标记自身
          expect(result).toBe("continue")
          expect(summary?.info.role).toBe("assistant")
          if (summary?.info.role === "assistant") expect(summary.info.finish).not.toBe("error")
          expect(part?.tail_start_id).toBe(parent)
          expect(replayMsg?.info.role).toBe("user")
          if (replayMsg?.info.role === "user") {
            const text = replayMsg.parts.find((p) => p.type === "text")
            expect(text?.type === "text" && text.text.startsWith("huge ")).toBe(true)
          }
          // 原始巨型消息在锚点之前,折叠后不再进入模型上下文
          const filtered = MessageV2.filterCompacted(MessageV2.stream(session.id))
          expect(filtered.map((msg) => msg.info.id)).not.toContain(huge.id)
          expect(filtered.map((msg) => msg.info.id)).toContain(replayMsg!.info.id)
        } finally {
          await rt.dispose()
        }
      },
    })
  })

  test("stops quickly when aborted during retry backoff", async () => {
    const stub = llm()
    const ready = defer()
    stub.push(
      Stream.fromAsyncIterable(
        {
          async *[Symbol.asyncIterator]() {
            yield { type: "start" } as LLM.Event
            throw new APICallError({
              message: "boom",
              url: "https://example.com/v1/chat/completions",
              requestBodyValues: {},
              statusCode: 503,
              responseHeaders: { "retry-after-ms": "10000" },
              responseBody: '{"error":"boom"}',
              isRetryable: true,
            })
          },
        },
        (err) => err,
      ),
    )

    await using tmp = await tmpdir({ git: true })
    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await svc.create({})
        const old = await user(session.id, `old ${"x".repeat(80_000)}`)
        await assistant(session.id, old.id, tmp.path)
        const msg = await user(session.id, "hello")
        const msgs = await svc.messages({ sessionID: session.id })
        const abort = new AbortController()
        const rt = liveRuntime(stub.layer, wide())
        let off: (() => void) | undefined
        let run: Promise<"continue" | "stop"> | undefined
        try {
          off = await rt.runPromise(
            Bus.Service.use((svc) =>
              svc.subscribeCallback(SessionStatus.Event.Status, (evt) => {
                if (evt.properties.sessionID !== session.id) return
                if (evt.properties.status.type !== "retry") return
                ready.resolve()
              }),
            ),
          )

          run = rt
            .runPromiseExit(
              SessionCompaction.Service.use((svc) =>
                svc.process({
                  parentID: msg.id,
                  messages: msgs,
                  sessionID: session.id,
                  auto: false,
                }),
              ),
              { signal: abort.signal },
            )
            .then((exit) => {
              if (Exit.isFailure(exit)) {
                if (Cause.hasInterrupts(exit.cause) && abort.signal.aborted) return "stop"
                throw Cause.squash(exit.cause)
              }
              return exit.value
            })

          await Promise.race([
            ready.promise,
            wait(1000).then(() => {
              throw new Error("timed out waiting for retry status")
            }),
          ])

          const start = Date.now()
          abort.abort()
          const result = await Promise.race([
            run.then((value) => ({ kind: "done" as const, value, ms: Date.now() - start })),
            wait(250).then(() => ({ kind: "timeout" as const })),
          ])

          expect(result.kind).toBe("done")
          if (result.kind === "done") {
            expect(result.value).toBe("stop")
            expect(result.ms).toBeLessThan(250)
          }
        } finally {
          off?.()
          abort.abort()
          await rt.dispose()
          await run?.catch(() => undefined)
        }
      },
    })
  })

  test("does not leave a summary assistant when aborted before processor setup", async () => {
    const ready = defer()

    await using tmp = await tmpdir({ git: true })
    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await svc.create({})
        const old = await user(session.id, `old ${"x".repeat(80_000)}`)
        await assistant(session.id, old.id, tmp.path)
        const msg = await user(session.id, "hello")
        const msgs = await svc.messages({ sessionID: session.id })
        const abort = new AbortController()
        const rt = runtime("continue", plugin(ready), wide())
        let run: Promise<"continue" | "stop"> | undefined
        try {
          run = rt
            .runPromiseExit(
              SessionCompaction.Service.use((svc) =>
                svc.process({
                  parentID: msg.id,
                  messages: msgs,
                  sessionID: session.id,
                  auto: false,
                }),
              ),
              { signal: abort.signal },
            )
            .then((exit) => {
              if (Exit.isFailure(exit)) {
                if (Cause.hasInterrupts(exit.cause) && abort.signal.aborted) return "stop"
                throw Cause.squash(exit.cause)
              }
              return exit.value
            })

          await Promise.race([
            ready.promise,
            wait(1000).then(() => {
              throw new Error("timed out waiting for compaction hook")
            }),
          ])

          abort.abort()
          expect(await run).toBe("stop")

          const all = await svc.messages({ sessionID: session.id })
          expect(all.some((msg) => msg.info.role === "assistant" && msg.info.summary)).toBe(false)
        } finally {
          abort.abort()
          await rt.dispose()
          await run?.catch(() => undefined)
        }
      },
    })
  })

  test("does not allow tool calls while generating the summary", async () => {
    const stub = llm()
    stub.push(
      Stream.make(
        { type: "start" } satisfies LLM.Event,
        { type: "tool-input-start", id: "call-1", toolName: "_noop" } satisfies LLM.Event,
        { type: "tool-call", toolCallId: "call-1", toolName: "_noop", input: {} } satisfies LLM.Event,
        {
          type: "finish-step",
          finishReason: "tool-calls",
          rawFinishReason: "tool_calls",
          response: { id: "res", modelId: "test-model", timestamp: new Date() },
          providerMetadata: undefined,
          usage: {
            inputTokens: 1,
            outputTokens: 1,
            totalTokens: 2,
            inputTokenDetails: {
              noCacheTokens: undefined,
              cacheReadTokens: undefined,
              cacheWriteTokens: undefined,
            },
            outputTokenDetails: {
              textTokens: undefined,
              reasoningTokens: undefined,
            },
          },
        } satisfies LLM.Event,
        {
          type: "finish",
          finishReason: "tool-calls",
          rawFinishReason: "tool_calls",
          totalUsage: {
            inputTokens: 1,
            outputTokens: 1,
            totalTokens: 2,
            inputTokenDetails: {
              noCacheTokens: undefined,
              cacheReadTokens: undefined,
              cacheWriteTokens: undefined,
            },
            outputTokenDetails: {
              textTokens: undefined,
              reasoningTokens: undefined,
            },
          },
        } satisfies LLM.Event,
      ),
    )

    await using tmp = await tmpdir({ git: true })
    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await svc.create({})
        const old = await user(session.id, `old ${"x".repeat(80_000)}`)
        await assistant(session.id, old.id, tmp.path)
        const msg = await user(session.id, "hello")
        const rt = liveRuntime(stub.layer, wide())
        try {
          const msgs = await svc.messages({ sessionID: session.id })
          await rt.runPromise(
            SessionCompaction.Service.use((svc) =>
              svc.process({
                parentID: msg.id,
                messages: msgs,
                sessionID: session.id,
                auto: false,
              }),
            ),
          )

          const summary = (await svc.messages({ sessionID: session.id })).find(
            (item) => item.info.role === "assistant" && item.info.summary,
          )

          expect(summary?.info.role).toBe("assistant")
          expect(summary?.parts.some((part) => part.type === "tool")).toBe(false)
        } finally {
          await rt.dispose()
        }
      },
    })
  })

  test("summarizes only the head while keeping recent tail out of summary input", async () => {
    const stub = llm()
    let captured = ""
    stub.push(
      reply("summary", (input) => {
        captured = JSON.stringify(input.messages)
      }),
    )

    await using tmp = await tmpdir({ git: true })
    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await svc.create({})
        await user(session.id, "older context")
        await user(session.id, `keep this turn ${"x".repeat(80_000)}`)
        await user(session.id, "and this one too")
        await SessionCompaction.create({
          sessionID: session.id,
          agent: "build",
          model: ref,
          auto: false,
        })

        const rt = liveRuntime(stub.layer, wide(), cfg())
        try {
          const msgs = await svc.messages({ sessionID: session.id })
          const parent = msgs.at(-1)?.info.id
          expect(parent).toBeTruthy()
          await rt.runPromise(
            SessionCompaction.Service.use((svc) =>
              svc.process({
                parentID: parent!,
                messages: msgs,
                sessionID: session.id,
                auto: false,
              }),
            ),
          )

          expect(captured).toContain("older context")
          expect(captured).toContain("keep this turn")
          expect(captured).not.toContain("and this one too")
          expect(captured).not.toContain("What did we do so far?")
        } finally {
          await rt.dispose()
        }
      },
    })
  })

  test("anchors repeated compactions with the previous summary", async () => {
    const stub = llm()
    let captured = ""
    stub.push(reply("summary one"))
    stub.push(
      reply("summary two", (input) => {
        captured = JSON.stringify(input.messages)
      }),
    )

    await using tmp = await tmpdir({ git: true })
    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await svc.create({})
        await user(session.id, `older context ${"x".repeat(80_000)}`)
        await user(session.id, "keep this turn")
        await SessionCompaction.create({
          sessionID: session.id,
          agent: "build",
          model: ref,
          auto: false,
        })

        const rt = liveRuntime(stub.layer, wide())
        try {
          let msgs = await svc.messages({ sessionID: session.id })
          let parent = msgs.at(-1)?.info.id
          expect(parent).toBeTruthy()
          await rt.runPromise(
            SessionCompaction.Service.use((svc) =>
              svc.process({
                parentID: parent!,
                messages: msgs,
                sessionID: session.id,
                auto: false,
              }),
            ),
          )

          await user(session.id, `big middle ${"x".repeat(80_000)}`)
          await user(session.id, "latest turn")
          await SessionCompaction.create({
            sessionID: session.id,
            agent: "build",
            model: ref,
            auto: false,
          })

          msgs = MessageV2.filterCompacted(MessageV2.stream(session.id))
          parent = msgs.at(-1)?.info.id
          expect(parent).toBeTruthy()
          await rt.runPromise(
            SessionCompaction.Service.use((svc) =>
              svc.process({
                parentID: parent!,
                messages: msgs,
                sessionID: session.id,
                auto: false,
              }),
            ),
          )

          expect(captured).toContain("<previous-summary>")
          expect(captured).toContain("summary one")
          // reply(text) puts `${text}` under both `## Goal` and `## Progress → Done`,
          // so the previous-summary anchor contains it twice. hidden filters the old
          // compaction message out of history; if that filter breaks, the count jumps
          // to 4 (2 here + 2 from the leaked old summary message).
          expect(captured.match(/summary one/g)?.length).toBe(2)
          expect(captured).toContain("## Constraints & Preferences")
          expect(captured).toContain("## Progress")
        } finally {
          await rt.dispose()
        }
      },
    })
  })

  test("keeps recent pre-compaction turns across repeated compactions", async () => {
    const stub = llm()
    stub.push(reply("summary one"))
    stub.push(reply("summary two"))
    await using tmp = await tmpdir()
    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await svc.create({})
        const u1 = await user(session.id, `one ${"x".repeat(80_000)}`)
        const u2 = await user(session.id, `two ${"x".repeat(80_000)}`)
        const u3 = await user(session.id, `three ${"x".repeat(40_000)}`)
        await SessionCompaction.create({
          sessionID: session.id,
          agent: "build",
          model: ref,
          auto: false,
        })

        const rt = liveRuntime(stub.layer, wide(), cfg())
        try {
          let msgs = await svc.messages({ sessionID: session.id })
          let parent = msgs.at(-1)?.info.id
          expect(parent).toBeTruthy()
          await rt.runPromise(
            SessionCompaction.Service.use((svc) =>
              svc.process({
                parentID: parent!,
                messages: msgs,
                sessionID: session.id,
                auto: false,
              }),
            ),
          )

          const u4 = await user(session.id, `four ${"x".repeat(32_000)}`)
          await SessionCompaction.create({
            sessionID: session.id,
            agent: "build",
            model: ref,
            auto: false,
          })

          msgs = MessageV2.filterCompacted(MessageV2.stream(session.id))
          parent = msgs.at(-1)?.info.id
          expect(parent).toBeTruthy()
          await rt.runPromise(
            SessionCompaction.Service.use((svc) =>
              svc.process({
                parentID: parent!,
                messages: msgs,
                sessionID: session.id,
                auto: false,
              }),
            ),
          )

          const filtered = MessageV2.filterCompacted(MessageV2.stream(session.id))
          const ids = filtered.map((msg) => msg.info.id)

          expect(ids).not.toContain(u1.id)
          expect(ids).not.toContain(u2.id)
          expect(ids).not.toContain(u3.id)
          expect(ids).toContain(u4.id)
          expect(filtered.some((msg) => msg.info.role === "assistant" && msg.info.summary)).toBe(true)
          expect(
            filtered.some((msg) => msg.info.role === "user" && msg.parts.some((part) => part.type === "compaction")),
          ).toBe(true)
        } finally {
          await rt.dispose()
        }
      },
    })
  })

  test("ignores previous summaries when sizing the retained tail", async () => {
    await using tmp = await tmpdir()
    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await svc.create({})
        await user(session.id, "older")
        const keep = await user(session.id, "keep this turn")
        const keepReply = await assistant(session.id, keep.id, tmp.path)
        await svc.updatePart({
          id: PartID.ascending(),
          messageID: keepReply.id,
          sessionID: session.id,
          type: "text",
          text: `keep reply ${"x".repeat(80_000)}`,
        })

        await SessionCompaction.create({
          sessionID: session.id,
          agent: "build",
          model: ref,
          auto: false,
        })
        const firstCompaction = (await svc.messages({ sessionID: session.id })).at(-1)?.info.id
        expect(firstCompaction).toBeTruthy()
        await summaryAssistant(session.id, firstCompaction!, tmp.path, "summary ".repeat(800))

        const recent = await user(session.id, "recent turn")
        const recentReply = await assistant(session.id, recent.id, tmp.path)
        await svc.updatePart({
          id: PartID.ascending(),
          messageID: recentReply.id,
          sessionID: session.id,
          type: "text",
          text: "recent reply",
        })

        await SessionCompaction.create({
          sessionID: session.id,
          agent: "build",
          model: ref,
          auto: false,
        })

        const rt = runtime("continue", Plugin.defaultLayer, wide(), cfg())
        try {
          const msgs = await svc.messages({ sessionID: session.id })
          const parent = msgs.at(-1)?.info.id
          expect(parent).toBeTruthy()
          await rt.runPromise(
            SessionCompaction.Service.use((svc) =>
              svc.process({
                parentID: parent!,
                messages: msgs,
                sessionID: session.id,
                auto: false,
              }),
            ),
          )

          const part = await lastCompactionPart(session.id)
          expect(part?.type).toBe("compaction")
          expect(part?.tail_start_id).toBe(recent.id)
        } finally {
          await rt.dispose()
        }
      },
    })
  })
})

describe("util.token.estimate", () => {
  test("estimates tokens from text (4 chars per token)", () => {
    const text = "x".repeat(4000)
    expect(Token.estimate(text)).toBe(1000)
  })

  test("estimates tokens from larger text", () => {
    const text = "y".repeat(20_000)
    expect(Token.estimate(text)).toBe(5000)
  })

  test("returns 0 for empty string", () => {
    expect(Token.estimate("")).toBe(0)
  })

  test("does not underestimate CJK text as four characters per token", () => {
    expect(Token.estimate("这是一个中文上下文压缩测试")).toBe(13)
  })

  test("estimates structured model messages without counting base64 bytes", () => {
    const estimated = Token.estimateValue([
      { role: "system", content: "x".repeat(400) },
      { role: "user", content: [{ type: "image", data: `data:image/png;base64,${"a".repeat(40_000)}` }] },
    ])
    expect(estimated).toBeGreaterThan(1_100)
    expect(estimated).toBeLessThan(2_000)
  })
})

describe("SessionNs.getUsage", () => {
  test("uses local estimates when provider usage is missing", () => {
    const model = createModel({ context: 100_000, output: 32_000 })
    const result = SessionNs.getUsage({
      model,
      usage: {
        inputTokens: undefined,
        outputTokens: undefined,
        totalTokens: undefined,
        inputTokenDetails: {
          noCacheTokens: undefined,
          cacheReadTokens: undefined,
          cacheWriteTokens: undefined,
        },
        outputTokenDetails: { textTokens: undefined, reasoningTokens: undefined },
      },
      estimated: { input: 75_000, output: 500 },
    })

    expect(result.tokens.input).toBe(75_000)
    expect(result.tokens.output).toBe(500)
    expect(result.tokens.total).toBe(75_500)
  })

  test("prefers provider usage over local estimates", () => {
    const model = createModel({ context: 100_000, output: 32_000 })
    const result = SessionNs.getUsage({
      model,
      usage: {
        inputTokens: 1_000,
        outputTokens: 500,
        totalTokens: 1_500,
        inputTokenDetails: {
          noCacheTokens: undefined,
          cacheReadTokens: undefined,
          cacheWriteTokens: undefined,
        },
        outputTokenDetails: { textTokens: undefined, reasoningTokens: undefined },
      },
      estimated: { input: 75_000, output: 10_000 },
    })

    expect(result.tokens.input).toBe(1_000)
    expect(result.tokens.output).toBe(500)
    expect(result.tokens.total).toBe(1_500)
  })

  test("recomputes total when provider returns only partial usage", () => {
    const model = createModel({ context: 100_000, output: 32_000 })
    const result = SessionNs.getUsage({
      model,
      usage: {
        inputTokens: 0,
        outputTokens: 500,
        totalTokens: 500,
        inputTokenDetails: {
          noCacheTokens: undefined,
          cacheReadTokens: undefined,
          cacheWriteTokens: undefined,
        },
        outputTokenDetails: { textTokens: undefined, reasoningTokens: undefined },
      },
      estimated: { input: 75_000, output: 10_000 },
    })

    expect(result.tokens.input).toBe(75_000)
    expect(result.tokens.output).toBe(500)
    expect(result.tokens.total).toBe(75_500)
  })

  test("normalizes standard usage to token format", () => {
    const model = createModel({ context: 100_000, output: 32_000 })
    const result = SessionNs.getUsage({
      model,
      usage: {
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
        inputTokenDetails: {
          noCacheTokens: undefined,
          cacheReadTokens: undefined,
          cacheWriteTokens: undefined,
        },
        outputTokenDetails: {
          textTokens: undefined,
          reasoningTokens: undefined,
        },
      },
    })

    expect(result.tokens.input).toBe(1000)
    expect(result.tokens.output).toBe(500)
    expect(result.tokens.reasoning).toBe(0)
    expect(result.tokens.cache.read).toBe(0)
    expect(result.tokens.cache.write).toBe(0)
  })

  test("extracts cached tokens to cache.read", () => {
    const model = createModel({ context: 100_000, output: 32_000 })
    const result = SessionNs.getUsage({
      model,
      usage: {
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
        inputTokenDetails: {
          noCacheTokens: 800,
          cacheReadTokens: 200,
          cacheWriteTokens: undefined,
        },
        outputTokenDetails: {
          textTokens: undefined,
          reasoningTokens: undefined,
        },
      },
    })

    expect(result.tokens.input).toBe(800)
    expect(result.tokens.cache.read).toBe(200)
  })

  test("handles anthropic cache write metadata", () => {
    const model = createModel({ context: 100_000, output: 32_000 })
    const result = SessionNs.getUsage({
      model,
      usage: {
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
        inputTokenDetails: {
          noCacheTokens: undefined,
          cacheReadTokens: undefined,
          cacheWriteTokens: undefined,
        },
        outputTokenDetails: {
          textTokens: undefined,
          reasoningTokens: undefined,
        },
      },
      metadata: {
        anthropic: {
          cacheCreationInputTokens: 300,
        },
      },
    })

    expect(result.tokens.cache.write).toBe(300)
  })

  test("subtracts cached tokens for anthropic provider", () => {
    const model = createModel({ context: 100_000, output: 32_000 })
    // AI SDK v6 normalizes inputTokens to include cached tokens for all providers
    const result = SessionNs.getUsage({
      model,
      usage: {
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
        inputTokenDetails: {
          noCacheTokens: 800,
          cacheReadTokens: 200,
          cacheWriteTokens: undefined,
        },
        outputTokenDetails: {
          textTokens: undefined,
          reasoningTokens: undefined,
        },
      },
      metadata: {
        anthropic: {},
      },
    })

    expect(result.tokens.input).toBe(800)
    expect(result.tokens.cache.read).toBe(200)
  })

  test("separates reasoning tokens from output tokens", () => {
    const model = createModel({ context: 100_000, output: 32_000 })
    const result = SessionNs.getUsage({
      model,
      usage: {
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
        inputTokenDetails: {
          noCacheTokens: undefined,
          cacheReadTokens: undefined,
          cacheWriteTokens: undefined,
        },
        outputTokenDetails: {
          textTokens: 400,
          reasoningTokens: 100,
        },
      },
    })

    expect(result.tokens.input).toBe(1000)
    expect(result.tokens.output).toBe(400)
    expect(result.tokens.reasoning).toBe(100)
    expect(result.tokens.total).toBe(1500)
  })

  test("does not double count reasoning tokens in cost", () => {
    const model = createModel({
      context: 100_000,
      output: 32_000,
      cost: {
        input: 0,
        output: 15,
        cache: { read: 0, write: 0 },
      },
    })
    const result = SessionNs.getUsage({
      model,
      usage: {
        inputTokens: 0,
        outputTokens: 1_000_000,
        totalTokens: 1_000_000,
        inputTokenDetails: {
          noCacheTokens: undefined,
          cacheReadTokens: undefined,
          cacheWriteTokens: undefined,
        },
        outputTokenDetails: {
          textTokens: 750_000,
          reasoningTokens: 250_000,
        },
      },
    })

    expect(result.tokens.output).toBe(750_000)
    expect(result.tokens.reasoning).toBe(250_000)
    expect(result.cost).toBe(15)
  })

  test("handles undefined optional values gracefully", () => {
    const model = createModel({ context: 100_000, output: 32_000 })
    const result = SessionNs.getUsage({
      model,
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        inputTokenDetails: {
          noCacheTokens: undefined,
          cacheReadTokens: undefined,
          cacheWriteTokens: undefined,
        },
        outputTokenDetails: {
          textTokens: undefined,
          reasoningTokens: undefined,
        },
      },
    })

    expect(result.tokens.input).toBe(0)
    expect(result.tokens.output).toBe(0)
    expect(result.tokens.reasoning).toBe(0)
    expect(result.tokens.cache.read).toBe(0)
    expect(result.tokens.cache.write).toBe(0)
    expect(Number.isNaN(result.cost)).toBe(false)
  })

  test("calculates cost correctly", () => {
    const model = createModel({
      context: 100_000,
      output: 32_000,
      cost: {
        input: 3,
        output: 15,
        cache: { read: 0.3, write: 3.75 },
      },
    })
    const result = SessionNs.getUsage({
      model,
      usage: {
        inputTokens: 1_000_000,
        outputTokens: 100_000,
        totalTokens: 1_100_000,
        inputTokenDetails: {
          noCacheTokens: undefined,
          cacheReadTokens: undefined,
          cacheWriteTokens: undefined,
        },
        outputTokenDetails: {
          textTokens: undefined,
          reasoningTokens: undefined,
        },
      },
    })

    expect(result.cost).toBe(3 + 1.5)
  })

  test.each(["@ai-sdk/anthropic", "@ai-sdk/amazon-bedrock", "@ai-sdk/google-vertex/anthropic"])(
    "computes total from components for %s models",
    (npm) => {
      const model = createModel({ context: 100_000, output: 32_000, npm })
      // AI SDK v6: inputTokens includes cached tokens for all providers
      const usage = {
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
        inputTokenDetails: {
          noCacheTokens: 800,
          cacheReadTokens: 200,
          cacheWriteTokens: undefined,
        },
        outputTokenDetails: {
          textTokens: undefined,
          reasoningTokens: undefined,
        },
      }
      if (npm === "@ai-sdk/amazon-bedrock") {
        const result = SessionNs.getUsage({
          model,
          usage,
          metadata: {
            bedrock: {
              usage: {
                cacheWriteInputTokens: 300,
              },
            },
          },
        })

        // inputTokens (1000) includes cache, so adjusted = 1000 - 200 - 300 = 500
        expect(result.tokens.input).toBe(500)
        expect(result.tokens.cache.read).toBe(200)
        expect(result.tokens.cache.write).toBe(300)
        // total = adjusted (500) + output (500) + cacheRead (200) + cacheWrite (300)
        expect(result.tokens.total).toBe(1500)
        return
      }

      const result = SessionNs.getUsage({
        model,
        usage,
        metadata: {
          anthropic: {
            cacheCreationInputTokens: 300,
          },
        },
      })

      // inputTokens (1000) includes cache, so adjusted = 1000 - 200 - 300 = 500
      expect(result.tokens.input).toBe(500)
      expect(result.tokens.cache.read).toBe(200)
      expect(result.tokens.cache.write).toBe(300)
      // total = adjusted (500) + output (500) + cacheRead (200) + cacheWrite (300)
      expect(result.tokens.total).toBe(1500)
    },
  )

  test("extracts cache write tokens from vertex metadata key", () => {
    const model = createModel({ context: 100_000, output: 32_000, npm: "@ai-sdk/google-vertex/anthropic" })
    const result = SessionNs.getUsage({
      model,
      usage: {
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
        inputTokenDetails: {
          noCacheTokens: 800,
          cacheReadTokens: 200,
          cacheWriteTokens: undefined,
        },
        outputTokenDetails: {
          textTokens: undefined,
          reasoningTokens: undefined,
        },
      },
      metadata: {
        vertex: {
          cacheCreationInputTokens: 300,
        },
      },
    })

    expect(result.tokens.input).toBe(500)
    expect(result.tokens.cache.read).toBe(200)
    expect(result.tokens.cache.write).toBe(300)
  })
})

describe("session.compaction.conversationWithin", () => {
  function withUserText(text: string): MessageV2.WithParts {
    const id = MessageID.ascending()
    const sessionID = SessionID.descending()
    return {
      info: {
        id,
        role: "user",
        sessionID,
        agent: "build",
        model: ref,
        time: { created: Date.now() },
      },
      parts: [{ id: PartID.ascending(), messageID: id, sessionID, type: "text", text }],
    }
  }

  function withAssistantText(parentID: MessageID, text: string): MessageV2.WithParts {
    const id = MessageID.ascending()
    const sessionID = SessionID.descending()
    return {
      info: {
        id,
        role: "assistant",
        sessionID,
        mode: "build",
        agent: "build",
        path: { cwd: "/", root: "/" },
        cost: 0,
        tokens: { output: 0, input: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        modelID: ref.modelID,
        providerID: ref.providerID,
        parentID,
        time: { created: Date.now() },
        finish: "end_turn",
      },
      parts: [{ id: PartID.ascending(), messageID: id, sessionID, type: "text", text }],
    }
  }

  test("returns the full transcript when budget is undefined", () => {
    const head = [withUserText("hello world")]
    const built = SessionCompaction.conversationWithin(head, undefined)
    expect(built.degraded).toBe(false)
    expect(built.text).toContain("hello world")
  })

  test("keeps the full transcript when it fits the budget", () => {
    const first = withUserText("hello world")
    const head = [first, withAssistantText(first.info.id, "assistant reply")]
    const built = SessionCompaction.conversationWithin(head, 10_000)
    expect(built.degraded).toBe(false)
    expect(built.text).toContain("hello world")
    expect(built.text).toContain("assistant reply")
  })

  test("degrades to clipped user-only text when the full transcript exceeds the budget", () => {
    const first = withUserText("x".repeat(50_000))
    const head = [first, withAssistantText(first.info.id, "assistant reply")]
    const built = SessionCompaction.conversationWithin(head, 4_000)
    expect(built.degraded).toBe(true)
    expect(built.text).toContain("characters omitted")
    expect(built.text).not.toContain("assistant reply")
    expect(built.text!.length).toBeLessThan(10_000)
  })

  test("drops the oldest turns when clipped user-only text still exceeds the budget", () => {
    const head = []
    for (let i = 0; i < 20; i++) head.push(withUserText(`marker-${String(i).padStart(3, "0")} ${"z".repeat(7_900)}`))
    const built = SessionCompaction.conversationWithin(head, 4_000)
    expect(built.degraded).toBe(true)
    expect(built.text).toContain("marker-019")
    expect(built.text).not.toContain("marker-000")
  })

  test("returns undefined when even the newest turn cannot fit", () => {
    const head = [withUserText(`blob ${"x".repeat(10_000)}`)]
    const built = SessionCompaction.conversationWithin(head, 10)
    expect(built.text).toBeUndefined()
    expect(built.degraded).toBe(true)
  })

  function withUserTexts(...texts: string[]): MessageV2.WithParts {
    const id = MessageID.ascending()
    const sessionID = SessionID.descending()
    return {
      info: {
        id,
        role: "user",
        sessionID,
        agent: "build",
        model: ref,
        time: { created: Date.now() },
      },
      parts: texts.map((text) => ({ id: PartID.ascending(), messageID: id, sessionID, type: "text" as const, text })),
    }
  }

  test("collapses repeated skill doc injections into one copy plus a reference", () => {
    const doc = `# Skill: my-skill\n\n${"d".repeat(100_000)}`
    const first = withUserTexts(doc, "workspace note")
    const head = [first, withAssistantText(first.info.id, "assistant reply"), withUserTexts(doc, "task text")]
    const built = SessionCompaction.conversationWithin(head, undefined)
    expect(built.degraded).toBe(false)
    expect(built.text!.match(/# Skill: my-skill/g)?.length).toBe(1)
    expect(built.text).toContain("[Skill my-skill was loaded again later in the conversation; duplicate content omitted]")
    expect(built.text).toContain("workspace note")
    expect(built.text).toContain("task text")
    expect(built.text!.length).toBeGreaterThan(doc.length)
    expect(built.text!.length).toBeLessThan(doc.length * 1.5)
  })

  test("keeps different skill docs side by side", () => {
    const head = [withUserTexts("# Skill: skill-a\ncontent a"), withUserTexts("# Skill: skill-b\ncontent b")]
    const built = SessionCompaction.conversationWithin(head, undefined)
    expect(built.text).toContain("skill-a")
    expect(built.text).toContain("skill-b")
    expect(built.text).not.toContain("duplicate content omitted")
  })

  test("gives skill docs a larger clip quota than plain text at the user-only level", () => {
    const doc = `# Skill: my-skill\n${"d".repeat(50_000)}`
    const plain = "p".repeat(50_000)
    const head = [withUserTexts(doc, plain)]
    const built = SessionCompaction.conversationWithin(head, 4_000)
    expect(built.degraded).toBe(true)
    expect(built.text).toContain("42018 characters omitted")
    expect(built.text).toContain("48000 characters omitted")
    expect(built.text).toContain("d".repeat(3_900))
    expect(built.text).toContain("p".repeat(990))
    expect(built.text).not.toContain("p".repeat(1_100))
  })

  test("retains the kept copy when the first skill injection is dropped by the ladder", () => {
    const doc = `# Skill: my-skill\n${"d".repeat(40_000)}`
    const head = [
      withUserTexts(doc),
      withUserTexts(...Array.from({ length: 10 }, () => "m".repeat(40_000))),
      withUserTexts(doc),
    ]
    const built = SessionCompaction.conversationWithin(head, 4_000)
    expect(built.degraded).toBe(true)
    expect(built.text).toContain("d".repeat(1_000))
    expect(built.text).not.toContain("m".repeat(990))
    expect(built.text).not.toContain("duplicate content omitted")
  })
})

describe("session.compaction.summary sizing", () => {
  test("fails fast when the minimal transcript cannot fit the summary model budget", async () => {
    await using tmp = await tmpdir()
    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await svc.create({})
        const old = await user(session.id, `old ${"x".repeat(80_000)}`)
        await assistant(session.id, old.id, tmp.path)
        await user(session.id, "hello")
        await SessionCompaction.create({ sessionID: session.id, agent: "build", model: ref, auto: false })

        const narrow = () => ProviderTest.fake({ model: createModel({ context: 10_000, output: 2_000 }) })
        const rt = runtime("continue", Plugin.defaultLayer, narrow())
        try {
          const msgs = await svc.messages({ sessionID: session.id })
          const parent = msgs.at(-1)?.info.id
          expect(parent).toBeTruthy()
          const result = await rt.runPromise(
            SessionCompaction.Service.use((svc) =>
              svc.process({ parentID: parent!, messages: msgs, sessionID: session.id, auto: false }),
            ),
          )

          expect(result).toBe("stop")
          const summary = (await svc.messages({ sessionID: session.id })).find(
            (msg) => msg.info.role === "assistant" && msg.info.summary,
          )
          expect(summary?.info.role).toBe("assistant")
          if (summary?.info.role === "assistant") {
            expect(summary.info.finish).toBe("error")
            expect(JSON.stringify(summary.info.error)).toContain("cannot fit the summary model budget")
          }
        } finally {
          await rt.dispose()
        }
      },
    })
  })

  test("degrades the transcript and sends a clipped summary prompt", async () => {
    const stub = llm()
    let captured = ""
    stub.push(
      reply("summary", (input) => {
        captured = JSON.stringify(input.messages)
      }),
    )
    await using tmp = await tmpdir({ git: true })
    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await svc.create({})
        await user(session.id, `skill doc ${"x".repeat(400_000)}`)
        await user(session.id, "latest question")
        await SessionCompaction.create({ sessionID: session.id, agent: "build", model: ref, auto: false })

        const rt = liveRuntime(stub.layer, wide(), cfg())
        try {
          const msgs = await svc.messages({ sessionID: session.id })
          const parent = msgs.at(-1)?.info.id
          expect(parent).toBeTruthy()
          const result = await rt.runPromise(
            SessionCompaction.Service.use((svc) =>
              svc.process({ parentID: parent!, messages: msgs, sessionID: session.id, auto: false }),
            ),
          )

          expect(result).toBe("continue")
          expect(captured).toContain("characters omitted")
          expect(captured).not.toContain("x".repeat(1_500))
        } finally {
          await rt.dispose()
        }
      },
    })
  })

  test("skips the summary when the history fits the tail budget", async () => {
    await using tmp = await tmpdir()
    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await svc.create({})
        await user(session.id, "hello")
        await SessionCompaction.create({ sessionID: session.id, agent: "build", model: ref, auto: false })

        const rt = runtime("continue", Plugin.defaultLayer, wide())
        try {
          const msgs = await svc.messages({ sessionID: session.id })
          const parent = msgs.at(-1)?.info.id
          expect(parent).toBeTruthy()
          const result = await rt.runPromise(
            SessionCompaction.Service.use((svc) =>
              svc.process({ parentID: parent!, messages: msgs, sessionID: session.id, auto: false }),
            ),
          )

          expect(result).toBe("stop")
          const part = await lastCompactionPart(session.id)
          expect(part?.type).toBe("compaction")
          expect(part?.tail_start_id).toBeUndefined()
          const summary = (await svc.messages({ sessionID: session.id })).find(
            (msg) => msg.info.role === "assistant" && msg.info.summary,
          )
          expect(summary?.info.role).toBe("assistant")
          if (summary?.info.role === "assistant") {
            expect(summary.info.finish).toBe("error")
            expect(JSON.stringify(summary.info.error)).toContain("fits entirely within the preserved-recent budget")
          }
        } finally {
          await rt.dispose()
        }
      },
    })
  })

  test("names system and tools pressure in the no-op error when context tokens are provided", async () => {
    await using tmp = await tmpdir()
    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await svc.create({})
        await user(session.id, "hello")
        await SessionCompaction.create({ sessionID: session.id, agent: "build", model: ref, auto: false })

        const rt = runtime("continue", Plugin.defaultLayer, wide())
        try {
          const msgs = await svc.messages({ sessionID: session.id })
          const parent = msgs.at(-1)?.info.id
          const result = await rt.runPromise(
            SessionCompaction.Service.use((svc) =>
              svc.process({
                parentID: parent!,
                messages: msgs,
                sessionID: session.id,
                auto: false,
                // 全账(fixed 22k + margin)≥ usable:真压力,保留诚实拒绝并点名来源
                contextTokens: { system: 10_000, tools: 12_000, usable: 23_500 },
              }),
            ),
          )

          expect(result).toBe("stop")
          const summary = (await svc.messages({ sessionID: session.id })).find(
            (msg) => msg.info.role === "assistant" && msg.info.summary,
          )
          if (summary?.info.role === "assistant") {
            const error = JSON.stringify(summary.info.error)
            expect(error).toContain("system prompt ~10000")
            expect(error).toContain("tools ~12000")
            expect(error).toContain("23500-token usable limit")
            expect(error).toContain("reduce the toolset")
          }
        } finally {
          await rt.dispose()
        }
      },
    })
  })

  test("rejects compaction when the post-compaction floor exceeds the usable limit", async () => {
    await using tmp = await tmpdir()
    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await svc.create({})
        await user(session.id, `old ${"x".repeat(80_000)}`)
        await user(session.id, "hello")
        await SessionCompaction.create({ sessionID: session.id, agent: "build", model: ref, auto: false })

        const rt = runtime("continue", Plugin.defaultLayer, wide())
        try {
          const msgs = await svc.messages({ sessionID: session.id })
          const parent = msgs.at(-1)?.info.id
          const result = await rt.runPromise(
            SessionCompaction.Service.use((svc) =>
              svc.process({
                parentID: parent!,
                messages: msgs,
                sessionID: session.id,
                auto: false,
                contextTokens: { system: 10_000, tools: 12_000, usable: 20_000 },
              }),
            ),
          )

          expect(result).toBe("stop")
          const part = await lastCompactionPart(session.id)
          expect(part?.type).toBe("compaction")
          expect(part?.tail_start_id).toBeUndefined()
          const summary = (await svc.messages({ sessionID: session.id })).find(
            (msg) => msg.info.role === "assistant" && msg.info.summary,
          )
          if (summary?.info.role === "assistant") {
            const error = JSON.stringify(summary.info.error)
            expect(error).toContain("cannot bring the context under the limit")
            expect(error).toContain("20000-token usable limit")
          }
        } finally {
          await rt.dispose()
        }
      },
    })
  })

  test("allows compaction when the projected floor with the actual retained tail fits", async () => {
    await using tmp = await tmpdir()
    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await svc.create({})
        await user(session.id, `old ${"x".repeat(80_000)}`)
        const keep = await user(session.id, "hello")
        await SessionCompaction.create({ sessionID: session.id, agent: "build", model: ref, auto: false })

        const rt = runtime("continue", Plugin.defaultLayer, wide())
        try {
          const msgs = await svc.messages({ sessionID: session.id })
          const parent = msgs.at(-1)?.info.id
          const result = await rt.runPromise(
            SessionCompaction.Service.use((svc) =>
              svc.process({
                parentID: parent!,
                messages: msgs,
                sessionID: session.id,
                auto: false,
                // 旧地板用保尾预算上限(15k)代替实际尾部(≈几十 tokens):10k+12k+15k+2k=39k ≥ 30k
                // 会误拒;投影用实际尾部 + 估算余量 ≈ 26k < 30k,放行压缩。
                contextTokens: { system: 10_000, tools: 12_000, usable: 30_000 },
              }),
            ),
          )

          const part = await lastCompactionPart(session.id)
          const summary = (await svc.messages({ sessionID: session.id })).find(
            (msg) => msg.info.role === "assistant" && msg.info.summary,
          )

          expect(result).toBe("continue")
          expect(part?.type).toBe("compaction")
          expect(part?.tail_start_id).toBe(keep.id)
          expect(summary?.info.role).toBe("assistant")
          if (summary?.info.role === "assistant") expect(summary.info.finish).not.toBe("error")
        } finally {
          await rt.dispose()
        }
      },
    })
  })

  test("shrinks the transcript on provider rejection and gives up after the steps", async () => {
    await using tmp = await tmpdir()
    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await svc.create({})
        await user(session.id, `old ${"x".repeat(80_000)}`)
        await user(session.id, "latest question")
        await SessionCompaction.create({ sessionID: session.id, agent: "build", model: ref, auto: false })

        const rt = runtime("compact", Plugin.defaultLayer, wide())
        try {
          const msgs = await svc.messages({ sessionID: session.id })
          const parent = msgs.at(-1)?.info.id
          expect(parent).toBeTruthy()
          const result = await rt.runPromise(
            SessionCompaction.Service.use((svc) =>
              svc.process({ parentID: parent!, messages: msgs, sessionID: session.id, auto: false }),
            ),
          )

          expect(result).toBe("stop")
          const summaries = (await svc.messages({ sessionID: session.id })).filter(
            (msg) => msg.info.role === "assistant" && msg.info.summary,
          )
          expect(summaries).toHaveLength(1)
          const failed = summaries[0]?.info
          expect(failed?.role).toBe("assistant")
          if (failed?.role === "assistant") expect(JSON.stringify(failed.error)).toContain("even after transcript degradation")
        } finally {
          await rt.dispose()
        }
      },
    })
  })
})

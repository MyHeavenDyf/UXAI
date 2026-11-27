import { Effect, Layer, Context } from "effect"
import * as Stream from "effect/Stream"
import { Bus } from "@/bus"
import { Session } from "@/session/session"
import { Agent } from "@/agent/agent"
import { Provider } from "@/provider/provider"
import { LLM } from "@/session/llm"
import { Config } from "@/config/config"
import { Flag } from "@opencode-ai/core/flag/flag"
import { extract } from "./extract"
import * as Log from "@opencode-ai/core/util/log"
import type { SessionID } from "@/session/schema"

const log = Log.create({ service: "memory.worker" })

// 节流:同 session 两次提取的最小间隔(ms)
const THROTTLE_MS = 5_000
const lastExtract = new Map<string, number>()

export interface Interface {
  readonly noop: () => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/MemoryWorker") {}

export const layer: Layer.Layer<Service, never, Bus.Service | Session.Service | Agent.Service | Provider.Service | LLM.Service | Config.Service> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const sessions = yield* Session.Service
    const agents = yield* Agent.Service
    const provider = yield* Provider.Service
    const llm = yield* LLM.Service
    const config = yield* Config.Service

    // 订阅 session.idle:回合完成时后台提取记忆
    // (复用 vcs.ts 的 Stream 模式,fiber 随 instance scope 自动中断)
    yield* (yield* bus.subscribe({ type: "session.idle" } as never)).pipe(
      Stream.runForEach(
        Effect.fnUntraced(function* (event: { properties: { sessionID: string } }) {
          const sessionID = event.properties.sessionID as string
          try {
            if (Flag.OCTO_DISABLE_MEMORY) return
            const cfg = (yield* config.get()).memory
            if (cfg?.enabled === false) return

            // 节流
            const now = Date.now()
            if (now - (lastExtract.get(sessionID) ?? 0) < THROTTLE_MS) return
            lastExtract.set(sessionID, now)

            const session = yield* sessions.get(sessionID as SessionID).pipe(
              Effect.catch(() => Effect.succeed(undefined)),
            )
            if (!session || session.parentID) return

            // 完全静默提取:失败只 log,不影响主流程
            const result = yield* extract({
              sessionID,
              projectID: session.projectID,
              agent: agents,
              provider,
              llm,
              sessions,
              memoryModel: cfg?.model,
            }).pipe(Effect.catch(() => Effect.succeed({ parsed: 0, applied: 0 })))

            if (result.applied > 0) {
              log.info("memory extracted", { sessionID, parsed: result.parsed, applied: result.applied })
            }
          } catch {
            // 静默
          }
        }),
      ),
      Effect.forkScoped,
    )

    return Service.of({ noop: () => Effect.void })
  }),
)

import { Effect, Stream, Scope } from "effect"
import type { Bus } from "@/bus"
import { SessionStatus } from "@/session/status"
import type { Session } from "@/session/session"
import type { Agent } from "@/agent/agent"
import type { Provider } from "@/provider/provider"
import type { LLM } from "@/session/llm"
import type { Config } from "@/config/config"
import { Flag } from "@opencode-ai/core/flag/flag"
import { extract } from "./extract"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "memory.worker" })

// 节流:同 session 两次提取的最小间隔(ms)
const THROTTLE_MS = 5_000
const lastExtract = new Map<string, number>()

// Memory Worker:由 bootstrap 传入已解析的服务实例(共享同一个 Bus/Session/LLM),
// 订阅 session.idle,回合完成后后台提取记忆,完全静默。
// 需要一个 Scope(fiber 生命周期管理),且该 Scope 必须长于 start() 调用本身
// —— 用 Effect.scoped 包装会在 start() 返回时关闭 scope 并中断订阅 fiber。
export function start(services: {
  bus: Bus.Interface
  sessions: Session.Interface
  agents: Agent.Interface
  provider: Provider.Interface
  llm: LLM.Interface
  config: Config.Interface
}): Effect.Effect<void, never, Scope.Scope> {
  return Effect.gen(function* () {
    log.info("memory worker starting (subscribing to session.idle)")

    yield* (yield* services.bus.subscribe(SessionStatus.Event.Idle)).pipe(
      Stream.runForEach(
        Effect.fnUntraced(function* (event: { properties: { sessionID: string } }) {
          const sessionID = event.properties.sessionID
          try {
            if (Flag.OCTO_DISABLE_MEMORY) return
            const cfg = (yield* services.config.get()).memory
            if (cfg?.enabled === false) return

            const now = Date.now()
            if (now - (lastExtract.get(sessionID) ?? 0) < THROTTLE_MS) return
            lastExtract.set(sessionID, now)

            const session = yield* services.sessions.get(sessionID as never).pipe(
              Effect.catch(() => Effect.succeed(undefined)),
            )
            if (!session || session.parentID) return

            log.info("extracting memory", { sessionID, projectID: session.projectID })

            // 完全静默:失败(failure)与缺陷(defect)都不许打断订阅——
            // extract 内部对非法 memory.model 会 Effect.die,若不接住 defect,
            // Stream.runForEach 的消费 fiber 会被杀死,worker 从此对所有会话停摆
            const result = yield* extract({
              sessionID,
              projectID: session.projectID,
              agent: services.agents,
              provider: services.provider,
              llm: services.llm,
              sessions: services.sessions,
              memoryModel: cfg?.model,
            }).pipe(
              Effect.catchDefect(() => Effect.succeed({ parsed: 0, applied: 0 })),
              Effect.catch(() => Effect.succeed({ parsed: 0, applied: 0 })),
            )

            log.info("memory extraction done", { sessionID, parsed: result.parsed, applied: result.applied })
          } catch (error) {
            log.warn("memory extraction failed silently", { sessionID, error: String(error) })
          }
        }),
      ),
      Effect.forkScoped,
    )
  })
}

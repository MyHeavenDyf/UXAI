import { Cause, Effect, Exit, Stream, Scope } from "effect"
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

const DEFAULT_INTERVAL_SECONDS = 5
// 不同 session 的提取可并发执行(一个慢提取不阻塞其它会话),但有上限
const MAX_CONCURRENT_SESSIONS = 3

// 会话提取调度状态:
// running   该 session 的提取正在执行(single-flight:新 idle 只记 pending)
// pending   执行期间有新 idle 到达,完成后 trailing 补跑最后一次
// scheduled trailing 定时器在途,间隔到期后补跑
type RunState = { running: boolean; pending: boolean; scheduled: boolean; lastRun: number; intervalMs: number }

// 简单信号量:acquire 返回 release,超限等待
class Limit {
  #active = 0
  #waiters: (() => void)[] = []
  constructor(readonly max: number) {}
  async acquire(): Promise<() => void> {
    if (this.#active >= this.max) await new Promise<void>((resolve) => this.#waiters.push(resolve))
    this.#active++
    let released = false
    return () => {
      if (released) return
      released = true
      this.#active--
      this.#waiters.shift()?.()
    }
  }
}

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
    const runs = new Map<string, RunState>()
    const limit = new Limit(MAX_CONCURRENT_SESSIONS)

    const timer: (sessionID: string, delay: number) => Effect.Effect<void, never, Scope.Scope> = Effect.fnUntraced(function* (sessionID: string, delay: number) {
      yield* Effect.sleep(delay)
      const st = runs.get(sessionID)
      if (!st) return
      st.scheduled = false
      if (st.running) {
        st.pending = true
        return
      }
      st.running = true
      yield* run(sessionID)
    })

    const run: (sessionID: string) => Effect.Effect<void, never, Scope.Scope> = Effect.fnUntraced(function* (sessionID: string) {
      const st = runs.get(sessionID)
      if (!st) return
      const release = yield* Effect.promise(() => limit.acquire())
      const exit = yield* Effect.gen(function* () {
        // 执行前复检开关:信号量排队期间 memory 可能已被关闭
        if (Flag.OCTO_DISABLE_MEMORY) return
        const cfg = (yield* services.config.get()).memory
        if (cfg?.enabled === false) return
        const session = yield* services.sessions.get(sessionID as never).pipe(
          Effect.catch(() => Effect.succeed(undefined)),
        )
        if (!session) {
          // 清理:会话已删除,调度状态不再需要
          runs.delete(sessionID)
          return
        }
        if (session.parentID) return
        log.info("extracting memory", { sessionID, projectID: session.projectID })

        // 完全静默:失败(failure)与缺陷(defect)都不许打断调度——
        // extract 内部对非法 memory.model 会 Effect.die,若不接住 defect,
        // 整个提取调度会停摆
        const result = yield* extract({
          sessionID,
          projectID: session.projectID,
          agent: services.agents,
          provider: services.provider,
          llm: services.llm,
          sessions: services.sessions,
          memoryModel: cfg?.model,
        }).pipe(
          Effect.catchDefect(() => Effect.succeed({ parsed: 0, applied: 0, skipped: 0 })),
          Effect.catch(() => Effect.succeed({ parsed: 0, applied: 0, skipped: 0 })),
        )

        log.info("memory extraction done", { sessionID, parsed: result.parsed, applied: result.applied })
        if (result.skipped) log.warn("memory extraction skipped actions", { sessionID, skipped: result.skipped })
      }).pipe(Effect.exit)
      release()
      st.running = false
      st.lastRun = Date.now()
      if (Exit.isFailure(exit)) {
        // 失败不自动循环重试:pending 清空,等待下一次自然 idle(有界重试;
        // 游标未推进,下次提取自然覆盖本批消息)
        st.pending = false
        st.scheduled = false
        log.warn("memory extraction failed", { sessionID, cause: String(Cause.squash(exit.cause)) })
        return
      }
      if (st.pending) {
        // trailing:执行期间的新 idle 在间隔到期后补跑最后一次。
        // 先置 scheduled 再 fork:delay 为 0 时 timer 可能在 fork 返回前就触发,
        // 反过来先置位会留下"有标志无定时器"的卡死状态
        st.pending = false
        st.scheduled = true
        yield* Effect.forkScoped(timer(sessionID, Math.max(0, st.lastRun + st.intervalMs - Date.now())))
      }
    })

    const handle: (sessionID: string) => Effect.Effect<void, never, Scope.Scope> = Effect.fnUntraced(function* (sessionID: string) {
      if (Flag.OCTO_DISABLE_MEMORY) return
      const cfg = (yield* services.config.get()).memory
      if (cfg?.enabled === false) return
      const intervalMs = (cfg?.extraction_interval_seconds ?? DEFAULT_INTERVAL_SECONDS) * 1000

      const st = runs.get(sessionID) ?? { running: false, pending: false, scheduled: false, lastRun: 0, intervalMs }
      st.intervalMs = intervalMs
      runs.set(sessionID, st)

      if (st.running) {
        st.pending = true // single-flight:在途时新 idle 只记 pending
        return
      }
      if (st.scheduled) return // 定时器已排队;增量消息由其执行时一并处理(游标增量)
      const delay = st.lastRun + intervalMs - Date.now()
      if (delay > 0) {
        // trailing 节流:间隔内的 idle 不丢弃,到期补跑最后一次(先置位再 fork)
        st.scheduled = true
        yield* Effect.forkScoped(timer(sessionID, delay))
        return
      }
      st.running = true
      yield* Effect.forkScoped(run(sessionID))
    })

    yield* (yield* services.bus.subscribe(SessionStatus.Event.Idle)).pipe(
      Stream.runForEach((event: { properties: { sessionID: string } }) =>
        handle(event.properties.sessionID).pipe(
          // 调度器绝不因单个事件失败而停摆:failure 与 defect 一律吞掉
          Effect.catchDefect(() => Effect.void),
          Effect.catch(() => Effect.void),
        ),
      ),
      Effect.forkScoped,
    )
  })
}

import { Effect } from "effect"
import { Bus } from "@/bus"
import { SessionStatus } from "@/session/status"
import { Session } from "@/session/session"
import { Agent } from "@/agent/agent"
import { Provider } from "@/provider/provider"
import { LLM } from "@/session/llm"
import { Config } from "@/config/config"
import { AppRuntime } from "@/effect/app-runtime"
import { Flag } from "@opencode-ai/core/flag/flag"
import { extract } from "./extract"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "memory.worker" })

// 节流:同 session 两次提取的最小间隔(ms)
const THROTTLE_MS = 5_000
const lastExtract = new Map<string, number>()

let started = false

// Memory Worker:订阅 session.idle,回合完成后后台提取记忆。
// 由 project/bootstrap.ts 调用启动(与 studio worker 同款模式)。
// 完全静默:无授权弹窗、无用户可见消息、失败只 log。
export function startMemoryWorker() {
  if (started) return
  started = true
  log.info("memory worker starting")

  // 非回调层订阅(不需要 Scope),提取工作在回调内用 AppRuntime 执行
  Bus.subscribe(SessionStatus.Event.Idle, (event) => {
    const sessionID = event.properties.sessionID
    if (Flag.OCTO_DISABLE_MEMORY) return

    // 节流
    const now = Date.now()
    if (now - (lastExtract.get(sessionID) ?? 0) < THROTTLE_MS) return
    lastExtract.set(sessionID, now)

    // 在 AppRuntime 环境中执行提取(完全静默)
    AppRuntime.runPromise(
      Effect.gen(function* () {
        const config = yield* Config.Service
        const cfg = (yield* config.get()).memory
        if (cfg?.enabled === false) return

        const sessions = yield* Session.Service
        const session = yield* sessions.get(sessionID).pipe(
          Effect.catch(() => Effect.succeed(undefined)),
        )
        if (!session || session.parentID) return

        log.info("extracting memory", { sessionID, projectID: session.projectID })

        const agents = yield* Agent.Service
        const provider = yield* Provider.Service
        const llm = yield* LLM.Service

        const result = yield* extract({
          sessionID,
          projectID: session.projectID,
          agent: agents,
          provider,
          llm,
          sessions,
          memoryModel: cfg?.model,
        }).pipe(Effect.catch(() => Effect.succeed({ parsed: 0, applied: 0 })))

        log.info("memory extraction done", { sessionID, parsed: result.parsed, applied: result.applied })
      }),
    ).catch((error) => {
      log.warn("memory extraction failed silently", { sessionID, error: String(error) })
    })
  })
}

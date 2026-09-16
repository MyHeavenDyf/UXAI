import { GlobalBus } from "@/bus/global"
import { InstanceStore } from "@/project/instance-store"
import { Config } from "@/config/config"
import * as Log from "@opencode-ai/core/util/log"
import { Effect } from "effect"
import { Event } from "./event"

const log = Log.create({ service: "server" })

export const emitGlobalDisposed = Effect.sync(() =>
  GlobalBus.emit("event", {
    directory: "global",
    payload: {
      type: Event.Disposed.type,
      properties: {},
    },
  }),
)

export const disposeAllInstancesAndEmitGlobalDisposed = Effect.fn("Server.disposeAllInstancesAndEmitGlobalDisposed")(
  function* (options?: { swallowErrors?: boolean }) {
    log.info("disposeAll:start", { t: Date.now() })
    const store = yield* InstanceStore.Service
    const config = yield* Config.Service
    yield* Effect.gen(function* () {
      // 配置必须先失效。disposeAll 期间前端查询可能立即重新拉起某个实例；如果此时
      // cachedGlobal 仍是旧值，该实例会一直保留旧 MCP 列表，直到下一次全局刷新。
      yield* config.invalidate()
      yield* options?.swallowErrors
        ? store.disposeAll().pipe(
            Effect.catchCause((cause) =>
              Effect.sync(() => {
                log.warn("global disposal failed", { cause })
              }),
            ),
          )
        : store.disposeAll()
      log.info("disposeAll:emit-disposed", { t: Date.now() })
      yield* emitGlobalDisposed
      log.info("disposeAll:done", { t: Date.now() })
    }).pipe(Effect.uninterruptible)
  },
)

export * as GlobalLifecycle from "./global-lifecycle"

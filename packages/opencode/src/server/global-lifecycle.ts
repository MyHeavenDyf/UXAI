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
      yield* options?.swallowErrors
        ? store.disposeAll().pipe(
            Effect.catchCause((cause) =>
              Effect.sync(() => {
                log.warn("global disposal failed", { cause })
              }),
            ),
          )
        : store.disposeAll()
      // 外部编辑 octo.json 后仅 dispose 无法刷新 cachedGlobal(无限 TTL,仅 updateGlobal/
      // replaceGlobalProvider 显式失效),统一在此失效,实例重建时才会重读配置文件
      yield* config.invalidate()
      log.info("disposeAll:emit-disposed", { t: Date.now() })
      yield* emitGlobalDisposed
      log.info("disposeAll:done", { t: Date.now() })
    }).pipe(Effect.uninterruptible)
  },
)

export * as GlobalLifecycle from "./global-lifecycle"

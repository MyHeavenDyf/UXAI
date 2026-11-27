import { Effect, Layer, Context, Schema } from "effect"
import { Bus } from "../bus"
import { Snapshot } from "../snapshot"
import { Storage } from "@/storage/storage"
import { SyncEvent } from "../sync"
import * as Log from "@opencode-ai/core/util/log"
import { zod } from "@/util/effect-zod"
import { withStatics } from "@/util/schema"
import * as Session from "./session"
import { MessageV2 } from "./message-v2"
import { SessionID, MessageID, PartID } from "./schema"
import { SessionRunState } from "./run-state"
import { SessionSummary } from "./summary"

const log = Log.create({ service: "session.revert" })

export const RevertInput = Schema.Struct({
  sessionID: SessionID,
  messageID: MessageID,
  partID: Schema.optional(PartID),
}).pipe(withStatics((s) => ({ zod: zod(s) })))
export type RevertInput = Schema.Schema.Type<typeof RevertInput>

export interface Interface {
  readonly revert: (input: RevertInput) => Effect.Effect<Session.Info>
  readonly unrevert: (input: { sessionID: SessionID }) => Effect.Effect<Session.Info>
  readonly cleanup: (session: Session.Info) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionRevert") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const snap = yield* Snapshot.Service
    const storage = yield* Storage.Service
    const bus = yield* Bus.Service
    const summary = yield* SessionSummary.Service
    const state = yield* SessionRunState.Service
    const sync = yield* SyncEvent.Service

    const revert = Effect.fn("SessionRevert.revert")(function* (input: RevertInput) {
      yield* state.assertNotBusy(input.sessionID)
      const all = yield* sessions.messages({ sessionID: input.sessionID })
      let lastUser: MessageV2.User | undefined
      const session = yield* sessions.get(input.sessionID).pipe(Effect.orDie)

      let rev: Session.Info["revert"]
      const patchParts: Array<{ id: MessageID; part: Snapshot.Patch }> = []
      for (const msg of all) {
        if (msg.info.role === "user") lastUser = msg.info
        const remaining = []
        for (const part of msg.parts) {
          if (rev) {
            if (part.type === "patch") patchParts.push({ id: msg.info.id, part })
            continue
          }

          if (!rev) {
            if ((msg.info.id === input.messageID && !input.partID) || part.id === input.partID) {
              const partID = remaining.some((item) => ["text", "tool"].includes(item.type)) ? input.partID : undefined
              rev = {
                messageID: !partID && lastUser ? lastUser.id : msg.info.id,
                partID,
              }
            }
            remaining.push(part)
          }
        }
      }

      if (!rev) return session

      // 子任务子会话(task 派发)的文件写入 patch 记在子会话消息里,只收集主会话的
      // 话回退不会恢复/删除子任务落盘文件(git 项目)。与 cleanup 同口径取
      // id >= messageID 的子会话 patch,按消息 id 与主会话 patch 时序合并——
      // snapshot.revert 对同一文件取数组中首次出现的快照,时序排序保证是
      // 回退点后最早一次写入前的状态(即回退点时的文件内容)。
      for (const child of yield* sessions.children(input.sessionID)) {
        const childMsgs = yield* sessions.messages({ sessionID: child.id })
        for (const msg of childMsgs) {
          if (msg.info.id < rev.messageID) continue
          for (const part of msg.parts) {
            if (part.type === "patch") patchParts.push({ id: msg.info.id, part })
          }
        }
      }
      patchParts.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      const patches = patchParts.map((item) => item.part)

      rev.snapshot = session.revert?.snapshot ?? (yield* snap.track())
      if (session.revert?.snapshot) yield* snap.restore(session.revert.snapshot)
      yield* snap.revert(patches)
      if (rev.snapshot) rev.diff = yield* snap.diff(rev.snapshot)
      const range = all.filter((msg) => msg.info.id >= rev.messageID)
      const diffs = yield* summary.computeDiff({ messages: range })
      yield* storage.write(["session_diff", input.sessionID], diffs).pipe(Effect.ignore)
      yield* bus.publish(Session.Event.Diff, { sessionID: input.sessionID, diff: diffs })
      yield* sessions.setRevert({
        sessionID: input.sessionID,
        revert: rev,
        summary: {
          additions: diffs.reduce((sum, x) => sum + x.additions, 0),
          deletions: diffs.reduce((sum, x) => sum + x.deletions, 0),
          files: diffs.length,
        },
      })
      return yield* sessions.get(input.sessionID).pipe(Effect.orDie)
    })

    const unrevert = Effect.fn("SessionRevert.unrevert")(function* (input: { sessionID: SessionID }) {
      log.info("unreverting", input)
      yield* state.assertNotBusy(input.sessionID)
      const session = yield* sessions.get(input.sessionID).pipe(Effect.orDie)
      if (!session.revert) return session
      if (session.revert.snapshot) yield* snap.restore(session.revert.snapshot)
      yield* sessions.clearRevert(input.sessionID)
      return yield* sessions.get(input.sessionID).pipe(Effect.orDie)
    })

    const cleanup = Effect.fn("SessionRevert.cleanup")(function* (session: Session.Info) {
      if (!session.revert) return
      const sessionID = session.id
      const msgs = yield* sessions.messages({ sessionID })
      const messageID = session.revert.messageID
      const remove = [] as MessageV2.WithParts[]
      let target: MessageV2.WithParts | undefined
      for (const msg of msgs) {
        if (msg.info.id < messageID) continue
        if (msg.info.id > messageID) {
          remove.push(msg)
          continue
        }
        if (session.revert.partID) {
          target = msg
          continue
        }
        remove.push(msg)
      }
      for (const msg of remove) {
        yield* sync.run(MessageV2.Event.Removed, {
          sessionID,
          messageID: msg.info.id,
        })
      }
      // 子任务子会话(task 派发)同样按回退点清理:id >= messageID 的消息移除。
      // 只清主会话的话,回退后发新消息清掉 revert 指针时,被回退轮次派发的
      // 子会话 turn 会重新出现在前端合并消息流里(幽灵 turn)。
      for (const child of yield* sessions.children(sessionID)) {
        const childMsgs = yield* sessions.messages({ sessionID: child.id })
        const hasEarlier = childMsgs.some((msg) => msg.info.id < messageID)
        for (const msg of childMsgs) {
          if (msg.info.id < messageID) continue
          yield* sync.run(MessageV2.Event.Removed, {
            sessionID: child.id,
            messageID: msg.info.id,
          })
        }
        // 整个子会话都落在回退点之后(回退轮次新派发的):会话本身一并删除
        if (!hasEarlier) yield* sessions.remove(child.id).pipe(Effect.ignore)
      }
      if (session.revert.partID && target) {
        const partID = session.revert.partID
        const idx = target.parts.findIndex((part) => part.id === partID)
        if (idx >= 0) {
          const removeParts = target.parts.slice(idx)
          target.parts = target.parts.slice(0, idx)
          for (const part of removeParts) {
            yield* sync.run(MessageV2.Event.PartRemoved, {
              sessionID,
              messageID: target.info.id,
              partID: part.id,
            })
          }
        }
      }
      yield* sessions.clearRevert(sessionID)
    })

    return Service.of({ revert, unrevert, cleanup })
  }),
)

export const defaultLayer = Layer.suspend(() =>
  layer.pipe(
    Layer.provide(SessionRunState.defaultLayer),
    Layer.provide(Session.defaultLayer),
    Layer.provide(Snapshot.defaultLayer),
    Layer.provide(Storage.defaultLayer),
    Layer.provide(Bus.layer),
    Layer.provide(SessionSummary.defaultLayer),
    Layer.provide(SyncEvent.defaultLayer),
  ),
)

export * as SessionRevert from "./revert"

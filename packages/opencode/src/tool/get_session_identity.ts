import { Effect, Schema } from "effect"
import * as Tool from "./tool"

// get_session_identity —— 把当前登录用户与会话标识读进模型上下文,供 skill 调内网接口时原样使用。
// 设计见 octo-agent docs/specs/agents/insight-session-identity.md(SPEC-INS-033)。
//
// 为什么是原生工具:skill 是文档 + 脚本,访问不到工具的 `ctx.extra`;身份值只有 renderer 拿得到
//   (`localStorage.userInfo`),经 promptAsync 的 `extra` 透传进 `ctx.extra`(与 SPEC-INS-030 §5 的
//   account 同一条管道)。本工具只负责把这几个值原样吐给模型,不发网络请求。
// 网关:只开给 octo_insight(registry.ts tools() 过滤);chip turn 由 buildToolGate 关掉。

export const Parameters = Schema.Struct({})

export type SessionIdentity = {
  userId?: string
  account?: string
  sessionId: string
}

// 缺 userId 时的显式失败文案:不输出空串让模型自己补,也不做任何兜底身份。
export const MISSING_USER_OUTPUT = "未获取到当前登录身份,请如实告知用户需要重新登录,不要编造或推测身份信息。"

const DESCRIPTION =
  "读取当前登录用户与当前会话的标识(userId、account、sessionId)。" +
  "需要以当前用户或当前会话的身份调用内部接口时使用;返回的值须逐字原样使用,不要改写、补全或推测。" +
  "本工具无需参数,不访问网络。"

function readExtra(ctx: Tool.Context, key: string): string | undefined {
  const raw = ctx.extra?.[key]
  if (typeof raw !== "string") return undefined
  const trimmed = raw.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

// 输出只放身份值本身,与说明文字分行隔开,方便模型逐字转抄。account 缺失只省略那一行。
export function formatIdentity(identity: SessionIdentity): string {
  if (!identity.userId) return MISSING_USER_OUTPUT
  return [
    "当前会话身份(系统提供,调用接口时逐字原样使用,不要改写、补全或推测):",
    `userId: ${identity.userId}`,
    ...(identity.account ? [`account: ${identity.account}`] : []),
    `sessionId: ${identity.sessionId}`,
  ].join("\n")
}

export const GetSessionIdentityTool = Tool.define(
  "get_session_identity",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (_params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.sync(() => {
          const identity: SessionIdentity = {
            userId: readExtra(ctx, "userId"),
            account: readExtra(ctx, "account"),
            sessionId: ctx.sessionID,
          }
          const missing = [
            ...(identity.userId ? [] : ["userId"]),
            ...(identity.account ? [] : ["account"]),
          ]
          // 只记缺了哪些字段,不打身份值本身。
          if (!identity.userId) console.error("[octo:ctx] identity missing", { sessionID: ctx.sessionID, missing })
          else if (missing.length) console.warn("[octo:ctx] identity partial", { sessionID: ctx.sessionID, missing })
          return {
            title: "读取会话身份",
            output: formatIdentity(identity),
            metadata: { ok: Boolean(identity.userId), missing },
          }
        }),
    }
  }),
)

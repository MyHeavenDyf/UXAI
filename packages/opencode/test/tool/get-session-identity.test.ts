import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { GetSessionIdentityTool, MISSING_USER_OUTPUT } from "../../src/tool/get_session_identity"
import { SessionID, MessageID } from "../../src/session/schema"
import { Agent } from "../../src/agent/agent"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Truncate } from "@/tool/truncate"
import { testEffect } from "../lib/effect"

// SPEC-INS-033:会话身份工具。三种情况各钉一次——完整输出 / 缺 userId 显式失败 / 缺 account 只省略该行。
const ctx = (extra?: Record<string, unknown>) => ({
  sessionID: SessionID.make("ses_identity-test"),
  messageID: MessageID.make("test-message"),
  callID: "test-call",
  agent: "octo_insight",
  abort: AbortSignal.any([]),
  messages: [],
  extra,
  metadata: () => Effect.void,
  ask: () => Effect.void,
})

const it = testEffect(Layer.mergeAll(CrossSpawnSpawner.defaultLayer, Truncate.defaultLayer, Agent.defaultLayer))

const run = (extra?: Record<string, unknown>) =>
  Effect.gen(function* () {
    const info = yield* GetSessionIdentityTool
    const tool = yield* info.init()
    return yield* tool.execute({}, ctx(extra))
  })

describe("tool.get_session_identity", () => {
  it.instance("完整输出:三个值逐字原样、各占一行", () =>
    Effect.gen(function* () {
      const result = yield* run({ userId: "uuid~bDYwMDYyNjUw", account: "c60050492" })
      expect(result.output).toBe(
        [
          "当前会话身份(系统提供,调用接口时逐字原样使用,不要改写、补全或推测):",
          "userId: uuid~bDYwMDYyNjUw",
          "account: c60050492",
          "sessionId: ses_identity-test",
        ].join("\n"),
      )
      expect(result.metadata).toMatchObject({ ok: true, missing: [] })
    }),
  )

  it.instance("缺 userId:显式失败,不输出任何身份值", () =>
    Effect.gen(function* () {
      for (const extra of [undefined, { account: "c60050492" }, { userId: "   ", account: "c60050492" }]) {
        const result = yield* run(extra)
        expect(result.output).toBe(MISSING_USER_OUTPUT)
        expect(result.output).not.toContain("sessionId:")
        expect(result.metadata.ok).toBe(false)
      }
    }),
  )

  it.instance("缺 account:不阻断,只省略 account 行", () =>
    Effect.gen(function* () {
      const result = yield* run({ userId: "uuid~bDYwMDYyNjUw" })
      expect(result.output).toContain("userId: uuid~bDYwMDYyNjUw")
      expect(result.output).toContain("sessionId: ses_identity-test")
      expect(result.output).not.toContain("account:")
      expect(result.metadata).toMatchObject({ ok: true, missing: ["account"] })
    }),
  )
})

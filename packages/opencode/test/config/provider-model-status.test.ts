import { expect, test } from "bun:test"
import { Schema } from "effect"
import { Model } from "@/config/provider"
import { Config } from "@/config/config"

test.each(["alpha", "beta", "deprecated", "active"] as const)("preserves the valid model status %s across config codecs", (status) => {
  const config = { provider: { cannbot: { models: { "cannbot-error": { status } } } } }
  expect(Schema.decodeUnknownSync(Config.Info)(config)).toEqual(config)
  expect(Schema.encodeUnknownSync(Config.Info)(config)).toEqual(config)
  expect(Model.zod.safeParse({ status }).success).toBe(true)
})

test.each(["error", "ready", "", 1, null])("continues rejecting an unsupported model status: %s", (status) => {
  const config = { provider: { cannbot: { models: { "cannbot-error": { status } } } } }
  expect(() => Schema.decodeUnknownSync(Config.Info)(config)).toThrow()
  expect(() => Schema.encodeUnknownSync(Config.Info)(config)).toThrow()
  expect(Model.zod.safeParse({ status }).success).toBe(false)
})

test("does not require or insert a status when the model omits it", () => {
  const config = { provider: { cannbot: { models: { "cannbot-error": {} } } } }
  expect(Schema.decodeUnknownSync(Config.Info)(config)).toEqual(config)
  expect(Schema.encodeUnknownSync(Config.Info)(config)).toEqual(config)
})

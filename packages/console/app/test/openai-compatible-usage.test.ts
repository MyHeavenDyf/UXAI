import { describe, expect, test } from "bun:test"
import { oaCompatHelper } from "../src/routes/zen/util/provider/openai-compatible"

describe("openai-compatible usage", () => {
  const helper = oaCompatHelper({ reqModel: "test", providerModel: "test" })

  test("requests streaming usage without dropping existing stream options", () => {
    expect(
      helper.modifyBody({
        model: "test",
        stream: true,
        stream_options: { custom: true },
      }),
    ).toMatchObject({
      stream_options: { custom: true, include_usage: true },
    })
  })

  test("parses usage SSE with or without a space after data colon", () => {
    const compact = helper.createUsageParser()
    compact.parse('data:{"usage":{"prompt_tokens":100,"completion_tokens":20,"total_tokens":120}}')
    expect(compact.retrieve()).toEqual({ prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 })

    const standard = helper.createUsageParser()
    standard.parse('data: {"usage":{"prompt_tokens":200,"completion_tokens":30,"total_tokens":230}}')
    expect(standard.retrieve()).toEqual({ prompt_tokens: 200, completion_tokens: 30, total_tokens: 230 })
  })
})

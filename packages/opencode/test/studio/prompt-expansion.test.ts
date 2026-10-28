import { describe, expect, test } from "bun:test"
import { Effect, Stream } from "effect"
import { parseExpansion, validateExpansion, readExpansionStream } from "@/studio/prompt-expansion"
import type { LLM } from "@/session/llm"
import { acquireBudget, readRecommendationBody } from "@/studio/prompt-recommendation-budget"

const output = {
  expandedPrompt: "夜色中的城市，霓虹灯映照在雨后的街道上。",
  tags: ["场景：城市", "光线：霓虹", "天气：雨后"],
}

describe("Studio expansion output", () => {
  test("accepts JSON, fences and escaped braces, rejecting ambiguous objects", () => {
    expect(parseExpansion(JSON.stringify(output))).toEqual(output)
    expect(parseExpansion(`说明\n\`\`\`json\n${JSON.stringify(output)}\n\`\`\``)).toEqual(output)
    expect(parseExpansion(JSON.stringify({ ...output, expandedPrompt: '招牌写着 "{城市}"' })).expandedPrompt).toContain(
      "{城市}",
    )
    expect(() => parseExpansion(`${JSON.stringify(output)} ${JSON.stringify(output)}`)).toThrow()
  })
  test("rejects nested expandedPrompt objects instead of treating them as body text", () => {
    expect(() => parseExpansion(JSON.stringify({ ...output, expandedPrompt: { expandedPrompt: output.expandedPrompt } }))).toThrow()
    expect(() => parseExpansion(JSON.stringify({ expandedPrompt: output }))).toThrow()
    expect(() => parseExpansion(JSON.stringify({ expandedPrompt: [output.expandedPrompt], tags: output.tags }))).toThrow()
    expect(parseExpansion(JSON.stringify(output))).toEqual(output)
  })
  test("normalizes tags and validates graphemes, dimensions, separators and invisible values", () => {
    expect(validateExpansion({ ...output, tags: ["场景 : 城市", "角色：👩‍🚀", "光线：霓虹"] }).tags[0]).toBe("场景：城市")
    for (const tags of [
      ["风格：科幻:未来", "场景：城市", "天气：雨后"],
      ["风:格：科幻", "场景：城市", "天气：雨后"],
      ["场景：城市", "场景：街道", "天气：雨后"],
      ["场景：\u200b", "光线：霓虹", "天气：雨后"],
      ["场景：城市", "光线：霓虹"],
    ])
      expect(() => validateExpansion({ ...output, tags })).toThrow()
    expect(() => validateExpansion({ ...output, expandedPrompt: "图".repeat(1001) })).toThrow()
    expect(validateExpansion({ ...output, secret: "ignored" })).toEqual(output)
  })
  test("does not accept valid JSON before a late stream error or truncated finish", async () => {
    const text: LLM.Event = { type: "text-delta", id: "text", text: JSON.stringify(output) }
    await expect(
      Effect.runPromise(
        readExpansionStream(
          Stream.fromIterable<LLM.Event>([text, { type: "error", error: new Error("late failure") }]),
          () => {},
        ),
      ),
    ).rejects.toThrow("MODEL_REQUEST_FAILED")
    await expect(
      Effect.runPromise(readExpansionStream(Stream.fromIterable<LLM.Event>([text]), () => {})),
    ).rejects.toThrow("MODEL_REQUEST_FAILED")
  })
  test("bounds text before parsing", async () => {
    await expect(
      Effect.runPromise(
        readExpansionStream(
          Stream.fromIterable<LLM.Event>([{ type: "text-delta", id: "text", text: "字".repeat(30_000) }]),
          () => {},
        ),
      ),
    ).rejects.toThrow("OUTPUT_LIMIT_EXCEEDED")
  })
  test("forwards raw body and reasoning independently before parsing the final result", async () => {
    const seen: { delta: string; type?: string; id?: string }[] = []
    let progress = 0
    const text = await Effect.runPromise(readExpansionStream(Stream.fromIterable<LLM.Event>([
      { type: "reasoning-start", id: "r" },
      { type: "reasoning-delta", id: "r", text: "思考画面" },
      { type: "reasoning-delta", id: "r", text: "" },
      { type: "reasoning-end", id: "r" },
      { type: "text-delta", id: "t", text: '{"expanded' },
      { type: "text-delta", id: "t", text: JSON.stringify(output).slice(10) },
      { type: "finish", finishReason: "stop", rawFinishReason: "stop", totalUsage: {
        inputTokens: 1, outputTokens: 1, totalTokens: 2,
        inputTokenDetails: { noCacheTokens: undefined, cacheReadTokens: undefined, cacheWriteTokens: undefined },
        outputTokenDetails: { textTokens: undefined, reasoningTokens: undefined },
      } },
    ]), () => { progress++ }, {
      start: () => Effect.void,
      append: (delta, type, id) => Effect.sync(() => {
        seen.push({ delta, type, id })
        expect(progress).toBe(seen.length)
      }),
      end: () => Effect.void,
    }))
    expect(parseExpansion(text)).toEqual(output)
    expect(progress).toBe(3)
    expect(seen).toEqual([
      { delta: "思考画面", type: "reasoning", id: "r" },
      { delta: '{"expanded', type: "text", id: "t" },
      { delta: JSON.stringify(output).slice(10), type: "text", id: "t" },
    ])
  })
  test("does not preview oversized reasoning and propagates preview persistence failures", async () => {
    let forwarded = false
    await expect(Effect.runPromise(readExpansionStream(Stream.fromIterable<LLM.Event>([
      { type: "reasoning-delta", id: "r", text: "x".repeat(1024 * 1024 + 1) },
    ]), () => {}, {
      start: () => Effect.void,
      append: () => Effect.sync(() => { forwarded = true }),
      end: () => Effect.void,
    }))).rejects.toThrow("OUTPUT_LIMIT_EXCEEDED")
    expect(forwarded).toBe(false)
    await expect(Effect.runPromise(readExpansionStream(Stream.fromIterable<LLM.Event>([
      { type: "text-delta", id: "t", text: JSON.stringify(output) },
    ]), () => {}, {
      start: () => Effect.void,
      append: () => Effect.fail(new Error("preview persistence failed")),
      end: () => Effect.void,
    }))).rejects.toThrow("preview persistence failed")
  })
})

test("process admission is nonblocking and releases each permit only once", () => {
  const release = Array.from({ length: 4 }, () => acquireBudget("execution"))
  expect(() => acquireBudget("execution")).toThrow("CAPACITY_EXCEEDED")
  release.forEach((done) => {
    done()
    done()
  })
  acquireBudget("execution")()
})

test("bounds chunked body bytes before JSON decoding", async () => {
  const body = async function* () {
    yield new Uint8Array(30 * 1024 * 1024)
    yield new Uint8Array(1)
  }
  await expect(readRecommendationBody(body())).rejects.toThrow("PAYLOAD_TOO_LARGE")
})

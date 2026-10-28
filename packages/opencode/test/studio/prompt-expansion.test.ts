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
  test("parses sibling text tags with case and whitespace tolerance", () => {
    expect(parseExpansion(`<expandedPrompt>${output.expandedPrompt}</expandedPrompt>\n<tags>${output.tags.join("\n")}</tags>`)).toEqual(output)
    expect(parseExpansion("说明\n< EXPANDEDPROMPT >城市{雨景}\r\n\r\n远处行人< / EXPANDEDPROMPT >\n<TAGS>\n- 场景 : 城市\n2. 光线：霓虹\n</TAGS>"))
      .toEqual({ expandedPrompt: "城市{雨景}\n\n远处行人", tags: ["场景：城市", "光线：霓虹"] })
    expect(parseExpansion(output.expandedPrompt)).toEqual({ expandedPrompt: output.expandedPrompt, tags: [] })
  })
  test("recovers missing body closure only at tags or a clean normal end", () => {
    expect(parseExpansion("<expandedPrompt>城市雨景<tags>场景：城市</tags>"))
      .toEqual({ expandedPrompt: "城市雨景", tags: ["场景：城市"] })
    expect(parseExpansion("<expandedPrompt>城市雨景")).toEqual({ expandedPrompt: "城市雨景", tags: [] })
    expect(parseExpansion("城市雨景<tags>场景：城市</tags>"))
      .toEqual({ expandedPrompt: "城市雨景", tags: ["场景：城市"] })
    expect(parseExpansion("<expandedPrompt>城市</expandedPrompt><expandedPrompt>城市</expandedPrompt>"))
      .toEqual({ expandedPrompt: "城市", tags: [] })
    for (const text of ["<expandedPrompt>城市<tags", "<expandedPrompt>城市<", "<expandedPrompt>城市<unknown>其他", "<expandedPrompt>城市</expandedPrompt><expandedPrompt>雨景</expandedPrompt>"])
      expect(() => parseExpansion(text)).toThrow()
  })
  test("missing, empty or malformed tags never discard a clearly delimited body", () => {
    for (const suffix of ["", "<tags></tags>", "<tags", "<tagsx>损坏标签", '<tags>"tags": ["风格tags":["风格：科幻"]', "<tags>无效标签\n风格：科幻:未来\n场景：\u200b"])
      expect(parseExpansion(`<expandedPrompt>${output.expandedPrompt}</expandedPrompt>${suffix}`)).toEqual({ expandedPrompt: output.expandedPrompt, tags: [] })
    expect(parseExpansion(`<expandedPrompt>${output.expandedPrompt}</expandedPrompt><tags>场景：城市`))
      .toEqual({ expandedPrompt: output.expandedPrompt, tags: [] })
    for (const tags of [undefined, null, {}, "场景：城市", []])
      expect(validateExpansion({ expandedPrompt: output.expandedPrompt, tags })).toEqual({ expandedPrompt: output.expandedPrompt, tags: [] })
    expect(parseExpansion(JSON.stringify({ expandedPrompt: output.expandedPrompt }))).toEqual({ expandedPrompt: output.expandedPrompt, tags: [] })
  })
  test("recovers repeated body wrappers and boundary fragments before validation", () => {
    const body = "樱花林荫道中的少女，日系动漫风格……"
    for (const text of [
      `<expandedPrompt>expandedPrompt>${body} expandedPrompt></expandedPrompt>`,
      `<expandedPrompt><expandedPrompt>${body}</expandedPrompt></expandedPrompt>`,
      `<expandedPrompt>expandedPrompt>${body}<expandedPrompt></expandedPrompt>`,
      `<expandedPrompt>${body}</expandedPrompt></expandedPrompt>`,
      `<expandedPrompt>${body}</expandedPrompt><expandedPrompt>${body}</expandedPrompt>`,
      `<expandedPrompt><expandedPrompt>${body}<tags>风格：日系动漫</tags>`,
    ]) expect(parseExpansion(text).expandedPrompt).toBe(body)
    expect(parseExpansion(`<expandedPrompt>expandedPrompt>${"图".repeat(1000)} expandedPrompt></expandedPrompt>`).expandedPrompt)
      .toBe("图".repeat(1000))
    expect(() => parseExpansion(`<expandedPrompt>expandedPrompt>${"图".repeat(1001)} expandedPrompt></expandedPrompt>`)).toThrow()
    expect(parseExpansion("<expandedPrompt>招牌写着 expandedPrompt>，少女站在树下。</expandedPrompt>").expandedPrompt)
      .toBe("招牌写着 expandedPrompt>，少女站在树下。")
    expect(() => parseExpansion("<expandedPrompt>城市</expandedPrompt><expandedPrompt>雨景</expandedPrompt>")).toThrow()
  })
  test("extracts sibling tag items without newlines and discards malformed items independently", () => {
    const prefix = "<expandedPrompt>樱花林荫道中的少女。</expandedPrompt>"
    const items = "<tags>风格：日系动漫</tags><tags>：日系动漫</tags><tags>主体：美少女主体：美少女</tags><tags>场景：樱花</tags><tags>场景：樱花林荫道</tags><tags>林荫道</tags>"
    expect(parseExpansion(prefix + items).tags).toEqual(["风格：日系动漫", "场景：樱花"])
    expect(parseExpansion(prefix + "<tags>风格：日系动漫</tags><tags><tags>坏：嵌套</tags></tags><tags>主体：美少女</tags><tags>场景：樱花").tags)
      .toEqual(["风格：日系动漫", "主体：美少女"])
    expect(parseExpansion(prefix + "<tags>场景：樱花</tags><tags>场景：樱花林荫道</tags><tags>天气：晴天</tags>").tags)
      .toEqual(["场景：樱花", "天气：晴天"])
    expect(parseExpansion(prefix + "<tags>场景：樱花<expandedPrompt></expandedPrompt><tags>天气：晴天</tags>").tags)
      .toEqual(["天气：晴天"])
  })
  test("normalizes, filters and deduplicates tags in source order, keeping at most five", () => {
    expect(validateExpansion({ ...output, tags: ["场景 : 城市", "角色：👩‍🚀", "光线：霓虹"] }).tags[0]).toBe("场景：城市")
    expect(validateExpansion({ ...output, tags: [
      "场景：城市", "场景：街道", "场景：城市", "风格：科幻:未来", null,
      "* 光线 : 霓虹", "1、天气：雨后", "角色：👩‍🚀", "色彩：暖色", "构图：全景",
    ] }).tags).toEqual(["场景：城市", "光线：霓虹", "天气：雨后", "角色：👩‍🚀", "色彩：暖色"])
    expect(validateExpansion({ ...output, tags: ["风格：科幻", "風格：写实", "ＦＯＯ：城市", "foo：雨景"] }).tags)
      .toEqual(["风格：科幻", "風格：写实", "ＦＯＯ：城市"])
  })
  test("rejects empty or oversized bodies and broken or nested body tags", () => {
    for (const text of ["", " \n", "\u200b", "<tags>场景：城市</tags>", "<expandedPrompt></expandedPrompt>", "<expandedPrompt 城市", "城市</expandedPrompt>", "图".repeat(1001)])
      expect(() => parseExpansion(text)).toThrow()
    expect(parseExpansion("😀".repeat(1000)).expandedPrompt).toBe("😀".repeat(1000))
    expect(() => parseExpansion("😀".repeat(1001))).toThrow()
  })
  test("never promotes malformed, nested or ambiguous structured output to a body", () => {
    for (const text of [
      '{"expandedPrompt": "expandedPrompt":"城市"}',
      '{"expandedPrompt":{"expandedPrompt":"城市"},"tags":[]}',
      '"expandedPrompt":"城市"',
      '[{"expandedPrompt":"城市"}]',
      '\x60\x60\x60json\n[{"expandedPrompt":"城市"}]\n\x60\x60\x60',
      '{"expandedPrompt":"城市"',
      '{"expandedPrompt":"城市"} {"expandedPrompt":"雨景"}',
      '<expandedPrompt>{"expandedPrompt":"城市"}</expandedPrompt>',
      '```json\n{"expandedPrompt":\n```',
    ]) expect(() => parseExpansion(text)).toThrow()
    expect(validateExpansion({ ...output, secret: "ignored" })).toEqual(output)
  })
  test("does not accept valid JSON before a late stream error or truncated finish", async () => {
    const text: LLM.Event = { type: "text-delta", id: "text", text: "<expandedPrompt>城市雨景" }
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

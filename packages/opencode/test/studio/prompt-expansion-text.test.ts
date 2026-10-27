import { expect, test } from "bun:test"
import { createExpandedPromptReader } from "@/studio/prompt-expansion-text"

test("extracts only top-level prompt text at every possible chunk boundary", () => {
  const expected = '雨后的 "城市"\\街道\n灯光\t👩‍🚀，招牌是 {"tags":"不是字段"}'
  const inputs = [
    JSON.stringify({ expandedPrompt: expected, tags: ["不要显示"] }),
    `说明\n\`\`\`json\n${JSON.stringify({ tags: [true, null, 1.2e3, { expandedPrompt: "嵌套" }], expandedPrompt: expected })}\n\`\`\``,
    '{"expanded\\u0050rompt":"' + '雨后的 \\"城市\\"\\\\街道\\n灯光\\t\\ud83d\\udc69‍\\ud83d\\ude80，招牌是 {\\"tags\\":\\"不是字段\\"}' + '","tags":[]}',
  ]
  for (const input of inputs) {
    for (let at = 0; at <= input.length; at++) {
      const reader = createExpandedPromptReader()
      expect(reader.push(input.slice(0, at)) + reader.push(input.slice(at))).toBe(expected)
    }
    const reader = createExpandedPromptReader()
    expect(input.split("").map((char) => reader.push(char)).join("")).toBe(expected)
  }
})

test("emits partial decoded text and buffers incomplete escapes and surrogate pairs", () => {
  const reader = createExpandedPromptReader()
  expect(reader.push('{"expandedPrompt":"雨')).toBe("雨")
  expect(reader.push('\\')).toBe("")
  expect(reader.push('n\\uD83')).toBe("\n")
  expect(reader.push('D')).toBe("")
  expect(reader.push('\\uDE')).toBe("")
  expect(reader.push('00')).toBe("😀")
  expect(reader.push('光線","tags":["不能显示"]}')).toBe("光線")
  expect(reader.push('{"expandedPrompt":"不能拼接第二个对象"}')).toBe("")
})

test("stops unsafe previews without accepting malformed values or concatenating duplicate fields", () => {
  for (const input of [
    '{"expandedPrompt":42}', '{"expandedPrompt":{"expandedPrompt":"嵌套"}}',
    '{"tags":["expandedPrompt"],"other":"无目标"}', '{"expandedPrompt":"\\x错误"}',
    '{"expandedPrompt":"\\uZZZZ错误"}', '{"tags":invalid,"expandedPrompt":"不能显示"}',
  ]) expect(createExpandedPromptReader().push(input)).toBe("")
  const reader = createExpandedPromptReader()
  expect(reader.push('{"expandedPrompt":"首段","expandedPrompt":"不应追加"}')).toBe("首段")
  expect(reader.push('更多')).toBe("")
})

test("limits preview by Unicode code points without changing the raw model output", () => {
  const reader = createExpandedPromptReader()
  expect(reader.push(JSON.stringify({ expandedPrompt: "😀".repeat(1001) }))).toBe("😀".repeat(1000))
})

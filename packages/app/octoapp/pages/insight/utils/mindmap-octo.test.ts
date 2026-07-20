import { describe, expect, test } from "bun:test"
import { uxrJsonToOctoWhiteboard } from "./mindmap-adapter"

// 思维导图 JSON → Octo 白板导入 JSON:name → text 递归,leaf 不带 children 键。
describe("uxrJsonToOctoWhiteboard", () => {
  test("单根:name → text,leaf 无 children 键", () => {
    const text = JSON.stringify({
      name: "中心主题",
      children: [
        { name: "分支主题", children: [{ name: "子主题" }] },
        { name: "叶子" },
      ],
    })
    expect(uxrJsonToOctoWhiteboard(text)).toEqual({
      text: "中心主题",
      children: [
        { text: "分支主题", children: [{ text: "子主题" }] },
        { text: "叶子" },
      ],
    })
  })

  test("MCP mindmaps 容器多根:合成 centerTitle 中心主题包住", () => {
    const text = JSON.stringify({
      mindmaps: [
        { name: "树A", children: [{ name: "a1" }] },
        { name: "树B", children: [{ name: "b1" }] },
      ],
    })
    expect(uxrJsonToOctoWhiteboard(text, "报告导图")).toEqual({
      text: "报告导图",
      children: [
        { text: "树A", children: [{ text: "a1" }] },
        { text: "树B", children: [{ text: "b1" }] },
      ],
    })
  })

  test("单根走 mindmaps 容器时不加多余中心层", () => {
    const text = JSON.stringify({ mindmaps: [{ name: "唯一根", children: [{ name: "叶" }] }] })
    expect(uxrJsonToOctoWhiteboard(text)).toEqual({
      text: "唯一根",
      children: [{ text: "叶" }],
    })
  })

  test("带 json fence 的内容", () => {
    const text = '```json\n{"name":"根","children":[{"name":"子"}]}\n```'
    expect(uxrJsonToOctoWhiteboard(text)).toEqual({ text: "根", children: [{ text: "子" }] })
  })

  test("非导图 shape / 无法解析 → null", () => {
    expect(uxrJsonToOctoWhiteboard('{"name":"配置","version":"1.0"}')).toBeNull()
    expect(uxrJsonToOctoWhiteboard("not json")).toBeNull()
  })

  test("空 name 兜底 (空)", () => {
    const text = JSON.stringify({ name: "根", children: [{ name: "  " }] })
    expect(uxrJsonToOctoWhiteboard(text)).toEqual({
      text: "根",
      children: [{ text: "(空)" }],
    })
  })
})

import { describe, expect, test } from "bun:test"
import { SessionPrompt } from "../../src/session/prompt"

// 标题模型输出清洗：内部网关（openai-compatible）未分离 reasoning 时，thinking 会混进
// content 文本流。cleanTitleText 是唯一防线，任何泄漏形态都必须被剥掉或整段放弃。
describe("cleanTitleText", () => {
  const clean = SessionPrompt.cleanTitleText

  test("纯标题一行 → 原样返回", () => {
    expect(clean("增加暗色模式切换")).toBe("增加暗色模式切换")
  })

  test("闭合 <think> 块 + 标题", () => {
    expect(clean("<think>用户想要改样式</think>\n增加暗色模式切换")).toBe("增加暗色模式切换")
  })

  test("多个闭合块夹正文 → 全部剥离", () => {
    expect(clean("<think>a</think>增加暗色模式<think>b</think>")).toBe("增加暗色模式")
  })

  test("未闭合 <think>（流截断）→ 放弃", () => {
    expect(clean("<think>用户想要生成一个标题，让我想想")).toBeUndefined()
  })

  test("未闭合 <think> 在正文后 → 保留正文", () => {
    expect(clean("增加暗色模式切换\n<think>补充思考")).toBe("增加暗色模式切换")
  })

  test("<thinking> 变体标签", () => {
    expect(clean("<thinking>思考</thinking>增加暗色模式切换")).toBe("增加暗色模式切换")
  })

  test("大小写变体 <Think>…</THINK>", () => {
    expect(clean("<Think>思考</THINK>增加暗色模式切换")).toBe("增加暗色模式切换")
  })

  test("开头孤立闭合标签 </think>正文", () => {
    expect(clean("</think>增加暗色模式切换")).toBe("增加暗色模式切换")
  })

  test("闭合 ```think 代码块", () => {
    expect(clean("```think\n思考过程\n```\n增加暗色模式切换")).toBe("增加暗色模式切换")
  })

  test("未闭合 ```think 代码块 → 放弃", () => {
    expect(clean("```think\n思考过程没有结束")).toBeUndefined()
  })

  test("多行 + 空白行 → 取首个非空行", () => {
    expect(clean("\n\n  增加暗色模式切换  \n第二行")).toBe("增加暗色模式切换")
  })

  test("轻微超字数（12 字符）→ 保留", () => {
    const t = "这是一个十二字符的标题呀"
    expect(t.length).toBe(12)
    expect(clean(t)).toBe(t)
  })

  test("超长即弃：>30 字符的裸思考文本 → undefined", () => {
    const leaked = "好的，用户想要生成一个标题，让我思考一下应该怎么总结这个需求比较好呢"
    expect(leaked.length).toBeGreaterThan(30)
    expect(clean(leaked)).toBeUndefined()
  })

  test("空串 / 全空白 / 只剩标签 → undefined", () => {
    expect(clean("")).toBeUndefined()
    expect(clean("  \n \t ")).toBeUndefined()
    expect(clean("<think>只有思考</think>")).toBeUndefined()
  })
})

import { describe, expect, test } from "bun:test"
import { serializeConsoleArg } from "./console-serialize"

describe("serializeConsoleArg", () => {
  test("原始类型原样透传", () => {
    expect(serializeConsoleArg("msg")).toBe("msg")
    expect(serializeConsoleArg(42)).toBe(42)
    expect(serializeConsoleArg(null)).toBe(null)
    expect(serializeConsoleArg(undefined)).toBe(undefined)
    expect(serializeConsoleArg(false)).toBe(false)
  })

  test("普通对象序列化为 JSON 字符串", () => {
    expect(serializeConsoleArg({ uri: "https://x/y.md", reused: true })).toBe('{"uri":"https://x/y.md","reused":true}')
    expect(serializeConsoleArg([1, "a"])).toBe('[1,"a"]')
  })

  test("Error 展开 message 与 cause 链(JSON.stringify 原生只会得到 {})", () => {
    const cause = new Error("connect ECONNREFUSED")
    const err = new TypeError("fetch failed", { cause })
    const out = serializeConsoleArg({ err }) as string
    expect(out).toContain("fetch failed")
    expect(out).toContain("TypeError")
    expect(out).toContain("connect ECONNREFUSED")
  })

  test("顶层就是 Error 也能展开", () => {
    const out = serializeConsoleArg(new Error("boom")) as string
    expect(out).toContain("boom")
  })

  test("循环引用不 throw,标记 [circular]", () => {
    const a: Record<string, unknown> = { name: "a" }
    a.self = a
    const out = serializeConsoleArg(a) as string
    expect(out).toContain("[circular]")
  })

  test("超长内容截断", () => {
    const out = serializeConsoleArg({ blob: "x".repeat(5000) }) as string
    expect(out.length).toBeLessThan(2100)
    expect(out).toContain("…[truncated]")
  })

  test("函数字段不 throw", () => {
    const out = serializeConsoleArg({ cb: () => {} }) as string
    expect(out).toContain("[function")
  })
})

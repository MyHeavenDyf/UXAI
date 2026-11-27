import { describe, expect, test } from "bun:test"
import { unwrapMetaTool } from "./message-part-meta"

describe("unwrapMetaTool", () => {
  test("unwraps execute_tool envelope to the inner tool and params", () => {
    expect(
      unwrapMetaTool("execute_tool", {
        tool_name: "bash",
        params: { command: "echo hi", description: "echo test" },
      }),
    ).toEqual({ tool: "bash", input: { command: "echo hi", description: "echo test" } })
  })

  test("defaults missing params to an empty object", () => {
    expect(unwrapMetaTool("execute_tool", { tool_name: "bash" })).toEqual({ tool: "bash", input: {} })
  })

  test("returns undefined for non-meta tools", () => {
    expect(unwrapMetaTool("bash", { command: "echo hi" })).toBeUndefined()
    expect(unwrapMetaTool("search_tools", { query: "select:bash" })).toBeUndefined()
  })

  test("returns undefined when envelope is malformed", () => {
    // pending 流式态 input 是 JSON 字符串,必须判型
    expect(unwrapMetaTool("execute_tool", '{"tool_name":"bash"}')).toBeUndefined()
    expect(unwrapMetaTool("execute_tool", null)).toBeUndefined()
    expect(unwrapMetaTool("execute_tool", { tool_name: "" })).toBeUndefined()
    expect(unwrapMetaTool("execute_tool", { tool_name: 123 })).toBeUndefined()
    expect(unwrapMetaTool("execute_tool", { params: { command: "echo" } })).toBeUndefined()
  })
})

import { describe, expect, test } from "bun:test"
import { buildToolGate, MCP_BUSINESS_TOOLS, mcpToolKey } from "./mcp-trigger"

// turn 级工具 gate 回归(SPEC-INS-017 §3 + SPEC-INS-021 §1):
// - MCP 业务工具:非 chip turn 全关;chip turn 只放行所选那一个
// - task 恒关(内部编排原语,不经用户提示词触发;018 编排 turn 由构造方显式放行)
// - bash/webfetch 仅 chip turn 加关(非 chip turn:bash 由 agent 权限层常驻 deny,webfetch 常驻可用)

describe("buildToolGate", () => {
  test("非 chip turn:业务工具全关、task 恒关,bash/webfetch 不下发", () => {
    const gate = buildToolGate()
    for (const tool of MCP_BUSINESS_TOOLS) expect(gate[mcpToolKey(tool)]).toBe(false)
    expect(gate["task"]).toBe(false)
    expect("bash" in gate).toBe(false)
    expect("webfetch" in gate).toBe(false)
  })

  test("chip turn:仅放行所选业务工具,并关 task/bash/webfetch", () => {
    const gate = buildToolGate("key_findings")
    expect(gate[mcpToolKey("key_findings")]).toBe(true)
    for (const tool of MCP_BUSINESS_TOOLS) {
      if (tool !== "key_findings") expect(gate[mcpToolKey(tool)]).toBe(false)
    }
    expect(gate["task"]).toBe(false)
    expect(gate["bash"]).toBe(false)
    expect(gate["webfetch"]).toBe(false)
  })
})

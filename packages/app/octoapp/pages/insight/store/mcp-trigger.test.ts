import { describe, expect, test } from "bun:test"
import { buildToolGate, MCP_BUSINESS_TOOLS, mcpToolKey } from "./mcp-trigger"

// turn 级工具 gate 回归(SPEC-INS-017 §3 + SPEC-INS-021 §1):
// - MCP 业务工具:非 chip turn 全关;chip turn 只放行所选那一个
// - task:普通轮次**放行**(SPEC-INS-032 §5 多文档分治;候选由 agent 权限层收敛到 insight_reader),
//   chip turn 仍关(2026-07-07 事故的逃生口之一就是委托 task 子代理)
// - bash/webfetch 仅 chip turn 加关(非 chip turn:bash 由 agent 权限层常驻 deny,webfetch 常驻可用)
// - extract_document 仅 chip turn 加关(MCP 只收文件名、服务端自解析,本地正文零贡献纯占上下文;
//   非 chip turn 必须常驻——它是 office 文件的唯一读取入口)

describe("buildToolGate", () => {
  test("非 chip turn:业务工具全关、task 不下发(留给权限层),bash/webfetch/extract_document 不下发", () => {
    const gate = buildToolGate()
    for (const tool of MCP_BUSINESS_TOOLS) expect(gate[mcpToolKey(tool)]).toBe(false)
    // SPEC-INS-032 §5:普通轮次不再关 task —— 不下发即由 agent 权限层说了算
    expect("task" in gate).toBe(false)
    expect("bash" in gate).toBe(false)
    expect("webfetch" in gate).toBe(false)
    // 非 chip turn 绝不能关它:office 文件没有别的读法(read 对二进制直接报错)
    expect("extract_document" in gate).toBe(false)
  })

  test("chip turn:仅放行所选业务工具,并关 task/bash/webfetch/extract_document", () => {
    const gate = buildToolGate("key_findings")
    expect(gate[mcpToolKey("key_findings")]).toBe(true)
    for (const tool of MCP_BUSINESS_TOOLS) {
      if (tool !== "key_findings") expect(gate[mcpToolKey(tool)]).toBe(false)
    }
    expect(gate["task"]).toBe(false)
    expect(gate["bash"]).toBe(false)
    expect(gate["webfetch"]).toBe(false)
    expect(gate["extract_document"]).toBe(false)
  })
})

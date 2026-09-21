import { describe, expect, test } from "bun:test"
import { contextUsageState } from "./context-usage-circle"

describe("contextUsageState", () => {
  test("uses blue below 60%", () => {
    expect(contextUsageState(undefined)).toEqual({ level: "normal", color: "var(--icon-interactive-base)" })
    expect(contextUsageState(59)).toEqual({ level: "normal", color: "var(--icon-interactive-base)" })
  })

  test("uses yellow from 60% to below 80%", () => {
    expect(contextUsageState(60)).toEqual({ level: "warning", color: "var(--icon-warning-base)" })
    expect(contextUsageState(79)).toEqual({ level: "warning", color: "var(--icon-warning-base)" })
  })

  test("uses red from 80%", () => {
    expect(contextUsageState(80)).toEqual({ level: "critical", color: "var(--icon-critical-base)" })
    expect(contextUsageState(100)).toEqual({ level: "critical", color: "var(--icon-critical-base)" })
  })
})

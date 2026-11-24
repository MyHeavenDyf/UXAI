import { describe, expect, test } from "bun:test"
import { studioGenerationProgress, studioGenerationQueueLabel, studioGenerationFailureMessage } from "./studio-shared"

describe("Studio generation presentation", () => {
  test("preserves a zero queue count and never invents a missing count", () => {
    expect(studioGenerationQueueLabel(5)).toBe("当前排队 5 人")
    expect(studioGenerationQueueLabel(0)).toBe("当前排队 0 人")
    expect(studioGenerationQueueLabel()).toBe("排队中")
    expect(studioGenerationQueueLabel(-1)).toBe("排队中")
    expect(studioGenerationQueueLabel(Number.NaN)).toBe("排队中")
  })
  test("rounds real progress and guards invalid or out-of-range values", () => {
    expect(studioGenerationProgress(49.6)).toBe(50)
    expect(studioGenerationProgress(150)).toBe(100)
    expect(studioGenerationProgress(-1)).toBe(0)
    expect(studioGenerationProgress(Number.NaN)).toBe(0)
    expect(studioGenerationProgress()).toBe(0)
  })
  test("recognizes confirmed cancellation and preserves the actual failure reason", () => {
    expect(studioGenerationFailureMessage({ status: "failed", rawStatus: "4", error: "通用错误" })).toBe("用户取消生成")
    expect(studioGenerationFailureMessage({ status: "create_failed", rawStatus: 4 })).toBe("用户取消生成")
    expect(studioGenerationFailureMessage({ status: "failed", error: "供应商返回的实际失败原因" })).toBe(
      "供应商返回的实际失败原因",
    )
    expect(studioGenerationFailureMessage({ status: "failed", error: "接口原因" }, "工具实际错误")).toBe("工具实际错误")
    expect(studioGenerationFailureMessage({ status: "create_failed", error: " " })).toBe(
      "任务创建失败，请检查网络或稍后再试",
    )
  })
})

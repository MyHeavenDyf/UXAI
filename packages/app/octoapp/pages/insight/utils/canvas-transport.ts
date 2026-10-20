import { usePixsoTransport, type PixsoAction } from "@/utils/useZipTransport"

export type CanvasAction = "import" | "open" | "reveal" | "other"
export type CanvasTransport = {
  available: boolean
  prepare: typeof usePixsoTransport
  actionId: (action: PixsoAction) => CanvasAction
  /** 仅真实接口的可验证回执可确认成功；缺省只统计请求发起。 */
  result?: (action: PixsoAction, result: Awaited<ReturnType<PixsoAction["fn"]>>) => {
    status: "success" | "failure" | "cancelled"
    evidence?: string
  } | undefined
}

// 公共接口目前是占位实现。真实对接交付后在此声明能力及回执映射，
// 不使用环境变量把占位 success:true 当作已启用，不影响 Design 调用方。
export const insightCanvasTransport: CanvasTransport = {
  available: false,
  prepare: usePixsoTransport,
  actionId: () => "other",
}

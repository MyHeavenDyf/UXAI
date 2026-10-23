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

// 与 Design 一致开放公共接口返回的菜单。available 仅表示入口可调用，
// 不代表真实画布已接通；缺少可验证回执的动作仍记为 unconfirmed。
export const insightCanvasTransport: CanvasTransport = {
  available: true,
  prepare: usePixsoTransport,
  actionId: () => "other",
}

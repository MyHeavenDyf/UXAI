// eager 落盘失败的用户提示 —— 从 local-resource.ts 分出来的薄壳。
//
// 为什么单独一个模块:local-resource 被 tab-store 依赖、进而进单测,在它里面 import
// `@opencode-ai/ui/toast` 会让整组测试挂在 solid/react 运行时解析上。纯逻辑与 UI 提示分开,
// 两边都能各自被测/被 mock。

import { showToast } from "@opencode-ai/ui/toast"
import type { MaterializeResult } from "./local-resource"

/**
 * 落盘失败时按类别决定要不要打扰用户(SPEC-INS-026 §4.1):
 *   - 文件名被拒 → **响亮报错**。重试不会有不同结果,不说用户就只看到一张失败卡。
 *     产物本身仍能从卡片打开、走「下载原件」拿到,只是没有本地副本,文案要说清这一点。
 *   - 网络 / HTTP 失败 → 不 toast。可重试,且批量产物会刷屏;入口卡的失败态 + 重试已覆盖(§3)。
 *   - skipped(非 uri 卡 / 无项目目录 / 非桌面端)→ 不是失败,不提示。
 */
export function notifyMaterializeFailure(result: MaterializeResult): void {
  if (result.ok || result.skipped) return
  if (!result.nameRejected) return
  showToast({
    title: "产物无法保存到本地",
    description: `文件名不符合本机文件系统要求：${result.filename}。可在产物卡片中下载原件。`,
    variant: "error",
  })
}

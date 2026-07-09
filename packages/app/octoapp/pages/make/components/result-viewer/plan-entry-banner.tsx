import type { JSX } from "solid-js"
import { IconCardPlan } from "../../icons"

/**
 * 设计规划阶段引导横条。
 *
 * 触发场景:agent 判断需求复杂 → 输出 `[design-plan-intent]` sentinel → 前端在
 * 输入框上方显示本组件,让用户决定是否进入规划阶段。
 *
 * 与 PlanBanner 的区别:
 *   - 本组件 = "agent 想进规划,请用户确认" (sentinel 阶段,plan artifact 未生成)
 *   - PlanBanner = "plan 已就绪,点击查看" (artifact 已生成)
 * 两者互斥渲染,由父组件根据消息流状态切换。
 */
export function PlanEntryBanner(props: {
  onEnter: () => void
  onSkip: () => void
}): JSX.Element {
  return (
    <div
      class="w-full rounded-[12px] px-4 py-3 flex items-start gap-3 mb-2 transition-all duration-150"
      style={{
        background: "var(--octo-surface-2, #F5F7FA)",
        border: "1px solid rgba(0,0,0,0.06)",
      }}
    >
      <span
        class="shrink-0 flex items-center justify-center rounded-[8px] mt-0.5"
        style={{
          width: "28px",
          height: "28px",
          background: "rgba(74,81,255,0.10)",
          color: "rgb(74,81,255)",
        }}
      >
        <IconCardPlan size={16} />
      </span>

      <div class="flex-1 min-w-0 flex flex-col gap-0.5">
        <div
          class="text-[13px] font-semibold"
          style={{ color: "var(--octo-text-primary)" }}
        >
          进入设计规划阶段
        </div>
        <div
          class="text-[12px] leading-[1.5]"
          style={{ color: "var(--octo-text-secondary)" }}
        >
          App 需要明确核心功能与交互场景,先规划再实现能避免返工。
        </div>

        <div class="flex items-center justify-end gap-2 mt-2">
          <button
            type="button"
            class="text-[12px] font-medium rounded-[8px] px-3 py-1.5 transition-colors hover:bg-[rgba(0,0,0,0.04)]"
            style={{
              background: "transparent",
              color: "var(--octo-text-secondary)",
              border: "1px solid rgba(0,0,0,0.10)",
            }}
            onClick={props.onSkip}
          >
            直接执行
          </button>
          <button
            type="button"
            class="text-[12px] font-semibold rounded-[8px] px-3 py-1.5 text-white transition-colors"
            style={{ background: "rgb(74,81,255)" }}
            onClick={props.onEnter}
          >
            进入
          </button>
        </div>
      </div>
    </div>
  )
}

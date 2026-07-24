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
      class="w-full rounded-[12px] flex flex-col mb-6 transition-all duration-150"
      style={{
        background: "linear-gradient(180deg, rgba(234,241,255,1), rgba(242,245,255,1) 100%)",
        border: "none",
        padding: "0",
      }}
    >
      <div class="flex items-center gap-[6px] py-[16px] px-[20px] pb-[12px]">
        <IconCardPlan size={20} />
        <span
          class="text-[14px] font-bold"
          style={{ "line-height": "22px", color: "rgba(0,0,0,0.9)" }}
        >
          进入设计策略规划阶段
        </span>
      </div>

      <div
        class="mx-[12px] mb-[12px] flex flex-col gap-[16px]"
        style={{
          padding: "12px",
          background: "rgba(255,255,255,0.9)",
          "border-radius": "8px",
        }}
      >
        <div
          class="text-[14px]"
          style={{ "line-height": "22px", color: "rgba(0,0,0,0.9)" }}
        >
          原型生成需要明确核心功能与交互场景，先规划再实现能避免返工。
        </div>

        <div class="flex items-center justify-center gap-[8px]">
          <button
            type="button"
            class="text-[14px] rounded-[999px] transition-colors hover:bg-[#dfdfdf] active:bg-[#dfdfdf]"
            style={{
              width: "88px",
              height: "32px",
              "line-height": "22px",
              background: "rgba(0,0,0,0.05)",
              color: "rgba(0,0,0,0.9)",
              border: "none",
              cursor: "pointer",
            }}
            onClick={props.onSkip}
          >
            直接执行
          </button>
          <button
            type="button"
            class="text-[14px] font-medium rounded-[999px] text-white transition-colors hover:opacity-90"
            style={{
              width: "88px",
              height: "32px",
              "line-height": "22px",
              background: "#0a59f7",
              color: "white",
              border: "none",
              cursor: "pointer",
            }}
            onClick={props.onEnter}
          >
            进入
          </button>
        </div>
      </div>
    </div>
  )
}

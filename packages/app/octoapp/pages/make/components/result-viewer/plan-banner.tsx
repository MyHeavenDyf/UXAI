import { Show } from "solid-js"
import type { JSX } from "solid-js"
import { IconCardPlan } from "../../icons"
import type { OutputCard } from "../insight-turn"

/**
 * Plan banner: 显示在输入框上方的"设计方案已就绪"横条。
 *
 * 交互:
 *   - plan 存在但用户尚未点击查看 → 高亮显示(白底 + 紫边 + 紫色光晕)
 *   - plan 已确认(planConfirmed=true) → 弱化显示(灰底)
 *   - 点击 → 调用 onView,由父组件 tabStore.openTab(plan) 把 plan 放进 ResultViewer
 *
 * 不再自动占用右侧 ResultViewer tab — 用户主动点击后才打开。
 */
export function PlanBanner(props: {
  plan: OutputCard | null
  confirmed: boolean
  onView: () => void
}): JSX.Element {
  return (
    <Show when={props.plan}>
      {(plan) => (
        <button
          type="button"
          class="w-full flex items-center gap-3 rounded-[12px] px-4 py-3 text-left transition-all duration-150 mb-2"
          style={{
            background: props.confirmed
              ? "var(--octo-surface-2, #f5f5f7)"
              : "#ffffff",
            border: props.confirmed
              ? "1px solid rgba(0,0,0,0.06)"
              : "1px solid rgba(74,81,255,0.45)",
            "box-shadow": props.confirmed
              ? "none"
              : "0 0 0 3px rgba(74,81,255,0.08), 0 1px 2px rgba(0,0,0,0.04)",
            cursor: "pointer",
          }}
          onClick={props.onView}
        >
          <span
            class="shrink-0 flex items-center justify-center rounded-[8px]"
            style={{
              width: "32px",
              height: "32px",
              background: props.confirmed
                ? "rgba(0,0,0,0.04)"
                : "rgba(74,81,255,0.10)",
              color: props.confirmed
                ? "var(--octo-text-tertiary, #999)"
                : "rgb(74,81,255)",
            }}
          >
            <IconCardPlan size={16} />
          </span>
          <div class="flex-1 min-w-0">
            <div
              class="text-[13px] font-semibold truncate"
              style={{
                color: props.confirmed
                  ? "var(--octo-text-tertiary, #999)"
                  : "var(--octo-text-primary)",
              }}
            >
              {plan().title}
            </div>
            <div
              class="text-[12px] truncate"
              style={{
                color: props.confirmed
                  ? "var(--octo-text-tertiary, #999)"
                  : "var(--octo-text-secondary)",
              }}
            >
              <Show when={!props.confirmed} fallback="已确认 · 正在生成 HTML">
                设计方案已就绪 · 点击查看并确认
              </Show>
            </div>
          </div>
          <Show when={!props.confirmed}>
            <span
              class="shrink-0 text-[11px] font-medium rounded-full px-2 py-1"
              style={{
                background: "rgba(74,81,255,0.12)",
                color: "rgb(74,81,255)",
              }}
            >
              待确认
            </span>
          </Show>
          <svg
            class="shrink-0"
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            style={{
              color: props.confirmed
                ? "var(--octo-text-tertiary, #999)"
                : "var(--octo-text-secondary)",
            }}
          >
            <path d="M6 4l4 4-4 4" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </button>
      )}
    </Show>
  )
}

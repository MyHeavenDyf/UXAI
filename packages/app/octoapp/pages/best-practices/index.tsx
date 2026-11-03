import type { JSX } from "solid-js"

export default function BestPracticesPage(): JSX.Element {
  return (
    <div
      class="h-full w-full flex items-center justify-center"
      style={{ background: "var(--octo-surface-page, #ffffff)" }}
    >
      <span class="text-sm" style={{ color: "var(--octo-text-primary, #191919)" }}>
        暂无数据
      </span>
    </div>
  )
}

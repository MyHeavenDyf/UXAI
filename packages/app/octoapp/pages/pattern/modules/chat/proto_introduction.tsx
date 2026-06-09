import type { JSX } from "solid-js"

export function ProtoIntroduction(): JSX.Element {
  return (
    <div class="flex flex-col items-center gap-4 text-center pb-8 px-6">
      <svg width="80" height="80" viewBox="0 0 80 80" fill="none">
        <rect x="8" y="8" width="64" height="64" rx="16" stroke="var(--octo-brand-a40)" stroke-width="2" fill="none" />
        <rect x="20" y="20" width="16" height="16" rx="4" fill="var(--octo-brand-a20)" />
        <rect x="44" y="20" width="16" height="16" rx="4" fill="var(--octo-brand-a20)" />
        <rect x="20" y="44" width="16" height="16" rx="4" fill="var(--octo-brand-a20)" />
        <rect x="44" y="44" width="16" height="16" rx="4" fill="var(--octo-brand-a20)" />
      </svg>
      <div class="flex flex-col items-center gap-2">
        <div style={{ color: "#191919", "font-size": "24px", "font-weight": "600", "line-height": "36px" }}>prototype</div>
        <div style={{ color: "#6e737a", "font-size": "14px", "line-height": "20px" }}>
          描述界面需求，生成 A2UI JSON 渲染预览页面
        </div>
      </div>
    </div>
  )
}
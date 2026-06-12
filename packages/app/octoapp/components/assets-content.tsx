import type { JSX } from "solid-js"

export function AssetsContent(): JSX.Element {
  return (
    <div class="h-full overflow-y-auto" style={{ background: "var(--octo-shell-bg)" }}>
      <div class="max-w-[640px] mx-auto px-6 py-6 flex flex-col gap-4">
        <h1 class="text-lg font-semibold" style={{ color: "var(--octo-text-primary)" }}>资产库</h1>
        <p class="text-sm" style={{ color: "var(--octo-text-secondary)" }}>暂无资产</p>
      </div>
    </div>
  )
}

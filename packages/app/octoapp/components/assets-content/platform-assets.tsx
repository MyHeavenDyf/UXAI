import type { JSX } from "solid-js"

export function PlatformAssets(): JSX.Element {
  return (
      <div class="flex flex-col items-center justify-center py-16 text-center">
        <p class="text-sm" style={{ color: "#333" }}>该分类下暂无资产</p>
      </div>
    )
}

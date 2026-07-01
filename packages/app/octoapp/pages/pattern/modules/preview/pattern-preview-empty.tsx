import type { JSX } from "solid-js"
import resultEmptySvg from "../../assets/images/IllustrationResultEmpty.svg?url"

export function PatternPreviewEmpty(): JSX.Element {
  return (
    <div class="flex flex-col items-center justify-center h-full gap-3 text-center px-8" style={{ background: "#f9fafb" }}>
      <img src={resultEmptySvg} width={80} height={80} alt="" draggable={false} style={{ "flex-shrink": "0" }} />
      <div class="text-[13px]" style={{ color: "var(--octo-text-secondary, rgba(0,0,0,0.6))" }}>对话产出将在这里展示</div>
      <div class="text-[12px]" style={{ color: "var(--octo-text-disabled, #BFBFBF)" }}>点击左侧输出卡片即可打开</div>
    </div>
  )
}
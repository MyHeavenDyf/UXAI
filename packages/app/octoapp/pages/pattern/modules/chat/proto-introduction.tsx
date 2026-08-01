import type { JSX } from "solid-js"
import IconHost from "@/pages/_shell/icons/IconHost.svg"

export function ProtoIntroduction(): JSX.Element {
  return (
    <div class="flex flex-col items-center gap-6 text-center pb-12 px-6">
      <img src={IconHost} width={80} height={80} alt="" draggable={false} style={{ "flex-shrink": "0" }} />
      <div class="flex flex-col items-center" style={{ gap: "12px" }}>
        <div style={{ color: "rgba(0, 0, 0, 0.9)", "font-size": "36px", "font-weight": "600", "line-height": "44px" }}>Octo Prototype</div>
        <div style={{ color: "rgba(0, 0, 0, 0.6)", "font-size": "16px", "line-height": "24px" }}>
          按照描述需求，开始生成页面原型
        </div>
      </div>
    </div>
  )
}

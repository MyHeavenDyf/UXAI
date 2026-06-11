import type { JSX } from "solid-js"
import IconHost from "@/pages/_shell/icons/IconHost.svg"
import "../../assets/style/chat/proto_introduction.css"

export function ProtoIntroduction(): JSX.Element {

  return (
    <div class="flex flex-col items-center gap-6 text-center pb-20 px-6 introduction">
      <img src={IconHost} width={166} height={166} alt="" draggable={false} />
      <div class="flex flex-col items-center gap-2">
        <div class="text">Prototype</div>
        <div class="info">
          按照描述需求，开始生成页面原型
        </div>
      </div>
    </div>
  )
}
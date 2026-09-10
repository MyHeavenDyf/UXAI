import { Show } from "solid-js"
import { useAvailableUpdate } from "./update-checker"

export function UpdateButton() {
  const available = useAvailableUpdate()

  return (
    <Show when={available.update()}>
      <button
        type="button"
        title="打开更新"
        class="absolute right-[12px] top-[8px] z-[1] flex h-[20px] items-center justify-center rounded-full border-0 bg-[#2070F3] px-[12px] text-[12px] font-normal leading-[20px] !text-white"
        style={{ color: "#FFFFFF" }}
        onClick={() => available.open()}
      >
        更新
      </button>
    </Show>
  )
}

import { Show } from "solid-js"

export function SessionTransferProgress(props: { visible: boolean; label: string; value: number }) {
  return (
    <Show when={props.visible}>
      <div
        role="status"
        aria-live="polite"
        class="fixed left-1/2 top-[84px] z-[1200] w-[320px] -translate-x-1/2 rounded-lg bg-white px-4 py-3 shadow-[0_6px_24px_rgba(0,0,0,0.16)]"
      >
        <div class="mb-2 flex items-center justify-between text-[13px] leading-5 text-[#191919]">
          <span>{props.label}</span>
          <span class="text-[#777]">{props.value}%</span>
        </div>
        <div
          role="progressbar"
          aria-valuemin="0"
          aria-valuemax="100"
          aria-valuenow={props.value}
          class="h-1 overflow-hidden rounded-full bg-[rgba(10,89,247,0.12)]"
        >
          <div
            class="h-full rounded-full bg-[#0a59f7] transition-[width] duration-300 ease-out"
            style={{ width: `${props.value}%` }}
          />
        </div>
      </div>
    </Show>
  )
}

import { type ParentProps } from "solid-js"
import { TitlebarSimple } from "@/components/titlebar-simple"

export default function LayoutNet(props: ParentProps) {
  return (
    <div class="relative bg-background-base flex-1 min-h-0 min-w-0 flex flex-col select-none [&_input]:select-text [&_textarea]:select-text [&_[contenteditable]]:select-text">
      <TitlebarSimple />
      <div class="flex-1 min-h-0 min-w-0 flex">
        {props.children}
      </div>
    </div>
  )
}
import { type ParentProps } from "solid-js"
import { TitlebarSimple } from "@/components/titlebar-simple"
import { Toast } from "@opencode-ai/ui/toast"
// jk-j60099994-replace-with-layoutnet-1-start
// jk-j60099994-replace-with-layoutnet-1-end

export default function LayoutNet(props: ParentProps) {
  return (
    <div class="relative bg-background-base flex-1 min-h-0 min-w-0 flex flex-col select-none [&_input]:select-text [&_textarea]:select-text [&_[contenteditable]]:select-text">
      <TitlebarSimple />
      <Toast.Region />
      <div class="flex-1 min-h-0 min-w-0 flex">{props.children}</div>
      {/* jk-j60099994-replace-with-layoutnet-2-start */}
      {/* jk-j60099994-replace-with-layoutnet-2-end */}
    </div>
  )
}

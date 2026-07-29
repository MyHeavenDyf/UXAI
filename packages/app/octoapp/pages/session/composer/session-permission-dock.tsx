import type { PermissionRequest } from "@opencode-ai/sdk/v2"
import { PermissionDialog } from "@/components/permission-dialog"

export function SessionPermissionDock(props: {
  request: PermissionRequest
  responding: boolean
  onDecide: (response: "once" | "always" | "reject") => void
}) {
  return (
    <PermissionDialog
      request={props.request}
      responding={props.responding}
      onDecide={props.onDecide}
    />
  )
}

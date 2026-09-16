import { Dialog } from "@opencode-ai/ui/dialog"
import { Button } from "@opencode-ai/ui/button"
import { IconFolder } from "@/pages/make/icons/design-files-icons"
import { createSignal, Show } from "solid-js"
import { useDialog } from "@opencode-ai/ui/context/dialog"

export function DialogCreateGroup(props: {
  existingNames?: string[]
  onCreate: (name: string) => Promise<unknown> | unknown
  initialName?: string
  title?: string
  actionLabel?: string
}) {
  const dialog = useDialog()
  const [name, setName] = createSignal(props.initialName ?? "")

  const errorMessage = () => {
    if (name().length > 50) return "分组名称不得超过50个字符"
    const value = name().trim().toLowerCase()
    const trimmedInitial = (props.initialName ?? "").trim().toLowerCase()
    if (value && value !== trimmedInitial && (props.existingNames ?? []).some(n => n.trim().toLowerCase() === value)) return "该分组名称已存在"
    return ""
  }

  const handleCreate = async () => {
    const value = name().trim()
    if (!value || errorMessage()) return
    await props.onCreate(value)
    dialog.close()
  }

  return (
    <Dialog title={props.title ?? "创建分组"} fit class="create-group-dialog">
      <div class="flex flex-col gap-3">
        <div data-component="input" data-variant="normal">
          <label data-slot="input-label">分组名称</label>
          <div data-slot="input-wrapper">
            <IconFolder size={16} class="create-group-input-icon" />
            <input
              data-slot="input-input"
              placeholder="请输入分组名称"
              value={name()}
              onInput={(e) => setName(e.currentTarget.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void handleCreate() }}
              autofocus
            />
          </div>
          <Show when={errorMessage()}>
            <div data-slot="input-error" style={{ color: "#ed4831", position: "absolute", top: "100%", left: "0", "margin-top": "4px" }}>{errorMessage()}</div>
          </Show>
        </div>
        <div class="flex justify-end gap-2 items-end create-group-actions">
          <Button variant="ghost" size="large" class="create-group-cancel-btn" onClick={() => dialog.close()}>取消</Button>
          <Button variant="primary" size="large" class="create-group-create-btn" disabled={!name().trim() || !!errorMessage()} onClick={handleCreate}>{props.actionLabel ?? "创建分组"}</Button>
        </div>
      </div>
    </Dialog>
  )
}

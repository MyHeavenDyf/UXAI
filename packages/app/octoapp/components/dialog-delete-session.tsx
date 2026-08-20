import { Dialog } from "@opencode-ai/ui/dialog"
import { Button } from "@opencode-ai/ui/button"
import { useLanguage } from "@/context/language"
import { useDialog } from "@opencode-ai/ui/context/dialog"

export function DialogDeleteSession(props: { name: string; onDelete: () => Promise<unknown> }) {
  const language = useLanguage()
  const dialog = useDialog()

  const handleDelete = async () => {
    await props.onDelete()
    dialog.close()
  }

  return (
    <Dialog title={language.t("session.delete.title")} fit class="delete-dialog">
      <div class="flex flex-col gap-4">
        <div class="flex flex-col gap-1">
          <span class="text-14-regular text-text-strong">
            {language.t("session.delete.confirm", { name: props.name })}
          </span>
        </div>
        <div class="flex justify-end gap-2">
          <Button variant="ghost" size="large" class="delete-dialog-btn" onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </Button>
          <Button variant="primary" size="large" class="delete-dialog-btn delete-dialog-btn-primary" onClick={handleDelete}>
            {language.t("session.delete.button")}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

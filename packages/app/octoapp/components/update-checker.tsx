import { useDialog } from "@opencode-ai/ui/context/dialog"
import { usePlatform } from "@/context/platform"
import { useSettings } from "@/context/settings"
import { useLayout } from "@/context/layout"
import { useUpdateAvailableDialog } from "./dialog-update-available"
import { createUpdateChecker } from "./update-scheduler"

export { openAvailableUpdate, useAvailableUpdate, type AvailableUpdate } from "./update-scheduler"

export function UpdateChecker() {
  const settings = useSettings()
  const layout = useLayout()
  return createUpdateChecker({
    platform: usePlatform(),
    startup: settings.updates.startup,
    onboarding: layout.onboarding.show,
    dialog: useDialog(),
    showUpdate: useUpdateAvailableDialog(),
  })
}

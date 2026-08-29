import { onCleanup, onMount } from "solid-js"
import { usePlatform } from "@/context/platform"
import { useSettings } from "@/context/settings"
import { useUpdateAvailableDialog } from "./dialog-update-available"

const STARTUP_DELAY = 30 * 1000
const CHECK_INTERVAL = 4 * 60 * 60 * 1000
const PROMPT_INTERVAL = 24 * 60 * 60 * 1000
const PROMPTED_VERSION_KEY = "octo.update.prompted-version"
const PROMPTED_AT_KEY = "octo.update.prompted-at"

export function UpdateChecker() {
  const platform = usePlatform()
  const settings = useSettings()
  const showUpdate = useUpdateAvailableDialog()

  onMount(() => {
    if (!platform.checkUpdate) return

    let checking = false
    const check = async () => {
      if (checking || !settings.updates.startup()) return
      checking = true
      const result = await platform.checkUpdate!().catch(() => undefined)
      checking = false
      if (!result?.updateAvailable) return

      if (
        localStorage.getItem(PROMPTED_VERSION_KEY) === (result.version ?? "") &&
        Date.now() - Number(localStorage.getItem(PROMPTED_AT_KEY) ?? 0) < PROMPT_INTERVAL
      )
        return

      localStorage.setItem(PROMPTED_VERSION_KEY, result.version ?? "")
      localStorage.setItem(PROMPTED_AT_KEY, String(Date.now()))
      showUpdate(result.version ?? "")
    }

    const startup = setTimeout(() => void check(), STARTUP_DELAY)
    const interval = setInterval(() => void check(), CHECK_INTERVAL)
    const unsubscribe = platform.onResume?.(() => void check())

    onCleanup(() => {
      clearTimeout(startup)
      clearInterval(interval)
      unsubscribe?.()
    })
  })

  return null
}

import { createEffect, createSignal, onCleanup, onMount } from "solid-js"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { usePlatform } from "@/context/platform"
import { useSettings } from "@/context/settings"
import { useLayout } from "@/context/layout"
import { useUpdateAvailableDialog } from "./dialog-update-available"

const STARTUP_DELAY = 30 * 1000
const CHECK_INTERVAL = 4 * 60 * 60 * 1000
const PROMPT_INTERVAL = 24 * 60 * 60 * 1000
const DIALOG_RETRY_INTERVAL = 200
const PROMPTED_VERSION_KEY = "octo.update.prompted-version"
const PROMPTED_AT_KEY = "octo.update.prompted-at"
const manualChecks = new EventTarget()

type PendingUpdate = {
  version: string
  releaseNotes?: string
}

function hasOpenDialog() {
  if (typeof document === "undefined") return false
  return document.querySelector('[data-component="dialog"], [role="dialog"], [aria-modal="true"]') !== null
}

export function cancelStartupUpdateCheck() {
  manualChecks.dispatchEvent(new Event("check"))
}

export function UpdateChecker() {
  const platform = usePlatform()
  const settings = useSettings()
  const layout = useLayout()
  const dialog = useDialog()
  const showUpdate = useUpdateAvailableDialog()
  const [pending, setPending] = createSignal<PendingUpdate>()
  const [retry, setRetry] = createSignal(0)

  createEffect(() => {
    retry()
    const update = pending()
    if (!update) return

    if (dialog.active || layout.onboarding.show() || hasOpenDialog()) {
      const timer = setTimeout(() => setRetry((value) => value + 1), DIALOG_RETRY_INTERVAL)
      onCleanup(() => clearTimeout(timer))
      return
    }

    setPending(undefined)
    localStorage.setItem(PROMPTED_VERSION_KEY, update.version)
    localStorage.setItem(PROMPTED_AT_KEY, String(Date.now()))
    showUpdate(update.version, update.releaseNotes)
  })

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

      setPending({ version: result.version ?? "", releaseNotes: result.releaseNotes })
    }

    const startup = setTimeout(() => void check(), STARTUP_DELAY)
    const interval = setInterval(() => void check(), CHECK_INTERVAL)
    const unsubscribe = platform.onResume?.(() => void check())
    const cancelStartup = () => clearTimeout(startup)
    manualChecks.addEventListener("check", cancelStartup)

    onCleanup(() => {
      clearTimeout(startup)
      clearInterval(interval)
      unsubscribe?.()
      manualChecks.removeEventListener("check", cancelStartup)
    })
  })

  return null
}

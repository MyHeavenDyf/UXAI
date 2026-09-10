import { createEffect, createSignal, onCleanup, onMount } from "solid-js"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { usePlatform } from "@/context/platform"
import { useSettings } from "@/context/settings"
import { useLayout } from "@/context/layout"
import { useUpdateAvailableDialog } from "./dialog-update-available"

const STARTUP_PROMPT_DELAY = 30 * 1000
const PROMPT_INTERVAL = 4 * 60 * 60 * 1000
const DIALOG_RETRY_INTERVAL = 200
const dialogRequests = new EventTarget()

export type AvailableUpdate = {
  version: string
  releaseNotes?: string
}

const [availableUpdate, setAvailableUpdate] = createSignal<AvailableUpdate>()

function hasOpenDialog() {
  if (typeof document === "undefined") return false
  return document.querySelector('[data-component="dialog"], [role="dialog"], [aria-modal="true"]') !== null
}

export function useAvailableUpdate() {
  return {
    update: availableUpdate,
    open() {
      if (!availableUpdate()) return
      dialogRequests.dispatchEvent(new Event("open"))
    },
  }
}

export function openAvailableUpdate(update: AvailableUpdate) {
  setAvailableUpdate(update)
  dialogRequests.dispatchEvent(new Event("open"))
}

export function UpdateChecker() {
  const platform = usePlatform()
  const settings = useSettings()
  const layout = useLayout()
  const dialog = useDialog()
  const showUpdate = useUpdateAvailableDialog()
  const [pending, setPending] = createSignal<AvailableUpdate>()
  const [retry, setRetry] = createSignal(0)

  let startupPrompt: ReturnType<typeof setTimeout> | undefined
  let nextPrompt: ReturnType<typeof setTimeout> | undefined
  let checking: Promise<AvailableUpdate | undefined> | undefined
  let stopped = false
  let entry = 0

  const check = () => {
    if (!settings.updates.startup()) return Promise.resolve(undefined)
    if (checking) return checking
    const request = platform.checkUpdate!()
      .catch(() => undefined)
      .then((result) => {
        if (!result) return undefined
        if (!result.updateAvailable) {
          setAvailableUpdate(undefined)
          return undefined
        }

        const update = { version: result.version ?? "", releaseNotes: result.releaseNotes }
        setAvailableUpdate(update)
        return update
      })
    checking = request
    void request.finally(() => {
      if (checking === request) checking = undefined
    })
    return request
  }

  const scheduleNextPrompt = () => {
    clearTimeout(nextPrompt)
    nextPrompt = setTimeout(async () => {
      if (!settings.updates.startup()) {
        scheduleNextPrompt()
        return
      }
      await check()
      if (stopped) return
      const update = availableUpdate()
      if (update) {
        setPending(update)
        return
      }
      scheduleNextPrompt()
    }, PROMPT_INTERVAL)
  }

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
    entry += 1
    clearTimeout(startupPrompt)
    scheduleNextPrompt()
    showUpdate(update.version, update.releaseNotes)
  })

  onMount(() => {
    if (!platform.checkUpdate) return

    const enter = () => {
      const startedAt = Date.now()
      const current = ++entry
      void check().then((update) => {
        if (!update || stopped || current !== entry) return
        clearTimeout(startupPrompt)
        startupPrompt = setTimeout(() => {
          const available = availableUpdate()
          if (available) setPending(available)
        }, Math.max(0, STARTUP_PROMPT_DELAY - (Date.now() - startedAt)))
      })
    }

    enter()
    scheduleNextPrompt()
    const unsubscribe = platform.onResume?.(() => void check())
    window.addEventListener("focus", enter)
    const open = () => {
      const update = availableUpdate()
      if (update) setPending(update)
    }
    dialogRequests.addEventListener("open", open)

    onCleanup(() => {
      stopped = true
      clearTimeout(startupPrompt)
      clearTimeout(nextPrompt)
      unsubscribe?.()
      window.removeEventListener("focus", enter)
      dialogRequests.removeEventListener("open", open)
    })
  })

  return null
}

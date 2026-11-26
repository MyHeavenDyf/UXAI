import { createEffect, createSignal, onCleanup, onMount } from "solid-js"
import type { Platform } from "@/context/platform"

const STARTUP_PROMPT_DELAY = 30 * 1000
const PROMPT_INTERVAL = 4 * 60 * 60 * 1000
const DIALOG_RETRY_INTERVAL = 200
const dialogRequests = new EventTarget()

export type AvailableUpdate = {
  version: string
  releaseNotes?: string
  forceUpdate?: boolean
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

export function createUpdateChecker(input: {
  platform: Pick<Platform, "checkUpdate" | "checkUpdateReadiness" | "onResume" | "onReopen">
  startup: () => boolean
  onboarding: () => boolean
  dialog: { readonly active: unknown }
  showUpdate: (version: string, releaseNotes?: string, onClose?: () => void, forceUpdate?: boolean) => void
}) {
  const platform = input.platform
  const [pending, setPending] = createSignal<AvailableUpdate & { automatic?: boolean }>()
  const [retry, setRetry] = createSignal(0)

  let startupPrompt: ReturnType<typeof setTimeout> | undefined
  let nextPrompt: ReturnType<typeof setTimeout> | undefined
  let checking: Promise<AvailableUpdate | undefined> | undefined
  let stopped = false
  let entry = 0

  const check = () => {
    if (checking) return checking
    const request = platform.checkUpdate!()
      .catch(() => undefined)
      .then((result) => {
        if (!result || result.failed || stopped) return undefined
        if (!result.updateAvailable) {
          setAvailableUpdate(undefined)
          clearTimeout(startupPrompt)
          if (pending()) scheduleNextPrompt()
          setPending(undefined)
          return undefined
        }

        const update = { version: result.version ?? "", releaseNotes: result.releaseNotes, forceUpdate: result.forceUpdate }
        setAvailableUpdate(update)
        setPending((current) => current
          ? { ...update, automatic: current.automatic }
          : update.forceUpdate ? { ...update, automatic: true } : undefined)
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
      await check()
      if (stopped) return
      const update = availableUpdate()
      if (update && (update.forceUpdate || input.startup())) {
        setPending({ ...update, automatic: true })
        return
      }
      scheduleNextPrompt()
    }, PROMPT_INTERVAL)
  }

  createEffect(() => {
    retry()
    const update = pending()
    if (!update) return

    if (update.automatic && !update.forceUpdate && !input.startup()) {
      setPending(undefined)
      scheduleNextPrompt()
      return
    }

    if (input.dialog.active || input.onboarding() || hasOpenDialog()) {
      const timer = setTimeout(() => setRetry((value) => value + 1), DIALOG_RETRY_INTERVAL)
      onCleanup(() => clearTimeout(timer))
      return
    }

    const show = () => {
      setPending(undefined)
      entry += 1
      clearTimeout(startupPrompt)
      clearTimeout(nextPrompt)
      input.showUpdate(update.version, update.releaseNotes, scheduleNextPrompt, update.forceUpdate)
    }
    if (!update.forceUpdate || !platform.checkUpdateReadiness) {
      show()
      return
    }

    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    void platform.checkUpdateReadiness().catch(() => ({ ready: false })).then((result) => {
      if (cancelled) return
      if (result.ready && !input.dialog.active && !input.onboarding() && !hasOpenDialog()) {
        show()
        return
      }
      timer = setTimeout(() => setRetry((value) => value + 1), 1000)
    })
    onCleanup(() => {
      cancelled = true
      clearTimeout(timer)
    })
  })

  onMount(() => {
    if (!platform.checkUpdate) return

    const enter = () => {
      const startedAt = Date.now()
      const current = ++entry
      void check().then((update) => {
        if (!update || stopped || current !== entry) return
        if (update.forceUpdate || !input.startup()) return
        clearTimeout(startupPrompt)
        startupPrompt = setTimeout(() => {
          const available = availableUpdate()
          if (available && (available.forceUpdate || input.startup())) {
            setPending({ ...available, automatic: true })
          }
        }, Math.max(0, STARTUP_PROMPT_DELAY - (Date.now() - startedAt)))
      })
    }

    enter()
    scheduleNextPrompt()
    const unsubscribe = platform.onResume?.(() => void check())
    const unsubscribeReopen = platform.onReopen?.(enter)
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
      unsubscribeReopen?.()
      dialogRequests.removeEventListener("open", open)
    })
  })

  return null
}

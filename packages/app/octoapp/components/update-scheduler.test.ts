import { afterEach, expect, spyOn, test } from "bun:test"
import { createComponent, untrack } from "solid-js"
import { createStore } from "solid-js/store"
import { render } from "solid-js/web"
import { createUpdateChecker, openAvailableUpdate } from "./update-scheduler"

const realTimeout = globalThis.setTimeout
const realClear = globalThis.clearTimeout
const timerTarget: { setTimeout: (callback: () => void, delay?: number) => ReturnType<typeof setTimeout> } = globalThis
const timers = new Map<unknown, { delay: number; run: () => void }>()
const cleanups: (() => void)[] = []

afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup())
  timers.forEach((_, timer) => Reflect.apply(realClear, globalThis, [timer]))
  timers.clear()
})

function mount(forceUpdate = false, enabled = true) {
  const clock = spyOn(timerTarget, "setTimeout").mockImplementation((callback, delay) => {
    const timer = realTimeout(() => {}, 60_000)
    timers.set(timer, { delay: delay ?? 0, run: callback })
    return timer
  })
  const clear = spyOn(globalThis, "clearTimeout").mockImplementation((timer) => {
    if (timer !== undefined) timers.delete(timer)
    Reflect.apply(realClear, globalThis, [timer])
  })
  const [state, setState] = createStore({ enabled, dialog: false, onboarding: false, busy: false })
  const shown: { forced?: boolean }[] = []
  const closed: (() => void)[] = []
  const container = document.createElement("div")
  document.body.append(container)
  const dispose = render(() => createComponent(() => createUpdateChecker({
    platform: {
      checkUpdate: async () => ({ updateAvailable: true, version: "3.3.3", forceUpdate }),
      checkUpdateReadiness: async () => ({ ready: untrack(() => !state.busy) }),
    },
    startup: () => state.enabled,
    onboarding: () => state.onboarding,
    dialog: { get active() { return state.dialog } },
    showUpdate: (_version, _notes, onClose, forced) => {
      shown.push({ forced })
      if (onClose) closed.push(onClose)
    },
  }), {}), container)
  cleanups.push(() => { dispose(); container.remove(); clock.mockRestore(); clear.mockRestore() })
  return { state, setState, shown, closed }
}

function advance(delay: number) {
  const item = [...timers].find(([, task]) => task.delay <= delay && task.delay >= delay - 100)
  expect(item).toBeDefined()
  if (!item) return
  Reflect.apply(realClear, globalThis, [item[0]])
  timers.delete(item[0])
  item[1].run()
}

test("ordinary startup prompt is cancelled when automatic updates are disabled during the 30 second delay", async () => {
  const app = mount()
  await Bun.sleep(1)
  app.setState("enabled", false)
  advance(30_000)
  await Bun.sleep(1)
  expect(app.shown).toEqual([])
})

test("queued ordinary prompts are cancelled when settings change, while manual prompts still work", async () => {
  const app = mount()
  app.setState("dialog", true)
  await Bun.sleep(1)
  advance(30_000)
  expect(app.shown).toEqual([])
  app.setState("enabled", false)
  app.setState("dialog", false)
  await Bun.sleep(1)
  expect(app.shown).toEqual([])
  openAvailableUpdate({ version: "3.3.3" })
  await Bun.sleep(1)
  expect(app.shown).toHaveLength(1)
})

test("forced prompts wait for existing dialogs and onboarding to end", async () => {
  const app = mount(true)
  app.setState({ dialog: true, onboarding: true })
  await Bun.sleep(1)
  expect(app.shown).toEqual([])
  app.setState("dialog", false)
  await Bun.sleep(1)
  expect(app.shown).toEqual([])
  app.setState("onboarding", false)
  await Bun.sleep(1)
  expect(app.shown).toEqual([{ forced: true }])
})

test("forced prompts wait for background tasks even with automatic updates disabled", async () => {
  const app = mount(true, false)
  app.setState("busy", true)
  await Bun.sleep(1)
  expect(app.shown).toEqual([])
  app.setState("busy", false)
  advance(1000)
  await Bun.sleep(1)
  expect(app.shown).toEqual([{ forced: true }])
})

test("normal startup updates retain the 30 second delay", async () => {
  const app = mount()
  await Bun.sleep(1)
  expect(app.shown).toEqual([])
  advance(30_000)
  expect(app.shown).toEqual([{ forced: false }])
})

test("ordinary update reminders restart four hours after the dialog closes", async () => {
  const app = mount()
  await Bun.sleep(1)
  advance(30_000)
  expect(app.shown).toHaveLength(1)
  expect([...timers.values()].some((timer) => timer.delay === 4 * 60 * 60 * 1000)).toBe(false)
  app.closed[0]()
  advance(4 * 60 * 60 * 1000)
  await Bun.sleep(1)
  expect(app.shown).toHaveLength(2)
})

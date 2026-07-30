import {
  createContext,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  useContext,
  type Accessor,
  type ParentProps,
} from "solid-js"

export const MAKE_LEFT_MIN = 200
export const MAKE_LEFT_MAX = 360
export const MAKE_LEFT_DEFAULT = 296
export const MAKE_CENTER_MIN = 360
export const MAKE_RIGHT_MIN = 500
export const MAKE_CRATIO_DEFAULT = 0.5

const LEFT_KEY = "octo:make:left-width"
const RATIO_KEY = "octo:make:split-ratio"

function loadNum(key: string, fallback: number, min: number, max: number): number {
  try {
    const n = parseFloat(localStorage.getItem(key) ?? "")
    if (!isNaN(n) && n >= min && n <= max) return n
  } catch {
    // localStorage unavailable
  }
  return fallback
}

export type MakeLayoutValue = {
  leftW: Accessor<number>
  setLeftW: (w: number) => void
  cRatio: Accessor<number>
  setCRatio: (r: number) => void
  windowW: Accessor<number>
  leftCollapsed: Accessor<boolean>
  rightCollapsed: Accessor<boolean>
  centerW: Accessor<number>
  rightW: Accessor<number>
  leftDrawerOpen: Accessor<boolean>
  toggleLeftDrawer: () => void
  rightDrawerOpen: Accessor<boolean>
  toggleRightDrawer: () => void
  rightManuallyHidden: Accessor<boolean>
  toggleRight: () => void
}

const MakeLayoutContext = createContext<MakeLayoutValue>()

export function useMakeLayout(): MakeLayoutValue {
  const ctx = useContext(MakeLayoutContext)
  if (!ctx) throw new Error("useMakeLayout must be used within MakeLayoutProvider")
  return ctx
}

export function MakeLayoutProvider(props: ParentProps) {
  const [leftW, setLeftWRaw] = createSignal(
    loadNum(LEFT_KEY, MAKE_LEFT_DEFAULT, MAKE_LEFT_MIN, MAKE_LEFT_MAX),
  )
  const [cRatio, setCRatioRaw] = createSignal(
    loadNum(RATIO_KEY, MAKE_CRATIO_DEFAULT, 0.05, 0.95),
  )
  const [windowW, setWindowW] = createSignal(
    typeof window !== "undefined" ? window.innerWidth : 1920,
  )
  const [leftDrawerOpen, setLeftDrawerOpen] = createSignal(false)
  const [rightDrawerOpen, setRightDrawerOpen] = createSignal(false)
  const [rightManuallyHidden, setRightManuallyHidden] = createSignal(false)

  onMount(() => {
    let raf = 0
    const update = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() =>
        setWindowW((prev) => (prev !== window.innerWidth ? window.innerWidth : prev)),
      )
    }
    update()
    window.addEventListener("resize", update)
    onCleanup(() => {
      cancelAnimationFrame(raf)
      window.removeEventListener("resize", update)
    })
  })

  const leftCollapsed = createMemo(() => windowW() <= leftW() + MAKE_CENTER_MIN)
  const rightCollapsed = createMemo(() => windowW() <= leftW() + MAKE_CENTER_MIN + MAKE_RIGHT_MIN)

  const centerW = createMemo(() => {
    const W = windowW()
    if (leftCollapsed()) return W
    const L = leftW()
    if (rightCollapsed()) return Math.max(MAKE_CENTER_MIN, W - L)
    const free = W - L
    const cIdeal = cRatio() * free
    if (cIdeal < MAKE_CENTER_MIN) return MAKE_CENTER_MIN
    if (free - cIdeal < MAKE_RIGHT_MIN) return free - MAKE_RIGHT_MIN
    return cIdeal
  })

  const rightW = createMemo(() => {
    if (leftCollapsed() || rightCollapsed()) return 0
    return Math.max(0, windowW() - leftW() - centerW())
  })

  const setLeftW = (w: number) => {
    const clamped = Math.max(MAKE_LEFT_MIN, Math.min(MAKE_LEFT_MAX, w))
    setLeftWRaw(clamped)
    try {
      localStorage.setItem(LEFT_KEY, String(clamped))
    } catch {
      // ignore
    }
  }

  const setCRatio = (r: number) => {
    const free = windowW() - leftW()
    let lo = 0.05
    let hi = 0.95
    if (free > 0) {
      lo = Math.max(lo, MAKE_CENTER_MIN / free)
      hi = Math.min(hi, (free - MAKE_RIGHT_MIN) / free)
    }
    if (lo > hi) lo = hi = MAKE_CRATIO_DEFAULT
    const clamped = Math.max(lo, Math.min(hi, r))
    setCRatioRaw(clamped)
    try {
      localStorage.setItem(RATIO_KEY, String(clamped))
    } catch {
      // ignore
    }
  }

  createEffect(() => {
    document.body.classList.toggle("make-left-drawer-open", leftDrawerOpen())
  })
  createEffect(() => {
    document.body.classList.toggle("make-right-drawer-open", rightDrawerOpen())
  })
  onCleanup(() => {
    document.body.classList.remove("make-left-drawer-open")
    document.body.classList.remove("make-right-drawer-open")
  })

  const toggleRight = () => {
    if (rightCollapsed()) setRightDrawerOpen((v) => !v)
    else setRightManuallyHidden((v) => !v)
  }

  const value: MakeLayoutValue = {
    leftW,
    setLeftW,
    cRatio,
    setCRatio,
    windowW,
    leftCollapsed,
    rightCollapsed,
    centerW,
    rightW,
    leftDrawerOpen,
    toggleLeftDrawer: () => setLeftDrawerOpen((v) => !v),
    rightDrawerOpen,
    toggleRightDrawer: () => setRightDrawerOpen((v) => !v),
    rightManuallyHidden,
    toggleRight,
  }

  return <MakeLayoutContext.Provider value={value}>{props.children}</MakeLayoutContext.Provider>
}

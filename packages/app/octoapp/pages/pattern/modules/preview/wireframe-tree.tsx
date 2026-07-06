import { For, Show, createMemo, createResource, type JSX } from "solid-js"
import { getDesktopApi } from "../../utils/desktop-api"

export type SlotInfo = {
  section_id: string
  element_id: string
  id_prefix: string
}

export type PlannerElement = {
  id: string
  component: string
  props: Record<string, unknown>
  children: string[]
}

export type SectionSimple = {
  id: string
  name: string
  description: string
}

export type SectionDetailLite = {
  id: string
  name: string
}

function detectDirection(className?: string): "row" | "column" | "unknown" {
  if (!className) return "unknown"
  if (className.includes("flex-row") || (className.includes("flex") && !className.includes("flex-col"))) return "row"
  if (className.includes("flex-col")) return "column"
  return "unknown"
}

function parseTailwindStyle(className?: string): Record<string, string | number> {
  const style: Record<string, string | number> = {}
  if (!className) return style

  const cls = className.trim()
  const spacing: Record<string, number> = { 0: 0, 0.5: 2, 1: 4, 1.5: 6, 2: 8, 2.5: 10, 3: 12, 3.5: 14, 4: 16, 5: 20, 6: 24, 7: 28, 8: 32, 9: 36, 10: 40, 11: 44, 12: 48, 14: 56, 16: 64, 20: 80, 24: 96, 28: 112, 32: 128, 36: 144, 40: 160, 44: 176, 48: 192, 52: 208, 56: 224, 60: 240, 64: 256, 72: 288, 80: 320, 96: 384 }

  const gapMatch = cls.match(/gap-(\d+(?:\.\d+)?)/)
  if (gapMatch) {
    const g = spacing[gapMatch[1]]
    if (g !== undefined) style.gap = `${g}px`
  }

  if (cls.includes("w-full")) style.width = "100%"
  if (/\bw-1\/2\b/.test(cls)) style.width = "50%"
  if (/\bw-1\/3\b/.test(cls)) style.width = "33.3333%"
  if (/\bw-2\/3\b/.test(cls)) style.width = "66.6667%"
  if (/\bw-1\/4\b/.test(cls)) style.width = "25%"
  if (/\bw-3\/4\b/.test(cls)) style.width = "75%"
  if (/\bw-1\/5\b/.test(cls)) style.width = "20%"
  if (/\bw-2\/5\b/.test(cls)) style.width = "40%"
  if (/\bw-3\/5\b/.test(cls)) style.width = "60%"
  if (/\bw-4\/5\b/.test(cls)) style.width = "80%"

  const mwMatch = cls.match(/max-w-(\d+(?:\.\d+)?)/)
  if (mwMatch) {
    const v = spacing[mwMatch[1]]
    if (v !== undefined) style["max-width"] = `${v}px`
  }
  if (cls.includes("max-w-full")) style["max-width"] = "100%"
  if (cls.includes("max-w-screen-xl")) style["max-width"] = "1280px"
  if (cls.includes("max-w-screen-lg")) style["max-width"] = "1024px"
  if (cls.includes("max-w-screen-md")) style["max-width"] = "768px"

  if (cls.includes("h-full")) style.height = "100%"
  if (cls.includes("h-screen")) style.height = "100vh"
  const hMatch = cls.match(/\bh-(\d+(?:\.\d+)?)/)
  if (hMatch) {
    const v = spacing[hMatch[1]]
    if (v !== undefined) style.height = `${v}px`
  }

  if (cls.includes("min-h-screen")) style["min-height"] = "100vh"

  if (cls.includes("flex-1")) style.flex = "1"
  if (cls.includes("flex-shrink-0") || cls.includes("shrink-0")) style["flex-shrink"] = 0

  const radiusMap: Record<string, string> = { "rounded-none": "0", "rounded-sm": "2px", "rounded": "4px", "rounded-md": "6px", "rounded-lg": "8px", "rounded-xl": "12px", "rounded-2xl": "16px", "rounded-3xl": "24px", "rounded-full": "9999px" }
  for (const [k, v] of Object.entries(radiusMap)) {
    if (cls.includes(k)) { style["border-radius"] = v; break }
  }

  return style
}

export function WireframeTree(props: {
  planner: Record<string, unknown>
  intentDescription: Record<string, unknown>
  selectedSectionId?: string
  onSelectSection?: (sectionId: string) => void
  sectionDetails?: SectionDetailLite[]
  showSectionInfo?: boolean
  boxBorderWidth?: number
  enableHover?: boolean
}): JSX.Element {
  const slots = createMemo(() => (props.planner.slots ?? []) as SlotInfo[])
  const elements = createMemo(() => (props.planner.elements ?? []) as PlannerElement[])
  const sections = createMemo(() => (props.intentDescription.sections ?? []) as SectionSimple[])
  const slotMap = createMemo(() => {
    const map = new Map<string, string>()
    for (const s of slots()) map.set(s.element_id, s.section_id)
    return map
  })
  const rootId = createMemo(() => (props.planner.rootId ?? "") as string)

  const elementMap = createMemo(() => {
    const map = new Map<string, PlannerElement>()
    for (const el of elements()) map.set(el.id, el)
    return map
  })

  const classNames = createMemo(() => {
    const set = new Set<string>()
    for (const el of elements()) {
      const cls = (el.props?.className as string) ?? (el.props?.class as string)
      if (cls?.trim()) set.add(cls.trim())
    }
    return [...set]
  })

  const [cssMap] = createResource(classNames, async (names) => {
    const api = getDesktopApi()?.tailwindToCss
    if (!api || names.length === 0) return new Map<string, Record<string, string>>()
    const entries = await Promise.all(names.map(async (cn) => [cn, await api(cn)] as const))
    return new Map(entries)
  })

  function sectionName(sectionId: string): string {
    return sections().find((s) => s.id === sectionId)?.name
      ?? props.sectionDetails?.find((d) => d.id === sectionId)?.name
      ?? sectionId
  }

  function sectionDescription(sectionId: string): string {
    return sections().find((s) => s.id === sectionId)?.description ?? ""
  }

  function renderElement(id: string): JSX.Element {
    const el = elementMap().get(id)
    if (!el) return <></>

    const cls = (el.props?.className as string) ?? (el.props?.class as string) ?? ""
    const isSlot = slotMap().has(el.id)
    const sectionId = slotMap().get(el.id)
    const isFlex = !!cls && /\bflex\b/.test(cls)
    const direction = detectDirection(cls)
    const isRow = direction === "row"
    const apiCss = cssMap()?.get(cls)
    const fallbackStyle = parseTailwindStyle(cls)
    const resolvedStyle = (apiCss ?? fallbackStyle) as Record<string, string | number>

    const cleanedStyle = Object.fromEntries(
      Object.entries(resolvedStyle).filter(([k, v]) => {
        if ((k === "min-height" || k === "min-width") && (v === 0 || v === "0" || v === "0px")) return false
        return true
      }),
    )

    const hasExplicitHeight = cleanedStyle["height"] !== undefined && cleanedStyle["height"] !== "auto"
    const hasExplicitMinHeight = cleanedStyle["min-height"] !== undefined

    const children = el.children ?? []

    const baseStyle: Record<string, string | number | undefined> = {
      ...!hasExplicitHeight && !hasExplicitMinHeight ? { "min-height": "200px" } : {},
      ...isFlex ? {
        display: "flex",
        "flex-direction": isRow ? "row" : "column",
        "flex-wrap": isRow && cleanedStyle["flex-wrap"] !== "nowrap" ? "wrap" : undefined,
      } : {},
      ...cleanedStyle,
    }

    if (!isSlot) {
      return (
        <div style={{ ...baseStyle, flex: cleanedStyle.flex ?? 1 }}>
          <For each={children}>{(childId) => renderElement(childId)}</For>
        </div>
      )
    }

    const name = sectionId ? sectionName(sectionId) : ""
    const desc = sectionId ? sectionDescription(sectionId) : ""

    return (
      <div
        class="wireframe-box"
        style={{ ...baseStyle, "border-width": `${props.boxBorderWidth ?? 2}px` }}
        classList={{ active: sectionId === props.selectedSectionId,"no-hover": props.enableHover === false, "large-title": props.showSectionInfo === false }}
        onClick={() => { if (sectionId) props.onSelectSection?.(sectionId) }}
      >
          {name}
        <Show when={children.length > 0}>
          <For each={children}>{(childId) => renderElement(childId)}</For>
        </Show>
      </div>
    )
  }

  return (
    <Show when={rootId() && elementMap().has(rootId())}>
      <div class="wireframe-layout">
        {renderElement(rootId())}
      </div>
    </Show>
  )
}

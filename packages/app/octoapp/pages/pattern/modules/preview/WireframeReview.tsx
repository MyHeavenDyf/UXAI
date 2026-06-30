import { For, Show, createMemo, createSignal, createEffect, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { Button } from "@opencode-ai/ui/button"
import "../../assets/style/preview/wireframe.css"

type SlotInfo = {
  section_id: string
  element_id: string
  id_prefix: string
}

type SectionDetail = {
  id: string
  name: string
  intent: string
  function: string
  layout: string
  elements: string
  data?: Record<string, unknown>
}

type SectionSimple = {
  id: string
  name: string
  description: string
}

type PlannerElement = {
  id: string
  component: string
  props: Record<string, unknown>
  children: string[]
}

type TreeNode = {
  id: string
  component: string
  props: Record<string, unknown>
  children: TreeNode[]
  isSlot: boolean
  sectionId?: string
  direction: "row" | "column" | "unknown"
  isFlex: boolean
  layoutStyle: Record<string, string | number>
}

export type WireframeReviewResult = {
  updatedSectionDetails: SectionDetail[]
  intentDescription: Record<string, unknown>
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

function buildTree(elements: PlannerElement[], rootId: string, slotMap: Map<string, string>): TreeNode | null {
  const map = new Map<string, PlannerElement>()
  for (const el of elements) map.set(el.id, el)
  const root = map.get(rootId)
  if (!root) return null

  function walk(el: PlannerElement): TreeNode {
    const cls = (el.props?.className as string) ?? (el.props?.class as string)
    const hasFlex = !!cls && /\bflex\b/.test(cls)
    return {
      id: el.id,
      component: el.component,
      props: el.props,
      children: (el.children ?? []).map((cid) => {
        const child = map.get(cid)
        return child ? walk(child) : { id: cid, component: "unknown", props: {}, children: [], isSlot: false, direction: "unknown", isFlex: false, layoutStyle: {} }
      }),
      isSlot: slotMap.has(el.id),
      sectionId: slotMap.get(el.id),
      direction: detectDirection(cls),
      isFlex: hasFlex,
      layoutStyle: parseTailwindStyle(cls),
    }
  }

  return walk(root)
}

export function WireframeReview(props: {
  planner: Record<string, unknown>
  intentDescription: Record<string, unknown>
  userInput: string
  onConfirm: (result: WireframeReviewResult) => void
}): JSX.Element {
  const slots = createMemo(() => (props.planner.slots ?? []) as SlotInfo[])
  const elements = createMemo(() => (props.planner.elements ?? []) as PlannerElement[])
  const sections = createMemo(() => (props.intentDescription.sections ?? []) as SectionSimple[])
  const sectionDetails = createMemo(() => (props.intentDescription.sectionDetailList ?? []) as SectionDetail[])

  const slotMap = createMemo(() => {
    const map = new Map<string, string>()
    for (const s of slots()) map.set(s.element_id, s.section_id)
    return map
  })

  const rootId = createMemo(() => (props.planner.rootId ?? "") as string)
  const tree = createMemo(() => buildTree(elements(), rootId(), slotMap()))

  const [selectedSectionId, setSelectedSectionId] = createSignal<string>("")

  const selectedSlot = createMemo(() => slots().find(s => s.section_id === selectedSectionId()))

  const [editing, setEditing] = createStore<{ details: SectionDetail[] }>({
    details: JSON.parse(JSON.stringify(sectionDetails())),
  })

  const moduleCardRefs = new Map<string, HTMLDivElement>()

  createEffect(() => {
    const allSlots = slots()
    if (allSlots.length > 0 && !selectedSectionId()) {
      setSelectedSectionId(allSlots[0].section_id)
    }
  })

  createEffect(() => {
    const id = selectedSectionId()
    if (id) {
      const el = moduleCardRefs.get(id)
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" })
    }
  })

  function sectionName(sectionId: string): string {
    return sections().find((s) => s.id === sectionId)?.name
      ?? editing.details.find((d) => d.id === sectionId)?.name
      ?? sectionId
  }

  function sectionDescription(sectionId: string): string {
    return sections().find((s) => s.id === sectionId)?.description ?? ""
  }

  function handleField(sectionId: string, field: "intent" | "function" | "elements", value: string) {
    const idx = editing.details.findIndex((d) => d.id === sectionId)
    if (idx === -1) return
    setEditing("details", idx, field, value)
  }

  function handleConfirm() {
    props.onConfirm({
      updatedSectionDetails: editing.details,
      intentDescription: { ...props.intentDescription, sectionDetailList: editing.details },
    })
  }

  function renderNode(node: TreeNode): JSX.Element {
    const isRow = node.direction === "row"
    const baseStyle: Record<string, string | number | undefined> = {
      ...node.isFlex ? {
        display: "flex",
        "flex-direction": isRow ? "row" : "column",
        "flex-wrap": isRow && node.layoutStyle["flex-wrap"] !== "nowrap" ? "wrap" : undefined,
      } : {},
      ...node.layoutStyle,
    }

    if (!node.isSlot) {
      return (
        <div style={{ ...baseStyle, flex: node.layoutStyle.flex ?? 1 }}>
          <For each={node.children}>{(child) => renderNode(child)}</For>
        </div>
      )
    }

    const name = node.sectionId ? sectionName(node.sectionId) : ""
    const desc = node.sectionId ? sectionDescription(node.sectionId) : ""

    return (
      <div
        class="wireframe-box"
        classList={{ active: node.sectionId === selectedSectionId() }}
        onClick={() => { if (node.sectionId) setSelectedSectionId(node.sectionId) }}
      >
        <div class="wireframe-box-name">{name}</div>
        <Show when={desc}>
          <div class="wireframe-box-desc">{desc}</div>
        </Show>
        <Show when={node.children.length > 0}>
          <For each={node.children}>{(child) => renderNode(child)}</For>
        </Show>
      </div>
    )
  }

  return (
    <div class="wireframe-review-container">
      <div class="wireframe-header">
        <div class="wireframe-header-left">
          <div class="wireframe-header-title">线框审查</div>
          <div class="wireframe-header-subtitle">
            请确认或修改每个模块的意图，确认后将据此生成最终页面
          </div>
        </div>
        <div class="wireframe-header-right">
          <Button variant="primary" size="large" onClick={handleConfirm} style={{ "background-color": "var(--octo-brand)", color: "white" }}>
            确认并继续生成
          </Button>
        </div>
      </div>

      <div class="wireframe-body">
        <div class="wireframe-layout-panel">
          <div class="wireframe-layout-label">布局预览</div>
          <div class="wireframe-canvas">
            <Show when={tree()}>
              <div class="wireframe-layout">
                {renderNode(tree()!)}
              </div>
            </Show>
          </div>
        </div>

        <div class="wireframe-modules-panel">
          <div class="wireframe-modules-label">模块意图（可编辑）</div>
          <div class="wireframe-modules-list">
            <For each={slots()}>
              {(slot) => {
                const detail = editing.details.find(d => d.id === slot.section_id)
                return (
                  <div
                    ref={el => { moduleCardRefs.set(slot.section_id, el) }}
                    class="wireframe-module-card"
                    classList={{ active: selectedSectionId() === slot.section_id }}
                  >
                    <div class="wireframe-module-card-header" onClick={() => setSelectedSectionId(slot.section_id)}>
                      <span class="wireframe-module-card-id">{slot.section_id}</span>
                      <span class="wireframe-module-card-name">{sectionName(slot.section_id)}</span>
                    </div>
                    <Show when={selectedSectionId() === slot.section_id}>
                      <Show when={detail} fallback={<div class="wireframe-module-empty">该模块暂无详细意图</div>}>
                        <div class="wireframe-module-fields">
                          <WireframeField
                            label="意图"
                            value={detail!.intent}
                            onInput={(v) => handleField(slot.section_id, "intent", v)}
                          />
                          <WireframeField
                            label="功能"
                            value={detail!.function}
                            onInput={(v) => handleField(slot.section_id, "function", v)}
                          />
                          <WireframeField
                            label="元素"
                            value={detail!.elements}
                            onInput={(v) => handleField(slot.section_id, "elements", v)}
                          />
                        </div>
                      </Show>
                    </Show>
                  </div>
                )
              }}
            </For>
          </div>
        </div>
      </div>
    </div>
  )
}

function WireframeField(props: { label: string; value: string; onInput: (v: string) => void }) {
  return (
    <div class="wireframe-field">
      <label class="wireframe-field-label">{props.label}</label>
      <textarea
        class="wireframe-field-input"
        value={props.value}
        onInput={(e) => props.onInput(e.currentTarget.value)}
        rows={2}
      />
    </div>
  )
}

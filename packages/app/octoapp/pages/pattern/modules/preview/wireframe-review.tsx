import { For, Show, createMemo, createSignal, createEffect, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { Button } from "@opencode-ai/ui/button"
import { WireframeTree, type SlotInfo, type SectionSimple } from "./wireframe-tree"
import "../../assets/style/preview/wireframe.css"

type SectionDetail = {
  id: string
  name: string
  intent: string
  function: string
  elements: string
  data?: Record<string, unknown>
}

export type WireframeReviewResult = {
  updatedSectionDetails: SectionDetail[]
  intentDescription: Record<string, unknown>
}

export function WireframeReview(props: {
  planner: Record<string, unknown>
  intentDescription: Record<string, unknown>
  userInput: string
  onConfirm: (result: WireframeReviewResult) => void
}): JSX.Element {
  const slots = createMemo(() => (props.planner.slots ?? []) as SlotInfo[])
  const sections = createMemo(() => (props.intentDescription.sections ?? []) as SectionSimple[])
  const sectionDetails = createMemo(() => (props.intentDescription.sectionDetailList ?? []) as SectionDetail[])

  const [selectedSectionId, setSelectedSectionId] = createSignal<string>("")
  const [showDrawer, setShowDrawer] = createSignal(false)

  const [editing, setEditing] = createStore<{ details: SectionDetail[] }>({
    details: JSON.parse(JSON.stringify(sectionDetails())),
  })

  const moduleCardRefs = new Map<string, HTMLDivElement>()

  createEffect(() => {
    const id = selectedSectionId()
    if (id) {
      setShowDrawer(true)
      const el = moduleCardRefs.get(id)
      if (el) {
        const list = el.closest(".wireframe-modules-list")
        if (list) {
          const card = el as HTMLElement
          list.scrollTo({ top: card.offsetTop - (list as HTMLElement).offsetTop - 12, behavior: "smooth" })
        }
      }
    } else {
      setShowDrawer(false)
    }
  })

  function closeDrawer() {
    setShowDrawer(false)
    setSelectedSectionId("")
  }

  function handleSelectSection(sectionId: string) {
    setSelectedSectionId(sectionId)
  }

  function sectionName(sectionId: string): string {
    return sections().find((s) => s.id === sectionId)?.name
      ?? editing.details.find((d) => d.id === sectionId)?.name
      ?? sectionId
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

  return (
    <div class="wireframe-review-container">
      <div class="wireframe-header">
        <div class="wireframe-header-left">
          <div class="wireframe-header-content">
            <div class="wireframe-header-icon">?</div>
            <div class="wireframe-header-title">线框审查</div>
          </div>
          <div class="wireframe-header-subtitle">
            请确认或修改每个模块的意图，确认后将据此生成最终页面
          </div>
        </div>
        <div class="wireframe-header-right">
          <button class="wireframe-header-confirm-btn"  onClick={handleConfirm}>
            确认并继续生成
          </button>
        </div>
      </div>

      <div class="wireframe-body">
        <div class="wireframe-layout-panel">
          <div class="wireframe-canvas">
            <WireframeTree
              planner={props.planner}
              intentDescription={props.intentDescription}
              selectedSectionId={selectedSectionId()}
              onSelectSection={handleSelectSection}
              sectionDetails={editing.details}
            />
          </div>
        </div>

        <div class="wireframe-drawer" classList={{ open: showDrawer() }}>
          <div class="wireframe-drawer-header">
            <div class="wireframe-modules-label">模块意图（可编辑）</div>
            <button class="wireframe-drawer-close" onClick={closeDrawer}>✕</button>
          </div>
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

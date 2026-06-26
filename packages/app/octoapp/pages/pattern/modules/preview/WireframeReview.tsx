import { For, Show, createMemo, type JSX } from "solid-js"
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

  // 可编辑的 sectionDetail 副本
  const [editing, setEditing] = createStore<{ details: SectionDetail[] }>({
    details: JSON.parse(JSON.stringify(sectionDetails())),
  })

  function sectionName(sectionId: string): string {
    return sections().find((s) => s.id === sectionId)?.name
      ?? editing.details.find((d) => d.id === sectionId)?.name
      ?? sectionId
  }

  function sectionDescription(sectionId: string): string {
    return sections().find((s) => s.id === sectionId)?.description ?? ""
  }

  function editDetail(sectionId: string): SectionDetail | undefined {
    return editing.details.find((d) => d.id === sectionId)
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
      {/* 顶部标题栏 */}
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

      {/* 主体：粗略布局示意 + 模块卡片列表 */}
      <div class="wireframe-body">
        {/* 左侧：粗略布局线框 */}
        <div class="wireframe-layout-panel">
          <div class="wireframe-layout-label">布局预览</div>
          <div class="wireframe-canvas">
            <For each={slots()}>
              {(slot) => (
                <div class="wireframe-slot-box" title={slot.element_id}>
                  <div class="wireframe-slot-id">{slot.section_id}</div>
                  <div class="wireframe-slot-name">{sectionName(slot.section_id)}</div>
                  <div class="wireframe-slot-desc">{sectionDescription(slot.section_id)}</div>
                </div>
              )}
            </For>
          </div>
        </div>

        {/* 右侧：可编辑的模块意图卡片 */}
        <div class="wireframe-modules-panel">
          <div class="wireframe-modules-label">模块意图（可编辑）</div>
          <div class="wireframe-modules-list">
            <For each={slots()}>
              {(slot) => {
                const detail = editDetail(slot.section_id)
                return (
                  <div class="wireframe-module-card">
                    <div class="wireframe-module-card-header">
                      <span class="wireframe-module-card-id">{slot.section_id}</span>
                      <span class="wireframe-module-card-name">{sectionName(slot.section_id)}</span>
                    </div>
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

/**
 * 3D 场景规划审查（SceneWireframeReview）
 *
 * 暂停点3 UI：展示 planner 的空间分区树（rootId + slots），让设计师审查/编辑
 * 每个 sectionDetail（intent/function/layout/elements/zoneHint），确认后触发
 * create_modules_json 并行生成分区物体。
 *
 * 比 pattern 的 wireframe-review 简化：去掉 PatternMatch 相关（3D 无模板库）。
 * 自包含渲染（不依赖 wireframe-tree），内联 slots 列表 + 编辑抽屉。
 */
import { For, Show, createMemo, createSignal, createEffect, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { Button } from "@opencode-ai/ui/button"
import type { ScenePlanner } from "../../agents/merge"

type SlotInfo = {
  section_id: string
  element_id: string
  id_prefix: string
  zone_description?: string
  object_count_hint?: number
}

type SectionSimple = { id: string; name: string }

type SectionDetail = {
  id: string
  name?: string
  intent: string
  function: string
  elements: string
  layout: string
}

export type SceneWireframeReviewResult = {
  intentDescription: Record<string, unknown>
}

export function SceneWireframeReview(props: {
  planner: ScenePlanner
  intentDescription: Record<string, unknown>
  userInput: string
  onConfirm: (result: SceneWireframeReviewResult) => void
}): JSX.Element {
  const slots = createMemo<SlotInfo[]>(() => (props.planner.slots ?? []) as SlotInfo[])
  const sections = createMemo<SectionSimple[]>(() => (props.intentDescription.sections ?? []) as SectionSimple[])
  const sectionDetails = createMemo<SectionDetail[]>(() => (props.intentDescription.sectionDetailList ?? []) as SectionDetail[])

  const [selectedSectionId, setSelectedSectionId] = createSignal<string>("")
  const [showDrawer, setShowDrawer] = createSignal(false)
  const [editing, setEditing] = createStore<{ details: SectionDetail[] }>({
    details: JSON.parse(JSON.stringify(sectionDetails())),
  })

  createEffect(() => {
    const id = selectedSectionId()
    setShowDrawer(!!id)
  })

  function sectionName(sectionId: string): string {
    return sections().find(s => s.id === sectionId)?.name
      ?? editing.details.find(d => d.id === sectionId)?.name
      ?? sectionId
  }

  function handleField(sectionId: string, field: "intent" | "function" | "elements" | "layout", value: string) {
    const idx = editing.details.findIndex(d => d.id === sectionId)
    if (idx === -1) return
    setEditing("details", idx, field, value)
  }

  function handleConfirm() {
    props.onConfirm({
      intentDescription: { ...props.intentDescription, sectionDetailList: editing.details },
    })
    setShowDrawer(false)
    setSelectedSectionId("")
  }

  const selectedDetail = createMemo(() => editing.details.find(d => d.id === selectedSectionId()))

  return (
    <div class="flex h-full w-full bg-[var(--octo-background-base,#fff)] text-[var(--octo-text-strong,#111)]">
      {/* 左：分区列表 */}
      <div class="flex flex-1 flex-col overflow-hidden">
        <div class="border-b border-[var(--octo-border,rgba(0,0,0,0.08))] px-6 py-4">
          <div class="text-lg font-semibold">场景规划审查</div>
          <div class="mt-1 text-xs text-[var(--octo-text-secondary,rgba(0,0,0,0.5))]">
            审查场景空间分区，点击分区可编辑详细意图。确认后生成 3D 物体。
          </div>
        </div>

        {/* 场景宏观信息 */}
        <div class="border-b border-[var(--octo-border,rgba(0,0,0,0.08))] px-6 py-3 text-xs text-[var(--octo-text-secondary,rgba(0,0,0,0.6))]">
          <Show when={props.planner.camera}>
            <span>相机：{(props.planner.camera as any)?.type} / </span>
          </Show>
          <span>灯光：{(props.planner.lights ?? []).length} 个光源 / </span>
          <span>分区：{slots().length} 个</span>
        </div>

        {/* slots 列表 */}
        <div class="flex-1 overflow-auto px-6 py-4">
          <div class="flex flex-col gap-3">
            <For each={slots()}>
              {(slot) => (
                <div
                  class="rounded-lg border p-4 transition-colors hover:bg-[var(--octo-hover,rgba(0,0,0,0.03))] cursor-pointer"
                  classList={{
                    "border-[var(--octo-primary,#5b8def)] bg-[var(--octo-hover,rgba(91,141,239,0.06))]": selectedSectionId() === slot.section_id,
                    "border-[var(--octo-border,rgba(0,0,0,0.08))]": selectedSectionId() !== slot.section_id,
                  }}
                  onClick={() => setSelectedSectionId(slot.section_id)}
                >
                  <div class="flex items-center justify-between">
                    <div class="flex items-center gap-2">
                      <span class="text-sm font-medium">{sectionName(slot.section_id)}</span>
                      <span class="rounded bg-[var(--octo-hover,rgba(0,0,0,0.06))] px-1.5 py-0.5 text-[10px] text-[var(--octo-text-secondary,rgba(0,0,0,0.5))]">
                        {slot.id_prefix}
                      </span>
                    </div>
                    <span class="text-xs text-[var(--octo-text-secondary,rgba(0,0,0,0.5))]">
                      预计 {slot.object_count_hint ?? "?"} 个物体
                    </span>
                  </div>
                  <Show when={slot.zone_description}>
                    <div class="mt-1.5 text-xs text-[var(--octo-text-secondary,rgba(0,0,0,0.6))]">
                      📍 {slot.zone_description}
                    </div>
                  </Show>
                  <Show when={editing.details.find(d => d.id === slot.section_id)}>
                    {(detail) => (
                      <div class="mt-2 text-xs leading-relaxed text-[var(--octo-text-secondary,rgba(0,0,0,0.6))]">
                        {detail().intent}
                      </div>
                    )}
                  </Show>
                </div>
              )}
            </For>
          </div>
        </div>

        {/* 底部确认 */}
        <div class="flex items-center justify-end gap-3 border-t border-[var(--octo-border,rgba(0,0,0,0.08))] px-6 py-3">
          <Button onClick={handleConfirm}>确认并生成场景</Button>
        </div>
      </div>

      {/* 右：编辑抽屉 */}
      <Show when={showDrawer() && selectedDetail()}>
        <div class="flex w-[360px] flex-col border-l border-[var(--octo-border,rgba(0,0,0,0.08))] bg-[var(--octo-surface,#fafafa)]">
          <div class="flex items-center justify-between border-b border-[var(--octo-border,rgba(0,0,0,0.08))] px-5 py-3">
            <span class="text-sm font-medium">编辑分区：{sectionName(selectedSectionId())}</span>
            <button class="text-xs text-[var(--octo-text-secondary,rgba(0,0,0,0.5))]" onClick={() => setSelectedSectionId("")}>✕</button>
          </div>
          <div class="flex-1 space-y-4 overflow-auto px-5 py-4">
            <Field label="分区意图 (intent)">
              <textarea
                class="w-full resize-none rounded border border-[var(--octo-border,rgba(0,0,0,0.1))] bg-white px-3 py-2 text-xs outline-none"
                rows={2}
                value={selectedDetail()!.intent}
                onInput={e => handleField(selectedSectionId(), "intent", e.currentTarget.value)}
              />
            </Field>
            <Field label="分区功能 (function)">
              <textarea
                class="w-full resize-none rounded border border-[var(--octo-border,rgba(0,0,0,0.1))] bg-white px-3 py-2 text-xs outline-none"
                rows={2}
                value={selectedDetail()!.function}
                onInput={e => handleField(selectedSectionId(), "function", e.currentTarget.value)}
              />
            </Field>
            <Field label="空间布局 (layout)">
              <textarea
                class="w-full resize-none rounded border border-[var(--octo-border,rgba(0,0,0,0.1))] bg-white px-3 py-2 text-xs outline-none"
                rows={2}
                value={selectedDetail()!.layout}
                onInput={e => handleField(selectedSectionId(), "layout", e.currentTarget.value)}
              />
            </Field>
            <Field label="物体清单 (elements)">
              <textarea
                class="w-full resize-none rounded border border-[var(--octo-border,rgba(0,0,0,0.1))] bg-white px-3 py-2 text-xs outline-none"
                rows={3}
                value={selectedDetail()!.elements}
                onInput={e => handleField(selectedSectionId(), "elements", e.currentTarget.value)}
              />
            </Field>
          </div>
        </div>
      </Show>
    </div>
  )
}

function Field(props: { label: string; children: JSX.Element }): JSX.Element {
  return (
    <div>
      <div class="mb-1 text-xs font-medium text-[var(--octo-text-secondary,rgba(0,0,0,0.6))]">{props.label}</div>
      {props.children}
    </div>
  )
}

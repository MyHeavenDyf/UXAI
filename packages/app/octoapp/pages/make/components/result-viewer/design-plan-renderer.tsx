import { Markdown } from "@opencode-ai/ui/markdown"
import { Button } from "@opencode-ai/ui/button"
import { Show, createEffect, createSignal, on } from "solid-js"
import type { JSX } from "solid-js"
import { IconCardPlan } from "../../icons"

/**
 * Renderer for `type="design-plan"` artifacts.
 *
 * Shows the plan as Markdown (no iframe, no syntax highlighting — just
 * readable text). Header buttons:
 *   preview mode: [编辑] [调整方案] [确认开始生成]
 *   edit mode:    [取消] [保存]
 *
 * 编辑后通过 onContentChange 传回父组件,父组件走 persistTabChanges →
 * snapshotStore + autoSaveArtifact 双层持久化。刷新/切换 session 后,
 * 通过 snapshotStore.restoreLatestByTabId 恢复用户编辑版本。
 */
export function DesignPlanRenderer(props: {
  content: string
  title: string
  artifactIdentifier?: string
  confirmed: boolean
  onConfirm: () => void
  onAdjust: () => void
  onContentChange?: (content: string) => void
}): JSX.Element {
  const [isEditing, setIsEditing] = createSignal(false)
  const [draft, setDraft] = createSignal(props.content)

  // 非编辑模式下,content 更新(agent 迭代方案) → 同步 draft
  // 编辑模式下,保留用户的未保存修改
  createEffect(on(() => props.content, (c) => {
    if (!isEditing()) setDraft(c)
  }))

  const handleSave = () => {
    props.onContentChange?.(draft())
    setIsEditing(false)
  }

  const handleCancel = () => {
    setDraft(props.content)
    setIsEditing(false)
  }

  return (
    <div class="flex flex-col h-full overflow-hidden" style={{ background: "var(--octo-surface-page)" }}>
      <div
        class="flex items-center justify-between shrink-0"
        style={{
          padding: "16px 24px",
          "border-bottom": "1px solid rgba(0,0,0,0.06)",
          background: "#fff",
        }}
      >
        <div class="flex items-center gap-2 min-w-0">
          <IconCardPlan size={18} class="shrink-0" />
          <div class="flex flex-col min-w-0">
            <span class="text-[15px] font-semibold truncate" style={{ color: "var(--octo-text-primary)" }}>
              {props.title}
            </span>
            <Show when={props.confirmed}>
              <span class="text-[11px]" style={{ color: "var(--octo-text-tertiary)" }}>
                已确认 · 正在生成 HTML
              </span>
            </Show>
          </div>
        </div>
        <div class="flex items-center gap-2 shrink-0">
          <Show
            when={!isEditing()}
            fallback={
              <>
                <Button variant="ghost" size="small" onClick={handleCancel}>
                  取消
                </Button>
                <Button variant="primary" size="small" onClick={handleSave}>
                  保存
                </Button>
              </>
            }
          >
            <Button variant="ghost" size="small" onClick={() => setIsEditing(true)}>
              编辑
            </Button>
            <Button
              variant="ghost"
              size="small"
              onClick={props.onAdjust}
              disabled={props.confirmed}
            >
              调整方案
            </Button>
            <Button
              variant="primary"
              size="small"
              onClick={props.onConfirm}
              disabled={props.confirmed}
            >
              {props.confirmed ? "已确认" : "确认开始生成"}
            </Button>
          </Show>
        </div>
      </div>
      <div class="flex-1 overflow-y-auto" style={{ padding: "24px" }}>
        <Show
          when={!isEditing()}
          fallback={
            <textarea
              value={draft()}
              onInput={(e) => setDraft(e.currentTarget.value)}
              class="w-full h-full resize-none outline-none p-3 rounded-[8px] text-[14px]"
              style={{
                "font-family": "var(--octo-font)",
                background: "rgba(0,0,0,0.02)",
                border: "1px solid rgba(0,0,0,0.08)",
                color: "var(--octo-text-primary)",
                "min-height": "400px",
              }}
            />
          }
        >
          <div
            class="prose prose-sm max-w-none"
            style={{ color: "var(--octo-text-primary)" }}
          >
            <Markdown text={props.content || "_方案生成中…_"} />
          </div>
        </Show>
      </div>
    </div>
  )
}
